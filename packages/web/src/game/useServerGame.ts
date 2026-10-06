// 서버 기반 게임 훅. wsClient(연결·재접속·seq)를 React 상태로 옮기고 GameController 인터페이스로 노출한다.
// 서버가 상태의 유일한 원본이므로 행동은 항상 view.legalActions와 대조(clientActionFromView)한 뒤에만 보낸다.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { Action, Seat } from "@mahjong/core";
import type { RoundSummary } from "../controller";
import { clientActionFromView, summarizeFromView } from "../model/fromView";
import type { ErrorCode, SeatView } from "../model/seatView";
import { createLocalSessionStore, isResumable } from "./sessionStore";
import type { SessionStore } from "./sessionStore";
import { LOCAL_TEXT, NEXT_ROUND_ESTIMATE_MS, buildConnectionBanner } from "./messages";
import type { RetryInfo } from "./messages";
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
  /** 'timeout' 알림이 자동으로 사라지기까지 ms (기본 NOTICE_TIMEOUT_MS = 5초) */
  noticeTimeoutMs?: number;
  /**
   * 행동을 보낸 뒤 ack 또는 새 view를 기다리는 상한 ms (기본 RESPONSE_TIMEOUT_MS = 10초).
   * 초과하면 응답 대기(중복 클릭 방지)를 풀고 '서버 응답이 없습니다'를 안내한다. ack를 받으면 다시 처음부터 센다.
   */
  responseTimeoutMs?: number;
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
  /** 국 종료 view를 받은 시각 + 추정 대기. 국 종료가 아니면 null */
  nextRoundAt: number | null;
  notice: GameNotice | null;
  error: string | null;
  errorCode: ErrorCode | null;
  /** 보낸 행동의 ack/view/오류를 기다리는 중 */
  inFlight: boolean;
  /** 응답 구간 중 ack를 받음: 다음 view까지 같은 구간에서 재응답하지 않는다 */
  acked: boolean;
  showFinal: boolean;
  resultDismissed: boolean;
  /** 재접속 대기 중 시도 정보 (연결 배너용) */
  retry: RetryInfo | null;
  /** 닫힘 시점에 저장소에 이 서버의 저장 세션이 있어 '다시 연결'이 가능한지 */
  resumable: boolean;
}

const initialState: ServerState = {
  conn: "idle",
  closeReason: null,
  roomId: null,
  joinedSeat: null,
  joining: false,
  view: null,
  deadlineAt: null,
  nextRoundAt: null,
  notice: null,
  error: null,
  errorCode: null,
  inFlight: false,
  acked: false,
  showFinal: false,
  resultDismissed: false,
  retry: null,
  resumable: false,
};

