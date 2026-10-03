import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import * as core from "@mahjong/core";
import { awaitingSeats, createGame, legalActions, type Action, type CalledMeld, type GameState, type RandomFn, type Tile } from "@mahjong/core";
import {
  actionKey,
  createSession,
  RoomManager,
  timeoutScheduler,
  viewFor,
  type Connection,
  type GameSession,
  type GameSessionOptions,
  type Scheduler,
  type ServerMessage,
} from "./index";

// S-7 행동 타임아웃: 가짜 스케줄러/시계로 결정적으로 검증한다.
// 지연값을 서로 다르게 두어(WAIT 집합) 어떤 타이머가 걸렸는지 구별한다.

vi.mock("@mahjong/core", async (orig) => {
  const actual = await orig<typeof import("@mahjong/core")>();
  return { ...actual, dispatch: vi.fn(actual.dispatch) };
});

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

function seeded(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HONORS: Tile[] = [
  { kind: "wind", wind: "east" },
  { kind: "wind", wind: "south" },
  { kind: "wind", wind: "west" },
  { kind: "wind", wind: "north" },
  { kind: "dragon", dragon: "white" },
  { kind: "dragon", dragon: "green" },
  { kind: "dragon", dragon: "red" },
];

/** "123m456p0s1z" 표기법 (0 = 적5, z: 1~4 동남서북, 5~7 백발중) */
function T(notation: string): Tile[] {
  const out: Tile[] = [];
  let digits: string[] = [];
  for (const ch of notation) {
    if (/[0-9]/.test(ch)) {
      digits.push(ch);
      continue;
    }
    for (const d of digits) {
      if (ch === "z") out.push(HONORS[Number(d) - 1]!);
      else {
        const suit = ch === "m" ? "man" : ch === "p" ? "pin" : "sou";
        out.push({ kind: "number", suit, rank: (d === "0" ? 5 : Number(d)) as 1, isRedFive: d === "0" });
      }
    }
    digits = [];
  }
  return out;
}

const JUNK = "1379m1379p1379s2z";
const TENPAI_5P = "234m567m234p678s5p";
const DEAD = "5s6s7s8s" + "7z".repeat(10);

/** 좌석 0이 hand0 + drawn으로 행동할 차례인 상태 */
function turnState(hand0: string, drawn: string | null, riichi = false): GameState {
  const base = createGame(seeded(1));
  const d = drawn === null ? null : T(drawn)[0]!;
  return {
    ...base,
    players: base.players.map((p, i) => ({
      hand: i === 0 ? [...T(hand0), ...(d ? [d] : [])] : T(JUNK),
      melds: [] as CalledMeld[],
      discards: [],
      riichi: i === 0 && riichi,
    })),
    liveWall: T("2z".repeat(5) + "3z".repeat(5) + "4z".repeat(5)),
    deadWall: T(DEAD),
    doraCount: 1,
    drawnTile: d,
    turn: 0,
    phase: "turn",
    pending: null,
  };
}

/** 좌석 3(봇)이 1m을 뽑아 둘 차례. 좌석 0은 1m을 펑할 수 있다 */
function botDiscardsState(seat1Pon = false): GameState {
  const base = turnState("11m234p567p789s12z", null);
  const drawn = T("1m")[0]!;
  return {
    ...base,
    turn: 3,
    drawnTile: drawn,
    players: base.players.map((p, i) =>
      i === 3 ? { ...p, hand: [...T(JUNK), drawn] } : i === 1 && seat1Pon ? { ...p, hand: T("11m234p567p789s13z") } : p,
    ),
  };
}
const botDiscards1m: GameSessionOptions["botDecide"] = (_s, seat) => ({ type: "discard", seat, tile: T("1m")[0]! });

/** 가짜 시계 + 수동 스케줄러. 타이머는 가장 이른 마감부터 실행하고 시계를 그 시각으로 옮긴다 */
function fakeTime() {
  let t = 0;
  const q: { fn: () => void; delay: number; due: number; cancelled: boolean; done: boolean }[] = [];
  const sched: Scheduler = (fn, delay) => {
    const e = { fn, delay, due: t + delay, cancelled: false, done: false };
    q.push(e);
    return () => {
      e.cancelled = true;
    };
  };
  const live = () => q.filter((e) => !e.cancelled && !e.done);
  return {
    sched,
    live,
    now: () => t,
    advance: (ms: number) => void (t += ms),
    runNext(): boolean {
      const e = live().sort((a, b) => a.due - b.due)[0];
      if (!e) return false;
      e.done = true;
      t = Math.max(t, e.due);
      e.fn();
      return true;
    },
  };
}

const TURN = 1000;
const RESP = 500;
const DISC = 100;
const AUTO = 10;
const WAIT = new Set([TURN, RESP, DISC, AUTO]);

type FakeConn = Connection & { sent: ServerMessage[] };
const fakeConn = (): FakeConn => {
  const c: FakeConn = { sent: [], send: (m) => void c.sent.push(m), close: () => {}, terminate: () => {} };
  return c;
};
type ViewMsg = Extract<ServerMessage, { type: "view" }>;
const viewMsgs = (c: FakeConn): ViewMsg[] => c.sent.filter((m): m is ViewMsg => m.type === "view");
const notices = (c: FakeConn) => c.sent.flatMap((m) => (m.type === "notice" ? [m.code] : []));
const errorCodes = (c: FakeConn) => c.sent.flatMap((m) => (m.type === "error" ? [m.code] : []));

const managers: RoomManager[] = [];
afterEach(() => {
  for (const m of managers.splice(0)) m.close();
  vi.useRealTimers();
});
beforeEach(() => {
  vi.mocked(core.dispatch).mockClear();
});

function setup(humans: number, state?: GameState, game: GameSessionOptions = {}) {
  const time = fakeTime();
  const manager = new RoomManager({
    game: {
      rng: seeded(1),
      scheduler: time.sched,
      now: time.now,
      botDelayMs: 7,
      responseWindowMs: 50,
      nextRoundDelayMs: 9,
      turnTimeoutMs: TURN,
      responseTimeoutMs: RESP,
      disconnectedTimeoutMs: DISC,
      autoDelayMs: AUTO,
      maxConsecutiveTimeouts: 2,
      ...(state && { initialState: state }),
      ...game,
    },
  });
  managers.push(manager);
  const conns: FakeConn[] = [];
  const sessions: ReturnType<typeof createSession>[] = [];
  let roomId: string | undefined;
  for (let i = 0; i < humans; i++) {
    const c = fakeConn();
    const s = createSession(manager, c, { maxViolations: 1e9, ratePerSecond: 1e9, rateBurst: 1e9 });
    s.onMessage(JSON.stringify({ type: "join", ...(roomId && { roomId }) }));
    const joined = c.sent[0];
    if (joined?.type === "joined") roomId = joined.roomId;
    conns.push(c);
    sessions.push(s);
  }
  const seqs = conns.map(() => 0);
  const ctx = {
    time,
    manager,
    conns,
    sessions,
    room: () => manager.getRoom(roomId!)!,
    game: (): GameSession => manager.gameOf(manager.getRoom(roomId!)!)!,
    state: (): GameState => ctx.game().peekState()!,
    start: () => sessions[0]!.onMessage(JSON.stringify({ type: "start" })),
    act: (i: number, action: unknown) => sessions[i]!.onMessage(JSON.stringify({ type: "action", seq: seqs[i]!++, action })),
  };
  return ctx;
}
type Ctx = ReturnType<typeof setup>;

const strip = (a: Action): Record<string, unknown> => {
  const { seat: _seat, ...rest } = a;
  return rest;
};

/** 사람(seat 0)이 마감을 기다리는 타이머가 걸릴 때까지 진행하고 그 지연을 반환 */
function toWait(ctx: Ctx, seat = 0): number {
  for (let i = 0; i < 20000; i++) {
    const t = ctx.time.live()[0];
    if (t && WAIT.has(t.delay) && awaitingSeats(ctx.state()).includes(seat)) return t.delay;
    if (!ctx.time.runNext()) throw new Error("타이머 없음");
  }
  throw new Error("진행 불가");
}

/** dispatch로 넘어간 모든 행동 */
const dispatched = (): { state: GameState; action: Action }[] =>
  vi.mocked(core.dispatch).mock.calls.map(([state, action]) => ({ state, action }));

const scoreSum = (s: GameState): number => s.scores.reduce((a, b) => a + b, 0) + s.riichiSticks * 1000;

// ---------------------------------------------------------------------------
// 차례 타임아웃
// ---------------------------------------------------------------------------

describe("차례 타임아웃", () => {
  it("뽑은 패를 쯔모기리하고, 화료/리치가 가능해도 하지 않는다 (legalActions 원소만 dispatch)", () => {
    const state = turnState(TENPAI_5P, "5p");
    expect(legalActions(state, 0).map((a) => a.type)).toContain("tsumo");
    expect(legalActions(state, 0).some((a) => a.type === "discard" && a.riichi === true)).toBe(true);
    const ctx = setup(1, state);
    ctx.start();
    expect(ctx.time.live().map((t) => t.delay)).toEqual([TURN]);
    ctx.time.runNext();

    const p0 = ctx.state().players[0]!;
    expect(p0.discards).toHaveLength(1);
    expect(p0.discards[0]).toMatchObject({ tile: T("5p")[0], riichi: false, tsumogiri: true });
    expect(ctx.state().phase).not.toBe("roundEnd");
    for (const { state: s, action } of dispatched()) {
      expect(legalActions(s, action.seat).some((l) => actionKey(l) === actionKey(action))).toBe(true);
    }
    expect(dispatched()[0]!.action).toMatchObject({ type: "discard", seat: 0 });
  });

  it("리치 후에도 뽑은 패 타패 (화료 가능해도 쯔모하지 않음)", () => {
    for (const drawn of ["5p", "9s"]) {
      const ctx = setup(1, turnState(TENPAI_5P, drawn, true));
      ctx.start();
      ctx.time.runNext();
      const d = ctx.state().players[0]!.discards[0]!;
      expect(d).toMatchObject({ tile: T(drawn)[0], tsumogiri: true });
      expect(ctx.state().phase).not.toBe("roundEnd");
    }
  });

  it("뽑은 패가 없으면(부로 직후) 합법 비리치 타패 중 결정적으로 마지막 것을 둔다", () => {
    const base = turnState(TENPAI_5P, null);
    // 14장, drawnTile=null
    const state: GameState = { ...base, players: base.players.map((p, i) => (i === 0 ? { ...p, hand: [...p.hand, T("9s")[0]!] } : p)) };
    const expected = legalActions(state, 0)
      .filter((a) => a.type === "discard" && a.riichi !== true)
      .at(-1)!;
    const ctx = setup(1, state);
    ctx.start();
    ctx.time.runNext();
    const d = ctx.state().players[0]!.discards[0]!;
    expect(d).toMatchObject({ tile: (expected as { tile: Tile }).tile, riichi: false });
  });
});

// ---------------------------------------------------------------------------
// 응답 타임아웃
// ---------------------------------------------------------------------------

describe("응답 타임아웃", () => {
  it("응답 구간이 끝난 뒤부터 마감이 시작되고, 초과하면 pass로 처리한다 (펑 안 함)", () => {
    const ctx = setup(1, botDiscardsState(), { botDecide: botDiscards1m });
    ctx.start();
    expect(ctx.time.live().map((t) => t.delay)).toEqual([7]); // 봇 차례
    ctx.time.runNext(); // 봇이 1m 타패 -> 응답 구간
    expect(ctx.state().phase).toBe("response");
    expect(awaitingSeats(ctx.state())).toEqual([0]);
    expect(ctx.time.live().map((t) => t.delay)).toEqual([50]); // 구간만 있고 마감 타이머는 아직 없음
    expect(viewMsgs(ctx.conns[0]!).at(-1)!.deadlineMs).toBeUndefined();
    ctx.time.runNext(); // 구간 종료
    expect(ctx.time.live().map((t) => t.delay)).toEqual([RESP]);
    expect(viewMsgs(ctx.conns[0]!).at(-1)!.deadlineMs).toBe(RESP);

    ctx.time.runNext(); // 응답 마감 -> pass
    expect(ctx.state().players[0]!.melds).toHaveLength(0);
    expect(ctx.state().players[3]!.discards[0]?.calledBy ?? null).toBeNull();
    expect(dispatched().some((c) => c.action.seat === 0 && c.action.type === "pass")).toBe(true);
    expect(notices(ctx.conns[0]!)).toEqual(["timeout"]);
  });

  it("구간 중 도착한 응답은 큐 규칙대로 처리되고 응답 마감은 취소된다 (이중 처리 없음)", () => {
    const ctx = setup(1, botDiscardsState(), { botDecide: botDiscards1m });
    ctx.start();
    ctx.time.runNext(); // 봇 타패
    ctx.act(0, { type: "pass" }); // 구간 중 수락(큐)
    expect(ctx.conns[0]!.sent.some((m) => m.type === "ack")).toBe(true);
    ctx.time.runNext(); // 구간 종료: 큐 적용
    expect(ctx.state().phase).toBe("turn");
    expect(notices(ctx.conns[0]!)).toEqual([]);
    expect(dispatched().filter((c) => c.action.seat === 0 && c.action.type === "pass")).toHaveLength(1);
    // 이후 걸린 것은 새 차례(좌석 0)의 마감 하나뿐
    expect(ctx.time.live().map((t) => t.delay)).toEqual([TURN]);
  });
});

// ---------------------------------------------------------------------------
// 마감 정보 전달 / 정보 은닉
// ---------------------------------------------------------------------------

describe("마감 전달과 정보 은닉", () => {
  it("남은 ms는 행동해야 하는 본인에게만 가고, 다른 좌석 메시지에는 마감/알림이 전혀 없다", () => {
    const ctx = setup(2, botDiscardsState(), { botDecide: botDiscards1m });
    ctx.start();
    ctx.time.runNext(); // 봇 타패
    ctx.time.runNext(); // 구간 종료 -> 좌석 0에 응답 마감
    ctx.time.advance(120);
    ctx.game().sendViewTo(0); // 재전송 시 남은 시간 갱신
    expect(viewMsgs(ctx.conns[0]!).at(-1)!.deadlineMs).toBe(RESP - 120);
    ctx.time.runNext(); // 자동 pass
    const other = JSON.stringify(ctx.conns[1]!.sent);
    expect(other).not.toMatch(/deadline|notice|timeout/);
    expect(ctx.conns[1]!.sent.every((m) => m.type === "joined" || m.type === "view")).toBe(true);
    // 마감이 붙은 메시지는 모두 좌석 0의 응답 대기 뷰
    const withDeadline = viewMsgs(ctx.conns[0]!).filter((m) => m.deadlineMs !== undefined);
    expect(withDeadline.length).toBeGreaterThan(0);
    for (const m of withDeadline) {
      expect(m.view.awaitingYou).toBe(true);
      expect(Object.keys(m).sort()).toEqual(["deadlineMs", "type", "view"]);
    }
    // 뷰 자체(viewFor 결과)는 마감 필드를 갖지 않는다
    expect(JSON.stringify(viewMsgs(ctx.conns[0]!).map((m) => m.view))).not.toMatch(/deadline/);
    expect(viewMsgs(ctx.conns[0]!).at(-1)!.view).toEqual(viewFor(ctx.state(), 0));
  });

  it("차례 시작 뷰에도 본인에게만 TURN이 실리고, 대기 중이 아닌 본인(타 좌석 차례)에게는 없다", () => {
    const ctx = setup(2, turnState(TENPAI_5P, "5p"));
    ctx.start();
    expect(viewMsgs(ctx.conns[0]!).at(-1)!.deadlineMs).toBe(TURN);
    expect(viewMsgs(ctx.conns[1]!).every((m) => m.deadlineMs === undefined)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 취소 / 경합
// ---------------------------------------------------------------------------

describe("타이머 취소와 경합", () => {
  it("마감 직전에 도착한 행동이 처리되고 마감 타이머는 취소된다 (자동 행동 없음)", () => {
    const ctx = setup(1, turnState(TENPAI_5P, "5p"));
    ctx.start();
    ctx.time.advance(TURN - 1);
    const handTile = T("2m")[0]!;
    ctx.act(0, { type: "discard", tile: handTile });
    expect(ctx.state().players[0]!.discards[0]).toMatchObject({ tile: handTile, tsumogiri: false });
    // 낡은 마감 타이머가 남아 있지 않다: 걸려 있는 것은 응답 구간 하나
    expect(ctx.time.live().map((t) => t.delay)).toEqual([50]);
    ctx.time.runNext(); // 구간 종료 -> 봇들이 진행해도 좌석 0의 자동 타패는 없다
    expect(ctx.state().players[0]!.discards).toHaveLength(1);
    expect(dispatched().filter((c) => c.action.seat === 0)).toHaveLength(1);
    expect(notices(ctx.conns[0]!)).toEqual([]);
  });

  it("마감이 먼저 발동하면 같은 차례의 뒤늦은 행동은 not_your_turn이고 한 번만 처리된다", () => {
    const ctx = setup(1, turnState(TENPAI_5P, "5p"));
    ctx.start();
    ctx.time.runNext(); // 자동 타패
    const after = ctx.state();
    ctx.act(0, { type: "discard", tile: T("2m")[0] });
    expect(errorCodes(ctx.conns[0]!)).toEqual(["not_your_turn"]);
    expect(ctx.state()).toBe(after);
    expect(dispatched().filter((c) => c.action.seat === 0)).toHaveLength(1);
  });

  it("취소가 무시되고 낡은 마감 콜백이 뒤늦게 실행돼도 이중 처리되지 않고 현재 타이머를 해치지 않는다", () => {
    const ctx = setup(1, turnState(TENPAI_5P, "5p"));
    ctx.start();
    const stale = ctx.time.live()[0]!;
    ctx.act(0, { type: "discard", tile: T("2m")[0] });
    const after = ctx.state();
    const callsBefore = dispatched().length;
    stale.fn(); // 스케줄러가 취소를 지키지 못한 경우를 가정
    expect(ctx.state()).toBe(after);
    expect(dispatched()).toHaveLength(callsBefore);
    expect(ctx.time.live().map((t) => t.delay)).toEqual([50]);
  });

  it("사람 둘이 응답 대기일 때 한쪽이 응답해도 다른 쪽 마감은 유지되고 타이머는 1개다", () => {
    const ctx = setup(2, botDiscardsState(true), { botDecide: botDiscards1m });
    ctx.start();
    ctx.time.runNext(); // 봇 타패
    ctx.time.runNext(); // 구간 종료
    expect(awaitingSeats(ctx.state())).toEqual([0, 1]);
    expect(ctx.time.live().map((t) => t.delay)).toEqual([RESP]);
    ctx.time.advance(200);
    ctx.act(0, { type: "pass" });
    expect(awaitingSeats(ctx.state())).toEqual([1]);
    expect(ctx.time.live().map((t) => t.delay)).toEqual([RESP - 200]); // 좌석 1의 원래 마감 유지
    expect(notices(ctx.conns[0]!)).toEqual([]);
    ctx.time.runNext(); // 좌석 1 자동 pass
    expect(notices(ctx.conns[1]!)).toEqual(["timeout"]);
    expect(notices(ctx.conns[0]!)).toEqual([]);
    expect(ctx.state().phase).toBe("turn");
  });
});

// ---------------------------------------------------------------------------
// 연속 타임아웃 / 자동 모드
// ---------------------------------------------------------------------------

describe("자동 모드", () => {
  it("연속 N회 타임아웃 후 짧은 지연으로 자동 진행하고, 유효 행동이 오면 해제·카운터 리셋", () => {
    const ctx = setup(1);
    ctx.start();
    const normal = (d: number) => d === TURN || d === RESP;
    expect(normal(toWait(ctx))).toBe(true);
    ctx.time.runNext(); // 1회
    expect(normal(toWait(ctx))).toBe(true);
    ctx.time.runNext(); // 2회 -> 자동 모드
    expect(notices(ctx.conns[0]!)).toEqual(["timeout", "timeout", "auto_mode"]);
    expect(toWait(ctx)).toBe(AUTO);

    // 자동 모드 구간에서도 뷰에는 마감이 붙지 않고(UI 카운트다운 없음) 자동 규칙으로만 진행
    expect(viewMsgs(ctx.conns[0]!).at(-1)!.deadlineMs).toBeUndefined();
    ctx.time.runNext();
    expect(toWait(ctx)).toBe(AUTO);

    // 유효 행동 -> 해제
    const s = ctx.state();
    const a = legalActions(s, 0).find((x) => x.type === "discard" || x.type === "pass")!;
    ctx.act(0, strip(a));
    expect(normal(toWait(ctx))).toBe(true);
    expect(notices(ctx.conns[0]!)).toHaveLength(3);
    // 카운터도 리셋: 1회 초과로는 다시 자동 모드가 되지 않는다
    ctx.time.runNext();
    expect(notices(ctx.conns[0]!).filter((c) => c === "auto_mode")).toHaveLength(1);
    expect(normal(toWait(ctx))).toBe(true);
  });

  it("자동 모드는 쯔모기리/패스만 한다 (화료·리치·깡·부로 없음)", () => {
    const ctx = setup(1, turnState(TENPAI_5P, "5p"), { turnTimeoutMs: AUTO, responseTimeoutMs: AUTO, maxConsecutiveTimeouts: 1 });
    ctx.start();
    for (let i = 0; i < 400 && ctx.state().phase !== "gameEnd" && ctx.time.runNext(); i++);
    const mine = dispatched().filter((c) => c.action.seat === 0);
    expect(mine.length).toBeGreaterThan(5);
    for (const { action } of mine) {
      expect(action.type === "pass" || (action.type === "discard" && action.riichi !== true)).toBe(true);
    }
  });

  it("재접속 훅(onSeatReconnected / RoomManager.seatReconnected)이 자동 모드를 푼다", () => {
    const ctx = setup(1, undefined, { maxConsecutiveTimeouts: 1 });
    ctx.start();
    toWait(ctx);
    ctx.time.runNext();
    expect(notices(ctx.conns[0]!)).toEqual(["timeout", "auto_mode"]);
    expect(toWait(ctx)).toBe(AUTO);
    ctx.manager.seatReconnected(ctx.room(), 0);
    expect(ctx.time.live()).toHaveLength(1);
    expect([TURN, RESP]).toContain(ctx.time.live()[0]!.delay);
    // 훅 이후 다시 1회 타임아웃되면 (N=1이므로) 새로 자동 모드가 되며 알림이 다시 간다
    ctx.time.runNext();
    expect(notices(ctx.conns[0]!)).toEqual(["timeout", "auto_mode", "timeout", "auto_mode"]);
    // 대기 중이 아닐 때 호출해도 안전하다
    ctx.game().onSeatReconnected(2);
  });
});

// ---------------------------------------------------------------------------
// 끊긴 좌석
// ---------------------------------------------------------------------------

describe("끊긴 좌석", () => {
  it("대기 중 끊기면 짧은 끊김 마감으로 줄고 자동 처리되며, 자동 모드/알림으로 취급하지 않는다", () => {
    const ctx = setup(1, turnState(TENPAI_5P, "5p"));
    ctx.start();
    expect(ctx.time.live().map((t) => t.delay)).toEqual([TURN]);
    ctx.time.advance(30);
    ctx.sessions[0]!.onClose();
    expect(ctx.time.live().map((t) => t.delay)).toEqual([DISC]);
    ctx.time.runNext();
    expect(ctx.state().players[0]!.discards[0]).toMatchObject({ tile: T("5p")[0], tsumogiri: true });
    expect(notices(ctx.conns[0]!)).toEqual([]);
  });

  it("이미 끊긴 좌석의 차례도 끊김 마감으로 진행된다 (게임이 멈추지 않음)", () => {
    const ctx = setup(1);
    ctx.start();
    ctx.sessions[0]!.onClose();
    for (let i = 0; i < 300; i++) {
      if (ctx.state().phase === "gameEnd" || !ctx.time.runNext()) break;
      expect(ctx.time.live().length).toBeLessThanOrEqual(1);
    }
    expect(dispatched().filter((c) => c.action.seat === 0).length).toBeGreaterThan(3);
  });

  it("끊김 마감 도중 재접속하면 일반 마감으로 다시 시작한다", () => {
    const ctx = setup(1, turnState(TENPAI_5P, "5p"));
    ctx.start();
    ctx.sessions[0]!.onClose();
    expect(ctx.time.live().map((t) => t.delay)).toEqual([DISC]);
    // S-8이 슬롯을 복구했다고 가정
    const slot = ctx.room().seats[0] as { kind: "human"; connected: boolean; conn?: Connection };
    slot.connected = true;
    slot.conn = ctx.conns[0]!;
    ctx.manager.seatReconnected(ctx.room(), 0);
    expect(ctx.time.live().map((t) => t.delay)).toEqual([TURN]);
    ctx.game().sendViewTo(0);
    expect(viewMsgs(ctx.conns[0]!).at(-1)!.deadlineMs).toBe(TURN);
  });
});

// ---------------------------------------------------------------------------
// 타이머 잔존 / 진행 보장
// ---------------------------------------------------------------------------

describe("마감 갱신과 시간 옵션", () => {
  it("같은 좌석이 계속 행동해야 하는 전이(안깡)에서 이전 마감이 남지 않고 새 마감이 걸린다", () => {
    const ctx = setup(1, turnState("111m234p567p789s5z", "1m"));
    ctx.start();
    ctx.time.advance(600);
    ctx.act(0, { type: "ankan", tile: T("1m")[0] });
    expect(ctx.state().players[0]!.melds).toHaveLength(1);
    expect(ctx.state().turn).toBe(0);
    expect(ctx.time.live().map((t) => t.delay)).toEqual([TURN]);
    expect(viewMsgs(ctx.conns[0]!).at(-1)!.deadlineMs).toBe(TURN);
  });

  const firstDelay = (opts: GameSessionOptions): number | undefined => {
    const ctx = setup(1, turnState(TENPAI_5P, "5p"), opts);
    ctx.start();
    return ctx.time.live()[0]?.delay;
  };

  it("시간 옵션 정규화: 상한 clamp, 0 이하는 즉시, NaN/Infinity는 마감 없음", () => {
    expect(firstDelay({ turnTimeoutMs: 1e12 })).toBe(2 ** 31 - 1);
    expect(firstDelay({ turnTimeoutMs: -5 })).toBe(0);
    expect(firstDelay({ turnTimeoutMs: 0 })).toBe(0);
    expect(firstDelay({ turnTimeoutMs: NaN })).toBeUndefined();
    expect(firstDelay({ turnTimeoutMs: Infinity })).toBeUndefined();
  });

  it("maxConsecutiveTimeouts는 1 이상으로 보정되고 autoDelayMs의 Infinity/NaN은 기본값을 쓴다", () => {
    for (const bad of [Infinity, NaN]) {
      const ctx = setup(1, turnState(TENPAI_5P, "5p"), { maxConsecutiveTimeouts: 0, autoDelayMs: bad });
      ctx.start();
      ctx.time.runNext(); // 1회 초과로 자동 모드 (0 -> 1 보정)
      expect(notices(ctx.conns[0]!)).toEqual(["timeout", "auto_mode"]);
      let found = false;
      for (let i = 0; i < 50 && !found; i++) {
        if (awaitingSeats(ctx.state()).includes(0) && ctx.time.live()[0]?.delay === 600) found = true;
        else ctx.time.runNext();
      }
      expect(found).toBe(true); // AUTO_DELAY_MS 기본값
    }
  });
});

describe("타이머 정리", () => {
  it("실제 타이머: 마감 타이머 1개, 행동·close 후 잔존 없음", () => {
    vi.useFakeTimers();
    const manager = new RoomManager({
      game: { rng: seeded(1), initialState: turnState(TENPAI_5P, "5p"), scheduler: timeoutScheduler, turnTimeoutMs: 1000, responseWindowMs: 50 },
    });
    managers.push(manager);
    const c = fakeConn();
    const s = createSession(manager, c);
    s.onMessage(JSON.stringify({ type: "join" }));
    s.onMessage(JSON.stringify({ type: "start" }));
    expect(vi.getTimerCount()).toBe(1);
    s.onMessage(JSON.stringify({ type: "action", seq: 0, action: { type: "discard", tile: T("2m")[0] } }));
    expect(vi.getTimerCount()).toBe(1); // 마감은 취소되고 응답 구간만
    vi.advanceTimersByTime(50);
    expect(vi.getTimerCount()).toBe(1); // 봇 차례
    manager.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("gameEnd에서도 타이머가 남지 않는다", () => {
    vi.useFakeTimers();
    const manager = new RoomManager({
      emptyRoomTtlMs: 5000,
      game: { rng: seeded(3), scheduler: timeoutScheduler, turnTimeoutMs: 100, responseTimeoutMs: 100, responseWindowMs: 1, botDelayMs: 1, nextRoundDelayMs: 1, disconnectedTimeoutMs: 1 },
    });
    managers.push(manager);
    const c = fakeConn();
    const s = createSession(manager, c);
    s.onMessage(JSON.stringify({ type: "join" }));
    s.onMessage(JSON.stringify({ type: "start" }));
    const game = manager.gameOf(manager.getRoom((c.sent[0] as { roomId: string }).roomId)!)!;
    // 아무도 행동하지 않아도 끝까지 진행 -> gameEnd에서 타이머 0
    for (let i = 0; i < 100000 && !game.ended; i++) vi.advanceTimersByTime(100);
    expect(game.ended).toBe(true);
    expect(scoreSum(game.peekState()!)).toBe(100000);
    expect(vi.getTimerCount()).toBe(0);
    expect(notices(c)).toContain("timeout");
  });
});

describe("방 삭제", () => {
  it("모두 끊긴 방이 TTL로 삭제되면 마감 타이머도 함께 정리된다", () => {
    vi.useFakeTimers();
    const manager = new RoomManager({
      emptyRoomTtlMs: 500,
      game: { rng: seeded(5), scheduler: timeoutScheduler, turnTimeoutMs: 1e6, responseTimeoutMs: 1e6, disconnectedTimeoutMs: 1e6 },
    });
    managers.push(manager);
    const s = createSession(manager, fakeConn());
    s.onMessage(JSON.stringify({ type: "join" }));
    s.onMessage(JSON.stringify({ type: "start" }));
    expect(vi.getTimerCount()).toBe(1);
    s.onClose();
    expect(vi.getTimerCount()).toBe(2); // 마감(끊김 마감) + 방 삭제 예약
    vi.advanceTimersByTime(500);
    expect(vi.getTimerCount()).toBe(0);
    expect(manager.roomCount).toBe(0);
  });
});

describe("전원 무행동에서도 한 판이 끝까지 진행", () => {
  const cases: { name: string; humans: number; disconnect: boolean }[] = [
    { name: "사람 4명(연결됨)", humans: 4, disconnect: false },
    { name: "사람 2명 + 봇 2명(연결됨)", humans: 2, disconnect: false },
    { name: "사람 4명 전원 끊김", humans: 4, disconnect: true },
  ];
  for (const { name, humans, disconnect } of cases) {
    it(name, () => {
      const ctx = setup(humans, undefined, { rng: seeded(11) });
      ctx.start();
      if (disconnect) for (const s of ctx.sessions) s.onClose();
      let steps = 0;
      while (ctx.state().phase !== "gameEnd") {
        expect(ctx.time.live().length).toBeLessThanOrEqual(1); // 타이머 최대 1개
        if (!ctx.time.runNext()) throw new Error(`무한 대기: ${ctx.state().phase}`);
        if (++steps > 200000) throw new Error("종료되지 않음");
      }
      expect(scoreSum(ctx.state())).toBe(100000);
      while (ctx.time.runNext()); // 마지막 타패의 응답 구간만 남아 있다
      expect(ctx.time.live()).toHaveLength(0);
      expect(ctx.state().phase).toBe("gameEnd");
      // 사람 좌석의 모든 행동은 legalActions 원소이며 자동 규칙(비리치 타패/pass)뿐
      const mine = dispatched().filter((c) => c.action.seat < humans);
      expect(mine.length).toBeGreaterThan(10);
      for (const { state, action } of mine) {
        expect(action.type === "pass" || (action.type === "discard" && action.riichi !== true)).toBe(true);
        expect(legalActions(state, action.seat).some((l) => actionKey(l) === actionKey(action))).toBe(true);
      }
      // 마감 정보는 각 좌석 본인의 대기 뷰에만 (view.awaitingYou)
      for (const c of ctx.conns) {
        for (const m of viewMsgs(c)) if (m.deadlineMs !== undefined) expect(m.view.awaitingYou).toBe(true);
      }
    });
  }
});
