import { describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import { createGame, legalActions } from "@mahjong/core";
import { createGameServer } from "./index";

describe("서버 셋업 스모크", () => {
  it("@mahjong/core가 alias로 import 되어 동작한다", () => {
    const game = createGame();
    expect(legalActions(game, 0).length).toBeGreaterThan(0);
  });

  it("임의 포트로 뜨고 클라이언트 접속/종료 후 close 된다", async () => {
    const server = await createGameServer({ port: 0 });
    expect(server.port).toBeGreaterThan(0);

    const client = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((res, rej) => {
      client.once("open", () => res());
      client.once("error", rej);
    });
    const closed = new Promise<void>((res) => client.once("close", () => res()));
    client.close();
    await closed;

    await server.close();
  });
});
