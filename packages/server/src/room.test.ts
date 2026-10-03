import { afterEach, describe, expect, it, vi } from "vitest";
import { timingSafeEqual } from "node:crypto";
import { WebSocket, type RawData } from "ws";
import {
  createGameServer,
  generateRoomId,
  generateSeatToken,
  MAX_CONSECUTIVE_VIOLATIONS,
  RoomError,
  RoomManager,
  SEAT_TOKEN_LENGTH,
  tokenEquals,
  type Connection,
  type GameServerHandle,
  type GameServerOptions,
  type ServerMessage,
} from "./index";

// timingSafeEqual 호출 여부를 spy로 확인하기 위해 node:crypto를 감싼다
// (한계: 상수 시간 성질 자체는 검증할 수 없고, 같은 길이 비교가 timingSafeEqual을 거치는지만 확인)
vi.mock("node:crypto", async (orig) => {
  const actual = await orig<typeof import("node:crypto")>();
  return { ...actual, timingSafeEqual: vi.fn(actual.timingSafeEqual) };
});

function fakeConn(): Connection & { sent: ServerMessage[]; closed: boolean; terminated: boolean } {
  const c = {
    sent: [] as ServerMessage[],
    closed: false,
    terminated: false,
    terminate() {
      c.terminated = true;
    },
    send(m: ServerMessage) {
      c.sent.push(m);
    },
    close() {
      c.closed = true;
    },
  };
  return c;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return e instanceof RoomError ? e.code : "other";
  }
  return undefined;
}

describe("RoomManager 참가/좌석", () => {
  it("새 방 생성 후 좌석 0,1,2,3 순서로 배정, 5번째는 room_full", () => {
    const m = new RoomManager();
    const first = m.join(fakeConn());
    expect(first.seat).toBe(0);
    expect(first.roomId).toMatch(/^[2-9A-HJKMNP-Z_]{8}$/);
    const seats = [1, 2, 3].map(() => m.join(fakeConn(), first.roomId).seat);
    expect(seats).toEqual([1, 2, 3]);
    expect(codeOf(() => m.join(fakeConn(), first.roomId))).toBe("room_full");
    m.close();
  });

  it("없는 방은 unknown_room, 중복 join은 bad_message", () => {
    const m = new RoomManager();
    expect(codeOf(() => m.join(fakeConn(), "NOROOM"))).toBe("unknown_room");
    const c = fakeConn();
    m.join(c);
    expect(codeOf(() => m.join(c))).toBe("bad_message");
    expect(m.roomCount).toBe(1);
    m.close();
  });

  it("최대 방 수 초과 시 오류", () => {
    const m = new RoomManager({ maxRooms: 2 });
    m.join(fakeConn());
    m.join(fakeConn());
    expect(codeOf(() => m.join(fakeConn()))).toBe("room_full");
    m.close();
  });

  it("난수 소스 주입으로 결정적 id/토큰", () => {
    const fixed = (n: number) => new Uint8Array(n).fill(7);
    expect(generateRoomId(fixed)).toBe(generateRoomId(fixed));
    expect(generateSeatToken(fixed)).toBe(Buffer.alloc(24, 7).toString("base64url"));
  });
});

