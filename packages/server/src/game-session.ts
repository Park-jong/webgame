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
 * [행동 타임아웃 (S-7)] 사람 좌석이 행동할 차례(turn)/응답할 차례(response)이면 좌석별 마감을 둔다.
 * - 마감은 응답 구간 종료 후 실제로 행동 기회가 생길 때(뷰 전송 직전) 시작한다. 타이머는 여전히 최대 1개:
 *   가장 이른 마감에 하나만 걸고, 사람 행동이 수락되면 취소 후 남은 마감으로 다시 건다.
 * - 초과 시 자동 행동: turn은 뽑은 패 타패(쯔모기리), 불가하면 합법 비리치 타패 중 마지막 것. response는 pass.
 *   화료/리치/깡/부로는 절대 자동으로 하지 않는다. 항상 legalActions 원소를 dispatch에 넘긴다.
 * - 마감 남은 시간(deadlineMs)은 view 메시지 봉투에 본인에게만 붙인다(viewFor는 건드리지 않음).
 *   타임아웃 사실은 본인에게만 notice로 알리고 상대에겐 일반 상태 변화(타패/패스)로만 보인다.
 * - 연속 maxConsecutiveTimeouts회 초과하면 자동 모드: 이후 autoDelayMs 뒤 같은 규칙으로 행동. 유효 행동 수락 시 해제.
 * - 끊긴 좌석은 disconnectedTimeoutMs 뒤 같은 규칙으로 처리(자동 모드로 간주하지 않음, 카운트 안 함).
 *   재접속(S-8)은 RoomManager.seatReconnected -> onSeatReconnected(seat)로 자동 모드를 풀고 sendViewTo(seat)로 뷰를 다시 보낸다.
 * - 시간 제한 값이 유한하지 않으면(Infinity) 해당 마감은 비활성(테스트/무제한 방용).
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
export const TURN_TIMEOUT_MS = 30_000;
export const RESPONSE_TIMEOUT_MS = 15_000;
/** 끊긴 좌석의 자동 처리 대기 */
export const DISCONNECTED_TIMEOUT_MS = 3_000;
/** 자동 모드 좌석의 행동 지연 (봇 수준) */
export const AUTO_DELAY_MS = BOT_DELAY_MS;
/** 이 횟수만큼 연속 타임아웃되면 자동 모드 */
export const MAX_CONSECUTIVE_TIMEOUTS = 3;

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
  /**
   * 시간 옵션 규칙(turn/response/disconnected): 미지정=기본값, Infinity/NaN="마감 없음"(비활성),
   * 0 이하는 0으로 보정(마감 즉시 발동), 유한 양수는 setTimeout 안전 상한(2^31-1ms)으로 clamp.
   */
  turnTimeoutMs?: number;
  responseTimeoutMs?: number;
  disconnectedTimeoutMs?: number;
  /** 자동 모드 지연. 0 이하는 0, 상한 clamp. Infinity/NaN은 영구 정지를 막기 위해 기본값 사용 */
  autoDelayMs?: number;
  /** 자동 모드 진입 연속 횟수. 내림 후 1 이상으로 보정(NaN은 기본값, Infinity는 자동 모드 없음) */
  maxConsecutiveTimeouts?: number;
  /** 시계 주입(테스트용, ms). 남은 시간(deadlineMs) 계산에만 쓰이고 타이머 발동은 스케줄러가 결정 */
  now?: () => number;
  /** 봇 행동 결정 함수 주입(테스트용). 기본 core decideAction */
  botDecide?: (state: GameState, seat: Seat, rng: RandomFn) => Action;
  /** 시작 상태 주입(테스트용). 기본 createGame */
  initialState?: GameState;
}

/** setTimeout이 안전하게 다루는 최대 지연 */
export const MAX_TIMER_MS = 2 ** 31 - 1;

/** 시간 옵션 정규화: 미지정=기본값, NaN/Infinity=Infinity(마감 없음), 0 이하=0, 유한 양수는 상한 clamp */
function normalizeMs(v: number | undefined, def: number): number {
  if (v === undefined) return def;
  if (Number.isNaN(v) || v === Infinity) return Infinity;
  return Math.min(Math.max(v, 0), MAX_TIMER_MS);
}

