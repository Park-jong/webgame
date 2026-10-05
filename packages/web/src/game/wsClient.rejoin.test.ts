// wsClient 보강 테스트: 늦은 close 가드, 수동 rejoin 중 action 거부, rejoin 오류/타임아웃 정리
import { beforeEach, describe, expect, it } from "vitest";
import { createMemorySessionStore, type SessionStore } from "./sessionStore";
import { FakeTimers, MockSocket } from "./testkit";
import { createWsClient, type WsClient, type WsClientEvent } from "./wsClient";

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

describe("이전 소켓의 늦은 close", () => {
  it("새 소켓이 만들어진 뒤 이전 소켓의 close가 다시 와도 상태/타이머가 바뀌지 않는다", () => {
    const old = joinedClient();
    old.drop();
    timers.advance(1000);
    expect(sockets.length).toBe(2);
    last().open();
    expect(client.getStatus()).toBe("reconnecting");
    const before = statuses().length;
    const pendingBefore = timers.pending();
    // 이전 소켓의 중복/지연 close
    old.drop();
    expect(statuses().length).toBe(before);
    expect(client.getStatus()).toBe("reconnecting");
    expect(timers.pending()).toEqual(pendingBefore);
    // 현재 소켓은 그대로 rejoin을 마칠 수 있다
    last().receive(joined);
    expect(client.getStatus()).toBe("connected");
    expect(sockets.length).toBe(2);
  });
});

describe("수동 rejoin()", () => {
  it("응답 전에는 action()을 거부하고 joined 뒤에 허용한다", () => {
    client.connect();
    last().open();
    expect(client.rejoin("ROOM1234", TOKEN)).toEqual({ ok: true });
    expect(client.action(pass)).toEqual({ ok: false, reason: "not_connected" });
    expect(last().sent.some((m) => m.type === "action")).toBe(false);
    last().receive(joined);
    expect(client.action(pass)).toEqual({ ok: true, seq: 1 });
  });

  it("알 수 없는 오류 코드로 실패해도 대기가 풀리고 이전 세션/연결이 유지된다", () => {
    joinedClient();
    expect(client.rejoin("OTHER", "other-token")).toEqual({ ok: true });
    expect(client.action(pass).ok).toBe(false);
    last().receive({ type: "error", code: "server_error", message: "x" });
    expect(client.getStatus()).toBe("connected");
    expect(client.action(pass).ok).toBe(true);
    // 이전 세션으로 복원됐으므로 이후 끊김은 원래 방으로 재접속한다
    last().drop();
    timers.advance(1000);
    last().open();
    expect(last().sent[0]).toEqual({ type: "rejoin", roomId: "ROOM1234", seatToken: TOKEN });
  });

  it("응답이 없으면 타임아웃 후 이전 세션으로 재접속 경로에 들어간다", () => {
    joinedClient();
    client.rejoin("OTHER", "other-token");
    timers.advance(10_000);
    expect(client.getStatus()).toBe("reconnecting");
    timers.advance(1000);
    last().open();
    expect(last().sent[0]).toEqual({ type: "rejoin", roomId: "ROOM1234", seatToken: TOKEN });
  });
});

describe("자동 rejoin 중 오류/타임아웃", () => {
  function reconnectOpened(): void {
    joinedClient().drop();
    timers.advance(1000);
    last().open();
    expect(last().sent[0]?.type).toBe("rejoin");
  }

  it("알 수 없는 오류 코드면 소켓을 버리고 백오프 재접속으로 간다 (대기 상태가 남지 않음)", () => {
    reconnectOpened();
    const failed = last();
    failed.receive({ type: "error", code: "server_error", message: "x" });
    expect(failed.closed).toBe(true);
    expect(client.getStatus()).toBe("reconnecting");
    expect(timers.pending()).toEqual([2000]);
    timers.advance(2000);
    last().open();
    last().receive(joined);
    expect(client.getStatus()).toBe("connected");
    expect(client.action(pass).ok).toBe(true);
  });

  it("rejoin 응답이 10초 안에 없으면 reconnecting으로 전이하고 다시 시도한다", () => {
    reconnectOpened();
    const stuck = last();
    timers.advance(9999);
    expect(stuck.closed).toBe(false);
    timers.advance(1);
    expect(stuck.closed).toBe(true);
    expect(client.getStatus()).toBe("reconnecting");
    expect(timers.pending()).toEqual([2000]);
  });

  it("연결 자체가 열리지 않아도 rejoin 타임아웃이 적용된다", () => {
    joinedClient().drop();
    timers.advance(1000);
    expect(sockets.length).toBe(2);
    timers.advance(10_000);
    expect(sockets[1]!.closed).toBe(true);
    expect(client.getStatus()).toBe("reconnecting");
  });

  it("joined를 받으면 타임아웃이 해제된다", () => {
    reconnectOpened();
    last().receive(joined);
    const n = sockets.length;
    timers.advance(60_000);
    expect(sockets.length).toBe(n);
    expect(client.getStatus()).toBe("connected");
  });

  it("재시도 상한에서 타임아웃이 나면 rejoin_timeout 사유로 닫힌다", () => {
    make({ maxReconnectAttempts: 1, rejoinTimeoutMs: 500 });
    joinedClient().drop();
    timers.advance(1000);
    last().open();
    timers.advance(500);
    expect(client.getStatus()).toBe("closed");
    expect(client.getCloseReason()?.code).toBe("rejoin_timeout");
  });

  it("사용자 close()는 타임아웃 타이머를 정리한다", () => {
    reconnectOpened();
    client.close();
    expect(timers.pending()).toEqual([]);
    expect(client.getCloseReason()?.code).toBe("user");
  });
});
