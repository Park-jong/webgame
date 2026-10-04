import { describe, expect, it, vi } from "vitest";
import { awaitingSeats, decideAction, legalActions, type Action, type GameState, type RandomFn, type Tile } from "@mahjong/core";
import * as core from "@mahjong/core";
import {
  createSession,
  GameSession,
  immediateScheduler,
  RoomManager,
  secureRandom,
  viewFor,
  type Connection,
  type GameSessionOptions,
  type Scheduler,
  type ServerMessage,
  type SeatView,
} from "./index";

// dispatch 예외 주입을 위해 core를 통과(pass-through) mock으로 감싼다
vi.mock("@mahjong/core", async (orig) => {
  const actual = await orig<typeof import("@mahjong/core")>();
  return { ...actual, dispatch: vi.fn(actual.dispatch) };
});

// ---------------------------------------------------------------------------
// 헬퍼
// ---------------------------------------------------------------------------

export function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

type FakeConn = Connection & { sent: ServerMessage[]; terminated: boolean };

function fakeConn(): FakeConn {
  const c: FakeConn = {
    sent: [],
    terminated: false,
    send: (m) => void c.sent.push(m),
    close: () => {},
    terminate: () => {
      c.terminated = true;
    },
  };
  return c;
}

const views = (c: FakeConn): SeatView[] => c.sent.flatMap((m) => (m.type === "view" ? [m.view] : []));
const errors = (c: FakeConn) => c.sent.flatMap((m) => (m.type === "error" ? [m] : []));
const lastError = (c: FakeConn) => errors(c).at(-1);

interface Ctx {
  manager: RoomManager;
  conns: FakeConn[];
  sessions: ReturnType<typeof createSession>[];
  seqs: number[];
  rng: RandomFn;
  game(): GameSession;
  state(): GameState;
  send(i: number, msg: unknown): void;
  act(i: number, action: unknown, seq?: number): void;
}

function setup(humans: number, seed = 1, game: GameSessionOptions = {}): Ctx {
  const rng = mulberry32(seed);
  const manager = new RoomManager({
    game: {
      rng,
      scheduler: immediateScheduler,
      botDelayMs: 0,
      responseWindowMs: 0,
      nextRoundDelayMs: 0,
      // 즉시 스케줄러에서는 사람 마감이 바로 발동하므로 이 파일의 기존 테스트는 마감을 끈다 (S-7은 game-timeout.test.ts)
      turnTimeoutMs: Infinity,
      responseTimeoutMs: Infinity,
      disconnectedTimeoutMs: Infinity,
      ...game,
    },
  });
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
  const ctx: Ctx = {
    manager,
    conns,
    sessions,
    seqs,
    rng,
    game: () => manager.gameOf(manager.getRoom(roomId!)!)!,
    state: () => ctx.game().peekState()!,
    send: (i, msg) => sessions[i]!.onMessage(JSON.stringify(msg)),
    act: (i, action, seq) => ctx.send(i, { type: "action", seq: seq ?? seqs[i]!++, action }),
  };
  return ctx;
}

function strip(a: Action): unknown {
  const { seat: _seat, ...rest } = a;
  return rest;
}

/** 사람 좌석이 행동할 차례면 봇 알고리즘으로 한 수 둔다. 둘 수 없으면 false */
function humanMove(ctx: Ctx, humans: number): boolean {
  const s = ctx.state();
  for (const seat of awaitingSeats(s)) {
    if (seat >= humans) continue;
    ctx.act(seat, strip(decideAction(s, seat, ctx.rng)));
    return true;
  }
  return false;
}

function playToEnd(ctx: Ctx, humans: number, maxMoves = 5000): void {
  for (let i = 0; i < maxMoves && ctx.state().phase !== "gameEnd"; i++) {
    if (!humanMove(ctx, humans)) throw new Error(`진행 불가: ${ctx.state().phase}`);
  }
}

function scoreSum(s: { scores: readonly number[]; riichiSticks: number }): number {
  return s.scores.reduce((a, b) => a + b, 0) + s.riichiSticks * 1000;
}

