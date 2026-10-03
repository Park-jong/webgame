/**
 * 방 하나의 서버 권위 게임 루프. GameState의 단일 소스는 이 객체(서버 메모리)다.
 *
 * [행동 검증 순서] 시작됨? -> seq -> 행동 가능 좌석? -> legalActions와 구조적 동일? -> dispatch
 * - 좌석은 소켓에 묶인 값만 사용한다(클라이언트 seat 불신). dispatch에는 서버가 만든 legalActions 원소를 넘긴다.
 * - 오류 응답에는 내부 상태를 싣지 않는다(고정 문구).
 * - seq는 좌석별로 마지막 처리 값보다 커야 한다. 검증을 통과한 seq는 이후 결과(불법 등)와 무관하게 소비된다.
 *
 * [진행] 상태가 바뀔 때마다 연결된 사람 좌석에 viewFor를 보낸다. 봇 차례/봇 응답은 스케줄러로 한 단계씩 진행한다.
 *
 * - seq가 마지막 값 + maxSeqJump(기본 1000)를 넘거나 이하면 bad_seq이고 lastSeq는 갱신하지 않는다(자기 잠금 방지).
 *
 * [응답 구간 타이밍 균일화]
 * 모든 타패(응답 가능자가 없어 core가 바로 다음 턴/유국으로 넘기는 경우 포함) 직후 responseWindowMs 동안 구간을 유지한 뒤 해결한다.
 * - 구간 중 사람 응답은 검증만 하고 큐에 쌓아 구간 종료 시 한꺼번에 적용(일찍 패스해도 종료가 앞당겨지지 않음).
 *   수락된 응답에는 해당 좌석에만 { type:"ack", seq }를 보낸다(클라이언트 버튼 비활성화용). 다른 좌석에는 절대 보내지 않는다.
 *   같은 구간에서 같은 좌석이 다시 응답하면 not_your_turn(위반 점수 정책은 그대로: 클라이언트는 ack 후 재전송하지 말 것).
 * - 봇 응답도 구간 종료 시 적용. 따라서 봇만 응답 대기여도 부로/론 가능 여부와 무관하게 같은 시점에 끝난다.
 * - 구간 동안 뷰 전송을 보류한다. 예외: 응답 단계이면서 응답 대상인 사람 좌석에는 응답할 수 있도록 뷰를 보낸다.
 *   구간 종료 시 전원에게 최종 뷰를 보낸다. 구간 중 phase가 turn/roundEnd인 상태에서의 행동은 not_your_turn.
 * - 게임 속도: 매 타패마다 responseWindowMs(기본 1000ms)가 걸린다(봇 포함). 옵션으로 조정 가능.
 * [남는 한계] 구간 종료 후에도 사람이 응답 대기 중이면 그 사람의 응답 시간에 진행이 의존한다.
 * 즉 "고정 지연 뒤에도 안 끝난다 = 어떤 사람이 응답 대기 중"임은 추측 가능하다. 또 응답 대상 사람은 구간 중에
 * 뷰를 받으므로 "내가 응답 대상"이라는 사실은 본인에게만 드러난다(상대는 이를 볼 수 없다). 완전 은닉은 불가능하다.
 *
 * [봇 정체 방지] 봇이 연속 maxBotFailures회 상태를 진행시키지 못하면 방을 정지(halt)하고
 * 사람에게 server_error를 1회 보낸다. 타이머는 정리되며 서버는 계속 동작한다.
 *
 * [끊김] 끊긴 사람 좌석의 자동 처리(S-7)는 없다. 그 좌석이 필요하면 게임은 타이머 없이 대기만 한다(busy-loop 없음).
 * 재접속(S-8)은 sendViewTo(seat)로 현재 뷰를 다시 보낸다.
 */

import {
  awaitingSeats,
  createGame,
  decideAction,
  dispatch,
  legalActions,
  startNextRound,
  type Action,
  type GameOptions,
  type GameState,
  type RandomFn,
  type Seat,
  type Tile,
} from "@mahjong/core";
import type { ClientAction, ErrorCode, ServerMessage } from "./protocol";
import type { Room } from "./room";
import { secureRandom } from "./rng";
import { viewFor } from "./view";

