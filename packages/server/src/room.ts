/**
 * 방(room) 세션 관리 — 전송 계층(WebSocket)과 무관한 순수 로직
 *
 * - 연결은 Connection 인터페이스로만 접근한다.
 * - 난수는 주입 가능(기본: crypto.randomBytes). 비암호학적 난수는 사용하지 않는다.
 * - 게임 시작/진행은 S-5, 재접속(rejoin)은 S-8에서 이 위에 얹었다.
 */

import { randomBytes, timingSafeEqual } from "node:crypto";
import { GameError, GameSession, type GameSessionOptions } from "./game-session";
import type { ErrorCode, ServerMessage } from "./protocol";

// ---------------------------------------------------------------------------
// 상수
// ---------------------------------------------------------------------------

export const SEAT_COUNT = 4;
/** 동시에 존재할 수 있는 방 수 상한 */
export const MAX_ROOMS = 1000;
/** 방당 동시 연결 수 상한 (좌석 수와 같음) */
export const MAX_CONNECTIONS_PER_ROOM = SEAT_COUNT;
/** 연결된 사람이 없는 방을 삭제하기까지의 시간 */
export const EMPTY_ROOM_TTL_MS = 5 * 60 * 1000;

/** 방 코드: 32자 알파벳 (5비트 → 바이트 & 31 이 편향 없음). 0/O, 1/I/L, - 같은 혼동 문자 제외 */
const ROOM_ID_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ_";
export const ROOM_ID_LENGTH = 8;
/** 고유 id/토큰 재생성 루프 상한 */
const MAX_GENERATE_TRIES = 100;
/** 좌석 토큰: 24바이트(192비트) → base64url 32자 */
export const SEAT_TOKEN_BYTES = 24;
export const SEAT_TOKEN_LENGTH = 32;

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

/** 전송 계층 추상화 */
export interface Connection {
  send(msg: ServerMessage): void;
  close(): void;
  /** 즉시/강제 종료 (위반 연결용) */
  terminate(): void;
}

export type RandomBytesFn = (size: number) => Uint8Array;

export type SeatSlot =
  | { kind: "empty" }
  | { kind: "bot" }
  | { kind: "human"; connected: boolean; name?: string; conn?: Connection };

export interface JoinResult {
  roomId: string;
  seat: number;
  seatToken: string;
}

/** 방 로직 오류: 전송 계층이 error 메시지로 변환한다 */
export class RoomError extends Error {
  readonly code: ErrorCode;
  constructor(code: ErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

// ---------------------------------------------------------------------------
// 생성기 / 토큰 비교
// ---------------------------------------------------------------------------

export function generateRoomId(random: RandomBytesFn = randomBytes): string {
  const bytes = random(ROOM_ID_LENGTH);
  let id = "";
  for (let i = 0; i < ROOM_ID_LENGTH; i++) id += ROOM_ID_ALPHABET[bytes[i]! & 31];
  return id;
}

export function generateSeatToken(random: RandomBytesFn = randomBytes): string {
  return Buffer.from(random(SEAT_TOKEN_BYTES)).toString("base64url");
}

/** 타이밍 안전 비교. 길이가 다르면 먼저 거부 */
export function tokenEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a, "utf8");
  const bb = Buffer.from(b, "utf8");
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

// ---------------------------------------------------------------------------
// Room
// ---------------------------------------------------------------------------

export class Room {
  readonly seats: SeatSlot[] = Array.from({ length: SEAT_COUNT }, (): SeatSlot => ({ kind: "empty" }));
  /** 좌석 토큰은 슬롯과 분리해 직렬화/로그에 새지 않게 한다 */
  readonly #tokens: (string | undefined)[] = [];

  constructor(
    readonly id: string,
    private readonly newToken: () => string,
  ) {}

  /** 빈 좌석 중 가장 낮은 번호에 앉힌다. 가득 차면 room_full */
  join(conn: Connection, name?: string): JoinResult {
    if (this.connectedCount() >= MAX_CONNECTIONS_PER_ROOM) throw new RoomError("room_full", "방이 가득 찼습니다");
    const seat = this.seats.findIndex((s) => s.kind === "empty");
    if (seat < 0) throw new RoomError("room_full", "방이 가득 찼습니다");
    let token = this.newToken();
    for (let i = 0; this.#tokens.includes(token); i++) {
      if (i >= MAX_GENERATE_TRIES) throw new Error("좌석 토큰 생성 실패");
      token = this.newToken();
    }
    this.#tokens[seat] = token;
    this.seats[seat] = { kind: "human", connected: true, conn, ...(name !== undefined && { name }) };
    return { roomId: this.id, seat, seatToken: token };
  }

