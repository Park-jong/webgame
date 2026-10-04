/**
 * S-9 회귀/퍼즈/부하 테스트 공용 헬퍼 (테스트 전용. 프로덕션 코드에서 import 금지)
 *
 * - STRESS=1 이면 긴 버전(반복 수 확대)을 켠다. 기본은 짧은 버전.
 * - 모든 무작위는 시드 고정 PRNG. 실패 재현을 위해 시드를 출력한다(logSeed).
 */

import { WebSocket } from "ws";
import type { RandomFn } from "@mahjong/core";
import { ERROR_CODES, type Connection, type SeatView, type ServerMessage } from "./index";

// ---------------------------------------------------------------------------
// 규모 / 시드
// ---------------------------------------------------------------------------

export const STRESS = process.env.STRESS === "1";
/** 짧은 버전 값 / 긴 버전 값 */
export const scale = <T>(short: T, long: T): T => (STRESS ? long : short);
/** 시드 환경변수로 재현 가능: FUZZ_SEED=123 */
export const baseSeed = (def: number): number => (process.env.FUZZ_SEED ? Number(process.env.FUZZ_SEED) : def);
export function logSeed(name: string, seed: number): void {
  console.log(`[seed] ${name} seed=${seed} (재현: FUZZ_SEED=${seed}${STRESS ? " STRESS=1" : ""})`);
}

