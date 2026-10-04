import { afterEach, describe, expect, it, vi } from "vitest";
import { GameSession, RoomManager, createGameServer, immediateScheduler, timeoutScheduler, type GameServerHandle, type GameSessionOptions } from "./index";
import { Player, activeTimeouts, leakProblems, logSeed, scale, seeded, sleep, until } from "./test-utils";

// S-9 통합 회귀: 실제 ws 연결로 한 판 완주 / 끊김·재접속·타임아웃 / 혼합·다중 방 / 종료 후 자원 0

const NO_LIMIT_FAST = (seed: number): GameSessionOptions => ({
  rng: seeded(seed),
  scheduler: immediateScheduler,
  turnTimeoutMs: Infinity,
  responseTimeoutMs: Infinity,
  disconnectedTimeoutMs: Infinity,
  botDelayMs: 0,
  responseWindowMs: 0,
  nextRoundDelayMs: 0,
});
const SESSION = { rateBurst: 1e9, ratePerSecond: 1e9 };

let server: GameServerHandle | undefined;
let players: Player[] = [];
afterEach(async () => {
  for (const p of players) p.ws.terminate();
  players = [];
  await server?.close();
  server = undefined;
});

async function start(game: GameSessionOptions, maxRooms?: number): Promise<GameServerHandle> {
  server = await createGameServer({ port: 0, session: SESSION, room: { game, ...(maxRooms && { maxRooms }) } });
  return server;
}
async function seat(port: number, seed: number, roomId?: string, play = true): Promise<Player> {
  const p = await Player.join(port, { rng: seeded(seed), play }, roomId);
  players.push(p);
  return p;
}

/** 연결 0, 방 0, 타이머 기준값 복귀를 기다린다 */
async function expectClean(baseline: number): Promise<void> {
  const s = server!;
  await until(() => s.rooms.connectionCount === 0, 5000, "연결 매핑 0");
  await s.close();
  server = undefined;
  await until(() => activeTimeouts() <= baseline, 5000, `타이머 잔존 (기준 ${baseline}, 현재 ${activeTimeouts()})`);
}

function allTokens(ps: Player[]): string[] {
  return ps.map((p) => p.token);
}