  /** 빈 좌석을 모두 봇으로 채운다. 바뀐 좌석 번호를 반환 */
  fillBots(): number[] {
    const filled: number[] = [];
    this.seats.forEach((s, i) => {
      if (s.kind === "empty") {
        this.seats[i] = { kind: "bot" };
        filled.push(i);
      }
    });
    return filled;
  }

  /**
   * 토큰으로 좌석을 찾아 연결을 새 연결로 교체한다(connected=true). 불일치면 bad_token.
   * 모든 좌석을 끝까지 비교해 어느 좌석에서 일치했는지가 소요 시간으로 드러나지 않게 한다.
   * 교체 전의 연결을 previous로 돌려준다(호출자가 정리). 토큰은 바꾸지 않는다.
   */
  rejoin(conn: Connection, token: string): { seat: number; previous?: Connection } {
    let seat = -1;
    for (let i = 0; i < this.seats.length; i++) if (this.verifyToken(i, token)) seat = i;
    if (seat < 0) throw new RoomError("bad_token", "좌석 토큰이 올바르지 않습니다");
    const slot = this.seats[seat] as Extract<SeatSlot, { kind: "human" }>;
    const previous = slot.conn;
    slot.conn = conn;
    slot.connected = true;
    return previous ? { seat, previous } : { seat };
  }

  /** 연결 끊김: 좌석은 human으로 유지하고 connected:false (봇 전환은 하지 않는다) */
  disconnect(conn: Connection): number | undefined {
    const seat = this.seatOf(conn);
    if (seat === undefined) return undefined;
    const slot = this.seats[seat] as Extract<SeatSlot, { kind: "human" }>;
    slot.connected = false;
    delete slot.conn;
    return seat;
  }

  seatOf(conn: Connection): number | undefined {
    const i = this.seats.findIndex((s) => s.kind === "human" && s.conn === conn);
    return i < 0 ? undefined : i;
  }

  /** 좌석 토큰 검증 (S-8 rejoin에서 사용) */
  verifyToken(seat: number, token: string): boolean {
    const slot = this.seats[seat];
    const expected = this.#tokens[seat];
    return slot?.kind === "human" && expected !== undefined && tokenEquals(expected, token);
  }

  connectedCount(): number {
    return this.seats.filter((s) => s.kind === "human" && s.connected).length;
  }

  /** 직렬화 시 토큰과 연결 객체를 제외한다 */
  toJSON(): unknown {
    return { id: this.id, seats: this.seats.map((s) => (s.kind === "human" ? { kind: s.kind, connected: s.connected } : { kind: s.kind })) };
  }

  /** 연결된 모든 사람에게 전송 */
  broadcast(msg: ServerMessage): void {
    for (const s of this.seats) if (s.kind === "human" && s.conn) s.conn.send(msg);
  }
}

// ---------------------------------------------------------------------------
// RoomManager
// ---------------------------------------------------------------------------

export interface RoomManagerOptions {
  maxRooms?: number;
  emptyRoomTtlMs?: number;
  /** 난수 소스 주입(테스트용). 기본 crypto.randomBytes */
  randomBytes?: RandomBytesFn;
  /** 게임 루프 옵션(RNG·스케줄러·지연 주입) */
  game?: GameSessionOptions;
}

export class RoomManager {
  private readonly rooms = new Map<string, Room>();
  private readonly byConn = new Map<Connection, Room>();
  private readonly games = new Map<string, GameSession>();
  private readonly timers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly maxRooms: number;
  private readonly ttl: number;
  private readonly random: RandomBytesFn;
  private readonly gameOptions: GameSessionOptions | undefined;
  private closed = false;

  constructor(options: RoomManagerOptions = {}) {
    this.maxRooms = options.maxRooms ?? MAX_ROOMS;
    this.ttl = options.emptyRoomTtlMs ?? EMPTY_ROOM_TTL_MS;
    this.random = options.randomBytes ?? randomBytes;
    this.gameOptions = options.game;
  }

  /** 방의 게임 세션 (시작 전이면 undefined) */
  gameOf(room: Room): GameSession | undefined {
    return this.games.get(room.id);
  }

  /** 연결이 앉은 방에서 게임 시작: 빈 좌석을 봇으로 채운다 */
  startGame(conn: Connection): void {
    const found = this.find(conn);
    if (!found) throw new RoomError("bad_message", "방에 참가하지 않았습니다");
    if (this.games.has(found.room.id)) throw new GameError("game_already_started", "이미 게임이 시작되었습니다");
    const game = new GameSession(found.room, this.gameOptions);
    this.games.set(found.room.id, game);
    try {
      game.start();
    } catch (e) {
      this.games.delete(found.room.id);
      game.close();
      throw e;
    }
  }

  get roomCount(): number {
    return this.rooms.size;
  }

  getRoom(roomId: string): Room | undefined {
    return this.rooms.get(roomId);
  }

