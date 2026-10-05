// 실서버(createGameServer port 0) + Node ws 로 훅을 끝까지 구동한다. 서버 소스는 테스트에서만 상대 경로로 import 한다.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { act, renderHook, waitFor } from "@testing-library/react";
import { WebSocket } from "ws";
import { createGameServer, type GameServerHandle } from "../../../server/src/index";
import type { Action } from "@mahjong/core";
import { createMemorySessionStore } from "./sessionStore";
import { useServerGame } from "./useServerGame";
import type { WebSocketLike } from "./wsClient";

let server: GameServerHandle;

beforeAll(async () => {
  // 사람 1명 + 봇 3명. 지연을 줄여 빠르게 진행하고 마감은 끈다
  server = await createGameServer({
    port: 0,
    room: {
      game: { botDelayMs: 1, responseWindowMs: 15, nextRoundDelayMs: 60_000, turnTimeoutMs: Infinity, responseTimeoutMs: Infinity },
    },
  });
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = false;
});
afterAll(async () => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  await server.close();
});

function choose(actions: readonly Action[]): Action {
  return (
    actions.find((a) => a.type === "tsumo" || a.type === "ron") ??
    actions.find((a) => a.type === "discard" && a.riichi !== true) ??
    actions.find((a) => a.type === "pass") ??
    actions[0]!
  );
}

describe("useServerGame 실서버 통합", () => {
  it("사람 1 + 봇 3: 입장 -> 시작 -> 한 판(또는 수십 수)을 불변식을 확인하며 진행한다", async () => {
    const hook = renderHook(() =>
      useServerGame({
        url: `ws://127.0.0.1:${server.port}`,
        createSocket: (u) => new WebSocket(u) as unknown as WebSocketLike,
        store: createMemorySessionStore(),
        resumeStored: false,
      }),
    );
    try {
      act(() => hook.result.current.create("tester"));
      await waitFor(() => expect(hook.result.current.status).toBe("waiting"), { timeout: 8000 });
      expect(hook.result.current.mySeat).toBe(0);
      act(() => hook.result.current.start());
      await waitFor(() => expect(hook.result.current.view).not.toBeNull(), { timeout: 8000 });

      let acts = 0;
      let acked = 0;
      for (let i = 0; i < 80; i++) {
        await waitFor(() => expect(hook.result.current.actions.length > 0 || hook.result.current.roundOver).toBe(true), {
          timeout: 15_000,
        });
        const c = hook.result.current;
        if (c.roundOver) break;
        const view = c.view!;
        // view 불변식
        const me = view.players[c.mySeat]!;
        expect(view.seat).toBe(c.mySeat);
        expect(view.hand.length).toBe(me.handCount);
        expect(view.hand.length + me.melds.length * 3).toBeGreaterThanOrEqual(13);
        expect(view.hand.length + me.melds.length * 3).toBeLessThanOrEqual(14);
        expect(view.awaitingYou).toBe(true);
        expect(c.actions.length).toBeGreaterThan(0);
        for (const p of view.players) if (p.seat !== c.mySeat) expect(p).not.toHaveProperty("hand");
        // 합법 행동이면 서버가 수락한다 (오류 없음)
        const wasResponse = view.phase === "response";
        act(() => c.act(choose(c.actions)));
        acts++;
        expect(hook.result.current.waitingAck).toBe(true);
        await waitFor(() => expect(hook.result.current.waitingAck).toBe(false), { timeout: 8000 });
        expect(hook.result.current.error).toBeNull();
        if (wasResponse) acked++;
      }
      expect(acts).toBeGreaterThanOrEqual(10);
      expect(acked).toBeGreaterThanOrEqual(1); // 응답 구간(ack 경로)을 최소 한 번 거친다
      if (hook.result.current.roundOver) {
        expect(hook.result.current.summary).not.toBeNull();
      }
      expect(hook.result.current.status === "playing" || hook.result.current.status === "ended").toBe(true);
    } finally {
      hook.unmount();
    }
  }, 120_000);
});