function manualScheduler() {
  const q: { fn: () => void; delay: number; cancelled: boolean; done: boolean }[] = [];
  const sched: Scheduler = (fn, delay) => {
    const t = { fn, delay, cancelled: false, done: false };
    q.push(t);
    return () => {
      t.cancelled = true;
    };
  };
  const live = () => q.filter((t) => !t.cancelled && !t.done);
  return {
    sched,
    live,
    runNext(): boolean {
      const t = live()[0];
      if (!t) return false;
      t.done = true;
      t.fn();
      return true;
    },
  };
}

// ---------------------------------------------------------------------------
// rng
// ---------------------------------------------------------------------------

describe("secureRandom", () => {
  it("[0,1) 범위이고 값이 고르게 달라진다", () => {
    const xs = Array.from({ length: 2000 }, () => secureRandom());
    expect(xs.every((x) => x >= 0 && x < 1)).toBe(true);
    expect(new Set(xs).size).toBeGreaterThan(1990);
    const mean = xs.reduce((a, b) => a + b, 0) / xs.length;
    expect(mean).toBeGreaterThan(0.45);
    expect(mean).toBeLessThan(0.55);
  });
});

// ---------------------------------------------------------------------------
// 시작 / 거부
// ---------------------------------------------------------------------------

describe("start", () => {
  it("시작 전 action은 game_not_started, 시작하면 빈 좌석이 봇으로 채워진다", () => {
    const ctx = setup(1);
    ctx.act(0, { type: "pass" }, 0);
    expect(lastError(ctx.conns[0]!)).toMatchObject({ code: "game_not_started", seq: 0 });

    ctx.send(0, { type: "start" });
    const room = ctx.manager.getRoom((ctx.conns[0]!.sent[0] as { roomId: string }).roomId)!;
    expect(room.seats.map((s) => s.kind)).toEqual(["human", "bot", "bot", "bot"]);
    expect(views(ctx.conns[0]!).length).toBeGreaterThan(0);
  });

  it("중복 start는 game_already_started, 방 밖 start/action은 bad_message", () => {
    const ctx = setup(2);
    ctx.send(1, { type: "start" });
    ctx.send(0, { type: "start" });
    expect(lastError(ctx.conns[0]!)?.code).toBe("game_already_started");
    const loner = fakeConn();
    const s = createSession(ctx.manager, loner);
    s.onMessage(JSON.stringify({ type: "start" }));
    s.onMessage(JSON.stringify({ type: "action", seq: 0, action: { type: "pass" } }));
    expect(errors(loner).map((e) => e.code)).toEqual(["bad_message", "bad_message"]);
  });

  it("시작 후에는 빈 좌석이 없어 추가 join이 거부된다", () => {
    const ctx = setup(1);
    ctx.send(0, { type: "start" });
    const late = fakeConn();
    const roomId = (ctx.conns[0]!.sent[0] as { roomId: string }).roomId;
    createSession(ctx.manager, late).onMessage(JSON.stringify({ type: "join", roomId }));
    expect(lastError(late)?.code).toBe("room_full");
  });
});

