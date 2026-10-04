import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { createGameServer, createSession, RoomManager, timeoutScheduler, type GameServerHandle } from "./index";
import { Player, activeTimeouts, baseSeed, fakeConn, intIn, leakProblems, logSeed, pickOf, scale, seeded, sleep, until, type FakeConn } from "./test-utils";

// S-9 부하/자원 누수: 방·연결 대량 개폐 후 타이머와 연결 매핑이 0으로 돌아오는지

let server: GameServerHandle | undefined;
let extra: WebSocket[] = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const w of extra) w.terminate();
  extra = [];
  await server?.close();
  server = undefined;
});

describe("부하: 가짜 연결 + 가짜 타이머", () => {
  it("수십~수백 방 / 수백 연결 개폐 후 연결 매핑·방·타이머가 모두 0으로 돌아온다", () => {
    const seed = baseSeed(4001);
    logSeed("load-fake", seed);
    const rng = seeded(seed);
    vi.useFakeTimers();
    const maxRooms = scale(30, 150);
    const manager = new RoomManager({ maxRooms, emptyRoomTtlMs: 5000, game: { rng: seeded(seed) } });
    interface H {
      conn: FakeConn;
      session: ReturnType<typeof createSession>;
      closed: boolean;
      joined: boolean;
    }
    const all: H[] = [];
    const open = (): H => {
      const conn = fakeConn();
      const h: H = { conn, session: createSession(manager, conn, { ratePerSecond: 1e9, rateBurst: 1e9 }), closed: false, joined: false };
      all.push(h);
      return h;
    };
    const close = (h: H): void => {
      if (h.closed) return;
      h.closed = true;
      h.session.onClose();
    };
    const send = (h: H, m: unknown): void => h.session.onMessage(JSON.stringify(m));
    const reap = (): void => {
      for (const h of all) if (h.conn.terminated) close(h);
    };

    let roomFull = 0;
    const waves = scale(4, 10);
    for (let w = 0; w < waves; w++) {
      const wanted = scale(20, 60);
      for (let r = 0; r < wanted; r++) {
        const first = open();
        send(first, { type: "join" });
        const m = first.conn.sent[0]!;
        if (m.type !== "joined") {
          expect(m.type === "error" && m.code).toBe("room_full");
          roomFull++;
          continue;
        }
        first.joined = true;
        const group = [first];
        for (let i = intIn(rng, 0, 3); i > 0; i--) {
          const h = open();
          send(h, { type: "join", roomId: m.roomId });
          h.joined = h.conn.sent[0]?.type === "joined";
          group.push(h);
        }
        if (rng() < 0.6) send(first, { type: "start" });
        // 일부는 join 없이 유휴
        if (rng() < 0.3) open();
      }
      // 게임이 어느 정도 진행되도록 시간 경과, 그 사이 연결을 무작위로 끊는다
      for (let k = 0; k < 5; k++) {
        vi.advanceTimersByTime(pickOf(rng, [300, 1500, 6000]));
        reap();
        for (const h of all) if (!h.closed && rng() < 0.15) close(h);
        // 상한: 방마다 (게임 타이머 | 삭제 TTL) 1개 + join 안 한 연결마다 1개
        const unjoined = all.filter((h) => !h.closed && !h.joined).length;
        expect(vi.getTimerCount()).toBeLessThanOrEqual(manager.roomCount + unjoined + 1);
        expect(manager.roomCount).toBeLessThanOrEqual(maxRooms);
      }
    }
    expect(roomFull).toBeGreaterThan(0); // 방 상한 보호가 실제로 작동했다

    // 전체 종료
    for (const h of all) close(h);
    expect(manager.connectionCount).toBe(0);
    vi.advanceTimersByTime(60_000);
    expect(manager.roomCount).toBe(0);
    expect(vi.getTimerCount()).toBe(0);
    manager.close();

    // 모든 연결이 받은 메시지에서 누출 없음
    const tokens = all.flatMap((h) => h.conn.sent.flatMap((m) => (m.type === "joined" ? [m.seatToken] : [])));
    for (const h of all) {
      const own = h.conn.sent.find((m) => m.type === "joined");
      const owner = own && own.type === "joined" ? { seat: own.seat, token: own.seatToken } : {};
      expect(leakProblems(h.conn.sent, owner, tokens)).toEqual([]);
    }
  }, 120000);
});

