import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMemorySessionStore, type SessionStore } from "./sessionStore";
import { FakeTimers, MockSocket } from "./testkit";
import { computeDeadlineAt, createWsClient, getServerUrl, type WsClient, type WsClientEvent } from "./wsClient";

const URL_ = "ws://test:1";
const TOKEN = "SECRET-TOKEN-0123456789abcdef";
const joined = { type: "joined", roomId: "ROOM1234", seat: 1, seatToken: TOKEN };
const pass = { type: "pass" } as const;

let sockets: MockSocket[];
let timers: FakeTimers;
let store: SessionStore;
let events: WsClientEvent[];
let client: WsClient;

function make(extra: Partial<Parameters<typeof createWsClient>[0]> = {}): void {
  client = createWsClient({
    url: URL_,
    createSocket: () => {
      const s = new MockSocket();
      sockets.push(s);
      return s;
    },
    store,
    timers,
    ...extra,
  });
  client.subscribe((e) => events.push(e));
}
const last = (): MockSocket => sockets[sockets.length - 1]!;
const statuses = (): string[] => events.flatMap((e) => (e.type === "status" ? [e.status] : []));

/** 연결 후 join 완료까지 진행 */
function joinedClient(): MockSocket {
  client.connect();
  last().open();
  client.join("park");
  last().receive(joined);
  return last();
}

beforeEach(() => {
  sockets = [];
  timers = new FakeTimers();
  store = createMemorySessionStore();
  events = [];
  make();
});

describe("wsClient 기본 흐름", () => {
  it("connect -> open -> join -> joined", () => {
    expect(client.getStatus()).toBe("idle");
    client.connect();
    expect(client.getStatus()).toBe("connecting");
    last().open();
    expect(client.getStatus()).toBe("connected");
    expect(client.join("park")).toEqual({ ok: true });
    expect(last().sent[0]).toEqual({ type: "join", name: "park" });
    last().receive(joined);
    expect(events).toContainEqual({ type: "joined", roomId: "ROOM1234", seat: 1 });
    expect(store.load()).toEqual({ roomId: "ROOM1234", seatToken: TOKEN, seq: 0, serverUrl: URL_ });
  });

  it("join에 roomId를 싣고 start/ping 송신", () => {
    client.connect();
    last().open();
    client.join(undefined, "ABCD2345");
    client.start();
    client.ping();
    expect(last().sent).toEqual([{ type: "join", roomId: "ABCD2345" }, { type: "start" }, { type: "ping" }]);
  });

  it("view 수신 시 수신 시각 기준 절대 만료시각 계산", () => {
    joinedClient();
    timers.time = 5000;
    last().receive({ type: "view", view: { phase: "turn" }, deadlineMs: 27450 });
    last().receive({ type: "view", view: { phase: "turn" } });
    const views = events.filter((e) => e.type === "view");
    expect(views[0]).toMatchObject({ receivedAt: 5000, deadlineMs: 27450, deadlineAt: 32450 });
    expect(views[1]).not.toHaveProperty("deadlineAt");
    expect(computeDeadlineAt(10, 5)).toBe(15);
    expect(computeDeadlineAt(10, undefined)).toBeUndefined();
  });

  it("ack, notice, error 전달", () => {
    joinedClient();
    last().receive({ type: "ack", seq: 3 });
    last().receive({ type: "notice", code: "timeout" });
    last().receive({ type: "error", code: "illegal_action", message: "x", seq: 2 });
    expect(events).toContainEqual({ type: "ack", seq: 3 });
    expect(events).toContainEqual({ type: "notice", code: "timeout" });
    expect(events).toContainEqual({ type: "error", code: "illegal_action", message: "x", seq: 2 });
  });

  it("구독 해제 후에는 이벤트가 오지 않고 구독자 예외는 격리", () => {
    const got: WsClientEvent[] = [];
    const un = client.subscribe((e) => got.push(e));
    client.subscribe(() => {
      throw new Error("listener");
    });
    client.connect();
    un();
    last().open();
    expect(got.map((e) => e.type)).toEqual(["status"]);
    expect(client.getStatus()).toBe("connected");
  });

  it("getServerUrl 기본값", () => {
    expect(getServerUrl().startsWith("ws")).toBe(true);
  });
});