describe("action 검증", () => {
  it("차례가 아닌 좌석은 not_your_turn, 클라이언트가 보낸 seat는 무시된다", () => {
    const ctx = setup(2);
    ctx.send(0, { type: "start" });
    const before = ctx.state();
    // 좌석 0이 친(차례). 좌석 1이 seat:0으로 위조해 타패 시도
    const tile = before.players[0]!.hand[0]!;
    ctx.act(1, { type: "discard", seat: 0, tile });
    expect(lastError(ctx.conns[1]!)?.code).toBe("not_your_turn");
    expect(ctx.state()).toBe(before);

    // 좌석 0이 seat:2로 위조해도 좌석 0의 행동으로 처리
    ctx.act(0, { type: "discard", seat: 2, tile });
    expect(errors(ctx.conns[0]!)).toHaveLength(0);
    expect(ctx.state().players[0]!.discards[0]?.tile).toEqual(tile);
    expect(ctx.state().players[2]!.discards.length).toBeLessThanOrEqual(1);
  });

  it("불법 행동은 illegal_action이고 상태가 변하지 않으며 오류에 내부 정보가 없다", () => {
    const ctx = setup(1, 3);
    ctx.send(0, { type: "start" });
    const before = ctx.state();
    const hand = before.players[0]!.hand;
    const missing: Tile = (["east", "south", "west", "north"] as const)
      .map((wind): Tile => ({ kind: "wind", wind }))
      .find((t) => !hand.some((h) => h.kind === "wind" && h.wind === (t as { wind: string }).wind))!;
    const attempts = [
      { type: "tsumo" }, // 역 없는 화료
      { type: "ron" }, // 차례 중 론
      { type: "pass" },
      { type: "discard", tile: missing }, // 손에 없는 패
      { type: "discard", tile: hand[0], riichi: true }, // 멘젠 비텐파이 리치
      { type: "kyuushu" },
      { type: "chi", use: [hand[0], hand[1]] },
    ];
    for (const a of attempts) ctx.act(0, a);
    const errs = errors(ctx.conns[0]!);
    expect(errs).toHaveLength(attempts.length);
    for (const e of errs) {
      expect(e.code).toBe("illegal_action");
      expect(Object.keys(e).sort()).toEqual(["code", "message", "seq", "type"]);
      expect(JSON.stringify(e)).not.toMatch(/kind|suit|rank/);
    }
    expect(ctx.state()).toBe(before);
  });

  it("seq는 좌석별로 단조 증가해야 한다 (중복/역전 거부)", () => {
    const ctx = setup(2);
    ctx.send(0, { type: "start" });
    const t0 = ctx.state().players[0]!.hand[0]!;
    ctx.act(0, { type: "pass" }, 5); // 불법이지만 seq 5 소비
    expect(lastError(ctx.conns[0]!)?.code).toBe("illegal_action");
    ctx.act(0, { type: "discard", tile: t0 }, 5);
    expect(lastError(ctx.conns[0]!)).toMatchObject({ code: "bad_seq", seq: 5 });
    ctx.act(0, { type: "discard", tile: t0 }, 2);
    expect(lastError(ctx.conns[0]!)).toMatchObject({ code: "bad_seq", seq: 2 });
    expect(ctx.state().players[0]!.discards).toHaveLength(0);
    ctx.act(0, { type: "discard", tile: t0 }, 6);
    expect(ctx.state().players[0]!.discards).toHaveLength(1);
    // 다른 좌석의 seq는 독립
    ctx.act(1, { type: "pass" }, 0);
    expect(lastError(ctx.conns[1]!)?.code).not.toBe("bad_seq");
  });

  it("dispatch가 예외를 던져도 상태 불변, illegal_action 응답, 서버 생존", () => {
    const ctx = setup(1, 4);
    ctx.send(0, { type: "start" });
    const before = ctx.state();
    const a = legalActions(before, 0).find((x) => x.type === "discard")!;
    vi.mocked(core.dispatch).mockImplementationOnce(() => {
      throw new Error("boom: 내부 상태");
    });
    const nViews = views(ctx.conns[0]!).length;
    ctx.act(0, strip(a));
    expect(lastError(ctx.conns[0]!)).toMatchObject({ code: "illegal_action", message: "허용되지 않는 행동입니다" });
    expect(ctx.state()).toBe(before);
    expect(views(ctx.conns[0]!)).toHaveLength(nViews);
    ctx.act(0, strip(a)); // 이후 정상 동작
    expect(ctx.state()).not.toBe(before);
  });
});

// ---------------------------------------------------------------------------
// 진행
// ---------------------------------------------------------------------------

