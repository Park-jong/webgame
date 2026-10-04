import { WebSocket, WebSocketServer } from "ws";
import { MAX_MESSAGE_LENGTH, type ServerMessage } from "./protocol";
import { RoomManager, type Connection, type RoomManagerOptions } from "./room";
import { createSession, type SessionOptions } from "./session";

export * from "./protocol";
export * from "./view";
export * from "./room";
export * from "./session";
export * from "./game-session";
export * from "./rng";

/** UTF-16 1단위는 UTF-8로 최대 3바이트 (여유 포함 4배) */
export const MAX_PAYLOAD_BYTES = MAX_MESSAGE_LENGTH * 4;

/** 서버 주도 keepalive: ping 간격 (pong이 한 주기 안에 없으면 종료) */
export const KEEPALIVE_INTERVAL_MS = 30_000;
/** terminate 전 정상 close 핸드셰이크를 기다리는 시간 */
const TERMINATE_GRACE_MS = 500;

export interface GameServerOptions {
  /** 0이면 임의 포트 */
  port: number;
  /** 방 관리 옵션 (테스트용 주입 포함) */
  room?: RoomManagerOptions;
  /** 연결별 세션 옵션 (위반 한도, 속도 제한, 참가 제한 시간) */
  session?: SessionOptions;
  keepaliveIntervalMs?: number;
}

export interface GameServerHandle {
  /** 실제로 바인딩된 포트 */
  port: number;
  rooms: RoomManager;
  close(): Promise<void>;
}

// 방 참가, 게임 루프, 재접속까지 처리
export function createGameServer(options: GameServerOptions): Promise<GameServerHandle> {
  return new Promise((resolve, reject) => {
    const wss = new WebSocketServer({ port: options.port, maxPayload: MAX_PAYLOAD_BYTES });
    const rooms = new RoomManager(options.room);
    const alive = new WeakSet<WebSocket>();
    let keepalive: ReturnType<typeof setInterval> | undefined;
    let closing: Promise<void> | undefined;
    wss.on("connection", (ws) => {
      alive.add(ws);
      ws.on("pong", () => alive.add(ws));
      const conn: Connection = {
        send: (msg: ServerMessage) => {
          if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
        },
        close: () => ws.close(),
        terminate: () => {
          // close 프레임을 먼저 보내 오류 응답이 전달되게 하고, 끝나지 않으면 강제 종료
          ws.close(1008);
          setTimeout(() => ws.terminate(), TERMINATE_GRACE_MS).unref();
        },
      };
      const session = createSession(rooms, conn, options.session);
      // ws의 message는 Buffer: 텍스트 프레임만 문자열로 변환, 바이너리는 거부
      ws.on("message", (data, isBinary) => {
        try {
          session.onMessage(isBinary ? null : data.toString());
        } catch {
          // 예상 밖 예외: 내부 정보는 노출하지 않고 이 연결만 종료한다 (서버 프로세스와 다른 연결은 계속 동작)
          conn.send({ type: "error", code: "server_error", message: "서버 내부 오류가 발생했습니다" });
          conn.terminate();
        }
      });
      ws.on("close", () => {
        try {
          session.onClose();
        } catch {
          // 정리 중 예외가 프로세스를 죽이지 않게 한다
        }
      });
      // 프로토콜 오류(maxPayload 초과 등)는 ws가 알맞은 코드로 직접 종료한다. 리스너만 둬서 미처리 예외를 막는다
      ws.on("error", () => {});
    });
    wss.once("error", reject);
    wss.once("listening", () => {
      const address = wss.address();
      keepalive = setInterval(() => {
        for (const c of wss.clients) {
          if (!alive.has(c)) {
            c.terminate();
            continue;
          }
          alive.delete(c);
          try {
            c.ping();
          } catch {
            c.terminate();
          }
        }
      }, options.keepaliveIntervalMs ?? KEEPALIVE_INTERVAL_MS);
      keepalive.unref();
      const port = typeof address === "object" && address ? address.port : options.port;
      resolve({
        port,
        rooms,
        // 멱등: 두 번째 호출부터는 같은 종료 Promise를 돌려준다
        close: () =>
          (closing ??= new Promise<void>((res, rej) => {
            if (keepalive) clearInterval(keepalive);
            rooms.close();
            for (const client of wss.clients) client.terminate();
            wss.close((err) => (err ? rej(err) : res()));
          })),
      });
    });
  });
}
