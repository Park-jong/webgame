// 서버 기반 게임 훅. wsClient(연결·재접속·seq)를 React 상태로 옮기고 GameController 인터페이스로 노출한다.
// 서버가 상태의 유일한 원본이므로 행동은 항상 view.legalActions와 대조(clientActionFromView)한 뒤에만 보낸다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, Seat } from "@mahjong/core";
import type { RoundSummary } from "../controller";
import { clientActionFromView, summarizeFromView } from "../model/fromView";
import type { ErrorCode, SeatView } from "../model/seatView";
import { createLocalSessionStore } from "./sessionStore";
import type { SessionStore } from "./sessionStore";
import type { GameNotice, GameStatus, ServerGameController } from "./types";
import { createWsClient, defaultTimers, getServerUrl } from "./wsClient";
import type { CloseReason, ConnectionStatus, Timers, WebSocketLike, WsClient, WsClientOptions } from "./wsClient";

export interface UseServerGameOptions {
  /** 서버 주소 (기본 getServerUrl()) */
  url?: string;
  /** 소켓 생성 (기본 브라우저 WebSocket). 테스트에서 모의 소켓/Node ws를 주입한다 */
  createSocket?: (url: string) => WebSocketLike;
  /** 세션 저장소 (기본 localStorage) */
  store?: SessionStore;
  timers?: Timers;
  /**
   * 입장 요청(join) 응답 대기 상한 ms (기본 JOIN_TIMEOUT_MS = 12초).
   * 서버 참가 제한 시간(10초, packages/server session.ts JOIN_TIMEOUT_MS)보다 약간 길게 잡아 서버가 먼저 연결을 닫을 기회를 준다.
   */
  joinTimeoutMs?: number;
  /** 마운트 시 저장된 세션이 있으면 자동 rejoin (기본 true) */
  resumeStored?: boolean;
  /** 기본 입장 이름 */
  name?: string;
  /** wsClient 세부 옵션 (재접속 횟수/지연/rejoin 타임아웃 등) */
  clientOptions?: Partial<Omit<WsClientOptions, "url" | "createSocket" | "store" | "timers">>;
}

interface ServerState {
  conn: ConnectionStatus;
  closeReason: CloseReason | null;
  roomId: string | null;
  joinedSeat: Seat | null;
  /** 입장 요청을 보냈거나 연결 뒤 보낼 예정이고 joined를 기다리는 중 */
  joining: boolean;
  view: SeatView | null;
  deadlineAt: number | null;
  notice: GameNotice | null;
  error: string | null;
  errorCode: ErrorCode | null;
  /** 보낸 행동의 ack/view/오류를 기다리는 중 */
  inFlight: boolean;
  /** 응답 구간 중 ack를 받음: 다음 view까지 같은 구간에서 재응답하지 않는다 */
  acked: boolean;
  showFinal: boolean;
  resultDismissed: boolean;
}

const initialState: ServerState = {
  conn: "idle",
  closeReason: null,
  roomId: null,
  joinedSeat: null,
  joining: false,
  view: null,
  deadlineAt: null,
  notice: null,
  error: null,
  errorCode: null,
  inFlight: false,
  acked: false,
  showFinal: false,
  resultDismissed: false,
};

/** 입장 요청 응답 대기 기본값: 서버 참가 제한 시간 10초 + 여유 2초 */
export const JOIN_TIMEOUT_MS = 12_000;
export const JOIN_TIMEOUT_MESSAGE = "서버 응답이 없습니다. 다시 시도해 주세요";

/** 재접속해도 복구할 수 없는 닫힘 사유: 방/뷰 상태를 비운다 */
const UNRECOVERABLE = ["unknown_room", "bad_token", "room_full"];

interface JoinIntent {
  name?: string;
  roomId?: string;
}

function createBrowserSocket(url: string): WebSocketLike {
  return new WebSocket(url) as unknown as WebSocketLike;
}