describe("진행", () => {
  it("사람 1 + 봇 3이 게임 끝까지 진행되고 종료 후 action은 거부된다", () => {
    const ctx = setup(1, 7);
    ctx.send(0, { type: "start" });
    playToEnd(ctx, 1);
    const end = ctx.state();
    expect(end.phase).toBe("gameEnd");
    expect(scoreSum(end)).toBe(100000);
    const last = views(ctx.conns[0]!).at(-1)!;
    expect(last.phase).toBe("gameEnd");
    expect(last.result).not.toBeNull();

    const nViews = views(ctx.conns[0]!).length;
    ctx.act(0, { type: "pass" });
    ctx.act(0, { type: "discard", tile: end.players[0]!.hand[0] });
    expect(errors(ctx.conns[0]!).slice(-2).map((e) => e.code)).toEqual(["not_your_turn", "not_your_turn"]);
    expect(ctx.state()).toBe(end);
    expect(views(ctx.conns[0]!)).toHaveLength(nViews);
  });

  it("상태가 바뀔 때마다 뷰가 전송되고 마지막 뷰는 현재 상태의 뷰와 같다", () => {
    const ctx = setup(1, 11);
    ctx.send(0, { type: "start" });
    let prev = views(ctx.conns[0]!).length;
    for (let i = 0; i < 40 && ctx.state().phase !== "gameEnd"; i++) {
      expect(humanMove(ctx, 1)).toBe(true);
      const now = views(ctx.conns[0]!).length;
      expect(now).toBeGreaterThan(prev);
      prev = now;
      expect(views(ctx.conns[0]!).at(-1)).toEqual(viewFor(ctx.state(), 0));
    }
  });

  it("국 종료 뷰(결과 포함) 후 자동으로 다음 국이 시작된다", () => {
    const ctx = setup(1, 21);
    ctx.send(0, { type: "start" });
    playToEnd(ctx, 1);
    const vs = views(ctx.conns[0]!);
    const ends = vs.filter((v) => v.phase === "roundEnd");
    expect(ends.length).toBeGreaterThan(0);
    for (const v of ends) expect(v.result).not.toBeNull();
    const idx = vs.findIndex((v) => v.phase === "roundEnd");
    expect(vs.slice(idx + 1).some((v) => v.phase === "turn")).toBe(true);
  });

  it("사람 4명: 각자 자기 뷰만 받고 상대 손패 필드가 없다", () => {
    const ctx = setup(4, 5);
    ctx.send(2, { type: "start" });
    for (let i = 0; i < 60 && ctx.state().phase !== "gameEnd"; i++) if (!humanMove(ctx, 4)) break;
    ctx.conns.forEach((c, seat) => {
      const vs = views(c);
      expect(vs.length).toBeGreaterThan(1);
      for (const v of vs) {
        expect(v.seat).toBe(seat);
        expect(v.players.every((p) => !("hand" in p))).toBe(true);
        expect(v.hand.length).toBe(v.players[seat]!.handCount);
      }
      expect(vs.at(-1)).toEqual(viewFor(ctx.state(), seat));
    });
  });

  it("봇 좌석과 끊긴 좌석에는 뷰를 보내지 않고, sendViewTo로 재전송할 수 있다", () => {
    const ctx = setup(2, 9);
    ctx.send(0, { type: "start" });
    ctx.sessions[1]!.onClose();
    const n1 = ctx.conns[1]!.sent.length;
    humanMove(ctx, 2);
    expect(ctx.conns[1]!.sent).toHaveLength(n1);
    const n0 = ctx.conns[0]!.sent.length;
    ctx.game().sendViewTo(0);
    ctx.game().sendViewTo(1); // 끊김
    ctx.game().sendViewTo(3); // 봇
    expect(ctx.conns[0]!.sent).toHaveLength(n0 + 1);
    expect(ctx.conns[1]!.sent).toHaveLength(n1);
  });

  it("끊긴 사람 좌석의 차례에서 게임은 멈추지만 예외/타이머 폭주가 없다", () => {
    const m = manualScheduler();
    const ctx = setup(1, 2, { scheduler: m.sched });
    ctx.send(0, { type: "start" });
    ctx.sessions[0]!.onClose();
    let guard = 0;
    while (m.runNext() && guard++ < 10000);
    expect(guard).toBeLessThan(10000);
    expect(m.live()).toHaveLength(0);
    expect(awaitingSeats(ctx.state())).toContain(0);
  });
});

