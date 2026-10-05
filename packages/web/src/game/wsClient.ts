// WebSocket 연결 계층 (React 비의존). 소켓 생성·타이머·저장소를 모두 주입받는다.
// 주의: seatToken은 어디에도 출력하지 않는다. 서버 index.ts(ws 의존)는 import하지 않는다.
import { ERROR_CODES } from "@mahjong/server-protocol";
import type { ClientAction, ClientMessage, ErrorCode, SeatView, ServerMessage } from "../model/seatView";
import type { SessionStore } from "./sessionStore";

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "closed";

export type CloseReasonCode =
  | "user"
  | "displaced"
  | "unknown_room"
  | "bad_token"
  | "room_full"
  | "connection_failed"
  | "retries_exhausted"
  | "rejoin_timeout";

export interface CloseReason {
  code: CloseReasonCode;
  message: string;
  /** WebSocket close code (알 수 있을 때) */
  closeCode?: number;
}

export type WsClientEvent =
  | { type: "status"; status: ConnectionStatus; reason?: CloseReason }
  | { type: "joined"; roomId: string; seat: number }
  | { type: "view"; view: SeatView; deadlineMs?: number; receivedAt: number; deadlineAt?: number }
  | { type: "ack"; seq: number }
  | { type: "notice"; code: "timeout" | "auto_mode" }
  | { type: "error"; code: ErrorCode; message: string; seq?: number };

export type SendResult = { ok: true } | { ok: false; reason: "not_connected" | "send_failed" };
export type ActionSendResult = { ok: true; seq: number } | { ok: false; reason: "not_connected" | "send_failed" };

/** 브라우저 WebSocket과 Node ws가 모두 만족하는 최소 인터페이스 */
export interface WebSocketLike {
  onopen: ((ev: unknown) => void) | null;
  onmessage: ((ev: { data: unknown }) => void) | null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null;
  onerror: ((ev: unknown) => void) | null;
  send(data: string): void;
  close(code?: number, reason?: string): void;
}

export interface Timers {
  setTimeout(fn: () => void, ms: number): unknown;
  clearTimeout(handle: unknown): void;
  now(): number;
}

export interface WsClientOptions {
  url: string;
  createSocket: (url: string) => WebSocketLike;
  store: SessionStore;
  timers?: Timers;
  /** 첫 action에 쓸 seq (기본 1). 새로고침 뒤에는 큰 값으로 시작한다 */
  initialSeq?: number;
  /** 재접속 시도 상한 (기본 10) */
  maxReconnectAttempts?: number;
  baseDelayMs?: number;
  maxDelayMs?: number;
  /** rejoin 연결+응답 대기 상한 (기본 10초). 초과하면 소켓을 버리고 재접속 경로로 보낸다 */
  rejoinTimeoutMs?: number;
}

export interface WsClient {
  getStatus(): ConnectionStatus;
  getCloseReason(): CloseReason | null;
  subscribe(listener: (event: WsClientEvent) => void): () => void;
  /** 소켓을 연다. 상태가 connected가 된 뒤 join/rejoin/start/action을 보낼 수 있다 */
  connect(): void;
  join(name?: string, roomId?: string): SendResult;
  rejoin(roomId: string, seatToken: string): SendResult;
  start(): SendResult;
  action(action: ClientAction): ActionSendResult;
  ping(): SendResult;
  /** 저장소의 세션으로 연결 후 rejoin. 저장된 세션이 없거나 서버 URL이 다르면 false */
  resumeStored(): boolean;
  close(): void;
}

/** 새로고침 복원 시 저장된 seq 위로 건너뛰는 폭 (서버 상한 1000 이내) */
export const RESUME_SEQ_JUMP = 10;

/** 호출자가 createWsClient의 url로 넘기는 기본 서버 주소 */
export function getServerUrl(): string {
  const env = (import.meta as unknown as { env?: { VITE_SERVER_URL?: string } }).env;
  return env?.VITE_SERVER_URL ?? "ws://localhost:8080";
}

/** 수신 시각 기준 절대 만료 시각(ms). deadlineMs가 없으면 undefined */
export function computeDeadlineAt(receivedAt: number, deadlineMs: number | undefined): number | undefined {
  return deadlineMs === undefined ? undefined : receivedAt + deadlineMs;
}

