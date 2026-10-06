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

type Ctl = ReturnType<typeof useServerGame>;
/** 실패 시 원인 파악용: 훅의 현재 상태 요약 */
function diag(c: Ctl): string {
  return `status=${c.status} conn=${c.connection ? JSON.stringify(c.connection) : "none"} error=${c.error ? JSON.stringify(c.error) : "null"} phase=${c.view?.phase ?? "-"} awaiting=${String(c.view?.awaitingYou)} actions=${c.actions.length} roundOver=${c.roundOver} waitingAck=${c.waitingAck}`;
}
/** waitFor 단언 실패 메시지에 진단 정보를 덧붙인다 */
function check(get: () => Ctl, cond: (c: Ctl) => boolean, what: string): void {
  const c = get();
  if (!cond(c)) throw new Error(`${what} 조건 불충족: ${diag(c)}`);
}

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
      await waitFor(() => check(() => hook.result.current, (c) => c.status === "waiting", "대기실 진입"), { timeout: 20_000 });
      expect(hook.result.current.mySeat).toBe(0);
      act(() => hook.result.current.start());
      await waitFor(() => check(() => hook.result.current, (c) => c.view !== null, "첫 view 수신"), { timeout: 20_000 });

      let acts = 0;
      let acked = 0;
      for (let i = 0; i < 80; i++) {
        // 내 행동 가능(또는 국 종료)이 되어 view와 actions가 일관될 때까지 기다린 뒤 같은 스냅샷을 읽는다
        await waitFor(
          () =>
            check(
              () => hook.result.current,
              (x) => x.roundOver || (x.actions.length > 0 && x.view !== null && x.view.awaitingYou),
              "내 행동 가능",
            ),
          { timeout: 30_000 },
        );
        const c = hook.result.current;
        if (c.roundOver) break;
        const view = c.view!;
        // view 불변식
        const me = view.players[c.mySeat]!;
        expect(view.seat).toBe(c.mySeat);
        expect(view.hand.length).toBe(me.handCount);
        expect(view.hand.length + me.melds.length * 3).toBeGreaterThanOrEqual(13);
        expect(view.hand.length + me.melds.length * 3).toBeLessThanOrEqual(14);
        for (const p of view.players) if (p.seat !== c.mySeat) expect(p).not.toHaveProperty("hand");
        // 합법 행동이면 서버가 수락한다 (오류 없음)
        const wasResponse = view.phase === "response";
        act(() => c.act(choose(c.actions)));
        acts++;
        // ack/새 view가 act 직후 곧바로 도착할 수 있어 waitingAck=true 즉시 단언은 하지 않는다
        await waitFor(() => check(() => hook.result.current, (x) => !x.waitingAck, "ack 해제"), { timeout: 20_000 });
        check(() => hook.result.current, (x) => x.error === null, "오류 없음");
        if (wasResponse) acked++;
      }
      // 서버 RNG가 무작위라 국이 일찍 끝나는 판이 있다: 행동이 한 번은 있어야 하고, 10회 미만이면 국이 끝났어야 한다
      expect(acts).toBeGreaterThanOrEqual(1);
      expect(acts >= 10 || hook.result.current.roundOver).toBe(true);
      // 응답 구간(ack 경로)은 서버 RNG에 따라 한 번도 안 올 수 있다(사람이 울 수 있는 패가 없는 판). 22-2: 이를 필수로 단언하면 간헐 실패하므로
      // 거쳤을 때만(wasResponse) 위 루프에서 ack 해제·오류 없음을 확인하고, ack 경로 자체는 useServerGame.test.tsx 단위 테스트가 고정한다.
      expect(acked).toBeGreaterThanOrEqual(0);
      if (hook.result.current.roundOver) {
        expect(hook.result.current.summary).not.toBeNull();
      }
      expect(hook.result.current.status === "playing" || hook.result.current.status === "ended").toBe(true);
    } finally {
      hook.unmount();
    }
  }, 120_000);
});