describe("응답 구간 / 스케줄러", () => {
  it("응답 구간: 불법 응답은 즉시 거부되어 큐에 쌓이지 않고, 정당한 응답은 해당 좌석에만 ack되며 재응답은 not_your_turn", () => {
    let verified = false;
    let sawResponse = 0;
    for (let seed = 1; seed <= 60 && !verified; seed++) {
      const m = manualScheduler();
      const ctx = setup(2, seed, { scheduler: m.sched, responseWindowMs: 50, botDelayMs: 7, nextRoundDelayMs: 9 });
      ctx.send(0, { type: "start" });
      for (let i = 0; i < 3000 && ctx.state().phase !== "gameEnd" && !verified; i++) {
        const s = ctx.state();
        const windowOpen = m.live()[0]?.delay === 50;
        const waiting = [0, 1].filter((h) => awaitingSeats(s).includes(h));
        if (s.phase === "response" && windowOpen && waiting.length > 0) {
          sawResponse++;
          const h = waiting[0]!;
          const c = ctx.conns[h]!;
          const other = ctx.conns[1 - h]!;
          const n = c.sent.length;
          const nOther = other.sent.length;
          ctx.act(h, { type: "chi", use: [{ kind: "wind", wind: "east" }, { kind: "wind", wind: "south" }] });
          ctx.act(h, { type: "kyuushu" });
          expect(errors(c).slice(-2).map((e) => e.code)).toEqual(["illegal_action", "illegal_action"]);
          expect(c.sent.slice(n).some((x) => x.type === "ack")).toBe(false);
          // 불법 시도가 큐에 쌓이지 않았으므로 이후 정당한 응답이 수락된다
          const seq = ctx.seqs[h]!;
          ctx.act(h, { type: "pass" });
          expect(c.sent.filter((x) => x.type === "ack")).toEqual([{ type: "ack", seq }]);
          expect(ctx.state()).toBe(s); // 아직 해결되지 않음
          expect(c.sent.slice(n).some((x) => x.type === "view")).toBe(false);
          ctx.act(h, { type: "pass" });
          expect(lastError(c)?.code).toBe("not_your_turn");
          expect(other.sent.slice(nOther).some((x) => x.type === "ack")).toBe(false);
          m.runNext();
          expect(ctx.state()).not.toBe(s);
          expect(c.sent.filter((x) => x.type === "ack")).toHaveLength(1);
          expect(other.sent.some((x) => x.type === "ack")).toBe(false);
          verified = true;
        } else if (windowOpen) {
          m.runNext();
        } else if (!humanMove(ctx, 2) && !m.runNext()) break;
      }
    }
    expect(sawResponse).toBeGreaterThan(0);
    expect(verified).toBe(true);
  });

  it("모든 타패 직후 같은 지연의 구간이 걸리고, 응답 대상이 아닌 좌석에는 구간 중 뷰가 가지 않는다", () => {
    const m = manualScheduler();
    const ctx = setup(1, 6, { scheduler: m.sched, responseWindowMs: 50, botDelayMs: 7, nextRoundDelayMs: 9 });
    ctx.send(0, { type: "start" });
    const total = (s: GameState): number => s.players.reduce((a, p) => a + p.discards.length, 0);
    let prev = 0;
    let checks = 0;
    for (let i = 0; i < 4000 && ctx.state().phase !== "gameEnd"; i++) {
      const vc = views(ctx.conns[0]!).length;
      if (m.live()[0]?.delay === 50) m.runNext();
      else if (!humanMove(ctx, 1) && !m.runNext()) break;
      const s = ctx.state();
      if (total(s) > prev) {
        checks++;
        expect(m.live()[0]?.delay).toBe(50); // 응답 가능자가 없어도 동일 지연
        if (!awaitingSeats(s).includes(0) || s.phase !== "response") {
          expect(views(ctx.conns[0]!)).toHaveLength(vc);
        }
      }
      prev = total(s);
    }
    expect(checks).toBeGreaterThan(20);
  });

  it("seq 점프 상한: 거부된 seq는 lastSeq를 올리지 않아 이후 정상 seq가 통한다", () => {
    const ctx = setup(1, 8);
    ctx.send(0, { type: "start" });
    const tile = ctx.state().players[0]!.hand[0]!;
    ctx.act(0, { type: "discard", tile }, Number.MAX_SAFE_INTEGER);
    ctx.act(0, { type: "discard", tile }, 1000); // -1 + 1000 초과
    expect(errors(ctx.conns[0]!).map((e) => e.code)).toEqual(["bad_seq", "bad_seq"]);
    ctx.act(0, { type: "discard", tile }, 999);
    expect(errors(ctx.conns[0]!)).toHaveLength(2);
    expect(ctx.state().players[0]!.discards).toHaveLength(1);
  });

  it("봇이 연속으로 진행에 실패하면 방이 정지하고 사람에게 server_error가 1회 전달된다", () => {
    const ctx = setup(1, 3, { botDecide: (_s, seat) => ({ type: "pass", seat }), maxBotFailures: 3 });
    ctx.send(0, { type: "start" });
    for (let i = 0; i < 20; i++) humanMove(ctx, 1);
    expect(errors(ctx.conns[0]!).filter((e) => e.code === "server_error")).toHaveLength(1);
    const before = ctx.state();
    ctx.act(0, { type: "pass" });
    expect(lastError(ctx.conns[0]!)?.code).toBe("server_error");
    expect(ctx.state()).toBe(before);
  });

  it("close()하면 대기 중 타이머가 취소되고 이후 입력은 처리되지 않는다", () => {
    const m = manualScheduler();
    const ctx = setup(1, 2, { scheduler: m.sched });
    ctx.send(0, { type: "start" });
    ctx.game().close();
    expect(m.live()).toHaveLength(0);
    const before = ctx.state();
    ctx.act(0, { type: "pass" });
    expect(lastError(ctx.conns[0]!)?.code).toBe("game_not_started");
    expect(ctx.state()).toBe(before);
  });

  it("RoomManager.close()가 게임 타이머를 정리한다", () => {
    const m = manualScheduler();
    const ctx = setup(1, 2, { scheduler: m.sched });
    ctx.send(0, { type: "start" });
    ctx.manager.close();
    expect(m.live()).toHaveLength(0);
  });

  it("기본 RNG(crypto)로도 게임이 시작되고 시드가 메시지에 실리지 않는다", () => {
    const manager = new RoomManager({ game: { scheduler: immediateScheduler, turnTimeoutMs: Infinity, responseTimeoutMs: Infinity, botDelayMs: 0, responseWindowMs: 0 } });
    const c = fakeConn();
    const s = createSession(manager, c);
    s.onMessage(JSON.stringify({ type: "join" }));
    s.onMessage(JSON.stringify({ type: "start" }));
    expect(views(c).length).toBeGreaterThan(0);
    expect(JSON.stringify(c.sent)).not.toMatch(/"seed"|"rng"|"liveWall"|"deadWall"/i);
    manager.close();
  });
});

