/**
 * WebSocket 메시지 프로토콜 (타입 + 런타임 검증)
 *
 * [좌석 규칙]
 * - 클라이언트는 좌석을 지정하지 않는다. 서버가 소켓에 묶인 좌석을 사용한다.
 * - 메시지 최상위의 seat 필드는 허용 목록에 없으므로 조용히 제거(무시)된다.
 * - action.action 안의 seat는 형식(0~3 정수)만 검증하고 결과에서는 항상 제거한다.
 *   (core의 legalActions 결과를 그대로 보내도 통과하게 하기 위함. 서버가 소켓 좌석을 주입해 비교)
 *
 * [검증 범위] 형식만 검사한다. Action의 합법성은 서버가 legalActions로 비교한다.
 */

import type { Action, NumberTile, Tile } from "@mahjong/core";
import type { SeatView } from "./view";

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

/** raw 메시지(문자열) 길이 상한 */
export const MAX_MESSAGE_LENGTH = 2048;
/** roomId / seatToken / name 문자열 길이 상한 */
export const MAX_ID_LENGTH = 64;
export const MAX_NAME_LENGTH = 32;
/** seq 상한 (안전 정수 범위 내) */
export const MAX_SEQ = Number.MAX_SAFE_INTEGER;

export const ERROR_CODES = [
  "bad_message",
  "not_your_turn",
  "illegal_action",
  "unknown_room",
  "bad_token",
  "room_full",
  "not_supported",
] as const;
export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ProtocolError {
  code: ErrorCode;
  message: string;
}

// ---------------------------------------------------------------------------
// 메시지 타입
// ---------------------------------------------------------------------------

/** 클라이언트가 보내는 행동: core Action에서 seat를 뺀 형태 (seat는 서버가 주입) */
export type ClientAction = Action extends infer A ? (A extends unknown ? Omit<A, "seat"> : never) : never;

export type ClientMessage =
  | { type: "join"; roomId?: string; name?: string }
  | { type: "rejoin"; roomId: string; seatToken: string }
  | { type: "action"; seq: number; action: ClientAction }
  | { type: "ping" };

/** view 메시지의 payload는 기본적으로 좌석별 뷰(SeatView) */
export type ServerMessage<V = SeatView> =
  | { type: "joined"; roomId: string; seat: number; seatToken: string }
  | { type: "view"; view: V }
  | { type: "error"; code: ErrorCode; message: string; seq?: number }
  | { type: "pong" };

export type ParseResult =
  | { ok: true; message: ClientMessage }
  | { ok: false; error: ProtocolError };

// ---------------------------------------------------------------------------
// 검증 유틸
// ---------------------------------------------------------------------------

/** 내부용: 검증 실패 시 throw, parseClientMessage에서 잡아 bad_message로 변환 */
class BadMessage extends Error {}

function fail(message: string): never {
  throw new BadMessage(message);
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function str(v: unknown, field: string, max: number): string {
  if (typeof v !== "string" || v.length === 0 || v.length > max) fail(`${field}: 1~${max}자 문자열이어야 합니다`);
  return v;
}

function optStr(v: unknown, field: string, max: number): string | undefined {
  return v === undefined ? undefined : str(v, field, max);
}

function seatNo(v: unknown, field: string): number {
  if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > 3) fail(`${field}: 0~3 정수여야 합니다`);
  return v;
}

const SUITS = ["man", "pin", "sou"] as const;
const WINDS = ["east", "south", "west", "north"] as const;
const DRAGONS = ["white", "green", "red"] as const;

function oneOf<T extends string>(v: unknown, list: readonly T[], field: string): T {
  if (typeof v !== "string" || !(list as readonly string[]).includes(v)) fail(`${field}: 허용되지 않는 값`);
  return v as T;
}

