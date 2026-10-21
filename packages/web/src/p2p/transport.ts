// P2P 멀티플레이 전송 계층: 호스트 브라우저가 서버 역할(RoomManager)을 하고, 참가자는 WebRTC DataChannel로 접속한다.
// - 외부 서버(PeerJS 시그널링)는 연결을 맺을 때만 거치고, 게임 데이터는 브라우저끼리 직접 오간다.
// - 호스트가 패산과 모든 손패를 알고 판정한다 (호스트 중심). 호스트가 나가면 방이 사라진다.
// - 웹 클라이언트(wsClient)는 소켓 생성 함수를 주입받으므로, 이 모듈의 createSocket을 넘기면 서버 모드 UI가 그대로 동작한다.
import Peer from "peerjs";
import type { PeerOptions } from "peerjs";
import type { ServerMessage } from "@mahjong/server-protocol";
import { RoomManager, generateRoomId } from "@mahjong/server-room";
import type { Connection } from "@mahjong/server-room";
import { createSession } from "@mahjong/server-session";
import type { Session } from "@mahjong/server-session";
import { CLOSE_CODE_HOST_LEFT } from "../game/wsClient";
import type { WebSocketLike } from "../game/wsClient";

/** 호스트가 되는 소켓 주소 / 참가 소켓 주소 접두사 */
export const P2P_PREFIX = "p2p://";
export const P2P_HOST_URL = `${P2P_PREFIX}host`;
/** 입장 전(아직 아무 방에도 접속하지 않은) 기본 주소 */
export const P2P_IDLE_URL = `${P2P_PREFIX}idle`;
/** PeerJS 공용 id 공간에서 겹치지 않게 방 코드 앞에 붙이는 접두사 */
export const PEER_ID_PREFIX = "mjk-";
/** 참가자가 입장 응답을 기다리는 상한(ms). 시그널링과 TURN 중계를 거치면 협상이 오래 걸린다 */
export const P2P_JOIN_TIMEOUT_MS = 300_000;
/** 호스트 id가 이미 쓰이고 있을 때 새 방 코드로 다시 시도하는 횟수 */
const MAX_ID_RETRIES = 5;
/** 아직 방에 앉지 않은 연결을 포함한 원격 동시 연결 상한 (호스트 본인 제외) */
const MAX_PEER_CONNECTIONS = 16;
/** PeerJS 1.5.x가 허용하는 id 형식(validateId). 위반하면 'invalid-id' 오류가 난다 */
const PEERJS_ID = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;
/** 방 코드 생성 재시도 상한 (실패 확률이 약 7%이므로 사실상 도달하지 않는다) */
const MAX_ROOM_ID_DRAWS = 100;
/** 방 코드로 허용하는 문자 */
const ROOM_CODE = /^[A-Z0-9_]+$/;

/** PeerJS 객체 중 이 모듈이 쓰는 부분만 (테스트에서 가짜를 주입한다) */
export interface DataConnectionLike {
  readonly open: boolean;
  on(event: "open" | "close", cb: () => void): void;
  on(event: "data", cb: (data: unknown) => void): void;
  on(event: "error", cb: (err: unknown) => void): void;
  send(data: string): void;
  close(): void;
}

export interface PeerLike {
  on(event: "open", cb: (id: string) => void): void;
  on(event: "connection", cb: (conn: DataConnectionLike) => void): void;
  on(event: "error", cb: (err: { type?: string }) => void): void;
  on(event: "disconnected", cb: () => void): void;
  connect(id: string, options: { reliable: boolean; serialization: "json" }): DataConnectionLike;
  reconnect(): void;
  destroy(): void;
}

export interface P2PTransportOptions {
  /** Peer 생성 (기본 PeerJS 공용 시그널링 서버). id를 생략하면 임의 id */
  createPeer?: (id?: string) => PeerLike;
  /** 기본 createPeer에 넘길 PeerJS 옵션 (자체 시그널링 서버 지정 등) */
  peerOptions?: PeerOptions;
  /** 방 코드 생성기 (테스트용 주입. 기본은 서버의 generateRoomId) */
  newRoomId?: () => string;
}

