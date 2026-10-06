// 로컬/서버 게임이 UI에 제공하는 공통 컨트롤러 인터페이스.
// UI는 view(SeatView)와 이 인터페이스만 읽는다. core GameState는 로컬 구현 내부에만 존재한다.
import type { Action, Seat } from "@mahjong/core";
import type { RoundSummary } from "../controller";
import type { ConnectionBanner } from "./messages";
import type { CloseReason, Timers } from "./wsClient";
import type { ErrorCode, SeatView } from "../model/seatView";

/**
 * - idle: 방/게임에 들어가지 않은 상태 (서버 모드의 입장 전, 사용자가 나간 뒤)
 * - connecting: 서버에 연결 중 (입장 요청 대기 포함)
 * - reconnecting: 끊겨서 재접속 중 (마지막 view는 유지)
 * - waiting: 방에 앉았고 게임 시작 전 (view 없음)
 * - playing: 진행 중 (국 종료 결과 표시 구간 포함. roundOver로 구분)
 * - ended: 게임 종료 (view.phase === "gameEnd")
 * - closed: 연결이 닫힘 (사유는 error)
 */
export type GameStatus = "idle" | "connecting" | "reconnecting" | "waiting" | "playing" | "ended" | "closed";

export type GameNotice = "timeout" | "auto_mode";

/**
 * 내가 보낸 행동의 진행 표시 (서버 모드). 내 행동에만 근거하므로 다른 좌석의 상태를 드러내지 않는다.
 * - none: 표시 없음
 * - sending: 행동을 보냈고 ack/view를 기다리는 중
 * - accepted: 응답 구간 중 내 응답이 접수됨 (구간이 끝나 다음 view가 올 때까지)
 */
export type AckState = "none" | "sending" | "accepted";

export interface GameController {
  mode: "local" | "server";
  status: GameStatus;
  /** 내 좌석. 로컬은 항상 0, 서버는 배정된 좌석 (view가 없으면 입장 응답의 좌석, 그것도 없으면 0) */
  mySeat: Seat;
  /** 내 좌석 기준 뷰. 게임 시작 전에는 null */
  view: SeatView | null;
  /** 지금 내가 선택할 수 있는 합법 행동 (내 차례/응답 차례가 아니거나 응답 접수 후에는 빈 배열) */
  actions: readonly Action[];
  /** 행동을 낸다. 서버 모드는 view.legalActions와 대조해 합법일 때만 전송한다 */
  act: (action: Action) => void;
  /** 서버 모드: 행동을 보냈고 ack/view/오류를 기다리는 중이거나 ack를 받은 뒤 구간 종료를 기다리는 중 */
  waitingAck: boolean;
  /** 내 행동의 진행 표시 (로컬은 항상 none) */
  ackState: AckState;
  /** 리치 선언 모드 (UI 상태) */
  riichiMode: boolean;
  toggleRiichi: () => void;

  /** 국이 끝난 상태(roundEnd/gameEnd) */
  roundOver: boolean;
  /** 게임 종료 상태(phase gameEnd) */
  gameOver: boolean;
  /** 국 결과 요약 (roundOver일 때만) */
  summary: RoundSummary | null;
  /** 결과 모달을 보여야 하는지 */
  resultOpen: boolean;
  /** 최종 순위 화면을 보여야 하는지 */
  showFinal: boolean;
  /** 결과 모달의 확인 버튼 (로컬: 다음 국/최종 결과, 서버: 모달 닫기/최종 결과) */
  advanceResult: () => void;

  /**
   * 행동 마감 절대 시각(ms, clock.now 기준). 서버 모드에서 연결돼 있고 내가 행동해야 하며 아직 행동을 보내지 않았을 때만.
   * 자동 모드·응답 구간 중·마감 없음이면 null
   */
  deadlineAt: number | null;
  /**
   * 서버가 자동으로 다음 국을 시작하리라 추정되는 절대 시각 (서버 모드, 국 종료 view를 받은 시각 + NEXT_ROUND_ESTIMATE_MS).
   * 국 종료 상태가 아니거나 연결이 끊겼으면 null. 서버 설정값을 모르므로 추정치다
   */
  nextRoundAt: number | null;
  /** 카운트다운이 쓰는 시계 (테스트에서 가짜 타이머 주입). 로컬은 기본 타이머 */
  clock: Timers;
  notice: GameNotice | null;
  dismissNotice: () => void;
  /** 사용자에게 보일 오류/연결 종료 사유 */
  error: string | null;
  /** 서버 오류 코드 (서버 모드) */
  errorCode: ErrorCode | null;
  dismissError: () => void;
  /** 행동 로그 (서버 모드는 비어 있음) */
  log: readonly string[];

  // --- 로컬 전용 (서버 모드에서는 undefined) ---
  seed?: number;
  seedInput?: string;
  setSeedInput?: (value: string) => void;
  /** 봇 지연 사용 여부 */
  botDelayOn?: boolean;
  setBotDelayOn?: (on: boolean) => void;
  nextRound?: () => void;
  newGame?: () => void;
}

/** 서버 모드 컨트롤러: 연결/방 조작이 추가된다 (UI는 W-7에서 만든다) */
export interface ServerGameController extends GameController {
  mode: "server";
  roomId: string | null;
  /** 입장 요청을 보냈고 joined를 기다리는 중 (이 구간에는 create/join을 다시 보내지 않는다) */
  joining: boolean;
  closeReason: CloseReason | null;
  /** 연결 상태 배너 (재접속 중/닫힘 사유별 안내와 사용자가 누를 버튼). 표시할 것이 없으면 null */
  connection: ConnectionBanner | null;
  /** 닫힌 연결을 저장 세션으로 처음부터 다시 접속한다 (배너의 '다시 연결'/'여기서 다시 접속'). 자동으로 호출되지 않는다 */
  reconnect: () => void;
  /** 저장된 세션이 url과 다른 서버의 것이면 지우고 true. 방에 있으면 아무것도 하지 않는다 */
  discardOtherServerSession: (url: string) => boolean;
  /** 새 방을 만들고 입장한다 (join에 roomId 없음) */
  create: (name?: string) => void;
  /** 방 ID로 입장한다 */
  join: (roomId: string, name?: string) => void;
  /** 게임을 시작한다 (빈 좌석은 봇) */
  start: () => void;
  /** 방에서 나간다: 연결을 닫고 저장된 세션을 지운다 */
  leave: () => void;
}