describe("S-9 통합 회귀 (실제 ws)", () => {
  it("사람 4명: 한 판 끝까지 + 다음 국 자동 진행 + 누출 0 + 종료 후 자원 0", async () => {
    const baseline = activeTimeouts();
    const s = await start(NO_LIMIT_FAST(31));
    const a = await seat(s.port, 1);
    const rest = [await seat(s.port, 2, a.roomId), await seat(s.port, 3, a.roomId), await seat(s.port, 4, a.roomId)];
    const all = [a, ...rest];
    expect(all.map((p) => p.seat)).toEqual([0, 1, 2, 3]);
    a.send({ type: "start" });
    await until(() => all.every((p) => p.gameEnd), 20000, "게임 종료");

    for (const p of all) {
      expect(p.roundEnds).toBeGreaterThan(0);
      // 국 종료 뒤 서버가 알아서 다음 국으로 넘어갔다: roundEnd 이후에 다른 (kyoku,honba,dealer) 뷰가 존재
      const i = p.views.findIndex((v) => v.phase === "roundEnd");
      const end = p.views[i]!;
      expect(p.views.slice(i + 1).some((v) => v.kyoku !== end.kyoku || v.honba !== end.honba || v.dealer !== end.dealer)).toBe(true);
      expect(leakProblems(p.msgs, { seat: p.seat, token: p.token }, allTokens(all))).toEqual([]);
    }
    all.forEach((p) => p.close());
    await expectClean(baseline);
  }, 30000);

  it("끊김/재접속 + 타임아웃 -> 자동 모드 -> 복귀 (사람 2 + 봇 2, 실제 타이머)", async () => {
    const baseline = activeTimeouts();
    const s = await start({
      rng: seeded(41),
      scheduler: timeoutScheduler,
      botDelayMs: 0,
      responseWindowMs: 0,
      nextRoundDelayMs: 0,
      turnTimeoutMs: 100,
      responseTimeoutMs: 100,
      disconnectedTimeoutMs: 40,
      autoDelayMs: 2,
      maxConsecutiveTimeouts: 2,
    });
    const a = await seat(s.port, 5);
    const b = await seat(s.port, 6, a.roomId, false); // B는 응답하지 않는다
    const seen: Player[] = [a, b];
    a.send({ type: "start" });

    // B가 연속 타임아웃으로 자동 모드에 들어간다. 그 사이 A 쪽 진행은 멈추지 않는다
    await until(() => b.notices.includes("auto_mode"), 15000, "B auto_mode");
    expect(b.notices.filter((n) => n === "timeout").length).toBeGreaterThanOrEqual(2);
    const aViews = a.views.length;
    await until(() => a.views.length > aViews + 3, 10000, "A 진행");

    // B 끊김 -> 같은 토큰으로 재접속: 현재 뷰를 즉시 받고 정상 마감으로 복귀
    const bToken = b.token;
    b.close();
    await until(() => b.closedFlag, 3000, "B close");
    const b2 = await Player.rejoin(s.port, { rng: seeded(7), play: true, seq: b.seq }, a.roomId, bToken);
    players.push(b2);
    seen.push(b2);
    expect(b2.seat).toBe(1);
    await until(() => b2.views.length > 0, 5000, "재접속 뷰");
    const base2 = b2.notices.length;
    await until(() => b2.views.length > 10, 15000, "B2 진행");
    expect(b2.notices.slice(base2)).not.toContain("auto_mode");

    // A도 끊겼다 돌아온다 (그 사이 B2 혼자 진행)
    const aToken = a.token;
    const aSeq = a.seq;
    a.close();
    await until(() => a.closedFlag, 3000, "A close");
    const b2Views = b2.views.length;
    await until(() => b2.views.length > b2Views + 3, 10000, "A 부재 중 진행");
    const a2 = await Player.rejoin(s.port, { rng: seeded(8), play: true, seq: aSeq + 5 }, a.roomId, aToken);
    players.push(a2);
    seen.push(a2);
    await until(() => a2.views.length > 3, 10000, "A2 진행");

    for (const p of seen) expect(leakProblems(p.msgs, { seat: p.seat, token: p.token }, allTokens(seen))).toEqual([]);
    [a2, b2].forEach((p) => p.close());
    await expectClean(baseline);
  }, 60000);

  it("사람+봇 혼합 방 여러 개 동시 진행 + 한 방이 끊겨도 다른 방은 영향 없음", async () => {
    const seed = 900;
    logSeed("multi-room", seed);
    const roomCount = scale(4, 12);
    const baseline = activeTimeouts();
    const s = await start(NO_LIMIT_FAST(seed));
    const rooms: Player[][] = [];
    for (let r = 0; r < roomCount; r++) {
      const humans = (r % 4) + 1;
      const first = await seat(s.port, seed + r * 10);
      const group = [first];
      for (let i = 1; i < humans; i++) group.push(await seat(s.port, seed + r * 10 + i, first.roomId));
      rooms.push(group);
    }
    expect(new Set(rooms.map((g) => g[0]!.roomId)).size).toBe(roomCount);
    expect(s.rooms.roomCount).toBe(roomCount);

    // 0번 방은 시작하자마자 전원 끊는다(진행 중단). 나머지는 모두 완주해야 한다
    for (const g of rooms) g[0]!.send({ type: "start" });
    for (const p of rooms[0]!) p.close();
    const live = rooms.slice(1).flat();
    await until(() => live.every((p) => p.gameEnd), 60000, "나머지 방 완주");

    const tokens = rooms.flat().map((p) => p.token);
    expect(new Set(tokens).size).toBe(tokens.length);
    for (const g of rooms.slice(1)) {
      for (const p of g) {
        expect(p.views.every((v) => v.seat === p.seat)).toBe(true);
        expect(p.msgs.every((m) => m.type !== "joined" || m.roomId === g[0]!.roomId)).toBe(true);
        expect(leakProblems(p.msgs, { seat: p.seat, token: p.token }, tokens)).toEqual([]);
      }
    }
    // 전원 이탈한 0번 방은 정지(진행 없음)
    const before = rooms[0]![0]!.views.length;
    await sleep(100);
    expect(rooms[0]![0]!.views.length).toBe(before);
    live.forEach((p) => p.close());
    await expectClean(baseline);
  }, 90000);

  it("서버 close 중 진행 중인 게임이 있어도 깔끔히 종료되고 이후 타이머가 남지 않는다", async () => {
    const baseline = activeTimeouts();
    const s = await start({ rng: seeded(77), scheduler: timeoutScheduler, botDelayMs: 5, responseWindowMs: 5, nextRoundDelayMs: 5 });
    const ps = [await seat(s.port, 1), await seat(s.port, 2)];
    ps[0]!.send({ type: "start" });
    await until(() => ps[0]!.views.length > 5, 10000, "진행");
    await s.close();
    server = undefined;
    await until(() => ps.every((p) => p.closedFlag), 5000, "클라이언트 종료");
    const n = ps[0]!.views.length;
    await sleep(100);
    expect(ps[0]!.views.length).toBe(n); // 종료 후 더 이상 진행하지 않는다
    await until(() => activeTimeouts() <= baseline, 5000, "타이머 복귀");
  }, 30000);
});