export interface P2PTransport {
  /** useServerGame의 createSocket에 넘긴다. P2P_HOST_URL이면 호스트, p2p://방코드면 참가자 */
  createSocket: (url: string) => WebSocketLike;
  /**
   * 호스트 방, 참가자 연결, PeerJS 피어를 모두 정리한다 (다시 createSocket을 불러도 새로 시작한다).
   * 탭을 닫을 때(pagehide)도 호출해 시그널링 서버의 id를 반납하고 상대에게 종료를 알린다.
   */
  dispose: () => void;
}

/** 방 코드 -> PeerJS id */
export function peerIdOf(roomId: string): string {
  return `${PEER_ID_PREFIX}${roomId}`;
}

/**
 * 호스트용 방 코드를 만든다. 서버 모드의 방 코드 알파벳에는 '_'가 있어 맨 앞/뒤나 연속으로 나오면
 * PeerJS id 규칙에 걸리므로, `mjk-`+코드가 규칙을 만족할 때까지 다시 뽑는다.
 */
export function generatePeerSafeRoomId(draw: () => string = generateRoomId): string {
  for (let i = 0; i < MAX_ROOM_ID_DRAWS; i++) {
    const id = draw();
    if (PEERJS_ID.test(peerIdOf(id))) return id;
  }
  throw new Error("PeerJS id 규칙에 맞는 방 코드를 만들지 못했습니다");
}

/** 'p2p://ABCD' 형태에서 방 코드를 꺼낸다. 형식이 틀리거나 예약 주소(host/idle)면 null */
export function roomIdFromUrl(url: string): string | null {
  if (!url.startsWith(P2P_PREFIX)) return null;
  const id = url.slice(P2P_PREFIX.length).toUpperCase();
  if (id === "HOST" || id === "IDLE") return null;
  return ROOM_CODE.test(id) ? id : null;
}

/** 한 구독자의 예외가 전송 계층을 깨지 않게 감싼다 */
function safe(fn: (() => void) | undefined): void {
  try {
    fn?.();
  } catch {
    // 무시
  }
}

/**
 * WebSocket처럼 동작하는 소켓. 이벤트는 모두 비동기로 전달해 핸들러가 등록된 뒤에 도착하고,
 * 클라이언트 호출 안에서 응답이 재진입하지 않게 한다. 닫힌 뒤의 이벤트는 무시한다.
 */
class SocketShell implements WebSocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  private closed = false;

  constructor(
    private readonly onSend: (data: string) => void,
    private readonly onUserClose: () => void,
  ) {}

  get isClosed(): boolean {
    return this.closed;
  }

  send(data: string): void {
    if (this.closed) throw new Error("소켓이 닫혔습니다");
    this.onSend(data);
  }

  close(): void {
    if (this.closed) return;
    // 먼저 닫힘 처리해야 정리 중 발생하는 채널 close 이벤트가 1006 종료로 덮어쓰지 않는다
    this.fireClose(1000);
    this.onUserClose();
  }

  fireOpen(): void {
    if (this.closed) return;
    queueMicrotask(() => {
      if (!this.closed) safe(() => this.onopen?.({}));
    });
  }

  fireMessage(data: unknown): void {
    if (this.closed) return;
    queueMicrotask(() => {
      if (!this.closed) safe(() => this.onmessage?.({ data }));
    });
  }

  fireError(): void {
    if (this.closed) return;
    queueMicrotask(() => safe(() => this.onerror?.({})));
  }

  fireClose(code: number, reason?: string): void {
    if (this.closed) return;
    this.closed = true;
    queueMicrotask(() => safe(() => this.onclose?.({ code, ...(reason !== undefined ? { reason } : {}) })));
  }
}