/** 좌석 마감: normal만 본인에게 남은 시간을 알린다 */
interface Deadline {
  at: number;
  kind: "normal" | "auto" | "disconnected";
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
  /** 현재 걸린 타이머가 마감 타이머인지 (사람 행동 수락 시 취소 대상) */
  private deadlineTimer = false;
  /** 타이머 세대: 취소 후 뒤늦게 실행된 콜백을 무시하기 위함 */
  private timerId = 0;
  /** 좌석별 행동 마감 (시각은 now() 기준 ms). 응답 구간 중에는 비어 있다 */
  private readonly deadlines = new Map<Seat, Deadline>();
  private readonly timeouts: number[] = [0, 0, 0, 0];
  private readonly auto: boolean[] = [false, false, false, false];
  private readonly turnMs: number;
  private readonly responseMs: number;
  private readonly disconnectedMs: number;
  private readonly autoMs: number;
  private readonly maxTimeouts: number;
  private readonly now: () => number;
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
    this.turnMs = normalizeMs(options.turnTimeoutMs, TURN_TIMEOUT_MS);
    this.responseMs = normalizeMs(options.responseTimeoutMs, RESPONSE_TIMEOUT_MS);
    this.disconnectedMs = normalizeMs(options.disconnectedTimeoutMs, DISCONNECTED_TIMEOUT_MS);
    const auto = normalizeMs(options.autoDelayMs, AUTO_DELAY_MS);
    this.autoMs = Number.isFinite(auto) ? auto : AUTO_DELAY_MS;
    const n = options.maxConsecutiveTimeouts ?? MAX_CONSECUTIVE_TIMEOUTS;
    this.maxTimeouts = Number.isNaN(n) ? MAX_CONSECUTIVE_TIMEOUTS : Math.max(1, Math.floor(n));
    this.now = options.now ?? Date.now;
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