// ---------------------------------------------------------------------------
// 상수 / 타입
// ---------------------------------------------------------------------------

export const BOT_DELAY_MS = 600;
export const RESPONSE_WINDOW_MS = 1000;
export const NEXT_ROUND_DELAY_MS = 5000;
/** 한 번에 올릴 수 있는 seq 점프 상한 */
export const MAX_SEQ_JUMP = 1000;
/** 봇이 연속으로 진행에 실패할 수 있는 횟수 */
export const MAX_BOT_FAILURES = 3;

/** 지연 실행 후 취소 함수를 반환. 테스트에서는 즉시/수동 실행으로 대체 */
export type Scheduler = (fn: () => void, delayMs: number) => () => void;

export const timeoutScheduler: Scheduler = (fn, delayMs) => {
  const t = setTimeout(fn, delayMs);
  t.unref?.();
  return () => clearTimeout(t);
};

/** 즉시(동기) 실행 스케줄러: 테스트용 */
export const immediateScheduler: Scheduler = (fn) => {
  fn();
  return () => {};
};

export interface GameSessionOptions {
  /** 난수 주입(테스트용). 기본 crypto 기반 */
  rng?: RandomFn;
  gameOptions?: Partial<GameOptions>;
  scheduler?: Scheduler;
  botDelayMs?: number;
  responseWindowMs?: number;
  nextRoundDelayMs?: number;
  maxSeqJump?: number;
  maxBotFailures?: number;
  /** 봇 행동 결정 함수 주입(테스트용). 기본 core decideAction */
  botDecide?: (state: GameState, seat: Seat, rng: RandomFn) => Action;
  /** 시작 상태 주입(테스트용). 기본 createGame */
  initialState?: GameState;
}