describe("S-9 피드백: 예기치 않은 예외 격리 / close 멱등 / 정리 경로", () => {
  it("핸들러 예외(TypeError): 해당 연결만 server_error 후 종료, 서버와 다른 연결은 정상, 내부 정보 미노출", async () => {
    const s = await start(NO_LIMIT_FAST(5));
    // 정상 연결 하나를 먼저 앉혀 둔다
    const healthy = await seat(s.port, 1, undefined, false);
    const original = s.rooms.join.bind(s.rooms);
    vi.spyOn(s.rooms, "join").mockImplementation(() => {
      throw new TypeError("boom: C:\secret\path\internal.ts:42");
    });
    const victim = await Player.open(s.port, { rng: seeded(2), play: false });
    victim.send({ type: "join" });
    await until(() => victim.closedFlag, 5000, "예외 연결 종료");
    expect(victim.errors.map((e) => e.code)).toEqual(["server_error"]);
    const raw = victim.raw.join("\n");
    expect(raw).not.toMatch(/boom|TypeError|secret|internal|\bat\b.*:\d+|stack/i);

    // 서버와 다른 연결은 정상
    expect(healthy.closedFlag).toBe(false);
    healthy.send({ type: "ping" });
    await until(() => healthy.msgs.some((m) => m.type === "pong"), 5000, "다른 연결 pong");
    vi.mocked(s.rooms.join).mockImplementation(original);
    const fresh = await seat(s.port, 3);
    expect(fresh.token).not.toBe("");
  });

  it("createGameServer.close()는 멱등: 두 번째 호출도 같은 결과로 resolve", async () => {
    const s = await start(NO_LIMIT_FAST(6));
    const closeRooms = vi.spyOn(s.rooms, "close");
    const first = s.close();
    const second = s.close();
    await expect(Promise.all([first, second])).resolves.toEqual([undefined, undefined]);
    await expect(s.close()).resolves.toBeUndefined();
    expect(closeRooms).toHaveBeenCalledTimes(1); // rooms.close() 호출 확인(및 중복 호출 없음)
    server = undefined;
  });

  it("createGameServer.close()가 rooms.close()를 호출한다", async () => {
    const s = await start(NO_LIMIT_FAST(7));
    const closeRooms = vi.spyOn(s.rooms, "close");
    await s.close();
    server = undefined;
    expect(closeRooms).toHaveBeenCalled();
  });

  it("GameSession.close() 직후 실제 타이머가 모두 정리된다", async () => {
    // 실제 타이머를 쓰되 살아 있는 개수를 센다(unref된 타이머는 activeTimeouts에 안 잡히므로)
    let live = 0;
    const counting: typeof timeoutScheduler = (fn, ms) => {
      live++;
      let done = false;
      const cancel = timeoutScheduler(() => {
        done = true;
        live--;
        fn();
      }, ms);
      return () => {
        if (!done) {
          done = true;
          live--;
        }
        cancel();
      };
    };
    const manager = new RoomManager({ game: { rng: seeded(8), scheduler: counting, botDelayMs: 60_000, responseWindowMs: 60_000, nextRoundDelayMs: 60_000 } });
    const conn = { send() {}, close() {}, terminate() {} };
    manager.join(conn);
    manager.startGame(conn);
    const found = manager.find(conn)!;
    const game = manager.gameOf(found.room) as GameSession;
    expect(live).toBeGreaterThan(0); // 대기 중 타이머 존재
    game.close();
    expect(live).toBe(0);
    manager.close();
  });

  it("RoomManager.close()가 모든 방의 게임을 닫는다", () => {
    const manager = new RoomManager({ game: { rng: seeded(9), scheduler: timeoutScheduler, botDelayMs: 60_000, responseWindowMs: 60_000, nextRoundDelayMs: 60_000 } });
    const games: GameSession[] = [];
    for (let i = 0; i < 3; i++) {
      const conn = { send() {}, close() {}, terminate() {} };
      manager.join(conn);
      manager.startGame(conn);
      games.push(manager.gameOf(manager.find(conn)!.room) as GameSession);
    }
    const spies = games.map((g) => vi.spyOn(g, "close"));
    manager.close();
    for (const sp of spies) expect(sp).toHaveBeenCalledTimes(1);
  });
});