function parseTile(v: unknown, field: string): Tile {
  if (!isRecord(v)) fail(`${field}: 패 객체가 아닙니다`);
  if (v.kind === "number") {
    const suit = oneOf(v.suit, SUITS, `${field}.suit`);
    const rank = v.rank;
    if (typeof rank !== "number" || !Number.isInteger(rank) || rank < 1 || rank > 9) fail(`${field}.rank: 1~9 정수여야 합니다`);
    if (typeof v.isRedFive !== "boolean") fail(`${field}.isRedFive: boolean이어야 합니다`);
    if (v.isRedFive && rank !== 5) fail(`${field}: 적도라는 5만 가능합니다`);
    return { kind: "number", suit, rank: rank as NumberTile["rank"], isRedFive: v.isRedFive };
  }
  if (v.kind === "wind") return { kind: "wind", wind: oneOf(v.wind, WINDS, `${field}.wind`) };
  if (v.kind === "dragon") return { kind: "dragon", dragon: oneOf(v.dragon, DRAGONS, `${field}.dragon`) };
  return fail(`${field}.kind: 알 수 없는 패 종류`);
}

function parseTilePair(v: unknown, field: string): [Tile, Tile] {
  if (!Array.isArray(v) || v.length !== 2) fail(`${field}: 패 2장 배열이어야 합니다`);
  return [parseTile(v[0], `${field}[0]`), parseTile(v[1], `${field}[1]`)];
}

/** Action 형식 검증 + 허용 목록 정규화 (seat 제거) */
function parseAction(v: unknown): ClientAction {
  if (!isRecord(v)) fail("action: 객체가 아닙니다");
  // seat는 있으면 형식만 검증하고 결과에서는 제거
  if (v.seat !== undefined) seatNo(v.seat, "action.seat");
  switch (v.type) {
    case "discard": {
      if (v.riichi !== undefined && typeof v.riichi !== "boolean") fail("action.riichi: boolean이어야 합니다");
      const tile = parseTile(v.tile, "action.tile");
      return v.riichi === undefined ? { type: "discard", tile } : { type: "discard", tile, riichi: v.riichi };
    }
    case "ankan":
    case "shouminkan":
      return { type: v.type, tile: parseTile(v.tile, "action.tile") };
    case "chi":
    case "pon":
      return { type: v.type, use: parseTilePair(v.use, "action.use") };
    case "tsumo":
    case "kyuushu":
    case "ron":
    case "daiminkan":
    case "pass":
      return { type: v.type };
    default:
      return fail("action.type: 알 수 없는 행동");
  }
}

function parseMessage(v: unknown): ClientMessage {
  if (!isRecord(v)) fail("메시지는 객체여야 합니다");
  switch (v.type) {
    case "join": {
      const roomId = optStr(v.roomId, "roomId", MAX_ID_LENGTH);
      const name = optStr(v.name, "name", MAX_NAME_LENGTH);
      return {
        type: "join",
        ...(roomId !== undefined && { roomId }),
        ...(name !== undefined && { name }),
      };
    }
    case "rejoin":
      return {
        type: "rejoin",
        roomId: str(v.roomId, "roomId", MAX_ID_LENGTH),
        seatToken: str(v.seatToken, "seatToken", MAX_ID_LENGTH),
      };
    case "action": {
      const seq = v.seq;
      if (typeof seq !== "number" || !Number.isInteger(seq) || seq < 0 || seq > MAX_SEQ) fail("seq: 0 이상의 정수여야 합니다");
      return { type: "action", seq, action: parseAction(v.action) };
    }
    case "ping":
      return { type: "ping" };
    default:
      return fail("type: 알 수 없는 메시지");
  }
}

/**
 * 클라이언트 메시지 파싱/검증. 예외를 던지지 않는다.
 *
 * 규약: 소켓 입력은 반드시 문자열로 변환해 넘길 것 (ws의 message는 Buffer이므로 data.toString() 필요).
 * 객체 직접 전달은 테스트 편의용이며 문자열 길이 한도(MAX_MESSAGE_LENGTH)가 적용되지 않는다.
 */
export function parseClientMessage(raw: unknown): ParseResult {
  try {
    let value = raw;
    if (typeof raw === "string") {
      if (raw.length > MAX_MESSAGE_LENGTH) fail("메시지가 너무 큽니다");
      try {
        value = JSON.parse(raw);
      } catch {
        fail("JSON 파싱 실패");
      }
    }
    return { ok: true, message: parseMessage(value) };
  } catch (e) {
    const message = e instanceof BadMessage ? e.message : "잘못된 메시지";
    return { ok: false, error: { code: "bad_message", message } };
  }
}