const NO_RETRY_ERRORS: readonly ErrorCode[] = ["unknown_room", "bad_token", "room_full"];

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);
const isSeq = (v: unknown): v is number => typeof v === "number" && Number.isSafeInteger(v) && v >= 0;

/** 서버 메시지 파싱+형식 검증. 실패/미지 type은 null (예외 없음) */
export function parseServerMessage(raw: unknown): ServerMessage | null {
  if (typeof raw !== "string") return null;
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isRecord(v)) return null;
  switch (v.type) {
    case "joined":
      if (
        typeof v.roomId === "string" &&
        typeof v.seatToken === "string" &&
        typeof v.seat === "number" &&
        Number.isInteger(v.seat) &&
        v.seat >= 0 &&
        v.seat <= 3
      ) {
        return { type: "joined", roomId: v.roomId, seat: v.seat, seatToken: v.seatToken };
      }
      return null;
    case "view": {
      if (!isRecord(v.view)) return null;
      const view = v.view as unknown as SeatView;
      if (v.deadlineMs === undefined) return { type: "view", view };
      if (typeof v.deadlineMs !== "number" || !Number.isFinite(v.deadlineMs) || v.deadlineMs < 0) return null;
      return { type: "view", view, deadlineMs: v.deadlineMs };
    }
    case "error": {
      if (typeof v.code !== "string" || !(ERROR_CODES as readonly string[]).includes(v.code) || typeof v.message !== "string") return null;
      const code = v.code as ErrorCode;
      if (v.seq === undefined) return { type: "error", code, message: v.message };
      if (!isSeq(v.seq)) return null;
      return { type: "error", code, message: v.message, seq: v.seq };
    }
    case "ack":
      return isSeq(v.seq) ? { type: "ack", seq: v.seq } : null;
    case "notice":
      return v.code === "timeout" || v.code === "auto_mode" ? { type: "notice", code: v.code } : null;
    case "pong":
      return { type: "pong" };
    default:
      return null;
  }
}

const defaultTimers: Timers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (h) => clearTimeout(h as ReturnType<typeof setTimeout>),
  now: () => Date.now(),
};