export function seeded(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export const pickOf = <T>(rng: RandomFn, list: readonly T[]): T => list[Math.floor(rng() * list.length)]!;
export const intIn = (rng: RandomFn, lo: number, hi: number): number => lo + Math.floor(rng() * (hi - lo + 1));

// ---------------------------------------------------------------------------
// 가짜 Connection
// ---------------------------------------------------------------------------

export type FakeConn = Connection & { sent: ServerMessage[]; closed: boolean; terminated: boolean };
export const fakeConn = (): FakeConn => {
  const c: FakeConn = {
    sent: [],
    closed: false,
    terminated: false,
    send: (m) => void c.sent.push(m),
    close: () => void (c.closed = true),
    terminate: () => void (c.terminated = true),
  };
  return c;
};

// ---------------------------------------------------------------------------
// 정보 누출 검사
// ---------------------------------------------------------------------------

/** view.test.ts의 금지 키 목록 + 시드/토큰 계열 */
export const FORBIDDEN_KEYS = ["liveWall", "deadWall", "seed", "rng", "ronEligible", "responses", "furitenTemp", "pendingKanDora", "firstDiscards", "options"];
const VIEW_TOP_KEYS = new Set([
  "awaitingYou", "dealer", "doraIndicators", "drawnTile", "furiten", "hand", "honba", "kuikae", "kyoku", "legalActions",
  "liveWallCount", "pending", "phase", "players", "result", "riichiSticks", "roundWind", "seat", "turn",
]);
const PLAYER_KEYS = new Set(["seat", "seatWind", "score", "riichi", "handCount", "melds", "discards"]);
const MESSAGE_TYPES = new Set(["joined", "view", "error", "ack", "notice", "pong"]);
/** 오류 메시지에 나오면 안 되는 내부 정보 흔적 */
const INTERNAL_TRACE = /(\n\s+at\s)|node_modules|\.tsx?:\d|\bError:|TypeError|RangeError|IllegalActionError|undefined|\[object|\bNaN\b|liveWall|deadWall|\bseed\b/;

export interface Owner {
  seat?: number;
  token?: string;
}

/**
 * 한 좌석(소켓)이 받은 메시지 전체를 검사해 문제 목록을 돌려준다(빈 배열 = 정상).
 * allTokens: 같은 서버에서 발급된 모든 좌석 토큰. 자기 토큰 외의 토큰 문자열이 하나라도 있으면 누출이다.
 */
export function leakProblems(msgs: readonly unknown[], owner: Owner, allTokens: readonly string[]): string[] {
  const problems: string[] = [];
  const bad = (m: string): void => void problems.push(m);
  for (const raw of msgs) {
    const json = typeof raw === "string" ? raw : JSON.stringify(raw);
    let msg: Record<string, unknown>;
    try {
      msg = JSON.parse(json) as Record<string, unknown>;
    } catch {
      bad(`JSON 아님: ${json.slice(0, 60)}`);
      continue;
    }
    const type = msg.type;
    if (typeof type !== "string" || !MESSAGE_TYPES.has(type)) {
      bad(`알 수 없는 메시지 type: ${String(type)}`);
      continue;
    }
    for (const k of FORBIDDEN_KEYS) if (json.includes(`"${k}"`)) bad(`금지 키 ${k} (${type})`);
    for (const t of allTokens) {
      if (t !== owner.token && json.includes(t)) bad(`타 좌석 토큰 노출 (${type})`);
    }
    if (type !== "joined" && owner.token && json.includes(owner.token)) bad(`joined 외 메시지에 본인 토큰 (${type})`);
    if (msg.deadlineMs !== undefined && (type !== "view" || typeof msg.deadlineMs !== "number" || msg.deadlineMs < 0)) bad("deadlineMs 위치/값 이상");
    switch (type) {
      case "joined":
        if (Object.keys(msg).sort().join() !== "roomId,seat,seatToken,type") bad("joined 필드 이상");
        break;
      case "error": {
        const m = String(msg.message);
        if (!(ERROR_CODES as readonly string[]).includes(String(msg.code))) bad(`정의되지 않은 오류 코드 ${String(msg.code)}`);
        if (INTERNAL_TRACE.test(m) || m.length > 100) bad(`오류 메시지에 내부 정보 흔적: ${m.slice(0, 80)}`);
        const extra = Object.keys(msg).filter((k) => !["type", "code", "message", "seq"].includes(k));
        if (extra.length) bad(`error 추가 필드 ${extra.join()}`);
        break;
      }
      case "notice":
        if (msg.code !== "timeout" && msg.code !== "auto_mode") bad("notice code 이상");
        break;
      case "ack":
        if (!Number.isInteger(msg.seq)) bad("ack seq 이상");
        break;
      case "view": {
        const v = msg.view as SeatView & Record<string, unknown>;
        for (const k of Object.keys(v)) if (!VIEW_TOP_KEYS.has(k)) bad(`view 허용 목록 밖 키 ${k}`);
        if (owner.seat !== undefined && v.seat !== owner.seat) bad(`다른 좌석 뷰 수신 (${String(v.seat)} != ${owner.seat})`);
        for (const p of v.players) {
          for (const k of Object.keys(p)) if (!PLAYER_KEYS.has(k)) bad(`players[] 허용 목록 밖 키 ${k}`);
        }
        if (v.hand.length !== v.players[v.seat]?.handCount) bad("본인 손패 장수 불일치");
        if (v.players.reduce((a, p) => a + p.score, 0) + v.riichiSticks * 1000 !== 100000) bad("점수 합 불변식 위반");
        if (v.phase !== "response" && v.pending) bad("응답 단계 밖에서 pending 노출");
        if (v.phase !== "roundEnd" && v.phase !== "gameEnd" && v.result) bad("국 종료 밖에서 result 노출");
        if (v.drawnTile && v.turn !== v.seat) bad("타인 차례에 뽑은 패 노출");
        if (v.kuikae.length > 0 && (v.phase !== "turn" || v.turn !== v.seat)) bad("타인 차례/비턴 단계에 kuikae 노출");
        if (v.pending?.chankan !== undefined && v.pending.chankan !== "ankan" && v.pending.chankan !== "shouminkan") bad("pending.chankan 값 이상");
        break;
      }
    }
  }
  return problems;
}

// ---------------------------------------------------------------------------
// 실제 ws 클라이언트
// ---------------------------------------------------------------------------

export interface WsMsg {
  type: string;
  [k: string]: unknown;
}

export const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

export async function until(cond: () => boolean, ms = 10000, what = "조건"): Promise<void> {
  const t0 = Date.now();
  while (!cond()) {
    if (Date.now() - t0 > ms) throw new Error(`시간 초과: ${what}`);
    await sleep(5);
  }
}

export interface PlayerOptions {
  /** 합법 행동 중 무작위 선택에 쓰는 PRNG */
  rng: RandomFn;
  /** false면 뷰를 받아도 응답하지 않는다(타임아웃 유도) */
  play?: boolean;
  /** 이어받을 seq (재접속용) */
  seq?: number;
}

/** 스크립트 클라이언트: 받은 원문을 전부 보관하고, play=true면 legalActions 중 하나로 응답한다 */
export class Player {
  readonly raw: string[] = [];
  readonly msgs: WsMsg[] = [];
  readonly views: SeatView[] = [];
  readonly errors: { code: string; seq?: number }[] = [];
  readonly notices: string[] = [];
  roomId = "";
  seat = -1;
  token = "";
  seq: number;
  play: boolean;
  gameEnd = false;
  roundEnds = 0;
  closedFlag = false;
  private lastKey = "";

  private constructor(
    readonly ws: WebSocket,
    private readonly opts: PlayerOptions,
  ) {
    this.seq = opts.seq ?? 1;
    this.play = opts.play ?? true;
    ws.on("message", (data) => this.onData(data.toString()));
    ws.on("close", () => (this.closedFlag = true));
    ws.on("error", () => {});
  }

  static async open(port: number, opts: PlayerOptions): Promise<Player> {
    const ws = new WebSocket(`ws://127.0.0.1:${port}`);
    const p = new Player(ws, opts);
    await new Promise<void>((res, rej) => {
      ws.once("open", () => res());
      ws.once("error", rej);
    });
    return p;
  }

  /** join 후 joined를 기다린다 */
  static async join(port: number, opts: PlayerOptions, roomId?: string): Promise<Player> {
    const p = await Player.open(port, opts);
    p.send({ type: "join", ...(roomId && { roomId }) });
    await until(() => p.token !== "" || p.closedFlag, 5000, "joined");
    if (p.token === "") throw new Error(`join 실패: ${JSON.stringify(p.errors)}`);
    return p;
  }

  /** 기존 좌석으로 재접속 */
  static async rejoin(port: number, opts: PlayerOptions, roomId: string, token: string): Promise<Player> {
    const p = await Player.open(port, opts);
    p.send({ type: "rejoin", roomId, seatToken: token });
    await until(() => p.token !== "" || p.closedFlag, 5000, "rejoin joined");
    if (p.token === "") throw new Error(`rejoin 실패: ${JSON.stringify(p.errors)}`);
    return p;
  }

  send(m: unknown): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(m));
  }

  close(): void {
    this.ws.close();
  }

  private onData(text: string): void {
    this.raw.push(text);
    const msg = JSON.parse(text) as WsMsg;
    this.msgs.push(msg);
    if (msg.type === "joined") {
      this.roomId = msg.roomId as string;
      this.seat = msg.seat as number;
      this.token = msg.seatToken as string;
    } else if (msg.type === "error") {
      this.errors.push({ code: msg.code as string, ...(msg.seq !== undefined && { seq: msg.seq as number }) });
    } else if (msg.type === "notice") {
      this.notices.push(msg.code as string);
    } else if (msg.type === "view") {
      this.onView(msg.view as SeatView);
    }
  }

  private onView(v: SeatView): void {
    this.views.push(v);
    if (v.phase === "roundEnd") this.roundEnds++;
    if (v.phase === "gameEnd") {
      this.gameEnd = true;
      return;
    }
    if (!this.play) return;
    // 같은 결정 상황에는 한 번만 응답
    const key = JSON.stringify([v.hand, v.legalActions, v.players.map((p) => p.discards.length), v.liveWallCount, v.kyoku, v.honba]);
    if (key === this.lastKey || !v.awaitingYou || v.legalActions.length === 0) return;
    this.lastKey = key;
    const win = v.legalActions.find((a) => a.type === "tsumo" || a.type === "ron");
    const pick = win ?? pickOf(this.opts.rng, v.legalActions);
    this.send({ type: "action", seq: this.seq++, action: pick });
  }
}

/** 활성 Timeout 핸들 수 (실제 타이머 누수 점검용). 비교는 기준값(baseline) 대비로 한다 */
export function activeTimeouts(): number {
  return process.getActiveResourcesInfo().filter((t) => t === "Timeout").length;
}