/** 게임 로직 오류: 전송 계층이 error 메시지로 변환한다 */
export class GameError extends Error {
  /** 응답에 되돌려줄 요청 seq (전송 계층이 채운다) */
  seq?: number;
  constructor(
    readonly code: ErrorCode,
    message: string,
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// 행동 비교 키 (구조적 동일성)
// ---------------------------------------------------------------------------

function tileKey(t: Tile): string {
  switch (t.kind) {
    case "number":
      return `${t.suit}${t.rank}${t.isRedFive ? "r" : ""}`;
    case "wind":
      return `w:${t.wind}`;
    case "dragon":
      return `d:${t.dragon}`;
  }
}

/** 필드 순서·riichi 생략 여부에 무관한 정규 키. chi/pon의 use는 순서 무관 */
export function actionKey(a: Action): string {
  switch (a.type) {
    case "discard":
      return `discard|${a.seat}|${tileKey(a.tile)}|${a.riichi === true}`;
    case "ankan":
    case "shouminkan":
      return `${a.type}|${a.seat}|${tileKey(a.tile)}`;
    case "chi":
    case "pon":
      return `${a.type}|${a.seat}|${a.use.map(tileKey).sort().join(",")}`;
    default:
      return `${a.type}|${a.seat}`;
  }
}

// ---------------------------------------------------------------------------
// GameSession
// ---------------------------------------------------------------------------

export class GameSession {
  private state: GameState | undefined;
  private readonly rng: RandomFn;
  private readonly gameOptions: Partial<GameOptions>;
  private readonly scheduler: Scheduler;
  private readonly botDelay: number;
  private readonly windowMs: number;
  private readonly nextRoundMs: number;
  private readonly seqJump: number;
  private readonly maxFailures: number;
  private readonly botDecide: NonNullable<GameSessionOptions["botDecide"]>;
  private readonly initialState: GameState | undefined;
  private failures = 0;
  private halted = false;
  private readonly lastSeq: number[] = [-1, -1, -1, -1];
  /** 응답 구간 중 사람 응답 큐 (좌석 -> 서버가 만든 합법 행동) */
  private readonly queued = new Map<Seat, Action>();
  private windowOpen = false;
  private cancelTimer: (() => void) | undefined;
  private pumping = false;
  private again = false;
  private closed = false;

  constructor(
    private readonly room: Room,
    options: GameSessionOptions = {},
  ) {
    this.rng = options.rng ?? secureRandom;
    this.gameOptions = options.gameOptions ?? {};
    this.scheduler = options.scheduler ?? timeoutScheduler;
    this.botDelay = options.botDelayMs ?? BOT_DELAY_MS;
    this.windowMs = options.responseWindowMs ?? RESPONSE_WINDOW_MS;
    this.nextRoundMs = options.nextRoundDelayMs ?? NEXT_ROUND_DELAY_MS;
    this.seqJump = options.maxSeqJump ?? MAX_SEQ_JUMP;
    this.maxFailures = options.maxBotFailures ?? MAX_BOT_FAILURES;
    this.botDecide = options.botDecide ?? decideAction;
    this.initialState = options.initialState;
  }

  get started(): boolean {
    return this.state !== undefined;
  }

  get ended(): boolean {
    return this.state?.phase === "gameEnd";
  }

  /** 테스트/디버그용 읽기 전용 접근 (메시지로는 절대 내보내지 않는다) */
  peekState(): GameState | undefined {
    return this.state;
  }

  /** 빈 좌석을 봇으로 채우고 게임 시작 */
  start(): void {
    if (this.closed) throw new GameError("game_not_started", "방이 종료되었습니다");
    if (this.state) throw new GameError("game_already_started", "이미 게임이 시작되었습니다");
    this.room.fillBots();
    this.state = this.initialState ?? createGame(this.rng, this.gameOptions);
    this.broadcast();
    this.pump();
  }

  /** 소켓에 묶인 좌석의 행동 처리. 실패 시 GameError (내부 상태 미포함) */
  handleAction(seat: Seat, seq: number, client: ClientAction): void {
    const state = this.state;
    if (!state || this.closed) throw new GameError("game_not_started", "게임이 시작되지 않았습니다");
    if (this.halted) throw new GameError("server_error", "서버 오류로 게임이 중단되었습니다");
    const last = this.lastSeq[seat]!;
    if (!(seq > last) || seq > last + this.seqJump) throw new GameError("bad_seq", "seq가 허용 범위를 벗어났습니다");
    this.lastSeq[seat] = seq;
    if (!awaitingSeats(state).includes(seat) || this.queued.has(seat) || (this.windowOpen && state.phase !== "response")) {
      throw new GameError("not_your_turn", "지금은 행동할 수 없습니다");
    }
    const wanted = actionKey({ ...client, seat } as Action);
    const legal = legalActions(state, seat).find((a) => actionKey(a) === wanted);
    if (!legal) throw new GameError("illegal_action", "허용되지 않는 행동입니다");

    if (state.phase === "response" && this.windowOpen) {
      this.queued.set(seat, legal);
      this.sendTo(seat, { type: "ack", seq });
      return;
    }
    try {
      this.apply(legal);
    } catch {
      throw new GameError("illegal_action", "허용되지 않는 행동입니다");
    }
    this.broadcast();
    this.pump();
  }

  private sendTo(seat: Seat, msg: ServerMessage): void {
    const slot = this.room.seats[seat];
    if (slot?.kind === "human" && slot.conn) slot.conn.send(msg);
  }

  /** 좌석에 현재 뷰 재전송 (재접속용). 봇/끊긴 좌석이면 아무것도 하지 않는다 */
  sendViewTo(seat: Seat): void {
    const s = this.state;
    if (!s) return;
    // 응답 구간 중에는 응답 대상인 좌석에만 보낸다 (나머지는 구간 종료 때)
    if (this.windowOpen && !(s.phase === "response" && awaitingSeats(s).includes(seat))) return;
    this.sendTo(seat, { type: "view", view: viewFor(s, seat) });
  }

  /** 타이머 정리. 이후 어떤 입력도 처리하지 않는다 */
  close(): void {
    this.closed = true;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.queued.clear();
  }

  // -------------------------------------------------------------------------
  // 내부
  // -------------------------------------------------------------------------

  private broadcast(): void {
    for (let seat = 0; seat < 4; seat++) this.sendViewTo(seat);
  }

  /** 상태 전이 (dispatch 예외 시 상태 불변). 응답 구간 진입을 감지한다 */
  private apply(action: Action): void {
    const prev = this.state!;
    const next = dispatch(prev, action);
    if (action.type === "discard" || (next.phase === "response" && prev.phase !== "response")) {
      this.windowOpen = true;
      this.queued.clear();
    }
    this.state = next;
  }

  private tryApply(a: Action): void {
    try {
      this.apply(a);
    } catch {
      // 상태 불변. 서버는 계속 동작한다
    }
  }

  private isBot(seat: Seat): boolean {
    return this.room.seats[seat]?.kind === "bot";
  }

  /** 재진입 안전한 진행 루프. 한 번에 타이머 하나만 건다 */
  private pump(): void {
    if (this.pumping) {
      this.again = true;
      return;
    }
    this.pumping = true;
    try {
      do {
        this.again = false;
        this.step();
      } while (this.again);
    } finally {
      this.pumping = false;
    }
  }

  private step(): void {
    const s = this.state;
    if (this.closed || this.halted || !s || this.cancelTimer) return;
    if (this.windowOpen) {
      this.later(this.windowMs, () => this.closeWindow());
      return;
    }
    switch (s.phase) {
      case "turn":
        if (this.isBot(s.turn)) this.later(this.botDelay, () => this.botTurn());
        return;
      case "response":
        if (awaitingSeats(s).some((x) => this.isBot(x))) this.later(0, () => this.botResponses());
        return;
      case "roundEnd":
        this.later(this.nextRoundMs, () => {
          this.state = startNextRound(this.state!, this.rng);
          this.broadcast();
        });
        return;
      case "gameEnd":
        return;
    }
  }

  private later(delayMs: number, fn: () => void): void {
    let fired = false;
    const cancel = this.scheduler(() => {
      fired = true;
      this.cancelTimer = undefined;
      if (this.closed || this.halted) return;
      fn();
      this.pump();
    }, delayMs);
    if (!fired) this.cancelTimer = cancel;
  }

  /** 봇 행동 결정. 실패 시 첫 합법 행동으로 대체해 멈춤을 막는다 */
  private botAction(seat: Seat): Action | undefined {
    const state = this.state!;
    try {
      return this.botDecide(state, seat, this.rng);
    } catch {
      return legalActions(state, seat)[0];
    }
  }

  private botTurn(): void {
    const s = this.state!;
    if (s.phase !== "turn" || !this.isBot(s.turn)) return;
    const a = this.botAction(s.turn);
    if (a) this.tryApply(a);
    this.noteProgress(s);
    this.broadcast();
  }

  /** 응답 구간 종료: 사람 큐 + 봇 응답을 적용 */
  private closeWindow(): void {
    this.windowOpen = false;
    const queued = [...this.queued.values()];
    this.queued.clear();
    for (const a of queued) this.tryApply(a);
    this.applyBotResponses();
    this.broadcast();
  }

  private botResponses(): void {
    this.applyBotResponses();
    this.broadcast();
  }

  private applyBotResponses(): void {
    for (const seat of awaitingSeats(this.state!)) {
      const s = this.state!;
      if (s.phase !== "response" || !awaitingSeats(s).includes(seat) || !this.isBot(seat)) continue;
      const a = this.botAction(seat);
      if (a) this.tryApply(a);
      this.noteProgress(s);
      if (this.halted) return;
    }
  }

  /** 봇 한 수 후 상태가 진행되지 않았으면 실패로 센다. 연속 한도 초과 시 방을 정지 */
  private noteProgress(before: GameState): void {
    if (this.state !== before) {
      this.failures = 0;
      return;
    }
    if (++this.failures >= this.maxFailures) this.halt();
  }

  private halt(): void {
    if (this.halted) return;
    this.halted = true;
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.queued.clear();
    for (let seat = 0; seat < 4; seat++) {
      this.sendTo(seat, { type: "error", code: "server_error", message: "서버 오류로 게임이 중단되었습니다" });
    }
  }
}