/** 입장 요청 응답 대기 기본값: 서버 참가 제한 시간 10초 + 여유 2초 */
export const JOIN_TIMEOUT_MS = 12_000;
export const JOIN_TIMEOUT_MESSAGE = LOCAL_TEXT.joinTimeout;
/** 'timeout' 알림 자동 소멸 기본값 */
export const NOTICE_TIMEOUT_MS = 5_000;
/** 행동 후 ack/view 대기 기본값: 서버 응답 구간(1초)과 느린 봇(0.6초 단위)을 넉넉히 넘는 값 */
export const RESPONSE_TIMEOUT_MS = 10_000;

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
  // 행동 응답 대기 타이머 / timeout 알림 자동 소멸 타이머
  const ackTimerRef = useRef<unknown>(null);
  const noticeTimerRef = useRef<unknown>(null);
  const clearAckTimerRef = useRef<() => void>(() => {});
  const startAckTimerRef = useRef<() => void>(() => {});
  const clearNoticeTimerRef = useRef<() => void>(() => {});

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

    const clearAckTimer = (): void => {
      if (ackTimerRef.current !== null) timers.clearTimeout(ackTimerRef.current);
      ackTimerRef.current = null;
    };
    clearAckTimerRef.current = clearAckTimer;
    startAckTimerRef.current = () => {
      clearAckTimer();
      ackTimerRef.current = timers.setTimeout(() => {
        ackTimerRef.current = null;
        if (!inFlightRef.current && !ackedRef.current) return;
        // 연결은 살아 있는데 서버가 침묵: 대기를 풀어 다시 행동할 수 있게 한다
        inFlightRef.current = false;
        ackedRef.current = false;
        patch({ inFlight: false, acked: false, error: LOCAL_TEXT.responseTimeout, errorCode: null });
      }, optionsRef.current.responseTimeoutMs ?? RESPONSE_TIMEOUT_MS);
    };
    const clearNoticeTimer = (): void => {
      if (noticeTimerRef.current !== null) timers.clearTimeout(noticeTimerRef.current);
      noticeTimerRef.current = null;
    };
    clearNoticeTimerRef.current = clearNoticeTimer;

    const sendIntent = (): void => {
      const intent = intentRef.current;
      intentRef.current = null;
      if (!intent || roomRef.current !== null) return;
      const r = client.join(intent.name ?? optionsRef.current.name, intent.roomId);
      if (!r.ok) {
        clearJoinTimer();
        patch({ error: LOCAL_TEXT.joinNotSent, errorCode: null, joining: false });
      }
    };

    const unsubscribe = client.subscribe((e) => {
      switch (e.type) {
        case "status": {
          const reason = e.reason ?? null;
          if (e.status === "connected") {
            patch({ conn: e.status, closeReason: null, retry: null });
            sendIntent();
          } else if (e.status === "closed") {
            intentRef.current = null;
            clearJoinTimer();
            clearAckTimer();
            clearNoticeTimer();
            inFlightRef.current = false;
            ackedRef.current = false;
            const resumable = isResumable(store, url);
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
              acked: false,
              joining: false,
              notice: null,
              retry: null,
              resumable,
              // 닫힘 사유는 오류 문구가 아니라 연결 배너(또는 서버 오류 코드 문구)로 보여 준다
              error: prev.error,
              // closed(unknown_room)는 저장 세션 rejoin 경로에서만 온다 (방 ID를 직접 입력한 join 실패는 error 이벤트만 오고 닫히지 않는다)
              ...(reason?.code === "unknown_room" ? { error: LOCAL_TEXT.roomGone, errorCode: null } : {}),
              ...(reset ? { roomId: null, joinedSeat: null, view: null, deadlineAt: null, nextRoundAt: null, acked: false } : {}),
            }));
          } else {
            // connecting / reconnecting: 보낸 행동의 결과는 알 수 없다 (재접속 뒤 새 view로 판단)
            clearAckTimer();
            inFlightRef.current = false;
            ackedRef.current = false;
            patch({
              conn: e.status,
              closeReason: null,
              inFlight: false,
              acked: false,
              ...(e.status === "connecting" ? { retry: null } : {}),
            });
          }
          return;
        }
        case "joined":
          clearJoinTimer();
          // 재접속(rejoin)하면 서버가 자동 모드를 해제한다
          clearNoticeTimer();
          roomRef.current = e.roomId;
          patch({
            roomId: e.roomId,
            joinedSeat: e.seat as Seat,
            joining: false,
            error: null,
            errorCode: null,
            notice: null,
            retry: null,
          });
          return;
        case "retry":
          patch({ retry: { attempt: e.attempt, max: e.max, delayMs: e.delayMs, nextAt: e.nextAt } });
          return;
        case "view":
          clearAckTimer();
          viewRef.current = e.view;
          inFlightRef.current = false;
          ackedRef.current = false;
          patch((prev) => ({
            view: e.view,
            deadlineAt: e.deadlineAt ?? null,
            // 국 종료 view 수신 시각 기준 추정. 같은 국 종료 view가 다시 오면(재접속) 처음 추정을 유지한다
            nextRoundAt:
              e.view.phase !== "roundEnd"
                ? null
                : prev.view?.phase === "roundEnd" && prev.nextRoundAt !== null
                  ? prev.nextRoundAt
                  : e.receivedAt + NEXT_ROUND_ESTIMATE_MS,
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
            // 구간 종료 view가 올 때까지 다시 기다린다
            startAckTimerRef.current();
            patch({ inFlight: false, acked: true });
          }
          return;
        case "notice":
          clearNoticeTimer();
          // timeout은 잠시 뒤 사라지고, auto_mode는 사용자가 행동하거나 재접속할 때까지 유지한다
          if (e.code === "timeout") {
            noticeTimerRef.current = timers.setTimeout(() => {
              noticeTimerRef.current = null;
              patch((prev) => (prev.notice === "timeout" ? { notice: null } : {}));
            }, optionsRef.current.noticeTimeoutMs ?? NOTICE_TIMEOUT_MS);
          }
          patch({ notice: e.code });
          return;
        case "error":
          clearJoinTimer();
          clearAckTimer();
          inFlightRef.current = false;
          // 타이머를 지웠으므로 acked도 풀어야 view가 영영 안 와도 조작 불가로 남지 않는다
          ackedRef.current = false;
          patch({ error: e.message, errorCode: e.code, inFlight: false, acked: false, joining: false });
          return;
      }
    });

    if (o.resumeStored !== false) client.resumeStored();

    return () => {
      unsubscribe();
      clearJoinTimer();
      clearAckTimer();
      clearNoticeTimer();
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
        patch({ error: LOCAL_TEXT.notYourTurn, errorCode: null });
        return;
      }
      const clientAction = clientActionFromView(v, action);
      if (clientAction === null) {
        patch({ error: LOCAL_TEXT.illegalAction, errorCode: "illegal_action" });
        return;
      }
      const r = client.action(clientAction);
      if (!r.ok) {
        patch({ error: LOCAL_TEXT.actionNotSent, errorCode: null });
        return;
      }
      inFlightRef.current = true;
      clearNoticeTimerRef.current();
      startAckTimerRef.current();
      setRiichiMode(false);
      patch({ inFlight: true, acked: false, notice: null, error: null, errorCode: null });
    },
    [patch],
  );

  const requestJoin = useCallback(
    (intent: JoinIntent): void => {
      const client = clientRef.current;
      if (!client) return;
      if (roomRef.current !== null) {
        patch({ error: LOCAL_TEXT.alreadyInRoom, errorCode: null });
        return;
      }
      patch({ error: null, errorCode: null, joining: true });
      startJoinTimerRef.current();
      if (client.getStatus() === "connected") {
        const r = client.join(intent.name ?? optionsRef.current.name, intent.roomId);
        if (!r.ok) {
          clearJoinTimerRef.current();
          patch({ error: LOCAL_TEXT.joinNotSent, errorCode: null, joining: false });
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
    if (!client.start().ok) patch({ error: LOCAL_TEXT.startNotSent, errorCode: null });
  }, [patch]);
  const leave = useCallback(() => {
    clearJoinTimerRef.current();
    clearAckTimerRef.current();
    clearNoticeTimerRef.current();
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

  /** 닫힌 연결을 저장 세션으로 처음부터 다시 접속한다 (백오프·시도 횟수 초기화). 사용자가 버튼을 눌렀을 때만 호출된다 */
  const reconnect = useCallback((): void => {
    const client = clientRef.current;
    if (!client || client.getStatus() !== "closed") return;
    if (!client.resumeStored()) {
      patch({ error: LOCAL_TEXT.noSavedSession, errorCode: null, resumable: false });
      return;
    }
    patch({ error: null, errorCode: null });
  }, [patch]);

  /** 다른 서버 주소로 새로 입장하려 할 때 이전 서버의 저장 세션을 지운다. 지웠으면 true */
  const discardOtherServerSession = useCallback(
    (url: string): boolean => {
      const store = storeRef.current;
      if (!store || roomRef.current !== null) return false;
      // 저장 세션이 있고 이 주소로 이어갈 수 없는(다른 서버) 경우만 지운다
      if (store.load() === null || isResumable(store, url)) return false;
      store.clear();
      patch({ resumable: false });
      return true;
    },
    [patch],
  );

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
    ackState: s.inFlight ? "sending" : s.acked ? "accepted" : "none",
    riichiMode,
    toggleRiichi: () => setRiichiMode((m) => !m),
    roundOver,
    gameOver,
    summary,
    resultOpen: roundOver && !s.resultDismissed && !(gameOver && s.showFinal),
    showFinal: gameOver && s.showFinal,
    advanceResult,
    // 끊긴 동안·행동을 보낸 뒤에는 마감을 보이지 않는다 (마지막 view의 낡은 마감을 보이지 않기 위함)
    deadlineAt: s.conn === "connected" && !waitingAck ? s.deadlineAt : null,
    nextRoundAt: s.conn === "connected" && view?.phase === "roundEnd" ? s.nextRoundAt : null,
    clock: optionsRef.current.timers ?? defaultTimers,
    notice: s.notice,
    dismissNotice: () => {
      clearNoticeTimerRef.current();
      patch({ notice: null });
    },
    error: s.error,
    errorCode: s.errorCode,
    dismissError: () => patch({ error: null, errorCode: null }),
    log: [],
    roomId: s.roomId,
    joining: s.joining,
    closeReason: s.closeReason,
    connection: buildConnectionBanner({
      status: serverStatus(s, view, gameOver),
      closeReason: s.closeReason,
      inRoom: s.roomId !== null,
      retry: s.retry,
      resumable: s.resumable,
    }),
    reconnect,
    discardOtherServerSession,
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
