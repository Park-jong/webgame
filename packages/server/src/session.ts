/**
 * 연결 단위 메시지 처리 (전송 계층과 무관: 문자열/바이너리 여부만 받는다)
 * S-8(rejoin)은 dispatch의 해당 케이스만 채우면 된다.
 *
 * 남용 방어
 * - 위반 점수: 위반 +1, 유효 메시지 -1(감쇠). 한도 초과 시 종료 (ping 1 + 위반 5 반복 우회 방지)
 * - 식별 실패(unknown_room/bad_token) 누적: 방 ID 열거 방어. 한도 초과 시 종료
 * - 토큰 버킷: 초당 N개, 버스트 M개 초과 시 종료
 * - 게임 오류(illegal_action/not_your_turn/bad_seq): 위반 점수 +2 (유효 메시지 감쇠 -1과 합쳐 순증 +1).
 *   정상 클라이언트의 경합(차례 직후 전송 등)은 허용하되 불법 행동 반복은 종료
 * - 참가 제한 시간: 연결 후 일정 시간 안에 join/rejoin 시도가 없으면 종료
 */

import { GameError } from "./game-session";
import { parseClientMessage, type ClientMessage, type ErrorCode } from "./protocol";
import { RoomError, type Connection, type RoomManager } from "./room";

/** 위반 점수가 이 값을 넘으면 연결을 종료한다 */
export const MAX_CONSECUTIVE_VIOLATIONS = 5;
/** 식별 실패(unknown_room 등) 누적이 이 값을 넘으면 종료 */
export const MAX_IDENTIFY_FAILURES = 5;
export const RATE_PER_SECOND = 20;
export const RATE_BURST = 40;
export const JOIN_TIMEOUT_MS = 10_000;

export interface SessionOptions {
  maxViolations?: number;
  maxIdentifyFailures?: number;
  ratePerSecond?: number;
  rateBurst?: number;
  joinTimeoutMs?: number;
  /** 시간 소스 주입(테스트용, ms) */
  now?: () => number;
}

export interface Session {
  /** 수신 프레임 처리. 바이너리 프레임은 null로 전달해 거부 */
  onMessage(data: string | null): void;
  onClose(): void;
}

export function createSession(manager: RoomManager, conn: Connection, options: SessionOptions = {}): Session {
  const maxViolations = options.maxViolations ?? MAX_CONSECUTIVE_VIOLATIONS;
  const maxFailures = options.maxIdentifyFailures ?? MAX_IDENTIFY_FAILURES;
  const perSecond = options.ratePerSecond ?? RATE_PER_SECOND;
  const burst = options.rateBurst ?? RATE_BURST;
  const now = options.now ?? Date.now;

  let violations = 0;
  let failures = 0;
  let dead = false;
  let tokens = burst;
  let last = now();

  const kill = (): void => {
    if (dead) return;
    dead = true;
    clearJoinTimer();
    conn.terminate();
  };

  let joinTimer: ReturnType<typeof setTimeout> | undefined = setTimeout(kill, options.joinTimeoutMs ?? JOIN_TIMEOUT_MS);
  joinTimer.unref?.();
  function clearJoinTimer(): void {
    if (joinTimer) clearTimeout(joinTimer);
    joinTimer = undefined;
  }

  const sendError = (code: ErrorCode, message: string, seq?: number): void =>
    conn.send({ type: "error", code, message, ...(seq !== undefined && { seq }) });

  /** 방에 앉은 연결의 좌석과 게임 (참가 전이면 bad_message) */
  const seated = (): { seat: number; game: ReturnType<RoomManager["gameOf"]> } => {
    const found = manager.find(conn);
    if (!found) throw new RoomError("bad_message", "방에 참가하지 않았습니다");
    return { seat: found.seat, game: manager.gameOf(found.room) };
  };

  const violation = (message: string): void => {
    sendError("bad_message", message);
    if (++violations > maxViolations) kill();
  };

  const takeToken = (): boolean => {
    const t = now();
    tokens = Math.min(burst, tokens + ((t - last) / 1000) * perSecond);
    last = t;
    if (tokens < 1) return false;
    tokens -= 1;
    return true;
  };

  const dispatch = (msg: ClientMessage): void => {
    switch (msg.type) {
      case "join": {
        clearJoinTimer();
        const result = manager.join(conn, msg.roomId, msg.name);
        conn.send({ type: "joined", ...result });
        return;
      }
      case "ping":
        conn.send({ type: "pong" });
        return;
      case "rejoin": // S-8에서 구현 (식별 실패 시 failures 증가 필요)
        clearJoinTimer();
        sendError("not_supported", "rejoin은 아직 지원하지 않습니다");
        return;
      case "start":
        manager.startGame(conn);
        return;
      case "action": {
        const { seat, game } = seated();
        try {
          if (!game) throw new GameError("game_not_started", "게임이 시작되지 않았습니다");
          game.handleAction(seat, msg.seq, msg.action);
        } catch (e) {
          if (e instanceof GameError) e.seq = msg.seq;
          throw e;
        }
        return;
      }
    }
  };

  return {
    onMessage(data) {
      if (dead) return;
      if (!takeToken()) return kill();
      if (data === null) return violation("바이너리 프레임은 지원하지 않습니다");
      const parsed = parseClientMessage(data);
      if (!parsed.ok) return violation(parsed.error.message);
      if (violations > 0) violations--;
      try {
        dispatch(parsed.message);
      } catch (e) {
        if (e instanceof GameError) {
          sendError(e.code, e.message, e.seq);
          if (e.code === "illegal_action" || e.code === "not_your_turn" || e.code === "bad_seq") {
            violations += 2;
            if (violations > maxViolations) kill();
          }
          return;
        }
        if (!(e instanceof RoomError)) throw e;
        sendError(e.code, e.message);
        if ((e.code === "unknown_room" || e.code === "bad_token") && ++failures > maxFailures) kill();
      }
    },
    onClose() {
      dead = true;
      clearJoinTimer();
      manager.disconnect(conn);
    },
  };
}