describe("좌석 토큰", () => {
  it("방/좌석 간 토큰이 겹치지 않고 길이/형식이 맞다", () => {
    const m = new RoomManager();
    const tokens: string[] = [];
    for (let r = 0; r < 5; r++) {
      const j = m.join(fakeConn());
      tokens.push(j.seatToken);
      for (let i = 0; i < 3; i++) tokens.push(m.join(fakeConn(), j.roomId).seatToken);
    }
    expect(tokens).toHaveLength(20);
    expect(new Set(tokens).size).toBe(20);
    for (const t of tokens) {
      expect(t).toHaveLength(SEAT_TOKEN_LENGTH);
      expect(t).toMatch(/^[A-Za-z0-9_-]+$/);
    }
    m.close();
  });

  it("tokenEquals / verifyToken: 틀린 토큰과 길이 다른 토큰 거부", () => {
    const t = generateSeatToken();
    expect(tokenEquals(t, t)).toBe(true);
    expect(tokenEquals(t, t.slice(0, -1) + (t.endsWith("A") ? "B" : "A"))).toBe(false);
    expect(tokenEquals(t, t.slice(0, -1))).toBe(false);
    expect(vi.mocked(timingSafeEqual)).toHaveBeenCalled();
    vi.mocked(timingSafeEqual).mockClear();
    expect(tokenEquals(t, t.slice(0, -1))).toBe(false);
    expect(timingSafeEqual).not.toHaveBeenCalled(); // 길이가 다르면 비교 전에 거부
    expect(tokenEquals(t, "")).toBe(false);

    const m = new RoomManager();
    const r = m.join(fakeConn());
    const room = m.getRoom(r.roomId)!;
    expect(room.verifyToken(0, r.seatToken)).toBe(true);
    expect(room.verifyToken(0, "x".repeat(SEAT_TOKEN_LENGTH))).toBe(false);
    expect(room.verifyToken(1, r.seatToken)).toBe(false);
    m.close();
  });
});

describe("봇 채우기", () => {
  it("사람 1 + 봇 3", () => {
    const m = new RoomManager();
    const r = m.join(fakeConn());
    const room = m.getRoom(r.roomId)!;
    expect(room.fillBots()).toEqual([1, 2, 3]);
    expect(room.seats.map((s) => s.kind)).toEqual(["human", "bot", "bot", "bot"]);
    m.close();
  });

  it("사람 2 + 봇 2, 가득 찬 방은 변화 없음, 봇 좌석엔 참가 불가", () => {
    const m = new RoomManager();
    const r = m.join(fakeConn());
    m.join(fakeConn(), r.roomId);
    const room = m.getRoom(r.roomId)!;
    expect(room.fillBots()).toEqual([2, 3]);
    expect(room.seats.map((s) => s.kind)).toEqual(["human", "human", "bot", "bot"]);
    expect(room.fillBots()).toEqual([]);
    expect(codeOf(() => m.join(fakeConn(), r.roomId))).toBe("room_full");
    m.close();
  });
});

