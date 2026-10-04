// @vitest-environment node
// 실제 서버 + Node ws 클라이언트 통합 스모크. 서버 소스는 테스트 파일에서만 상대 경로로 import 한다.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createGameServer, type GameServerHandle } from "../../../server/src/index";
import { createMemorySessionStore } from "./sessionStore";
import { createWsClient, type WebSocketLike, type WsClientEvent } from "./wsClient";

let server: GameServerHandle;

beforeAll(async () => {
  server = await createGameServer({ port: 0 });
});
afterAll(async () => {
  await server.close();
});

function waitFor<T>(events: WsClientEvent[], pick: (e: WsClientEvent) => T | undefined, from = 0, ms = 8000): Promise<T> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = (): void => {
      for (let i = from; i < events.length; i++) {
        const r = pick(events[i]!);
        if (r !== undefined) return resolve(r);
      }
      if (Date.now() - started > ms) return reject(new Error("timeout waiting for event"));
      setTimeout(tick, 10);
    };
    tick();
  });
}

describe("wsClient 통합 스모크", () => {
  it("join -> start -> view -> 합법 action -> ack/다음 view", async () => {
    const url = `ws://127.0.0.1:${server.port}`;
    const client = createWsClient({
      url,
      createSocket: (u) => new WebSocket(u) as unknown as WebSocketLike,
      store: createMemorySessionStore(),
    });
    const events: WsClientEvent[] = [];
    client.subscribe((e) => events.push(e));
    try {
      client.connect();
      await waitFor(events, (e) => (e.type === "status" && e.status === "connected" ? true : undefined));
      expect(client.join("tester")).toEqual({ ok: true });
      const seat = await waitFor(events, (e) => (e.type === "joined" ? e.seat : undefined));
      expect(seat).toBe(0);
      expect(client.start()).toEqual({ ok: true });
      const mine = await waitFor(events, (e) => (e.type === "view" && e.view.awaitingYou ? e : undefined));
      const { seat: _seat, ...clientAction } = mine.view.legalActions[0]! as { seat?: number } & Record<string, unknown>;
      const mark = events.length;
      const sent = client.action(clientAction as never);
      expect(sent).toEqual({ ok: true, seq: 1 });
      await waitFor(events, (e) => (e.type === "ack" || e.type === "view" ? true : undefined), mark);
      expect(events.slice(mark).some((e) => e.type === "error")).toBe(false);
    } finally {
      client.close();
    }
  });
});
