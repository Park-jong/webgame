// 사용자에게 보이는 연결/오류/알림 문구의 단일 출처.
// 서버 오류 코드·close 사유·컨트롤러(로컬) 오류·notice 문구와 연결 배너 규칙을 한곳에 모아
// 컨트롤러·입장 화면·배너가 같은 매핑을 쓰게 한다.
import type { ErrorCode } from "../model/seatView";
import type { GameNotice, GameStatus } from "./types";
import type { CloseReason, CloseReasonCode } from "./wsClient";

// ---------------------------------------------------------------------------
// 서버 오류 코드
// ---------------------------------------------------------------------------

/**
 * 한글 문구가 있는 서버 오류 코드.
 * 여기에 없는 코드는 폴백 문구("요청을 처리하지 못했습니다 (코드: ...)")를 쓴다.
 */
export const ERROR_TEXT: Partial<Record<ErrorCode, string>> = {
  unknown_room: "해당 방을 찾을 수 없습니다. 방 ID를 확인해 주세요",
  room_full: "방이 가득 찼습니다. 다른 방에 입장해 주세요",
  bad_token: "저장된 좌석 정보가 올바르지 않아 이어서 접속할 수 없습니다",
  game_already_started: "이미 시작된 게임입니다",
  game_not_started: "아직 게임이 시작되지 않았습니다",
  bad_message: "요청을 처리하지 못했습니다. 잠시 후 다시 시도해 주세요",
  server_error: "서버 오류가 발생했습니다. 잠시 후 다시 시도해 주세요",
  not_your_turn: "지금은 행동할 차례가 아닙니다",
  illegal_action: "허용되지 않는 행동입니다",
  bad_seq: "서버와 요청 순서가 맞지 않았습니다. 다시 시도해 주세요",
};

/** 의도적으로 매핑하지 않고 폴백 문구를 쓰는 코드 (서버가 보내는 경로가 없는 예약 코드) */
export const INTENTIONAL_FALLBACK_CODES: readonly ErrorCode[] = ["not_supported"];

export function fallbackErrorText(code: ErrorCode): string {
  return `요청을 처리하지 못했습니다 (코드: ${code})`;
}

/** 서버 오류 코드를 한글 문구로 바꾼다. 코드가 없으면(로컬 문구) 원문을 그대로 쓴다 */
export function errorText(code: ErrorCode | null, fallback: string | null): string | null {
  if (fallback === null) return null;
  if (code === null) return fallback;
  return ERROR_TEXT[code] ?? fallbackErrorText(code);
}

// ---------------------------------------------------------------------------
// 컨트롤러(로컬) 오류 문구
// ---------------------------------------------------------------------------

export const LOCAL_TEXT = {
  notYourTurn: "지금은 행동할 차례가 아닙니다",
  illegalAction: "허용되지 않는 행동입니다",
  actionNotSent: "연결이 끊겨 행동을 보내지 못했습니다",
  startNotSent: "연결이 끊겨 시작 요청을 보내지 못했습니다",
  joinNotSent: "서버에 입장 요청을 보내지 못했습니다",
  alreadyInRoom: "이미 방에 입장해 있습니다",
  /** join 응답 대기 만료 */
  joinTimeout: "서버 응답이 없습니다. 다시 시도해 주세요",
  /** 행동 후 ack/view 대기 만료 */
  responseTimeout: "서버 응답이 없습니다. 다시 시도해 주세요",
  /** 저장 세션으로 다시 들어가려 했는데 방이 없음 (서버 재기동 등) */
  roomGone: "방이 사라졌습니다. 서버가 다시 시작되었거나 방이 닫혔을 수 있습니다.",
  noSavedSession: "저장된 접속 정보가 없어 다시 연결할 수 없습니다",
} as const;

// ---------------------------------------------------------------------------
// notice
// ---------------------------------------------------------------------------

export const NOTICE_TEXT: Record<GameNotice, string> = {
  timeout: "시간 초과로 자동 처리되었습니다.",
  auto_mode: "연속 시간 초과로 자동 진행 중입니다. 아무 행동이나 하면 해제됩니다.",
};