describe("action seq", () => {
  it("seq는 1부터 단조 증가, 에러 응답 후에도 계속 증가", () => {
    const s = joinedClient();
    expect(client.action(pass)).toEqual({ ok: true, seq: 1 });
    s.receive({ type: "error", code: "illegal_action", message: "x", seq: 1 });
    expect(client.action(pass)).toEqual({ ok: true, seq: 2 });
    s.receive({ type: "error", code: "bad_seq", message: "x", seq: 2 });
    expect(client.action(pass)).toEqual({ ok: true, seq: 3 });
    expect(s.sent.filter((m) => m.type === "action").map((m) => m.seq)).toEqual([1, 2, 3]);
    expect(store.load()!.seq).toBe(3);
  });

  it("initialSeq 옵션", () => {
    make({ initialSeq: 500 });
    joinedClient();
    expect(client.action(pass)).toEqual({ ok: true, seq: 500 });
  });

  it("전송 실패 시 seq를 소비하지 않는다", () => {
    const s = joinedClient();
    s.throwOnSend = true;
    expect(client.action(pass)).toEqual({ ok: false, reason: "send_failed" });
    s.throwOnSend = false;
    expect(client.action(pass)).toEqual({ ok: true, seq: 1 });
  });
});

describe("연결 전 송신 거부", () => {
  it("idle/connecting/closed에서는 거부하고 큐잉하지 않는다", () => {
    const no = { ok: false, reason: "not_connected" };
    expect(client.join()).toEqual(no);
    expect(client.action(pass)).toEqual(no);
    expect(client.start()).toEqual(no);
    expect(client.ping()).toEqual(no);
    expect(client.rejoin("R", "T")).toEqual(no);
    client.connect();
    expect(client.join()).toEqual(no);
    last().open();
    expect(last().sent).toEqual([]);
    client.close();
    expect(client.join()).toEqual(no);
  });
});

describe("재접속", () => {
  it("끊김 -> 백오프 1s,2s,4s,... 최대 10s -> rejoin -> joined 복귀", () => {
    const s = joinedClient();
    events.length = 0;
    s.drop();
    expect(client.getStatus()).toBe("reconnecting");
    expect(timers.pending()).toEqual([1000]);
    timers.advance(999);
    expect(sockets.length).toBe(1);
    timers.advance(1);
    expect(sockets.length).toBe(2);
    // 소켓이 열리기 전에 실패 -> 2s
    last().drop();
    expect(timers.pending()).toEqual([2000]);
    timers.advance(2000);
    last().drop();
    expect(timers.pending()).toEqual([4000]);
    timers.advance(4000);
    last().drop();
    expect(timers.pending()).toEqual([8000]);
    timers.advance(8000);
    last().drop();
    expect(timers.pending()).toEqual([10000]);
    timers.advance(10000);
    last().open();
    expect(last().sent).toEqual([{ type: "rejoin", roomId: "ROOM1234", seatToken: TOKEN }]);
    expect(client.getStatus()).toBe("reconnecting");
    expect(client.action(pass)).toEqual({ ok: false, reason: "not_connected" });
    last().receive(joined);
    expect(client.getStatus()).toBe("connected");
    expect(statuses()).toContain("connected");
    // 성공하면 백오프 초기화
    last().drop();
    expect(timers.pending()).toEqual([1000]);
  });

  it("재접속 후 seq는 마지막 값에서 이어진다", () => {
    const s = joinedClient();
    client.action(pass);
    client.action(pass);
    s.drop();
    timers.advance(1000);
    last().open();
    last().receive(joined);
    expect(client.action(pass)).toEqual({ ok: true, seq: 3 });
  });

  it("상한 횟수를 넘기면 retries_exhausted로 닫힌다", () => {
    make({ maxReconnectAttempts: 2 });
    joinedClient().drop();
    timers.advance(1000);
    last().drop();
    timers.advance(2000);
    last().drop();
    expect(client.getStatus()).toBe("closed");
    expect(client.getCloseReason()?.code).toBe("retries_exhausted");
    expect(sockets.length).toBe(3);
  });

  it("세션이 없으면 재시도하지 않는다", () => {
    client.connect();
    last().drop();
    expect(client.getStatus()).toBe("closed");
    expect(client.getCloseReason()?.code).toBe("connection_failed");
    expect(timers.pending()).toEqual([]);
  });

  it("close code 1008은 재시도하지 않는다", () => {
    joinedClient().drop(1008);
    expect(client.getStatus()).toBe("closed");
    expect(client.getCloseReason()).toMatchObject({ code: "displaced", closeCode: 1008 });
    expect(timers.pending()).toEqual([]);
    expect(store.load()).not.toBeNull();
  });

  for (const code of ["bad_token", "unknown_room", "room_full"] as const) {
    it(`rejoin 중 ${code} 오류는 재시도하지 않고 세션을 지운다`, () => {
      joinedClient().drop();
      timers.advance(1000);
      last().open();
      last().receive({ type: "error", code, message: "m" });
      expect(client.getStatus()).toBe("closed");
      expect(client.getCloseReason()?.code).toBe(code);
      expect(last().closed).toBe(true);
      expect(timers.pending()).toEqual([]);
      expect(store.load()).toBeNull();
      expect(sockets.length).toBe(2);
    });
  }

  it("일반 join 중 unknown_room은 연결을 유지한다", () => {
    client.connect();
    last().open();
    client.join(undefined, "NOPE2345");
    last().receive({ type: "error", code: "unknown_room", message: "m" });
    expect(client.getStatus()).toBe("connected");
  });

  it("사용자 close()는 재시도하지 않는다 (재접속 대기 중에도)", () => {
    const s = joinedClient();
    client.close();
    expect(client.getStatus()).toBe("closed");
    expect(client.getCloseReason()?.code).toBe("user");
    expect(s.closed).toBe(true);
    s.drop(1000);
    expect(timers.pending()).toEqual([]);

    make();
    joinedClient().drop();
    expect(timers.pending()).toEqual([1000]);
    client.close();
    expect(timers.pending()).toEqual([]);
    timers.advance(20000);
    expect(sockets.length).toBe(2);
  });

  it("resumeStored: 저장 세션으로 rejoin, seq는 저장값 위로 건너뜀", () => {
    store.save({ roomId: "ROOM1234", seatToken: TOKEN, seq: 7, serverUrl: URL_ });
    expect(client.resumeStored()).toBe(true);
    expect(client.getStatus()).toBe("connecting");
    last().open();
    expect(last().sent).toEqual([{ type: "rejoin", roomId: "ROOM1234", seatToken: TOKEN }]);
    last().receive(joined);
    expect(client.getStatus()).toBe("connected");
    const r = client.action(pass);
    expect(r.ok && r.seq).toBeGreaterThan(7);
  });

  it("resumeStored: 세션이 없거나 URL이 다르면 false", () => {
    expect(client.resumeStored()).toBe(false);
    store.save({ roomId: "R", seatToken: "T", seq: 1, serverUrl: "ws://other" });
    expect(client.resumeStored()).toBe(false);
    expect(sockets.length).toBe(0);
  });

  it("수동 rejoin 메시지 송신", () => {
    client.connect();
    last().open();
    expect(client.rejoin("ROOM1234", TOKEN)).toEqual({ ok: true });
    expect(last().sent[0]).toEqual({ type: "rejoin", roomId: "ROOM1234", seatToken: TOKEN });
  });
});

