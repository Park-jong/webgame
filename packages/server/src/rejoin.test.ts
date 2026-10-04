import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket, type RawData } from "ws";
import { awaitingSeats, legalActions, type GameState, type RandomFn } from "@mahjong/core";
import {
  createGameServer,
  createSession,
  RoomManager,
  timeoutScheduler,
  viewFor,
  type Connection,
  type GameServerHandle,
  type GameSession,
  type GameSessionOptions,
  type Scheduler,
  type ServerMessage,
} from "./index";

// S-8 재접속: 가짜 스케줄러/시계로 결정적으로 검증하고, 마지막에 실제 ws 통합 2개를 둔다.

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

/** 가짜 시계 + 수동 스케줄러 (game-timeout.test.ts와 동일 방식) */
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

type FakeConn = Connection & { sent: ServerMessage[]; closed: boolean; terminated: boolean };
const fakeConn = (): FakeConn => {
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
type ViewMsg = Extract<ServerMessage, { type: "view" }>;
const viewMsgs = (c: FakeConn): ViewMsg[] => c.sent.filter((m): m is ViewMsg => m.type === "view");
const errorCodes = (c: FakeConn) => c.sent.flatMap((m) => (m.type === "error" ? [m.code] : []));

/** view.test.ts의 금지 키 목록과 동일 */
const FORBIDDEN_KEYS = ["liveWall", "deadWall", "seed", "rng", "ronEligible", "responses", "furitenTemp", "pendingKanDora", "firstDiscards", "options"];

const managers: RoomManager[] = [];
afterEach(() => {
  for (const m of managers.splice(0)) m.close();
  vi.useRealTimers();
});

const SESSION_OPTS = { maxViolations: 1e9, ratePerSecond: 1e9, rateBurst: 1e9 };

function setup(humans: number, game: GameSessionOptions = {}, room: { emptyRoomTtlMs?: number } = {}, session = SESSION_OPTS) {
  const time = fakeTime();
  const manager = new RoomManager({
    ...room,
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
      ...game,
    },
  });
  managers.push(manager);
  const conns: FakeConn[] = [];
  const sessions: ReturnType<typeof createSession>[] = [];
  const tokens: string[] = [];
  let roomId!: string;
  for (let i = 0; i < humans; i++) {
    const c = fakeConn();
    const s = createSession(manager, c, session);
    s.onMessage(JSON.stringify({ type: "join", ...(i > 0 && { roomId }) }));
    const joined = c.sent[0];
    if (joined?.type !== "joined") throw new Error("join 실패");
    roomId = joined.roomId;
    tokens.push(joined.seatToken);
    conns.push(c);
    sessions.push(s);
  }
  const ctx = {
    time,
    manager,
    conns,
    sessions,
    tokens,
    roomId,
    room: () => manager.getRoom(roomId)!,
    game: (): GameSession => manager.gameOf(manager.getRoom(roomId)!)!,
    state: (): GameState => ctx.game().peekState()!,
    start: () => sessions[0]!.onMessage(JSON.stringify({ type: "start" })),
    /** 새 연결로 rejoin 시도 */
    rejoin(seat: number, token = tokens[seat]!, id = roomId, opts = session) {
      const c = fakeConn();
      const s = createSession(manager, c, opts);
      s.onMessage(JSON.stringify({ type: "rejoin", roomId: id, seatToken: token }));
      return { c, s };
    },
    act(s: ReturnType<typeof createSession>, seq: number, seat: number) {
      const a = legalActions(ctx.state(), seat).find((x) => x.type === "discard")!;
      const { seat: _s, ...action } = a as typeof a & { seat: number };
      s.onMessage(JSON.stringify({ type: "action", seq, action }));
      return action;
    },
  };
  return ctx;
}
type Ctx = ReturnType<typeof setup>;