export function createWsClient(options: WsClientOptions): WsClient {
  const timers = options.timers ?? defaultTimers;
  const maxAttempts = options.maxReconnectAttempts ?? 10;
  const baseDelay = options.baseDelayMs ?? 1000;
  const maxDelay = options.maxDelayMs ?? 10_000;
  const listeners = new Set<(e: WsClientEvent) => void>();

  let status: ConnectionStatus = "idle";
  let closeReason: CloseReason | null = null;
  let socket: WebSocketLike | null = null;
  let session: { roomId: string; seatToken: string } | null = null;
  let nextSeq = options.initialSeq ?? 1;
  let awaitingRejoin = false;
  let intentionalClose = false;
  let attempts = 0;
  let retryTimer: unknown = null;
  let rejoinTimer: unknown = null;
  /** 수동 rejoin() 이전의 세션 (rejoin이 실패하면 복원한다) */
  let sessionBeforeRejoin: { roomId: string; seatToken: string } | null = null;
  const rejoinTimeout = options.rejoinTimeoutMs ?? 10_000;

  const emit = (e: WsClientEvent): void => {
    for (const l of [...listeners]) {
      try {
        l(e);
      } catch {
        // 한 구독자의 예외가 연결 계층을 깨지 않게 한다
      }
    }
  };

  const setStatus = (s: ConnectionStatus, reason?: CloseReason): void => {
    if (status === s && !reason) return;
    status = s;
    closeReason = s === "closed" ? (reason ?? null) : null;
    emit(reason ? { type: "status", status: s, reason } : { type: "status", status: s });
  };

  const rawSend = (msg: ClientMessage): SendResult => {
    if (!socket) return { ok: false, reason: "not_connected" };
    try {
      socket.send(JSON.stringify(msg));
      return { ok: true };
    } catch {
      return { ok: false, reason: "send_failed" };
    }
  };

  const guardedSend = (msg: ClientMessage): SendResult =>
    status === "connected" ? rawSend(msg) : { ok: false, reason: "not_connected" };

  const persist = (): void => {
    if (session) options.store.save({ ...session, seq: Math.max(0, nextSeq - 1), serverUrl: options.url });
  };

  const detach = (sock: WebSocketLike): void => {
    sock.onopen = null;
    sock.onmessage = null;
    sock.onclose = null;
    sock.onerror = null;
  };

  const dropSocket = (): void => {
    const sock = socket;
    socket = null;
    if (!sock) return;
    detach(sock);
    try {
      sock.close();
    } catch {
      // 무시
    }
  };

  const clearRejoinTimer = (): void => {
    if (rejoinTimer !== null) timers.clearTimeout(rejoinTimer);
    rejoinTimer = null;
  };

  const finishClosed = (reason: CloseReason): void => {
    if (retryTimer !== null) timers.clearTimeout(retryTimer);
    retryTimer = null;
    clearRejoinTimer();
    setStatus("closed", reason);
  };

  const handleDrop = (closeCode: number | undefined, cause?: "rejoin_timeout"): void => {
    if (intentionalClose || status === "closed") return;
    clearRejoinTimer();
    const extra = closeCode === undefined ? {} : { closeCode };
    if (closeCode === 1008) {
      finishClosed({ code: "displaced", message: "다른 연결이 좌석을 가져갔거나 규칙 위반으로 종료되었습니다", ...extra });
      return;
    }
    if (!session) {
      finishClosed({ code: "connection_failed", message: "서버 연결이 끊어졌습니다", ...extra });
      return;
    }
    if (attempts >= maxAttempts) {
      if (cause === "rejoin_timeout") {
        finishClosed({ code: "rejoin_timeout", message: "재접속 응답 시간이 초과되었습니다", ...extra });
      } else {
        finishClosed({ code: "retries_exhausted", message: "재접속 시도 횟수를 초과했습니다", ...extra });
      }
      return;
    }
    const delay = Math.min(baseDelay * 2 ** attempts, maxDelay);
    attempts += 1;
    awaitingRejoin = true;
    setStatus("reconnecting");
    retryTimer = timers.setTimeout(() => {
      retryTimer = null;
      if (intentionalClose || status !== "reconnecting") return;
      openSocket(true);
    }, delay);
  };

  const handleMessage = (raw: unknown): void => {
    const msg = parseServerMessage(raw);
    if (!msg) return;
    switch (msg.type) {
      case "joined":
        awaitingRejoin = false;
        sessionBeforeRejoin = null;
        clearRejoinTimer();
        attempts = 0;
        session = { roomId: msg.roomId, seatToken: msg.seatToken };
        persist();
        setStatus("connected");
        emit({ type: "joined", roomId: msg.roomId, seat: msg.seat });
        return;
      case "view": {
        const receivedAt = timers.now();
        const e: WsClientEvent = { type: "view", view: msg.view, receivedAt };
        if (msg.deadlineMs !== undefined) {
          e.deadlineMs = msg.deadlineMs;
          e.deadlineAt = receivedAt + msg.deadlineMs;
        }
        emit(e);
        return;
      }
      case "ack":
        emit({ type: "ack", seq: msg.seq });
        return;
      case "notice":
        emit({ type: "notice", code: msg.code });
        return;
      case "error": {
        const e: WsClientEvent = { type: "error", code: msg.code, message: msg.message };
        if (msg.seq !== undefined) e.seq = msg.seq;
        emit(e);
        if (awaitingRejoin && NO_RETRY_ERRORS.includes(msg.code)) {
          // 복구 불가능한 rejoin 실패: 저장 세션을 버리고 재시도 없이 닫는다
          session = null;
          sessionBeforeRejoin = null;
          options.store.clear();
          dropSocket();
          finishClosed({ code: msg.code as CloseReasonCode, message: msg.message });
        } else if (awaitingRejoin && msg.seq === undefined) {
          // 알 수 없는/일시적인 rejoin 실패: 대기 상태를 풀고 연결 상태를 일관되게 정리한다
          awaitingRejoin = false;
          clearRejoinTimer();
          if (status === "connected") {
            // 수동 rejoin: 연결은 유지하고 이전 세션으로 되돌린다
            session = sessionBeforeRejoin;
            sessionBeforeRejoin = null;
          } else {
            // 자동 rejoin: 이 소켓은 쓸 수 없으므로 버리고 백오프 재접속으로 보낸다
            dropSocket();
            handleDrop(undefined);
          }
        }
        return;
      }
      case "pong":
        return;
    }
  };

  /** rejoin 연결+응답 타임아웃 시작. 만료되면 소켓을 버리고 재접속(또는 사유 표기 후 종료)으로 보낸다 */
  const startRejoinTimer = (): void => {
    clearRejoinTimer();
    rejoinTimer = timers.setTimeout(() => {
      rejoinTimer = null;
      if (!awaitingRejoin || intentionalClose || status === "closed") return;
      awaitingRejoin = false;
      if (sessionBeforeRejoin) session = sessionBeforeRejoin;
      sessionBeforeRejoin = null;
      dropSocket();
      handleDrop(undefined, "rejoin_timeout");
    }, rejoinTimeout);
  };

  function openSocket(rejoining: boolean): void {
    awaitingRejoin = rejoining;
    if (rejoining) startRejoinTimer();
    else clearRejoinTimer();
    let sock: WebSocketLike;
    try {
      sock = options.createSocket(options.url);
    } catch {
      socket = null;
      handleDrop(undefined);
      return;
    }
    socket = sock;
    sock.onopen = () => {
      if (socket !== sock) return;
      if (awaitingRejoin && session) {
        rawSend({ type: "rejoin", roomId: session.roomId, seatToken: session.seatToken });
      } else {
        setStatus("connected");
      }
    };
    sock.onmessage = (ev) => {
      if (socket === sock) handleMessage(ev.data);
    };
    sock.onerror = () => {
      // close 이벤트에서 일괄 처리한다
    };
    sock.onclose = (ev) => {
      if (socket !== sock) return;
      socket = null;
      handleDrop(ev.code);
    };
  }

  const beginConnect = (rejoining: boolean): void => {
    intentionalClose = false;
    attempts = 0;
    setStatus("connecting");
    openSocket(rejoining);
  };

  const isActive = (): boolean => status === "connecting" || status === "connected" || status === "reconnecting";

  return {
    getStatus: () => status,
    getCloseReason: () => closeReason,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect() {
      if (!isActive()) beginConnect(false);
    },
    join(name, roomId) {
      const msg: ClientMessage = { type: "join" };
      if (roomId !== undefined) msg.roomId = roomId;
      if (name !== undefined) msg.name = name;
      return guardedSend(msg);
    },
    rejoin(roomId, seatToken) {
      const r = guardedSend({ type: "rejoin", roomId, seatToken });
      if (r.ok) {
        sessionBeforeRejoin = session;
        awaitingRejoin = true;
        session = { roomId, seatToken };
        startRejoinTimer();
      }
      return r;
    },
    start: () => guardedSend({ type: "start" }),
    action(action) {
      // 수동 rejoin 응답 전에는 보내지 않는다 (서버가 아직 좌석을 모른다)
      if (status !== "connected" || awaitingRejoin) return { ok: false, reason: "not_connected" };
      const seq = nextSeq;
      const r = rawSend({ type: "action", seq, action });
      if (!r.ok) return r;
      // 서버는 오류 응답 뒤에도 seq를 소비하므로 보낸 즉시 증가시킨다
      nextSeq = seq + 1;
      persist();
      return { ok: true, seq };
    },
    ping: () => guardedSend({ type: "ping" }),
    resumeStored() {
      if (isActive()) return false;
      const stored = options.store.load();
      if (!stored || stored.serverUrl !== options.url) return false;
      session = { roomId: stored.roomId, seatToken: stored.seatToken };
      nextSeq = Math.max(nextSeq, stored.seq + 1 + RESUME_SEQ_JUMP);
      beginConnect(true);
      return true;
    },
    close() {
      intentionalClose = true;
      if (retryTimer !== null) timers.clearTimeout(retryTimer);
      retryTimer = null;
      clearRejoinTimer();
      const sock = socket;
      socket = null;
      if (sock) {
        detach(sock);
        try {
          sock.close(1000);
        } catch {
          // 무시
        }
      }
      if (status !== "closed") setStatus("closed", { code: "user", message: "사용자가 연결을 닫았습니다" });
    },
  };
}