// ---------------------------------------------------------------------------
// close 사유
// ---------------------------------------------------------------------------

export interface CloseText {
  title: string;
  detail: string;
}

/** 모든 close 사유의 한글 문구 (배너 표시 여부는 buildConnectionBanner가 정한다) */
export const CLOSE_REASON_TEXT: Record<CloseReasonCode, CloseText> = {
  user: { title: "연결을 닫았습니다", detail: "" },
  displaced: {
    title: "다른 곳에서 접속해 이 연결이 종료되었습니다",
    detail:
      "같은 좌석으로 다른 탭이나 기기가 접속하면 이 화면은 밀려납니다 (서버 규칙 위반으로 닫힌 경우도 같은 안내가 나옵니다). " +
      "여기서 다시 접속하면 반대쪽이 밀려나고, 두 곳에서 번갈아 접속하면 서로 계속 밀어내므로 한 곳만 사용해 주세요.",
  },
  unknown_room: { title: ERROR_TEXT.unknown_room ?? "", detail: "" },
  bad_token: { title: ERROR_TEXT.bad_token ?? "", detail: "" },
  room_full: { title: ERROR_TEXT.room_full ?? "", detail: "" },
  connection_failed: {
    title: "서버에 연결하지 못했습니다",
    detail: "서버 주소와 네트워크 상태를 확인해 주세요.",
  },
  retries_exhausted: {
    title: "서버에 다시 접속하지 못했습니다",
    detail: "자동 재접속을 모두 시도했지만 실패했습니다. 네트워크와 서버 상태를 확인한 뒤 다시 연결해 보세요.",
  },
  rejoin_timeout: {
    title: "서버 응답이 없어 다시 접속하지 못했습니다",
    detail: "재접속 요청에 서버가 응답하지 않았습니다. 잠시 후 다시 연결해 보세요.",
  },
};

/** 복구할 수 없어 입장 화면(오류 문구)으로 돌아가는 사유: 배너를 쓰지 않는다 */
const ERROR_ALERT_REASONS: readonly CloseReasonCode[] = ["user", "unknown_room", "bad_token", "room_full"];

/** '다시 연결' 버튼을 제공하는 사유 (저장 세션이 있을 때만) */
const RETRY_REASONS: readonly CloseReasonCode[] = ["retries_exhausted", "rejoin_timeout", "connection_failed"];

// ---------------------------------------------------------------------------
// 연결 배너
// ---------------------------------------------------------------------------

export interface ConnectionBanner {
  kind: "reconnecting" | "closed";
  title: string;
  detail: string;
  /** 사용자가 명시적으로 누르는 버튼. 없으면 안내만 */
  action: { kind: "retry" | "takeover"; label: string } | null;
  /** 재접속 대기 중이면 다음 시도 정보 (배너가 남은 초를 카운트다운한다). 없으면 detail만 표시 */
  retry: { attempt: number; max: number; at: number } | null;
}

export interface RetryInfo {
  /** 곧 시도할(또는 진행 중인) 재접속 번호 (1부터) */
  attempt: number;
  max: number;
  /** 이번 시도까지의 대기 ms */
  delayMs: number;
  /** 다음 시도 절대 시각 (wsClient 시계 기준). 없으면 카운트다운 없이 정적 문구만 */
  nextAt?: number;
}

export interface BannerInput {
  status: GameStatus;
  closeReason: CloseReason | null;
  /** 컨트롤러가 가공한 값: 방에 앉아 있는지 */
  inRoom: boolean;
  retry: RetryInfo | null;
  /** 저장소에 이 서버의 저장 세션이 있어 rejoin을 다시 시도할 수 있는지 */
  resumable: boolean;
}

/**
 * 상태별 배너 규칙 (표는 agent-summaries/20-1 문서)
 * - reconnecting/connecting은 방에 앉은 경우에만 (방 없음이면 입장 화면이 '접속 중' 안내를 보여 준다)
 * - closed는 사유별 안내. user/unknown_room/bad_token/room_full은 입장 화면의 오류 문구가 대신한다
 */