  /** 연결이 앉아 있는 방과 좌석 */
  find(conn: Connection): { room: Room; seat: number } | undefined {
    const room = this.byConn.get(conn);
    const seat = room?.seatOf(conn);
    return room && seat !== undefined ? { room, seat } : undefined;
  }

  /** roomId가 없으면 새 방 생성. 실패 시 RoomError */
  join(conn: Connection, roomId?: string, name?: string): JoinResult {
    if (this.closed) throw new RoomError("unknown_room", "서버가 종료되었습니다");
    if (this.byConn.has(conn)) throw new RoomError("bad_message", "이미 방에 참가했습니다");
    let room: Room;
    let created = false;
    if (roomId === undefined) {
      if (this.rooms.size >= this.maxRooms) throw new RoomError("room_full", "서버의 방 수가 한도에 도달했습니다");
      room = new Room(this.uniqueRoomId(), () => generateSeatToken(this.random));
      created = true;
    } else {
      const found = this.rooms.get(roomId);
      if (!found) throw new RoomError("unknown_room", "존재하지 않는 방입니다");
      room = found;
    }
    const result = room.join(conn, name);
    if (created) this.rooms.set(room.id, room);
    this.byConn.set(conn, room);
    this.cancelTimer(room.id);
    return result;
  }

  /**
   * 재접속: roomId + 좌석 토큰으로 좌석의 연결을 새 연결로 교체한다.
   * 슬롯(connected=true) 복구까지만 하고, 게임 훅(seatReconnected)과 뷰 전송은 호출자가 joined 응답 뒤에 한다.
   * 교체된 이전 연결은 byConn에서 먼저 지운 뒤 종료하므로 이전 연결의 지연 close/메시지가 새 연결 상태에 영향을 주지 못한다.
   */
  rejoin(conn: Connection, roomId: string, seatToken: string): { roomId: string; seat: number; wasConnected: boolean } {
    if (this.closed) throw new RoomError("unknown_room", "서버가 종료되었습니다");
    if (this.byConn.has(conn)) throw new RoomError("bad_message", "이미 방에 참가했습니다");
    const room = this.rooms.get(roomId);
    if (!room) throw new RoomError("unknown_room", "존재하지 않는 방입니다");
    const { seat, previous } = room.rejoin(conn, seatToken);
    if (previous) this.byConn.delete(previous);
    this.byConn.set(conn, room);
    this.cancelTimer(room.id);
    previous?.terminate();
    return { roomId: room.id, seat, wasConnected: previous !== undefined };
  }

  /** 테스트용 읽기 전용: 연결->방 매핑 크기 (누수 검증) */
  get connectionCount(): number {
    return this.byConn.size;
  }

  /** 연결 종료 처리. 모두 끊긴 방은 게임을 일시정지하고 지연 삭제 예약 */
  disconnect(conn: Connection): void {
    const room = this.byConn.get(conn);
    if (!room) return; // 이미 교체/정리된 연결(지연 close 포함)
    this.byConn.delete(conn);
    const seat = room.disconnect(conn);
    const game = this.games.get(room.id);
    if (room.connectedCount() === 0) {
      game?.pause();
      this.scheduleDelete(room.id);
    } else if (seat !== undefined) {
      game?.onSeatDisconnected(seat);
    }
  }

  /** 좌석이 돌아왔음을 게임에 알린다 (rejoin이 슬롯 복구 후 호출. 자동 모드 해제, 일시정지면 재개) */
  seatReconnected(room: Room, seat: number, wasConnected = false): void {
    this.games.get(room.id)?.onSeatReconnected(seat, wasConnected);
  }

  /** 모든 타이머 정리 */
  close(): void {
    this.closed = true;
    for (const t of this.timers.values()) clearTimeout(t);
    this.timers.clear();
    for (const g of this.games.values()) g.close();
    this.games.clear();
  }

  private uniqueRoomId(): string {
    for (let i = 0; i < MAX_GENERATE_TRIES; i++) {
      const id = generateRoomId(this.random);
      if (!this.rooms.has(id)) return id;
    }
    throw new Error("방 id 생성 실패");
  }

  private scheduleDelete(roomId: string): void {
    if (this.closed) return;
    this.cancelTimer(roomId);
    const t = setTimeout(() => {
      this.timers.delete(roomId);
      const room = this.rooms.get(roomId);
      if (room && room.connectedCount() === 0) {
        this.rooms.delete(roomId);
        this.games.get(roomId)?.close();
        this.games.delete(roomId);
      }
    }, this.ttl);
    t.unref?.();
    this.timers.set(roomId, t);
  }

  private cancelTimer(roomId: string): void {
    const t = this.timers.get(roomId);
    if (t) clearTimeout(t);
    this.timers.delete(roomId);
  }
}