export function useServerGame(options: UseServerGameOptions = {}): ServerGameController {
  const [s, setS] = useState<ServerState>(initialState);
  const [riichiMode, setRiichiMode] = useState(false);
  const optionsRef = useRef(options);
  const clientRef = useRef<WsClient | null>(null);
  const storeRef = useRef<SessionStore | null>(null);
  const intentRef = useRef<JoinIntent | null>(null);
  // 같은 tick의 중복 호출을 막기 위한 동기 값 (state는 다음 렌더에야 반영된다)
  const inFlightRef = useRef(false);
  const ackedRef = useRef(false);
  const viewRef = useRef<SeatView | null>(null);
  const roomRef = useRef<string | null>(null);
  // join 응답 대기 타이머: joined/error/closed/leave/언마운트에서 해제한다
  const joinTimerRef = useRef<unknown>(null);
  const clearJoinTimerRef = useRef<() => void>(() => {});
  const startJoinTimerRef = useRef<() => void>(() => {});

  const patch = useCallback((p: Partial<ServerState> | ((prev: ServerState) => Partial<ServerState>)) => {
    setS((prev) => ({ ...prev, ...(typeof p === "function" ? p(prev) : p) }));
  }, []);

  useEffect(() => {
    const o = optionsRef.current;
    const url = o.url ?? getServerUrl();
    const store = o.store ?? createLocalSessionStore();
    storeRef.current = store;
    const client = createWsClient({
      url,
      createSocket: o.createSocket ?? createBrowserSocket,
      store,
      ...(o.timers ? { timers: o.timers } : {}),
      ...o.clientOptions,
    });
    clientRef.current = client;

    const timers = o.timers ?? defaultTimers;
    const clearJoinTimer = (): void => {
      if (joinTimerRef.current !== null) timers.clearTimeout(joinTimerRef.current);
      joinTimerRef.current = null;
    };
    clearJoinTimerRef.current = clearJoinTimer;
    startJoinTimerRef.current = () => {
      clearJoinTimer();
      joinTimerRef.current = timers.setTimeout(() => {
        joinTimerRef.current = null;
        intentRef.current = null;
        // 소켓을 정리하고(closed 핸들러가 joining을 해제한다) 폼으로 돌아간다. roomId는 null 그대로
        client.close();
        patch({ error: JOIN_TIMEOUT_MESSAGE, errorCode: null, joining: false });
      }, optionsRef.current.joinTimeoutMs ?? JOIN_TIMEOUT_MS);
    };

    const sendIntent = (): void => {
      const intent = intentRef.current;
      intentRef.current = null;
      if (!intent || roomRef.current !== null) return;
      const r = client.join(intent.name ?? optionsRef.current.name, intent.roomId);
      if (!r.ok) {
        clearJoinTimer();
        patch({ error: "서버에 입장 요청을 보내지 못했습니다", errorCode: null, joining: false });
      }
    };

    const unsubscribe = client.subscribe((e) => {
      switch (e.type) {
        case "status": {
          const reason = e.reason ?? null;
          if (e.status === "connected") {
            patch({ conn: e.status, closeReason: null });
            sendIntent();
          } else if (e.status === "closed") {
            intentRef.current = null;
            clearJoinTimer();
            inFlightRef.current = false;
            const reset = reason !== null && UNRECOVERABLE.includes(reason.code);
            if (reset) {
              viewRef.current = null;
              roomRef.current = null;
              ackedRef.current = false;
            }
            patch((prev) => ({
              conn: e.status,
              closeReason: reason,
              inFlight: false,
              joining: false,
              // 사용자가 나간 경우가 아니면 닫힘 사유를 오류로 보여 준다
              error: reason && reason.code !== "user" ? reason.message : prev.error,
              ...(reset ? { roomId: null, joinedSeat: null, view: null, deadlineAt: null, acked: false } : {}),
            }));
          } else {
            // connecting / reconnecting: 보낸 행동의 결과는 알 수 없다 (재접속 뒤 새 view로 판단)
            inFlightRef.current = false;
            patch({ conn: e.status, closeReason: null, inFlight: false });
          }
          return;
        }
        case "joined":
          clearJoinTimer();
          roomRef.current = e.roomId;
          patch({ roomId: e.roomId, joinedSeat: e.seat as Seat, joining: false, error: null, errorCode: null });
          return;
        case "view":
          viewRef.current = e.view;
          inFlightRef.current = false;
          ackedRef.current = false;
          patch((prev) => ({
            view: e.view,
            deadlineAt: e.deadlineAt ?? null,
            inFlight: false,
            acked: false,
            // 국이 새로 시작되면(결과가 사라지면) 결과 모달 상태를 초기화한다
            resultDismissed: e.view.result === null ? false : prev.resultDismissed,
            showFinal: e.view.phase === "gameEnd" ? prev.showFinal : false,
          }));
          return;
        case "ack":
          // 응답 구간 중 접수됨: 구간이 끝나 다음 view가 올 때까지 재응답 금지
          if (inFlightRef.current) {
            inFlightRef.current = false;
            ackedRef.current = true;
            patch({ inFlight: false, acked: true });
          }
          return;
        case "notice":
          patch({ notice: e.code });
          return;
        case "error":
          clearJoinTimer();
          inFlightRef.current = false;
          patch({ error: e.message, errorCode: e.code, inFlight: false, joining: false });
          return;
      }
    });

    if (o.resumeStored !== false) client.resumeStored();

    return () => {
      unsubscribe();
      clearJoinTimer();
      intentRef.current = null;
      client.close();
      if (clientRef.current === client) clientRef.current = null;
    };
  }, [patch]);

  const view = s.view;
  const mySeat: Seat = view?.seat ?? s.joinedSeat ?? 0;
  const roundOver = view !== null && (view.phase === "roundEnd" || view.phase === "gameEnd") && view.result !== null;
  const gameOver = roundOver && view.phase === "gameEnd";
  const summary: RoundSummary | null = useMemo(() => (roundOver && view ? summarizeFromView(view) : null), [roundOver, view]);
  const waitingAck = s.inFlight || s.acked;
  // 연결이 끊긴 동안(closed·reconnecting·connecting)에는 마지막 view의 행동을 노출하지 않는다
  const actions: readonly Action[] =
    s.conn === "connected" && view !== null && view.awaitingYou && !waitingAck ? view.legalActions : [];

  const act = useCallback(
    (action: Action): void => {
      const client = clientRef.current;
      const v = viewRef.current;
      if (!client || !v) return;
      // 보낸 직후/ack 후 같은 구간의 중복 응답을 막는다
      if (inFlightRef.current || ackedRef.current) return;
      if (!v.awaitingYou) {
        patch({ error: "지금은 행동할 차례가 아닙니다", errorCode: null });
        return;
      }
      const clientAction = clientActionFromView(v, action);
      if (clientAction === null) {
        patch({ error: "허용되지 않는 행동입니다", errorCode: "illegal_action" });
        return;
      }
      const r = client.action(clientAction);
      if (!r.ok) {
        patch({ error: "연결이 끊겨 행동을 보내지 못했습니다", errorCode: null });
        return;
      }
      inFlightRef.current = true;
      setRiichiMode(false);
      patch({ inFlight: true, acked: false, notice: null, error: null, errorCode: null, deadlineAt: null });
    },
    [patch],
  );

  const requestJoin = useCallback(
    (intent: JoinIntent): void => {
      const client = clientRef.current;
      if (!client) return;
      if (roomRef.current !== null) {
        patch({ error: "이미 방에 입장해 있습니다", errorCode: null });
        return;
      }
      patch({ error: null, errorCode: null, joining: true });
      startJoinTimerRef.current();
      if (client.getStatus() === "connected") {
        const r = client.join(intent.name ?? optionsRef.current.name, intent.roomId);
        if (!r.ok) {
          clearJoinTimerRef.current();
          patch({ error: "서버에 입장 요청을 보내지 못했습니다", errorCode: null, joining: false });
        }
      } else {
        // 연결이 열리면 입장 요청을 보낸다 (이미 연결 중이면 connect()는 아무것도 하지 않는다)
        intentRef.current = intent;
        client.connect();
      }
    },
    [patch],
  );

  const create = useCallback((name?: string) => requestJoin(name === undefined ? {} : { name }), [requestJoin]);
  const join = useCallback(
    (roomId: string, name?: string) => requestJoin(name === undefined ? { roomId } : { roomId, name }),
    [requestJoin],
  );
  const start = useCallback(() => {
    const client = clientRef.current;
    if (!client) return;
    if (!client.start().ok) patch({ error: "연결이 끊겨 시작 요청을 보내지 못했습니다", errorCode: null });
  }, [patch]);
  const leave = useCallback(() => {
    clearJoinTimerRef.current();
    intentRef.current = null;
    inFlightRef.current = false;
    ackedRef.current = false;
    viewRef.current = null;
    roomRef.current = null;
    clientRef.current?.close();
    storeRef.current?.clear();
    setRiichiMode(false);
    setS({ ...initialState, conn: "closed", closeReason: { code: "user", message: "사용자가 연결을 닫았습니다" } });
  }, []);

  const advanceResult = useCallback(() => {
    if (viewRef.current?.phase === "gameEnd") patch({ showFinal: true });
    else patch({ resultDismissed: true });
  }, [patch]);

  return {
    mode: "server",
    status: serverStatus(s, view, gameOver),
    mySeat,
    view,
    actions,
    act,
    waitingAck,
    riichiMode,
    toggleRiichi: () => setRiichiMode((m) => !m),
    roundOver,
    gameOver,
    summary,
    resultOpen: roundOver && !s.resultDismissed && !(gameOver && s.showFinal),
    showFinal: gameOver && s.showFinal,
    advanceResult,
    deadlineAt: s.deadlineAt,
    notice: s.notice,
    dismissNotice: () => patch({ notice: null }),
    error: s.error,
    errorCode: s.errorCode,
    dismissError: () => patch({ error: null, errorCode: null }),
    log: [],
    roomId: s.roomId,
    joining: s.joining,
    closeReason: s.closeReason,
    create,
    join,
    start,
    leave,
  };
}

function serverStatus(s: ServerState, view: SeatView | null, gameOver: boolean): GameStatus {
  if (s.conn === "reconnecting") return "reconnecting";
  if (s.conn === "connecting") return "connecting";
  if (s.conn === "closed") return s.closeReason?.code === "user" ? "idle" : "closed";
  if (s.roomId === null) return "idle";
  if (view === null) return "waiting";
  return gameOver ? "ended" : "playing";
}