export function buildConnectionBanner(input: BannerInput): ConnectionBanner | null {
  const { status, closeReason, inRoom, retry, resumable } = input;
  if ((status === "reconnecting" || status === "connecting") && inRoom) {
    const detail =
      status === "reconnecting" && retry !== null
        ? `재접속 시도 ${retry.attempt}/${retry.max}회 (약 ${Math.max(1, Math.ceil(retry.delayMs / 1000))}초 뒤 시도). 화면은 마지막 상태로 유지됩니다.`
        : "잠시만 기다려 주세요. 화면은 마지막 상태로 유지됩니다.";
    const live = status === "reconnecting" && retry !== null && retry.nextAt !== undefined;
    return {
      kind: "reconnecting",
      title: "연결이 끊겨 다시 접속하는 중입니다",
      detail,
      action: null,
      retry: live ? { attempt: retry.attempt, max: retry.max, at: retry.nextAt as number } : null,
    };
  }
  if (status !== "closed" || closeReason === null) return null;
  const code = closeReason.code;
  if (ERROR_ALERT_REASONS.includes(code)) return null;
  const text = CLOSE_REASON_TEXT[code];
  let action: ConnectionBanner["action"] = null;
  if (resumable) {
    if (code === "displaced") action = { kind: "takeover", label: "여기서 다시 접속" };
    else if (RETRY_REASONS.includes(code)) action = { kind: "retry", label: "다시 연결" };
  }
  return { kind: "closed", title: text.title, detail: text.detail, action, retry: null };
}

// ---------------------------------------------------------------------------
// 서버 주소 전환
// ---------------------------------------------------------------------------

export const SERVER_SWITCH_NOTE =
  "서버 주소가 바뀌어 이전 서버의 저장된 접속 정보를 지웠습니다. 이전 방으로는 이어서 접속할 수 없습니다.";

/** 헤더 연결 상태 문구 */
export const STATUS_LABEL: Record<GameStatus, string> = {
  idle: "입장 전",
  connecting: "연결 중",
  reconnecting: "재접속 중",
  waiting: "대기",
  playing: "진행 중",
  ended: "게임 종료",
  closed: "연결 끊김",
};

// ---------------------------------------------------------------------------
// 마감·결과·응답 진행 문구
// ---------------------------------------------------------------------------

/** 이 초 이하로 남으면 마감 표시를 강조한다 */
export const URGENT_SECONDS = 10;

/**
 * 국 종료 후 서버가 다음 국을 자동 시작하기까지의 추정 ms.
 * 서버 기본값(nextRoundDelayMs 5000)이며 서버 옵션으로 바뀔 수 있으나 클라이언트는 알 수 없어 '약'으로 표시한다.
 */
export const NEXT_ROUND_ESTIMATE_MS = 5_000;

export const CLOCK_TEXT = {
  label: "남은 시간",
  unit: "초",
  urgent: "곧 마감",
  expired: "시간 종료 · 처리 중…",
} as const;

/**
 * 내 행동의 진행 표시. 어느 쪽도 다른 좌석의 응답 여부·대기 여부를 암시하지 않는 중립 문구다
 * (서버는 누가 응답 대기 중인지 숨긴다).
 */
export const ACK_TEXT = {
  sending: "처리 중…",
  accepted: "응답이 접수되었습니다 · 결과를 기다리는 중…",
} as const;

export const NEXT_ROUND_TEXT = {
  countdown: (seconds: number): string => `다음 국 약 ${seconds}초 후 자동 시작`,
  waiting: "다음 국을 기다리는 중…",
  /** 연결이 끊긴 동안: 카운트다운을 멈추고 연결 배너를 보라고 안내 */
  offline: "연결을 확인하는 중… 연결이 복구되면 다음 국이 이어집니다",
  close: "결과 닫기",
} as const;

export const RETRY_TEXT = {
  countdown: (attempt: number, max: number, seconds: number): string =>
    `재접속 시도 ${attempt}/${max}회 · 다음 시도까지 ${seconds}초. 화면은 마지막 상태로 유지됩니다.`,
  trying: (attempt: number, max: number): string =>
    `재접속 시도 ${attempt}/${max}회 · 지금 다시 접속하는 중… 화면은 마지막 상태로 유지됩니다.`,
};