interface Host {
  manager: RoomManager;
  peer: PeerLike | null;
  /** 호스트 본인 세션의 정리 함수 (연결 수 상한에 포함하지 않는다) */
  hostStop: (() => void) | null;
  /** 원격 참가자 연결의 정리 함수 (연결 수 상한 계산 대상) */
  stops: Set<() => void>;
  disposed: boolean;
}

export function createP2PTransport(options: P2PTransportOptions = {}): P2PTransport {
  const createPeer =
    options.createPeer ??
    ((id?: string): PeerLike =>
      (id === undefined ? new Peer(options.peerOptions ?? {}) : new Peer(id, options.peerOptions ?? {})) as unknown as PeerLike);

  let current: Host | null = null;
  /** 열려 있는 참가자 소켓 (dispose에서 함께 닫는다) */
  const guests = new Set<SocketShell>();

  function disposeHost(h: Host | null): void {
    if (!h || h.disposed) return;
    h.disposed = true;
    if (current === h) current = null;
    safe(h.hostStop ?? undefined);
    h.hostStop = null;
    for (const stop of [...h.stops]) safe(stop);
    h.stops.clear();
    safe(() => h.manager.close());
    safe(() => h.peer?.destroy());
  }

  /** 원격 참가자의 DataChannel 하나를 방 세션에 연결한다 */
  function attachRemote(h: Host, dc: DataConnectionLike): void {
    // 호스트 본인은 stops에 없으므로 원격 연결만 센다
    if (h.stops.size >= MAX_PEER_CONNECTIONS) {
      safe(() => dc.close());
      return;
    }
    let session: Session | null = null;
    let done = false;
    const stop = (): void => {
      if (done) return;
      done = true;
      h.stops.delete(stop);
      safe(() => session?.onClose());
      safe(() => dc.close());
    };
    h.stops.add(stop);
    const conn: Connection = {
      send: (msg: ServerMessage) => {
        if (!done && dc.open) safe(() => dc.send(JSON.stringify(msg)));
      },
      close: stop,
      terminate: stop,
    };
    const start = (): void => {
      if (!session && !done) session = createSession(h.manager, conn);
    };
    dc.on("open", start);
    if (dc.open) start();
    dc.on("data", (data) => {
      if (!session || done) return;
      try {
        session.onMessage(typeof data === "string" ? data : null);
      } catch {
        // 예상 밖 예외: 이 연결만 끊는다 (호스트와 다른 참가자는 계속)
        conn.send({ type: "error", code: "server_error", message: "호스트 내부 오류가 발생했습니다" });
        stop();
      }
    });
    dc.on("close", stop);
    dc.on("error", stop);
  }

  /** 호스트 본인의 소켓: 네트워크 없이 같은 브라우저의 방 세션에 바로 연결한다 */
  function createHostSocket(): WebSocketLike {
    disposeHost(current); // 이전 호스트가 남아 있으면 정리하고 새 방으로 시작한다
    const drawRoomId = (): string => generatePeerSafeRoomId(options.newRoomId);
    let roomId = drawRoomId();
    const h: Host = {
      manager: new RoomManager({ newRoomId: () => roomId }),
      peer: null,
      hostStop: null,
      stops: new Set(),
      disposed: false,
    };
    current = h;
    let session: Session | null = null;
    let retries = 0;
    const shell: SocketShell = new SocketShell(
      (data) => {
        queueMicrotask(() => {
          if (!h.disposed && session) safe(() => session!.onMessage(data));
        });
      },
      () => disposeHost(h),
    );
    const conn: Connection = {
      send: (msg) => shell.fireMessage(JSON.stringify(msg)),
      close: () => shell.fireClose(1000),
      terminate: () => shell.fireClose(1008),
    };
    const failed = (): void => {
      shell.fireError();
      shell.fireClose(1006, "호스트를 시작하지 못했습니다");
      disposeHost(h);
    };
    const openPeer = (): void => {
      const peer = createPeer(peerIdOf(roomId));
      h.peer = peer;
      peer.on("open", () => {
        if (h.disposed || h.peer !== peer) return;
        // 시그널링이 끊겼다 reconnect()되면 PeerJS가 'open'을 다시 낸다. 세션을 또 만들면 참가 제한 시간 타이머가
        // 새로 돌아 10초 뒤 호스트 소켓이 1008('같은 자리' 오류)로 강제 종료되므로, 이미 만든 세션은 그대로 둔다
        if (session) return;
        session = createSession(h.manager, conn);
        h.hostStop = () => session?.onClose();
        shell.fireOpen();
      });
      peer.on("connection", (dc) => {
        if (!h.disposed && h.peer === peer) attachRemote(h, dc);
      });
      peer.on("error", (err) => {
        if (h.disposed || h.peer !== peer) return;
        if ((err.type === "unavailable-id" || err.type === "invalid-id") && !session && retries < MAX_ID_RETRIES) {
          // 방 코드가 이미 쓰이고 있으면 새 코드로 다시 시도한다
          retries += 1;
          roomId = drawRoomId();
          safe(() => peer.destroy());
          openPeer();
          return;
        }
        // 방이 만들어진 뒤의 오류(시그널링 일시 끊김 등)는 이미 맺은 연결에 영향이 없으므로 무시한다
        if (!session) failed();
      });
      // 시그널링 서버와 끊겨도 맺은 연결은 유지된다. 새 참가자를 받으려면 다시 연결한다
      peer.on("disconnected", () => {
        if (!h.disposed && h.peer === peer) safe(() => peer.reconnect());
      });
    };
    openPeer();
    return shell;
  }

  /** 참가자 소켓: 방 코드로 호스트에 접속한다 */
  function createGuestSocket(roomId: string): WebSocketLike {
    let peer: PeerLike | null = null;
    let dc: DataConnectionLike | null = null;
    const teardown = (): void => {
      guests.delete(shell);
      safe(() => dc?.close());
      safe(() => peer?.destroy());
      dc = null;
      peer = null;
    };
    const shell: SocketShell = new SocketShell((data) => {
      if (!dc?.open) throw new Error("연결되지 않았습니다");
      dc.send(data);
    }, teardown);
    const failed = (reason: string, code = 1006): void => {
      shell.fireError();
      shell.fireClose(code, reason);
      teardown();
    };
    guests.add(shell);
    const p = createPeer();
    peer = p;
    p.on("open", () => {
      // 시그널링 재연결로 'open'이 다시 와도 이미 맺은 DataChannel을 새로 만들지 않는다
      if (shell.isClosed || dc) return;
      const channel = p.connect(peerIdOf(roomId), { reliable: true, serialization: "json" });
      dc = channel;
      channel.on("open", () => shell.fireOpen());
      channel.on("data", (data) => shell.fireMessage(data));
      channel.on("close", () => failed("호스트와 연결이 끊어졌습니다"));
      channel.on("error", () => failed("호스트와 연결하지 못했습니다"));
    });
    // peer-unavailable: 그 방 코드의 호스트가 없다. 이미 앉았던 방이면(재접속 중) 호스트가 사라진 것이므로 전용 코드로 알린다
    p.on("error", (err) =>
      err.type === "peer-unavailable"
        ? failed("해당 방 코드의 호스트를 찾을 수 없습니다", CLOSE_CODE_HOST_LEFT)
        : failed("P2P 연결에 실패했습니다"),
    );
    return shell;
  }

  return {
    createSocket(url) {
      if (url === P2P_HOST_URL) return createHostSocket();
      const roomId = roomIdFromUrl(url);
      if (roomId === null) {
        const shell = new SocketShell(
          () => {
            throw new Error("연결되지 않았습니다");
          },
          () => {},
        );
        shell.fireError();
        shell.fireClose(1006, "방 코드가 올바르지 않습니다");
        return shell;
      }
      return createGuestSocket(roomId);
    },
    dispose: () => {
      disposeHost(current);
      for (const g of [...guests]) g.close();
    },
  };
}
