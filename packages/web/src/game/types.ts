// 로컬/서버 게임이 UI에 제공하는 공통 컨트롤러 인터페이스.
// UI는 view(SeatView)와 이 인터페이스만 읽는다. core GameState는 로컬 구현 내부에만 존재한다.
import type { Action, Seat } from "@mahjong/core";
import type { RoundSummary } from "../controller";
import type { CloseReason } from "./wsClient";
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

  /** 행동 마감 절대 시각(ms, Date.now 기준). 서버 모드에서 내 행동 차례일 때만 */
  deadlineAt: number | null;
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
  /** 새 방을 만들고 입장한다 (join에 roomId 없음) */
  create: (name?: string) => void;
  /** 방 ID로 입장한다 */
  join: (roomId: string, name?: string) => void;
  /** 게임을 시작한다 (빈 좌석은 봇) */
  start: () => void;
  /** 방에서 나간다: 연결을 닫고 저장된 세션을 지운다 */
  leave: () => void;
}