// ---------------------------------------------------------------------------
// 퍼즈 (세션 단위)
// ---------------------------------------------------------------------------

describe("퍼즈", () => {
  it("합법/불법/깨진 입력을 섞어도 죽지 않고 불변식이 유지된다", () => {
    for (let seed = 1; seed <= 8; seed++) {
      const ctx = setup(2, seed);
      const r = mulberry32(seed * 977);
      ctx.send(0, { type: "start" });
      const hostile: unknown[] = [
        "{",
        "null",
        JSON.stringify({ type: "action", seq: -1, action: { type: "pass" } }),
        JSON.stringify({ type: "action", seq: 1.5, action: {} }),
        JSON.stringify({ type: "action", seq: 1, action: { type: "discard", tile: { kind: "x" } } }),
        JSON.stringify({ type: "start", extra: 1 }),
        JSON.stringify({ type: "join" }),
      ];
      const checkpoint = (): void => {
        const s = ctx.state();
        expect(scoreSum(s)).toBe(100000);
        for (const p of s.players) expect([13, 14, 10, 11, 7, 8, 4, 5, 1, 2]).toContain(p.hand.length);
      };
      for (let i = 0; i < 1500 && ctx.state().phase !== "gameEnd"; i++) {
        const who = Math.floor(r() * 2);
        const s = ctx.state();
        const roll = r();
        if (roll < 0.35) {
          humanMove(ctx, 2);
        } else if (roll < 0.55) {
          // 다른 좌석의 합법 행동을 내 소켓으로 (seat 위조 포함)
          const other = legalActions(s, 1 - who)[0];
          if (other) ctx.act(who, other as unknown);
        } else if (roll < 0.75) {
          const pool = s.players[who]!.hand;
          const tile = pool[Math.floor(r() * pool.length)];
          ctx.act(who, { type: "discard", tile, riichi: r() < 0.5 });
        } else if (roll < 0.85) {
          ctx.act(who, { type: ["tsumo", "ron", "pass", "kyuushu", "daiminkan"][Math.floor(r() * 5)] });
        } else if (roll < 0.95) {
          ctx.sessions[who]!.onMessage(hostile[Math.floor(r() * hostile.length)] as string);
        } else {
          ctx.act(who, { type: "pass" }, Math.floor(r() * 5)); // 낮은 seq 재사용
        }
        checkpoint();
      }
      expect(ctx.conns.every((c) => !c.terminated)).toBe(true);
    }
  });
});
