import { WebSocketServer } from "ws";

export interface GameServerOptions {
  /** 0이면 임의 포트 */
  port: number;
}

export interface GameServerHandle {
  /** 실제로 바인딩된 포트 */
  port: number;
  close(): Promise<void>;
}

// 연결만 수락하는 뼈대 (프로토콜/방/게임 루프는 이후 단계)
export function createGameServer(options: GameServerOptions): Promise<GameServerHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: options.port });
    wss.once("error", reject);
    wss.once("listening", () => {
      const address = wss.address();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        port,
        close: () =>
          new Promise<void>((res, rej) => {
            for (const client of wss.clients) client.terminate();
            wss.close((err) => (err ? rej(err) : res()));
          }),
      });
    });
  });
}
