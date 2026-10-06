// 입장 화면의 순수 로직: 입력 검증·정규화, 상태별 버튼 규칙, 한글 오류 문구.
// 화면은 컨트롤러가 가공한 status/roomId/joining만 보고 판단한다 (view를 직접 읽지 않는다).
import type { Seat } from "@mahjong/core";
import { STATUS_LABEL } from "./messages";
import type { GameStatus } from "./types";

export const MAX_NAME_LENGTH = 32;
export const MAX_ROOM_ID_LENGTH = 64;
export const DEFAULT_NAME = "플레이어";

export type Validation<T> = { ok: true; value: T } | { ok: false; message: string };

/** 이름: 앞뒤 공백 제거 후 1~32자 */
export function validateName(raw: string): Validation<string> {
  const v = raw.trim();
  if (v.length === 0) return { ok: false, message: "이름을 입력해 주세요 (1~32자)" };
  if (v.length > MAX_NAME_LENGTH) return { ok: false, message: `이름은 ${MAX_NAME_LENGTH}자 이하로 입력해 주세요` };
  return { ok: true, value: v };
}

/** 서버 주소: ws:// 또는 wss:// 로 시작하고 호스트가 있어야 한다 */
export function validateServerUrl(raw: string): Validation<string> {
  const v = raw.trim();
  if (!/^wss?:\/\//i.test(v)) return { ok: false, message: "서버 주소는 ws:// 또는 wss:// 로 시작해야 합니다" };
  try {
    const u = new URL(v);
    if ((u.protocol !== "ws:" && u.protocol !== "wss:") || u.hostname === "") throw new Error("host");
  } catch {
    return { ok: false, message: "서버 주소 형식이 올바르지 않습니다 (예: ws://localhost:8080)" };
  }
  return { ok: true, value: v };
}

/** 방 ID: 공백을 모두 제거하고 대문자로 바꾼다 */
export function normalizeRoomId(raw: string): string {
  return raw.replace(/\s+/g, "").toUpperCase();
}

export const ROOM_ID_HINT = "방 ID는 영문 대문자·숫자·밑줄(_)로 이뤄집니다 (대소문자·공백은 무시됩니다)";

export function validateRoomId(raw: string): Validation<string> {
  const v = normalizeRoomId(raw);
  if (v.length === 0) return { ok: false, message: "방 ID를 입력해 주세요" };
  if (v.length > MAX_ROOM_ID_LENGTH || !/^[A-Z0-9_]+$/.test(v)) {
    return { ok: false, message: "방 ID 형식이 올바르지 않습니다. 영문 대문자·숫자·밑줄(_)만 입력해 주세요" };
  }
  return { ok: true, value: v };
}

const WIND = ["동", "남", "서", "북"] as const;

/** 대기실의 내 좌석 표기: 좌석 번호(1~4)와 자풍 */
export function seatLabel(seat: Seat): string {
  return `좌석 ${seat + 1} (${WIND[seat]}가)`;
}

export type EntryScreen =
  /** 입장 폼 (연결/입장 요청 중이면 폼 전체 비활성) */
  | "entry"
  /** 대기실 */
  | "lobby"
  /** 대국 화면 */
  | "game"
  /** 재접속 중 (방에 남은 상태) */
  | "reconnecting"
  /** 연결이 끊겼고 방에 남은 상태: 나가기만 가능 */
  | "disconnected";

export interface EntryPlan {
  screen: EntryScreen;
  /** 방 만들기 / 방 ID로 입장 버튼 활성 */
  canCreate: boolean;
  canJoin: boolean;
  /** 시작 버튼 (대기실) */
  canStart: boolean;
  /** 나가기(또는 연결 중 취소) 버튼 활성 */
  canLeave: boolean;
  /** 연결 중 안내(이어서 접속 중/연결 중) 표시 */
  showConnecting: boolean;
  /** 헤더 연결 상태 문구 (방 없음 + closed는 '연결 끊김'이 아니라 '입장 전') */
  statusLabel: string;
}

/**
 * 상태별 버튼 규칙 (표는 agent-summaries/19-1 문서 참고)
 * - roomId는 컨트롤러가 가공한 값. joining은 입장 요청을 보냈고 joined를 기다리는 구간
 */
export function entryPlan(status: GameStatus, roomId: string | null, joining: boolean): EntryPlan {
  const plan = basePlan(status, roomId, joining);
  // 방에 앉지 않은 채 closed(unknown_room 복귀·연결 실패 등)면 입장 폼이 보이므로 '입장 전'으로 표시한다
  // 방에 앉은 채 연결 중(수동 다시 연결)이면 재접속 중으로 표시한다
  const key: GameStatus =
    status === "closed" && roomId === null ? "idle" : status === "connecting" && roomId !== null ? "reconnecting" : status;
  const statusLabel = STATUS_LABEL[key];
  return { ...plan, statusLabel };
}

function basePlan(status: GameStatus, roomId: string | null, joining: boolean): Omit<EntryPlan, "statusLabel"> {
  const base: Omit<EntryPlan, "statusLabel"> = {
    screen: "entry",
    canCreate: false,
    canJoin: false,
    canStart: false,
    canLeave: false,
    showConnecting: false,
  };
  switch (status) {
    case "idle":
      return { ...base, canCreate: !joining, canJoin: !joining, canLeave: joining, showConnecting: joining };
    case "connecting":
      // 방에 앉은 채 수동 '다시 연결' 중이면 대국 화면 위에 입장 폼을 띄우지 않는다
      if (roomId !== null) return { ...base, screen: "reconnecting", canLeave: true };
      // 자동 resume 중 포함: 방 만들기/입장은 항상 비활성 (resume과 입장 요청이 겹치면 서버가 bad_message를 낸다)
      return { ...base, canLeave: true, showConnecting: true };
    case "waiting":
      return { ...base, screen: "lobby", canStart: true, canLeave: true };
    case "playing":
    case "ended":
      return { ...base, screen: "game", canLeave: true };
    case "reconnecting":
      return roomId === null
        ? { ...base, canLeave: true, showConnecting: true }
        : { ...base, screen: "reconnecting", canLeave: true };
    case "closed":
      return roomId === null
        ? { ...base, canCreate: true, canJoin: true }
        : { ...base, screen: "disconnected", canLeave: true };
  }
}

// 오류 문구는 messages.ts가 단일 출처다 (기존 import 경로 호환용 재export)
export { errorText } from "./messages";