    // 유효한 행동: 연속 타임아웃 카운터 리셋 + 자동 모드 해제
    this.timeouts[seat] = 0;
    this.auto[seat] = false;
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
    // 수락된 행동: 본인 마감 취소 (마감 타이머는 취소하고 pump가 남은 마감으로 다시 건다)
    this.deadlines.delete(seat);
    this.cancelDeadlineTimer();
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
    // 마감 정보는 viewFor가 아니라 봉투에만, 본인(normal 마감)에게만 붙인다
    const d = this.deadlines.get(seat);
    const view = viewFor(s, seat);
    this.sendTo(
      seat,
      d?.kind === "normal" && !this.windowOpen
        ? { type: "view", view, deadlineMs: Math.max(0, d.at - this.now()) }
        : { type: "view", view },
    );
  }

  /** 좌석 연결 끊김 알림: 대기 중이던 마감을 짧은 끊김 마감으로 줄인다 */
  onSeatDisconnected(seat: Seat): void {
    if (!this.state || this.closed || this.halted) return;
    const old = this.deadlines.get(seat);
    if (!old || old.kind === "disconnected") return;
    this.deadlines.delete(seat);
    this.armDeadlines();
    const fresh = this.deadlines.get(seat);
    if (fresh) fresh.at = Math.min(fresh.at, old.at);
    this.retime();
  }

  /** 좌석 복귀 알림(S-8 훅): 자동 모드/카운터를 풀고 마감을 일반 시간으로 다시 시작한다. 뷰는 sendViewTo로 따로 보낸다 */
  onSeatReconnected(seat: Seat): void {
    this.timeouts[seat] = 0;
    this.auto[seat] = false;
    if (!this.state || this.closed || this.halted) return;
    if (!this.deadlines.delete(seat)) return;
    this.armDeadlines();
    this.retime();
  }

  /** 타이머 정리. 이후 어떤 입력도 처리하지 않는다 */
  close(): void {
    this.closed = true;
    this.clearTimer();
    this.queued.clear();
    this.deadlines.clear();
  }

  // -------------------------------------------------------------------------
  // 내부
  // -------------------------------------------------------------------------

  private broadcast(): void {
    this.armDeadlines(); // 뷰에 남은 시간을 실을 수 있도록 전송 전에 마감을 시작한다
    for (let seat = 0; seat < 4; seat++) this.sendViewTo(seat);
  }

  /** 상태 전이 (dispatch 예외 시 상태 불변). 응답 구간 진입을 감지한다 */
  private apply(action: Action): void {
    const prev = this.state!;
    const next = dispatch(prev, action);
    if (action.type === "discard" || (next.phase === "response" && prev.phase !== "response")) {
      this.windowOpen = true;
      this.queued.clear();
      this.deadlines.clear(); // 마감은 구간 종료 후 시작
    }
    this.state = next;
    const awaiting = awaitingSeats(next);
    for (const seat of [...this.deadlines.keys()]) if (!awaiting.includes(seat)) this.deadlines.delete(seat);
  }

  // -------------------------------------------------------------------------
  // 행동 마감
  // -------------------------------------------------------------------------

  /** 이 좌석에 걸 마감 길이. 해당 없음/비활성이면 undefined */
  private deadlineFor(seat: Seat): Deadline | undefined {
    const slot = this.room.seats[seat];
    if (slot?.kind !== "human") return undefined;
    const kind = !slot.connected ? "disconnected" : this.auto[seat] ? "auto" : "normal";
    const ms =
      kind === "disconnected"
        ? this.disconnectedMs
        : kind === "auto"
          ? this.autoMs
          : this.state!.phase === "turn"
            ? this.turnMs
            : this.responseMs;
    return Number.isFinite(ms) ? { at: this.now() + ms, kind } : undefined;
  }

  /** 행동 기회가 있는 사람 좌석 중 마감이 없는 좌석에 마감을 시작한다 (멱등) */
  private armDeadlines(): void {
    const s = this.state;
    if (!s || this.closed || this.halted || this.windowOpen) return;
    for (const seat of awaitingSeats(s)) {
      if (this.deadlines.has(seat)) continue;
      const d = this.deadlineFor(seat);
      if (d) this.deadlines.set(seat, d);
    }
  }

  private cancelDeadlineTimer(): void {
    if (this.deadlineTimer) this.clearTimer();
  }

  /** 현재 타이머 취소. 이미 큐에 들어간 낡은 콜백도 timerId 불일치로 무시된다 */
  private clearTimer(): void {
    this.cancelTimer?.();
    this.cancelTimer = undefined;
    this.deadlineTimer = false;
    this.timerId++;
  }

  /** 마감이 바뀌었으니 마감 타이머를 다시 건다 */
  private retime(): void {
    this.cancelDeadlineTimer();
    this.pump();
  }

  /** 사람 응답 대기: 가장 이른 마감에 타이머 하나만 건다 */
  private waitHuman(): void {
    this.armDeadlines();
    let target = Infinity;
    for (const d of this.deadlines.values()) target = Math.min(target, d.at);
    if (target === Infinity) return; // 마감 없음(끊김/무제한): 타이머 없이 대기
    const seats = [...this.deadlines].filter(([, d]) => d.at <= target).map(([seat]) => seat);
    this.later(Math.max(0, target - this.now()), () => this.fireDeadline(seats), true);
  }

  /** 마감 도달: 아직 같은 마감을 가진 좌석만 자동 행동 (한 번만 처리) */
  private fireDeadline(seats: Seat[]): void {
    for (const seat of seats) {
      const before = this.state!;
      const d = this.deadlines.get(seat);
      if (!d || !awaitingSeats(before).includes(seat)) continue;
      this.deadlines.delete(seat);
      if (d.kind === "normal") {
        this.sendTo(seat, { type: "notice", code: "timeout" });
        if (++this.timeouts[seat]! >= this.maxTimeouts && !this.auto[seat]) {
          this.auto[seat] = true;
          this.sendTo(seat, { type: "notice", code: "auto_mode" });
        }
      }
      const a = this.autoAction(before, seat);
      if (a) this.tryApply(a);
      if (this.state === before) this.noteProgress(before);
      if (this.halted) return;
    }
    this.broadcast();
  }

  /** 자동 규칙: response는 pass, turn은 쯔모기리 -> 아니면 마지막 합법 비리치 타패. 항상 legalActions 원소 */
  private autoAction(state: GameState, seat: Seat): Action | undefined {
    const legal = legalActions(state, seat);
    if (state.phase === "response") return legal.find((a) => a.type === "pass");
    const discards = legal.filter((a) => a.type === "discard" && a.riichi !== true);
    const drawn = state.drawnTile;
    const tsumogiri = drawn && discards.find((a) => a.type === "discard" && tileKey(a.tile) === tileKey(drawn));
    return tsumogiri ?? discards.at(-1);
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
        else this.waitHuman();
        return;
      case "response":
        if (awaitingSeats(s).some((x) => this.isBot(x))) this.later(0, () => this.botResponses());
        else this.waitHuman();
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

  private later(delayMs: number, fn: () => void, isDeadline = false): void {
    let fired = false;
    const id = ++this.timerId;
    const cancel = this.scheduler(() => {
      if (id !== this.timerId) return; // 취소된(낡은) 타이머
      fired = true;
      this.cancelTimer = undefined;
      this.deadlineTimer = false;
      if (this.closed || this.halted) return;
      fn();
      this.pump();
    }, delayMs);
    if (!fired) {
      this.cancelTimer = cancel;
      this.deadlineTimer = isDeadline;
    }
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
    this.clearTimer();
    this.queued.clear();
    this.deadlines.clear();
    for (let seat = 0; seat < 4; seat++) {
      this.sendTo(seat, { type: "error", code: "server_error", message: "서버 오류로 게임이 중단되었습니다" });
    }
  }
}