describe("부하: 실제 ws", () => {
  it("연결 폭주 + 유휴 연결(join 제한) + 클라이언트 비정상 종료 후 연결·타이머가 정리된다", async () => {
    const baseline = activeTimeouts();
    const n = scale(120, 800);
    server = await createGameServer({
      port: 0,
      session: { joinTimeoutMs: 300, rateBurst: 1e9, ratePerSecond: 1e9 },
      room: { game: { rng: seeded(5), scheduler: timeoutScheduler, botDelayMs: 1, responseWindowMs: 1, nextRoundDelayMs: 1, turnTimeoutMs: 200, responseTimeoutMs: 200, disconnectedTimeoutMs: 20 } },
    });
    const port = server.port;
    const sockets: WebSocket[] = [];
    const idle: Promise<void>[] = [];
    for (let i = 0; i < n; i++) {
      const ws = new WebSocket(`ws://127.0.0.1:${port}`);
      ws.on("error", () => {});
      sockets.push(ws);
      extra.push(ws);
      if (i % 3 === 0) idle.push(new Promise<void>((r) => ws.once("close", () => r()))); // 유휴: 서버가 끊어야 한다
      else
        ws.once("open", () => {
          ws.send(JSON.stringify({ type: "join", ...(i % 7 === 0 && { roomId: "ZZZZZZZZ" }) }));
          if (i % 5 === 0) ws.send(JSON.stringify({ type: "start" }));
        });
    }
    // 유휴 연결은 join 제한 시간(300ms) 안에 서버가 종료
    await Promise.race([Promise.all(idle), sleep(10000).then(() => Promise.reject(new Error("유휴 연결이 정리되지 않음")))]);
    await until(() => sockets.every((w) => w.readyState === WebSocket.OPEN || w.readyState === WebSocket.CLOSED), 5000, "연결 상태");
    await sleep(400); // 일부 게임 진행
    // 절반은 정상 종료, 절반은 소켓을 그냥 파괴
    sockets.forEach((w, i) => (i % 2 ? w.close() : w.terminate()));
    await until(() => server!.rooms.connectionCount === 0, 10000, "연결 매핑 0");
    // 방은 TTL 뒤 삭제되므로 남아 있을 수 있다. 서버 종료로 모두 정리
    await server.close();
    server = undefined;
    await until(() => activeTimeouts() <= baseline, 5000, `타이머 잔존 (기준 ${baseline}, 현재 ${activeTimeouts()})`);
  }, 60000);

  it("느린 소비자(소켓 읽기 중지)가 있어도 다른 좌석은 완주하고, 서버 종료도 깔끔하다", async () => {
    const baseline = activeTimeouts();
    server = await createGameServer({
      port: 0,
      session: { rateBurst: 1e9, ratePerSecond: 1e9 },
      room: { game: { rng: seeded(6), scheduler: timeoutScheduler, botDelayMs: 0, responseWindowMs: 0, nextRoundDelayMs: 0, turnTimeoutMs: 30, responseTimeoutMs: 30, disconnectedTimeoutMs: 30, autoDelayMs: 0, maxConsecutiveTimeouts: 1 } },
    });
    const port = server.port;
    const a = await Player.join(port, { rng: seeded(1) });
    const slow = await Player.join(port, { rng: seeded(2) }, a.roomId);
    const c = await Player.join(port, { rng: seeded(3) }, a.roomId);
    const d = await Player.join(port, { rng: seeded(4) }, a.roomId);
    (slow.ws as unknown as { _socket: { pause(): void } })._socket.pause(); // 서버가 보낸 것을 읽지 않는다
    a.send({ type: "start" });
    await until(() => [a, c, d].every((p) => p.gameEnd), 60000, "나머지 좌석 완주");
    for (const p of [a, c, d]) expect(leakProblems(p.msgs, { seat: p.seat, token: p.token }, [a, slow, c, d].map((x) => x.token))).toEqual([]);
    const t0 = Date.now();
    await server.close();
    server = undefined;
    expect(Date.now() - t0).toBeLessThan(3000);
    await until(() => activeTimeouts() <= baseline, 5000, "타이머 복귀");
  }, 90000);

  it("진행 중인 방이 많은 상태에서 서버를 닫아도 예외 없이 종료되고 타이머가 남지 않는다", async () => {
    const baseline = activeTimeouts();
    const rooms = scale(10, 60);
    server = await createGameServer({
      port: 0,
      session: { rateBurst: 1e9, ratePerSecond: 1e9 },
      room: { game: { rng: seeded(7), scheduler: timeoutScheduler, botDelayMs: 3, responseWindowMs: 3, nextRoundDelayMs: 3, turnTimeoutMs: 100, responseTimeoutMs: 100 } },
    });
    const ps: Player[] = [];
    for (let r = 0; r < rooms; r++) {
      const first = await Player.join(server.port, { rng: seeded(r) });
      ps.push(first);
      if (r % 2) ps.push(await Player.join(server.port, { rng: seeded(r + 1000) }, first.roomId));
      first.send({ type: "start" });
    }
    await until(() => ps.every((p) => p.views.length > 3), 20000, "모든 방 진행");
    await server.close();
    server = undefined;
    await until(() => ps.every((p) => p.closedFlag), 10000, "클라이언트 종료");
    const counts = ps.map((p) => p.views.length);
    await sleep(150);
    expect(ps.map((p) => p.views.length)).toEqual(counts); // 종료 후 진행 없음
    await until(() => activeTimeouts() <= baseline, 5000, "타이머 복귀");
  }, 60000);
});