describe("수신 방어", () => {
  it("잘못된 JSON, 미지 type, 형식 오류는 무시하고 크래시하지 않는다", () => {
    const s = joinedClient();
    const before = events.length;
    for (const bad of [
      "{oops",
      "null",
      "[]",
      "123",
      '"str"',
      { type: "weird" },
      { type: "ack", seq: "x" },
      { type: "joined", roomId: "a" },
      { type: "view", view: 3 },
      { type: "view", view: {}, deadlineMs: -1 },
      { type: "error", code: "nope", message: "m" },
      { type: "notice", code: "other" },
    ]) {
      expect(() => s.receive(bad)).not.toThrow();
    }
    s.onmessage?.({ data: new ArrayBuffer(4) });
    expect(events.length).toBe(before);
    expect(client.getStatus()).toBe("connected");
  });

  it("pong은 이벤트 없이 처리", () => {
    const s = joinedClient();
    const before = events.length;
    s.receive({ type: "pong" });
    expect(events.length).toBe(before);
  });
});

describe("토큰 비출력", () => {
  it("전 과정에서 console에 토큰이 나오지 않는다", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const s = joinedClient();
    client.action(pass);
    s.receive({ type: "garbage-with-" + TOKEN });
    s.receive("{bad " + TOKEN);
    s.drop();
    timers.advance(1000);
    last().open();
    last().receive({ type: "error", code: "bad_token", message: "m" });
    for (const sp of spies) {
      expect(JSON.stringify(sp.mock.calls)).not.toContain(TOKEN);
      sp.mockRestore();
    }
    // 이벤트에도 토큰이 실리지 않는다
    expect(JSON.stringify(events)).not.toContain(TOKEN);
  });
});