describe("연결 끊김과 방 정리", () => {
  afterEach(() => vi.useRealTimers());

  it("끊겨도 좌석은 human(connected:false)으로 유지", () => {
    const m = new RoomManager();
    const a = fakeConn();
    const r = m.join(a);
    m.join(fakeConn(), r.roomId);
    m.disconnect(a);
    const s = m.getRoom(r.roomId)!.seats[0]!;
    expect(s.kind).toBe("human");
    expect(s.kind === "human" && s.connected).toBe(false);
    m.close();
  });

  it("모두 끊긴 방은 TTL 후 삭제, 중간에 다시 참가하면 유지", () => {
    vi.useFakeTimers();
    const m = new RoomManager({ emptyRoomTtlMs: 1000 });
    const a = fakeConn();
    const id = m.join(a).roomId;
    m.disconnect(a);
    vi.advanceTimersByTime(999);
    expect(m.roomCount).toBe(1);
    // 대기 중 다시 참가(빈 좌석 없이 모두 human이면 room_full이므로 새 좌석 필요) -> 좌석이 남은 방
    m.join(fakeConn(), id);
    vi.advanceTimersByTime(5000);
    expect(m.roomCount).toBe(1);

    const b = fakeConn();
    const id2 = m.join(b).roomId;
    m.disconnect(b);
    vi.advanceTimersByTime(1000);
    expect(m.getRoom(id2)).toBeUndefined();
    m.close();
  });

  it("재참가하면 삭제 타이머가 취소된다", () => {
    vi.useFakeTimers();
    const m = new RoomManager({ emptyRoomTtlMs: 1000 });
    const a = fakeConn();
    const id = m.join(a).roomId;
    m.disconnect(a);
    expect(vi.getTimerCount()).toBe(1);
    m.join(fakeConn(), id);
    expect(vi.getTimerCount()).toBe(0);
    m.close();
  });

  it("close() 이후에는 타이머 재예약과 join이 거부된다", () => {
    vi.useFakeTimers();
    const m = new RoomManager({ emptyRoomTtlMs: 1000 });
    const a = fakeConn();
    m.join(a);
    m.close();
    m.disconnect(a);
    expect(vi.getTimerCount()).toBe(0);
    expect(codeOf(() => m.join(fakeConn()))).toBe("unknown_room");
  });

  it("JSON 직렬화에 토큰과 연결 객체가 없다", () => {
    const m = new RoomManager();
    const j = m.join(fakeConn());
    const text = JSON.stringify(m.getRoom(j.roomId)) + JSON.stringify(m.getRoom(j.roomId)!.seats);
    expect(text).not.toContain(j.seatToken);
    m.close();
  });

  it("id 생성이 계속 충돌하면 예외 (무한 루프 없음)", () => {
    const m = new RoomManager({ randomBytes: (n) => new Uint8Array(n) });
    m.join(fakeConn());
    expect(() => m.join(fakeConn())).toThrow();
    m.close();
  });

  it("close()는 대기 중 타이머를 모두 정리한다", () => {
    vi.useFakeTimers();
    const m = new RoomManager({ emptyRoomTtlMs: 1000 });
    const a = fakeConn();
    m.join(a);
    m.disconnect(a);
    expect(vi.getTimerCount()).toBe(1);
    m.close();
    expect(vi.getTimerCount()).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ws 통합
// ---------------------------------------------------------------------------

interface Client {
  ws: WebSocket;
  msgs: ServerMessage[];
  next(): Promise<ServerMessage>;
  closed: Promise<number>;
  /** 수신한 원문 전체 (next로 소비해도 남는다) */
  raw: string[];
}

const servers: GameServerHandle[] = [];
afterEach(async () => {
  while (servers.length) await servers.pop()!.close();
});

async function start(
  room?: { maxRooms?: number; emptyRoomTtlMs?: number },
  extra: Partial<GameServerOptions> = {},
): Promise<GameServerHandle> {
  const s = await createGameServer({ port: 0, room, ...extra });
  servers.push(s);
  return s;
}

async function connect(port: number, autoPong = true): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`, { autoPong });
  const msgs: ServerMessage[] = [];
  const raw: string[] = [];
  const waiters: ((m: ServerMessage) => void)[] = [];
  ws.on("message", (d: RawData) => {
    raw.push(d.toString());
    const m = JSON.parse(d.toString()) as ServerMessage;
    const w = waiters.shift();
    if (w) w(m);
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
    raw,
    closed,
    next: () => (msgs.length ? Promise.resolve(msgs.shift()!) : new Promise((res) => waiters.push(res))),
  };
}

describe("ws 통합", () => {
  it("join -> joined, 본인에게만 토큰 전달", async () => {
    const s = await start();
    const a = await connect(s.port);
    a.ws.send(JSON.stringify({ type: "join" }));
    const ja = await a.next();
    expect(ja).toMatchObject({ type: "joined", seat: 0 });
    if (ja.type !== "joined") throw new Error();
    expect(ja.seatToken).toHaveLength(SEAT_TOKEN_LENGTH);

    const b = await connect(s.port);
    b.ws.send(JSON.stringify({ type: "join", roomId: ja.roomId }));
    const jb = await b.next();
    expect(jb).toMatchObject({ type: "joined", seat: 1, roomId: ja.roomId });
    if (jb.type !== "joined") throw new Error();
    expect(jb.seatToken).not.toBe(ja.seatToken);

    // a에게는 b의 토큰이 전달되지 않는다
    b.ws.send(JSON.stringify({ type: "ping" }));
    await b.next();
    a.ws.send(JSON.stringify({ type: "ping" }));
    expect(await a.next()).toEqual({ type: "pong" });
    expect(JSON.stringify(a.msgs)).not.toContain(jb.seatToken);
    a.ws.close();
    b.ws.close();
  });

  it("ping/pong, rejoin/action은 not_supported", async () => {
    const s = await start();
    const a = await connect(s.port);
    a.ws.send(JSON.stringify({ type: "ping" }));
    expect(await a.next()).toEqual({ type: "pong" });
    a.ws.send(JSON.stringify({ type: "rejoin", roomId: "ABC", seatToken: "t" }));
    expect(await a.next()).toMatchObject({ type: "error", code: "not_supported" });
    a.ws.send(JSON.stringify({ type: "action", seq: 3, action: { type: "pass" } }));
    expect(await a.next()).toMatchObject({ type: "error", code: "not_supported", seq: 3 });
    a.ws.close();
  });

  it("바이너리 프레임과 깨진 JSON은 bad_message, 연결은 유지", async () => {
    const s = await start();
    const a = await connect(s.port);
    a.ws.send(Buffer.from(JSON.stringify({ type: "ping" })), { binary: true });
    expect(await a.next()).toMatchObject({ type: "error", code: "bad_message" });
    a.ws.send("{not json");
    expect(await a.next()).toMatchObject({ type: "error", code: "bad_message" });
    a.ws.send(JSON.stringify({ type: "ping" }));
    expect(await a.next()).toEqual({ type: "pong" });
    a.ws.close();
  });

  it("위반이 한도를 넘으면 종료, 유효 메시지는 1씩만 감쇠", async () => {
    const s = await start();
    const b = await connect(s.port);
    for (let i = 0; i <= MAX_CONSECUTIVE_VIOLATIONS; i++) b.ws.send("bad");
    await b.closed;

    // 위반 한도 이내에서 유효 메시지가 섞이면 유지
    const a = await connect(s.port);
    for (let i = 0; i < MAX_CONSECUTIVE_VIOLATIONS; i++) a.ws.send("bad");
    a.ws.send(JSON.stringify({ type: "ping" }));
    a.ws.send("bad");
    a.ws.send(JSON.stringify({ type: "ping" }));
    for (let i = 0; i < 8; i++) await a.next();
    expect(a.ws.readyState).toBe(WebSocket.OPEN);
    a.ws.close();
  });

  it("ping 1 + 위반 5 반복 우회는 종료된다", async () => {
    const s = await start();
    const a = await connect(s.port);
    for (let r = 0; r < 4; r++) {
      a.ws.send(JSON.stringify({ type: "ping" }));
      for (let i = 0; i < MAX_CONSECUTIVE_VIOLATIONS; i++) a.ws.send("bad");
    }
    await a.closed;
  });

  it("방 ID 열거(unknown_room 연타)는 종료된다", async () => {
    const s = await start();
    const a = await connect(s.port);
    for (let i = 0; i < 10; i++) a.ws.send(JSON.stringify({ type: "join", roomId: `ROOM${i}XYZ` }));
    await a.closed;
  });

  it("메시지 폭주는 토큰 버킷으로 종료된다", async () => {
    const s = await start(undefined, { session: { ratePerSecond: 1, rateBurst: 5 } });
    const a = await connect(s.port);
    for (let i = 0; i < 30; i++) a.ws.send(JSON.stringify({ type: "ping" }));
    await a.closed;
  });

  it("단편화된 텍스트 프레임은 조립되어 정상 처리된다", async () => {
    const s = await start();
    const a = await connect(s.port);
    a.ws.send(`{"type":`, { fin: false });
    a.ws.send(`"ping"}`, { fin: true });
    expect(await a.next()).toEqual({ type: "pong" });
    a.ws.close();
  });

  it("비UTF-8 텍스트 프레임은 연결이 종료된다", async () => {
    const s = await start();
    const a = await connect(s.port);
    a.ws.send(Buffer.from([0xff, 0xfe, 0xfd]), { binary: false });
    expect(await a.closed).toBe(1007);
  });

  it("4명 접속 시 다른 좌석 토큰은 어떤 메시지에도 없다", async () => {
    const s = await start();
    const clients: Client[] = [];
    const tokens: string[] = [];
    let roomId: string | undefined;
    for (let i = 0; i < 4; i++) {
      const c = await connect(s.port);
      c.ws.send(JSON.stringify({ type: "join", ...(roomId && { roomId }) }));
      const j = await c.next();
      if (j.type !== "joined") throw new Error();
      roomId = j.roomId;
      tokens.push(j.seatToken);
      clients.push(c);
    }
    for (const c of clients) {
      c.ws.send(JSON.stringify({ type: "ping" }));
      await c.next();
    }
    clients.forEach((c, i) => {
      const all = c.raw.join("|");
      tokens.forEach((t, k) => expect(all.includes(t)).toBe(k === i));
      c.ws.close();
    });
  });

  it("서버 keepalive: pong 없는 클라이언트는 종료, 응답하는 클라이언트는 유지", async () => {
    const s = await start(undefined, { keepaliveIntervalMs: 40 });
    const dead = await connect(s.port, false);
    const live = await connect(s.port, true);
    await dead.closed;
    expect(live.ws.readyState).toBe(WebSocket.OPEN);
    live.ws.close();
  });

  it("join 하지 않은 연결은 제한 시간 후 종료, join 한 연결은 유지", async () => {
    const s = await start(undefined, { session: { joinTimeoutMs: 60 } });
    const idle = await connect(s.port);
    const joined = await connect(s.port);
    joined.ws.send(JSON.stringify({ type: "join" }));
    await joined.next();
    await idle.closed;
    expect(joined.ws.readyState).toBe(WebSocket.OPEN);
    joined.ws.close();
  });

  it("서버 close() 후 방 삭제 타이머가 남지 않는다", async () => {
    const s = await start({ emptyRoomTtlMs: 12345 });
    const a = await connect(s.port);
    a.ws.send(JSON.stringify({ type: "join" }));
    await a.next();
    const spy = vi.spyOn(globalThis, "setTimeout");
    await s.close();
    servers.pop();
    await a.closed;
    await new Promise((r) => setTimeout(r, 20));
    expect(spy.mock.calls.filter((c) => c[1] === 12345)).toHaveLength(0);
    spy.mockRestore();
  });

  it("너무 큰 프레임은 연결이 종료된다 (maxPayload)", async () => {
    const s = await start();
    const a = await connect(s.port);
    a.ws.send("x".repeat(100_000));
    expect(await a.closed).toBe(1009);
  });

  it("최대 방 수 제한", async () => {
    const s = await start({ maxRooms: 1 });
    const a = await connect(s.port);
    a.ws.send(JSON.stringify({ type: "join" }));
    await a.next();
    const b = await connect(s.port);
    b.ws.send(JSON.stringify({ type: "join" }));
    expect(await b.next()).toMatchObject({ type: "error", code: "room_full" });
    a.ws.close();
    b.ws.close();
  });

  it("연결 종료 시 좌석이 connected:false로 유지, 서버 close는 hang 없음", async () => {
    const s = await start();
    const a = await connect(s.port);
    a.ws.send(JSON.stringify({ type: "join" }));
    const j = await a.next();
    if (j.type !== "joined") throw new Error();
    a.ws.close();
    await a.closed;
    await vi.waitFor(() => {
      const slot = s.rooms.getRoom(j.roomId)!.seats[0]!;
      expect(slot.kind === "human" && slot.connected).toBe(false);
    });
    const b = await connect(s.port);
    await s.close();
    servers.pop();
    await b.closed;
  });
});