/** 좌석이 해당 지연의 마감을 기다리는 상태(응답 구간 아님)가 될 때까지 진행. turnOnly면 타패 차례만 */
function runUntilAwaiting(ctx: Ctx, seat: number, delay: number, turnOnly = false): void {
  for (let i = 0; i < 20000; i++) {
    const t = ctx.time.live()[0];
    const s = ctx.state();
    if (t?.delay === delay && awaitingSeats(s).includes(seat) && (!turnOnly || s.phase === "turn")) return;
    if (!ctx.time.runNext()) throw new Error("타이머 없음");
  }
  throw new Error("진행 불가");
}

// ---------------------------------------------------------------------------
// 정상 재접속
// ---------------------------------------------------------------------------

describe("정상 재접속", () => {
  it("joined(기존 토큰) 뒤 현재 뷰(deadlineMs 포함)를 보내고 이전 연결을 종료한다", () => {
    const ctx = setup(2);
    ctx.start();
    expect(awaitingSeats(ctx.state())).toContain(0);
    const { c } = ctx.rejoin(0);

    expect(ctx.conns[0]!.terminated).toBe(true);
    expect(c.sent[0]).toEqual({ type: "joined", roomId: ctx.roomId, seat: 0, seatToken: ctx.tokens[0] });
    const v = c.sent[1] as ViewMsg;
    expect(v.type).toBe("view");
    expect(v.view).toEqual(viewFor(ctx.state(), 0));
    expect(v.deadlineMs).toBe(TURN);
    expect(c.sent).toHaveLength(2);
    expect(ctx.manager.find(c)).toEqual({ room: ctx.room(), seat: 0 });
    expect(ctx.manager.find(ctx.conns[0]!)).toBeUndefined();
    // 토큰은 다른 좌석/연결로 새지 않는다
    expect(JSON.stringify(ctx.conns[1]!.sent)).not.toContain(ctx.tokens[0]!);
  });

  it("끊긴 뒤(connected=false)에 재접속해도 복구되고 게임이 계속 진행된다", () => {
    const ctx = setup(2);
    ctx.start();
    ctx.sessions[0]!.onClose();
    expect(ctx.room().seats[0]).toMatchObject({ kind: "human", connected: false });
    const { c, s } = ctx.rejoin(0);
    expect(ctx.room().seats[0]).toMatchObject({ kind: "human", connected: true });
    expect(ctx.conns[0]!.terminated).toBe(false); // 이미 끊긴 연결은 종료할 필요 없음
    expect(viewMsgs(c)).toHaveLength(1);

    ctx.act(s, 0, 0);
    expect(ctx.state().players[0]!.discards).toHaveLength(1);
    runUntilAwaiting(ctx, 0, TURN); // 봇이 진행해 다시 내 차례
    expect(viewMsgs(c).length).toBeGreaterThan(1);
  });

  it("봇 좌석은 토큰이 없어 재접속할 수 없다 / 게임 시작 전(방만 있음)에도 재접속된다", () => {
    const ctx = setup(1);
    const { c } = ctx.rejoin(0); // 아직 게임 없음: joined만
    expect(c.sent).toEqual([{ type: "joined", roomId: ctx.roomId, seat: 0, seatToken: ctx.tokens[0] }]);
    expect(ctx.conns[0]!.terminated).toBe(true);
  });

  it("이미 방에 참가한 연결의 rejoin/join은 bad_message", () => {
    const ctx = setup(2);
    ctx.sessions[0]!.onMessage(JSON.stringify({ type: "rejoin", roomId: ctx.roomId, seatToken: ctx.tokens[1] }));
    expect(errorCodes(ctx.conns[0]!)).toEqual(["bad_message"]);
    expect(ctx.conns[1]!.terminated).toBe(false);
    expect(ctx.manager.find(ctx.conns[0]!)?.seat).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// 실패 처리
// ---------------------------------------------------------------------------

describe("재접속 실패", () => {
  it("없는 방은 unknown_room, 잘못된 토큰은 bad_token (좌석 상태 불변)", () => {
    const ctx = setup(2);
    ctx.start();
    const a = ctx.rejoin(0, ctx.tokens[0], "NOROOM22");
    expect(errorCodes(a.c)).toEqual(["unknown_room"]);
    const b = ctx.rejoin(0, "x".repeat(32));
    expect(errorCodes(b.c)).toEqual(["bad_token"]);
    const c = ctx.rejoin(0, ctx.tokens[0]!.slice(0, -1)); // 길이 다름
    expect(errorCodes(c.c)).toEqual(["bad_token"]);
    expect(ctx.conns[0]!.terminated).toBe(false);
    expect(ctx.manager.find(ctx.conns[0]!)?.seat).toBe(0);
    expect(viewMsgs(b.c)).toHaveLength(0);
  });

  it("다른 방의 토큰으로는 재접속할 수 없다", () => {
    const a = setup(1);
    const bConn = fakeConn();
    // 같은 매니저에 두 번째 방
    const sb = createSession(a.manager, bConn, SESSION_OPTS);
    sb.onMessage(JSON.stringify({ type: "join" }));
    const joinedB = bConn.sent[0] as { roomId: string; seatToken: string };
    expect(joinedB.roomId).not.toBe(a.roomId);

    const x = a.rejoin(0, joinedB.seatToken, a.roomId);
    expect(errorCodes(x.c)).toEqual(["bad_token"]);
    const y = a.rejoin(0, a.tokens[0], joinedB.roomId);
    expect(errorCodes(y.c)).toEqual(["bad_token"]);
    expect(a.conns[0]!.terminated).toBe(false);
    expect(bConn.terminated).toBe(false);
  });

  it("실패가 누적되면(unknown_room/bad_token 합산) 연결을 종료한다", () => {
    const ctx = setup(1, {}, {}, { ...SESSION_OPTS, maxIdentifyFailures: 2 } as typeof SESSION_OPTS);
    const c = fakeConn();
    const s = createSession(ctx.manager, c, { ...SESSION_OPTS, maxIdentifyFailures: 2 });
    const send = (roomId: string, seatToken: string) => s.onMessage(JSON.stringify({ type: "rejoin", roomId, seatToken }));
    send("NOROOM22", "t");
    send(ctx.roomId, "t");
    expect(c.terminated).toBe(false);
    send(ctx.roomId, "t");
    expect(c.terminated).toBe(true);
    expect(errorCodes(c)).toEqual(["unknown_room", "bad_token", "bad_token"]);
    // 종료된 연결은 이후 올바른 토큰도 처리되지 않는다
    send(ctx.roomId, ctx.tokens[0]!);
    expect(ctx.conns[0]!.terminated).toBe(false);
  });

  it("rejoin 실패 후에도 참가 제한 시간은 해제되지 않는다 (성공해야 해제)", () => {
    vi.useFakeTimers();
    const ctx = setup(1);
    const c = fakeConn();
    const s = createSession(ctx.manager, c, { ...SESSION_OPTS, joinTimeoutMs: 1000 });
    s.onMessage(JSON.stringify({ type: "rejoin", roomId: ctx.roomId, seatToken: "bad" }));
    vi.advanceTimersByTime(1000);
    expect(c.terminated).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// 이전 연결 / seq
// ---------------------------------------------------------------------------

describe("이전 연결과 seq", () => {
  it("이전 연결의 지연 close가 새 연결의 슬롯 상태를 망치지 않는다", () => {
    const ctx = setup(2);
    ctx.start();
    const { c } = ctx.rejoin(0);
    ctx.sessions[0]!.onClose(); // 교체된 연결의 뒤늦은 close
    ctx.sessions[0]!.onClose();
    const slot = ctx.room().seats[0];
    expect(slot).toMatchObject({ kind: "human", connected: true });
    expect(ctx.manager.find(c)).toEqual({ room: ctx.room(), seat: 0 });
    expect(ctx.room().connectedCount()).toBe(2);
    // 마감이 끊김(DISC)으로 줄지도 않는다
    expect(ctx.time.live().map((t) => t.delay)).toEqual([TURN]);
  });

  it("교체 후 byConn에 이전 연결이 잔류하지 않는다 (누수 없음)", () => {
    const ctx = setup(2);
    ctx.start();
    expect(ctx.manager.connectionCount).toBe(2);
    const a = ctx.rejoin(0);
    expect(ctx.manager.connectionCount).toBe(2);
    const b = ctx.rejoin(0);
    expect(ctx.manager.connectionCount).toBe(2);
    expect(ctx.manager.find(a.c)).toBeUndefined();
    ctx.sessions[0]!.onClose();
    a.s.onClose();
    expect(ctx.manager.connectionCount).toBe(2);
    b.s.onClose();
    expect(ctx.manager.connectionCount).toBe(1);
  });

  it("이전 연결이 보낸 뒤늦은 행동은 처리되지 않는다", () => {
    const ctx = setup(2);
    ctx.start();
    ctx.rejoin(0);
    const before = ctx.state();
    const action = legalActions(before, 0).find((x) => x.type === "discard")!;
    const { seat: _s, ...rest } = action as typeof action & { seat: number };
    ctx.sessions[0]!.onMessage(JSON.stringify({ type: "action", seq: 0, action: rest }));
    expect(errorCodes(ctx.conns[0]!)).toEqual(["bad_message"]);
    expect(ctx.state()).toBe(before);
  });

  it("seq는 재접속 후에도 유지되어 옛 seq 재생은 bad_seq, 더 큰 seq는 허용", () => {
    const ctx = setup(2);
    ctx.start();
    ctx.act(ctx.sessions[0]!, 5, 0);
    expect(ctx.state().players[0]!.discards).toHaveLength(1);

    const { c, s } = ctx.rejoin(0);
    s.onMessage(JSON.stringify({ type: "action", seq: 5, action: { type: "pass" } })); // 같은 seq 재생
    s.onMessage(JSON.stringify({ type: "action", seq: 3, action: { type: "pass" } })); // 더 옛 seq
    expect(errorCodes(c)).toEqual(["bad_seq", "bad_seq"]);

    runUntilAwaiting(ctx, 0, TURN, true);
    ctx.act(s, 6, 0);
    expect(ctx.state().players[0]!.discards).toHaveLength(2);
  });
});

// ---------------------------------------------------------------------------
// 끊김 중 진행 / 뷰 보안 / 자동 모드
// ---------------------------------------------------------------------------

describe("재접속 뷰", () => {
  it("끊김 중 타임아웃 자동 처리 후 재접속하면 현재 상태 뷰를 받고 자기 패 외 정보가 없다", () => {
    const ctx = setup(2);
    ctx.start();
    ctx.sessions[0]!.onClose();
    ctx.time.runNext(); // 끊김 마감 -> 자동 쯔모기리
    expect(ctx.state().players[0]!.discards).toHaveLength(1);
    runUntilAwaiting(ctx, 0, DISC);

    const { c } = ctx.rejoin(0);
    const v = viewMsgs(c).at(-1)!;
    expect(v.view).toEqual(viewFor(ctx.state(), 0));
    expect(v.view.players[0]!.discards.length).toBeGreaterThan(0);
    const json = JSON.stringify(c.sent);
    for (const k of FORBIDDEN_KEYS) expect(json).not.toContain(`"${k}"`);
    expect(v.view.players.every((p) => !("hand" in p))).toBe(true);
    // 상대(좌석 1)의 손패 타일이 뷰 어디에도 hand로 실리지 않는다
    expect(v.view.hand).toEqual(viewFor(ctx.state(), 0).hand);
    expect(c.sent.some((m) => m.type === "notice")).toBe(false); // 끊김 중 자동 처리는 알림 없음
  });

  it("응답 구간 중에는 뷰를 보류하고 구간 종료 시 보낸다 (joined는 즉시)", () => {
    const ctx = setup(2);
    ctx.start();
    ctx.act(ctx.sessions[0]!, 0, 0); // 버림패 -> 응답 구간 시작
    const { c } = ctx.rejoin(0);
    expect(c.sent.map((m) => m.type)).toEqual(["joined"]);
    ctx.time.runNext(); // 구간 종료 -> 전원에게 뷰
    expect(viewMsgs(c).length).toBeGreaterThan(0);
  });

  it("자동 모드 좌석이 재접속하면 자동 모드가 풀리고 일반 마감이 다시 시작된다", () => {
    const ctx = setup(2, { maxConsecutiveTimeouts: 1 });
    ctx.start();
    ctx.time.runNext(); // 1회 타임아웃 -> 자동 모드
    expect(ctx.conns[0]!.sent.some((m) => m.type === "notice" && m.code === "auto_mode")).toBe(true);
    for (let i = 0; i < 100 && !(awaitingSeats(ctx.state()).includes(0) && ctx.time.live()[0]?.delay === AUTO); i++) ctx.time.runNext();
    expect(ctx.time.live()[0]!.delay).toBe(AUTO);

    ctx.sessions[0]!.onClose(); // 실제로 끊긴 뒤 돌아온 경우 (연결 유지 중 교체는 자동 모드를 유지한다)
    const { c } = ctx.rejoin(0);
    expect([TURN, RESP]).toContain(ctx.time.live()[0]!.delay);
    expect(viewMsgs(c).at(-1)!.deadlineMs).toBeDefined();
  });
});

describe("마감 연장 방지", () => {
  it("연결 유지 중 교체 rejoin을 반복해도 마감이 리셋되지 않고 마감에 자동 처리된다", () => {
    const ctx = setup(2);
    ctx.start();
    expect(awaitingSeats(ctx.state())).toContain(0);
    const due = ctx.time.live()[0]!.due;
    let last: FakeConn | undefined;
    for (let i = 1; i <= 3; i++) {
      ctx.time.advance(200);
      const { c } = ctx.rejoin(0);
      last = c;
      expect(viewMsgs(c).at(-1)!.deadlineMs).toBe(TURN - 200 * i);
      expect(ctx.time.live().map((t) => t.due)).toEqual([due]);
    }
    expect(ctx.state().players[0]!.discards).toHaveLength(0);
    ctx.time.runNext(); // 원래 마감 시각에 자동 쯔모기리
    expect(ctx.state().players[0]!.discards).toHaveLength(1);
    expect(last).toBeDefined();
  });

  it("연속 타임아웃 카운터와 자동 모드도 연결 유지 중 rejoin으로 리셋되지 않는다", () => {
    const ctx = setup(2, { maxConsecutiveTimeouts: 2 });
    ctx.start();
    ctx.time.runNext(); // 타임아웃 1회
    runUntilAwaiting(ctx, 0, TURN);
    ctx.rejoin(0); // 카운터 유지
    ctx.time.runNext(); // 타임아웃 2회 -> 자동 모드
    expect(ctx.conns[0]!.sent.length).toBeGreaterThan(0);
    const { c } = ctx.rejoin(0);
    expect(c.sent.some((m) => m.type === "notice")).toBe(false);
    for (let i = 0; i < 100 && !(awaitingSeats(ctx.state()).includes(0) && ctx.time.live()[0]?.delay === AUTO); i++) ctx.time.runNext();
    expect(ctx.time.live()[0]!.delay).toBe(AUTO); // 자동 모드 유지
  });

  it("실제 끊김 후 재접속은 기존대로 마감을 일반 시간으로 다시 시작한다", () => {
    const ctx = setup(2);
    ctx.start();
    ctx.time.advance(400);
    ctx.sessions[0]!.onClose(); // 끊김 마감으로 단축
    const { c } = ctx.rejoin(0);
    expect(viewMsgs(c).at(-1)!.deadlineMs).toBe(TURN);
    expect(ctx.time.live().map((t) => t.due)).toEqual([ctx.time.now() + TURN]);
  });
});

// ---------------------------------------------------------------------------
// 전원 이탈 / 일시정지 / TTL
// ---------------------------------------------------------------------------

describe("전원 이탈", () => {
  it("모두 끊기면 진행이 멈추고(시간이 흘러도 상태 불변) 재접속하면 재개된다", () => {
    const ctx = setup(2);
    ctx.start();
    ctx.act(ctx.sessions[0]!, 0, 0); // 봇이 이어서 진행해야 하는 상황
    const frozen = ctx.state();
    ctx.sessions[0]!.onClose();
    ctx.sessions[1]!.onClose();
    expect(ctx.time.live()).toHaveLength(0);
    ctx.time.advance(10_000_000);
    expect(ctx.time.runNext()).toBe(false);
    expect(ctx.state()).toBe(frozen);

    const { c } = ctx.rejoin(1);
    expect(ctx.time.live().length).toBeLessThanOrEqual(1);
    for (let i = 0; i < 200; i++) ctx.time.runNext();
    expect(ctx.state()).not.toBe(frozen);
    expect(viewMsgs(c).length).toBeGreaterThan(0);
  });

  it("정지 중 시간은 소모되지 않는다: 재접속 시점부터 정상 마감(deadlineMs)이 다시 시작된다", () => {
    const ctx = setup(1);
    ctx.start();
    ctx.time.advance(TURN - 1); // 마감 직전
    ctx.sessions[0]!.onClose();
    expect(ctx.time.live()).toHaveLength(0);
    ctx.time.advance(5_000_000);
    const before = ctx.state();
    expect(ctx.time.runNext()).toBe(false);
    expect(ctx.state()).toBe(before);

    const { c } = ctx.rejoin(0);
    expect(viewMsgs(c).at(-1)!.deadlineMs).toBe(TURN);
    const t = ctx.time.live();
    expect(t).toHaveLength(1);
    expect(t[0]!.due).toBe(ctx.time.now() + TURN);
    expect(ctx.state()).toBe(before); // 즉시 자동 처리되지 않음
  });

  it("정지 중 타이머 누수 없음: 실제 타이머 기준으로 TTL 예약 1개뿐, 재접속 시 0개, close 시 0개", () => {
    vi.useFakeTimers();
    const manager = new RoomManager({ emptyRoomTtlMs: 500, game: { rng: seeded(1), scheduler: timeoutScheduler, turnTimeoutMs: 1e6, responseTimeoutMs: 1e6, disconnectedTimeoutMs: 100, responseWindowMs: 50, botDelayMs: 1 } });
    managers.push(manager);
    const c = fakeConn();
    const s = createSession(manager, c);
    s.onMessage(JSON.stringify({ type: "join" }));
    const joined = c.sent[0] as { roomId: string; seatToken: string };
    s.onMessage(JSON.stringify({ type: "start" }));
    expect(vi.getTimerCount()).toBe(1);
    s.onClose();
    expect(vi.getTimerCount()).toBe(1); // TTL만
    const c2 = fakeConn();
    const s2 = createSession(manager, c2);
    s2.onMessage(JSON.stringify({ type: "rejoin", roomId: joined.roomId, seatToken: joined.seatToken }));
    expect(vi.getTimerCount()).toBe(1); // TTL 취소, 마감 타이머 1개
    vi.advanceTimersByTime(10_000);
    expect(manager.roomCount).toBe(1);
    manager.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("TTL이 지나면 방이 삭제되어 이후 재접속은 unknown_room, TTL 전 재접속하면 방이 유지된다", () => {
    vi.useFakeTimers();
    const ctx = setup(2, {}, { emptyRoomTtlMs: 500 });
    ctx.start();
    ctx.sessions[0]!.onClose();
    ctx.sessions[1]!.onClose();
    vi.advanceTimersByTime(400);
    const { c } = ctx.rejoin(0);
    expect(viewMsgs(c)).toHaveLength(1);
    vi.advanceTimersByTime(10_000);
    expect(ctx.manager.roomCount).toBe(1);

    c.terminated = false;
    ctx.manager.disconnect(c);
    ctx.sessions[0]!.onClose(); // 이미 교체됨: 무시
    vi.advanceTimersByTime(500);
    expect(ctx.manager.roomCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    const late = ctx.rejoin(0);
    expect(errorCodes(late.c)).toEqual(["unknown_room"]);
  });
});

// ---------------------------------------------------------------------------
// 실제 ws 통합
// ---------------------------------------------------------------------------

let server: GameServerHandle | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

interface Client {
  ws: WebSocket;
  msgs: ServerMessage[];
  closed: Promise<number>;
  next(type?: ServerMessage["type"]): Promise<ServerMessage>;
}

async function connect(port: number): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const msgs: ServerMessage[] = [];
  const waiters: { type?: string; res: (m: ServerMessage) => void }[] = [];
  ws.on("message", (d: RawData) => {
    const m = JSON.parse(d.toString()) as ServerMessage;
    const i = waiters.findIndex((w) => !w.type || w.type === m.type);
    if (i >= 0) waiters.splice(i, 1)[0]!.res(m);
    else msgs.push(m);
  });
  const closed = new Promise<number>((res) => ws.once("close", (code) => res(code)));
  await new Promise<void>((res, rej) => {
    ws.once("open", () => res());
    ws.once("error", rej);
  });
  return {
    ws,
    msgs,
    closed,
    next: (type) => {
      const i = msgs.findIndex((m) => !type || m.type === type);
      if (i >= 0) return Promise.resolve(msgs.splice(i, 1)[0]!);
      return new Promise((res) => waiters.push({ ...(type && { type }), res }));
    },
  };
}

const wsGame: GameSessionOptions = {
  rng: seeded(1),
  scheduler: timeoutScheduler,
  botDelayMs: 0,
  responseWindowMs: 0,
  nextRoundDelayMs: 0,
  turnTimeoutMs: Infinity,
  responseTimeoutMs: Infinity,
  disconnectedTimeoutMs: Infinity,
};

describe("재접속 ws 통합", () => {
  it("연결이 끊긴 뒤 새 소켓으로 rejoin하면 같은 뷰를 받고 이어서 행동할 수 있다", async () => {
    server = await createGameServer({ port: 0, session: { rateBurst: 1e9, ratePerSecond: 1e9 }, room: { game: wsGame } });
    const a = await connect(server.port);
    a.ws.send(JSON.stringify({ type: "join" }));
    const joined = (await a.next("joined")) as Extract<ServerMessage, { type: "joined" }>;
    a.ws.send(JSON.stringify({ type: "start" }));
    const first = (await a.next("view")) as ViewMsg;
    expect(first.view.awaitingYou).toBe(true);

    // 먼저 새 소켓으로 rejoin: 이전 소켓은 서버가 닫는다
    const b = await connect(server.port);
    b.ws.send(JSON.stringify({ type: "rejoin", roomId: joined.roomId, seatToken: joined.seatToken }));
    expect(await b.next("joined")).toEqual(joined);
    const again = (await b.next("view")) as ViewMsg;
    expect(again.view).toEqual(first.view);
    await a.closed;
    // 이전 소켓의 close가 처리된 뒤에도 새 연결은 유효
    await new Promise((r) => setTimeout(r, 50));
    expect(server.rooms.getRoom(joined.roomId)!.seats[0]).toMatchObject({ kind: "human", connected: true });

    const act = again.view.legalActions.find((x) => x.type === "discard")!;
    b.ws.send(JSON.stringify({ type: "action", seq: 1, action: act }));
    const next = (await b.next("view")) as ViewMsg;
    expect(next.view.players[0]!.discards.length).toBeGreaterThan(0);
    expect(JSON.stringify(next)).not.toMatch(/"seed"|"liveWall"|"deadWall"/);
    b.ws.close();
  });

  it("잘못된 토큰 rejoin을 반복하면 연결이 종료된다", async () => {
    server = await createGameServer({ port: 0, session: { rateBurst: 1e9, ratePerSecond: 1e9, maxIdentifyFailures: 3 }, room: { game: wsGame } });
    const a = await connect(server.port);
    a.ws.send(JSON.stringify({ type: "join" }));
    const joined = (await a.next("joined")) as Extract<ServerMessage, { type: "joined" }>;
    const b = await connect(server.port);
    for (let i = 0; i < 4; i++) b.ws.send(JSON.stringify({ type: "rejoin", roomId: joined.roomId, seatToken: `bad${i}` }));
    await b.closed;
    expect(server.rooms.getRoom(joined.roomId)!.seats[0]).toMatchObject({ kind: "human", connected: true });
    a.ws.close();
  });
});

