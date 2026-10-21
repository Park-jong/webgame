import { describe, expect, it } from "vitest";
import { immediateScheduler } from "./game-session";
import { RoomManager } from "./room";
import { createSession } from "./session";
import { fakeConn, type FakeConn } from "./test-utils";

// 시작 전 대기실 착석 현황(lobby 메시지): 참가/퇴장 때 방 전원에게 방송되고, 시작 후에는 보내지 않는다.

const lobbies = (c: FakeConn) => c.sent.filter((m) => m.type === "lobby");
const lastLobby = (c: FakeConn) => lobbies(c).at(-1);

function sit(m: RoomManager, roomId?: string, name?: string) {
  const conn = fakeConn();
  const session = createSession(m, conn);
  session.onMessage(JSON.stringify({ type: "join", ...(roomId !== undefined && { roomId }), ...(name !== undefined && { name }) }));
  const joined = conn.sent.find((x) => x.type === "joined");
  if (!joined || joined.type !== "joined") throw new Error("입장 실패");
  return { conn, session, roomId: joined.roomId, seat: joined.seat, token: joined.seatToken };
}

describe("대기실 착석 현황", () => {
  it("입장하면 본인 joined 뒤에 현황을 받고, 기존 참가자도 갱신을 받는다", () => {
    const m = new RoomManager();
    const a = sit(m);
    expect(a.conn.sent.map((x) => x.type)).toEqual(["joined", "lobby"]);
    expect(lastLobby(a.conn)).toEqual({ type: "lobby", seats: ["human", "empty", "empty", "empty"], names: [null, null, null, null], host: 0 });
    const b = sit(m, a.roomId);
    expect(lastLobby(a.conn)).toEqual({ type: "lobby", seats: ["human", "human", "empty", "empty"], names: [null, null, null, null], host: 0 });
    expect(b.conn.sent.map((x) => x.type)).toEqual(["joined", "lobby"]);
    expect(lastLobby(b.conn)).toEqual({ type: "lobby", seats: ["human", "human", "empty", "empty"], names: [null, null, null, null], host: 0 });
    m.close();
  });

  it("시작 전에 나가면 좌석이 비고 남은 사람에게 알리며, 다음 사람이 그 자리에 앉는다", () => {
    const m = new RoomManager();
    const a = sit(m);
    const b = sit(m, a.roomId);
    const c = sit(m, a.roomId);
    b.session.onClose();
    expect(lastLobby(a.conn)).toEqual({ type: "lobby", seats: ["human", "empty", "human", "empty"], names: [null, null, null, null], host: 0 });
    expect(lastLobby(c.conn)).toEqual({ type: "lobby", seats: ["human", "empty", "human", "empty"], names: [null, null, null, null], host: 0 });
    const d = sit(m, a.roomId);
    expect(d.seat).toBe(1);
    expect(lastLobby(a.conn)).toEqual({ type: "lobby", seats: ["human", "human", "human", "empty"], names: [null, null, null, null], host: 0 });
    m.close();
  });

  it("정원 4명이 모두 나갔다 들어와도 입장 실패(room_full) 없이 새로 앉을 수 있다 (회귀)", () => {
    const m = new RoomManager();
    const first = sit(m);
    const others = [sit(m, first.roomId), sit(m, first.roomId), sit(m, first.roomId)];
    for (const o of others) o.session.onClose();
    const again = [sit(m, first.roomId), sit(m, first.roomId), sit(m, first.roomId)];
    expect(again.map((x) => x.seat)).toEqual([1, 2, 3]);
    m.close();
  });

  it("게임이 시작되면 더 이상 보내지 않고, 시작 후 끊김은 좌석을 유지한다", () => {
    const m = new RoomManager();
    const a = sit(m);
    const b = sit(m, a.roomId);
    a.session.onMessage(JSON.stringify({ type: "start" }));
    const before = lobbies(a.conn).length;
    b.session.onClose();
    expect(lobbies(a.conn).length).toBe(before);
    const seat = m.getRoom(a.roomId)!.seats[1]!;
    expect(seat.kind).toBe("human");
    m.close();
  });

  it("입력한 이름이 좌석별로 전달되고 토큰은 어떤 lobby 메시지에도 들어가지 않는다", () => {
    const m = new RoomManager();
    const a = sit(m, undefined, "가나");
    const b = sit(m, a.roomId, "다라");
    sit(m, a.roomId);
    expect(lastLobby(a.conn)).toEqual({ type: "lobby", seats: ["human", "human", "human", "empty"], names: ["가나", "다라", null, null], host: 0 });
    const text = JSON.stringify([...lobbies(a.conn), ...lobbies(b.conn)]);
    expect(text).not.toContain(a.token);
    expect(text).not.toContain(b.token);
    m.close();
  });

  it("호스트가 아닌 좌석의 start는 not_host로 거부되고 게임은 시작되지 않는다", () => {
    const m = new RoomManager();
    const a = sit(m);
    const b = sit(m, a.roomId);
    b.session.onMessage(JSON.stringify({ type: "start" }));
    const err = b.conn.sent.find((x) => x.type === "error");
    expect(err).toMatchObject({ type: "error", code: "not_host" });
    expect(m.gameOf(m.getRoom(a.roomId)!)).toBeUndefined();
    a.session.onMessage(JSON.stringify({ type: "start" }));
    expect(m.gameOf(m.getRoom(a.roomId)!)).toBeDefined();
    m.close();
  });

  it("시작 전 호스트가 나가면 가장 낮은 번호의 남은 사람이 호스트를 승계한다", () => {
    const m = new RoomManager();
    const a = sit(m);
    const b = sit(m, a.roomId);
    const c = sit(m, a.roomId);
    a.session.onClose();
    expect(lastLobby(b.conn)).toMatchObject({ host: 1, seats: ["empty", "human", "human", "empty"] });
    c.session.onMessage(JSON.stringify({ type: "start" }));
    expect(c.conn.sent.find((x) => x.type === "error")).toMatchObject({ code: "not_host" });
    b.session.onMessage(JSON.stringify({ type: "start" }));
    expect(m.gameOf(m.getRoom(a.roomId)!)).toBeDefined();
    m.close();
  });
});

describe("끊긴 좌석 표시(disconnectedSeats)", () => {
  const lastView = (c: FakeConn) => c.sent.filter((x) => x.type === "view").at(-1);
  const downOf = (c: FakeConn) => {
    const v = lastView(c);
    return v && v.type === "view" ? v.view.disconnectedSeats : undefined;
  };

  it("끊기면 연결된 사람들의 뷰에 나타나고, 복귀하면 사라진다", () => {
    const m = new RoomManager({
      game: {
        scheduler: immediateScheduler,
        botDelayMs: 0,
        responseWindowMs: 0,
        nextRoundDelayMs: 0,
        turnTimeoutMs: Infinity,
        responseTimeoutMs: Infinity,
        disconnectedTimeoutMs: Infinity,
      },
    });
    const a = sit(m);
    const b = sit(m, a.roomId);
    const c = sit(m, a.roomId);
    a.session.onMessage(JSON.stringify({ type: "start" }));
    expect(downOf(a.conn)).toBeUndefined();
    b.session.onClose();
    expect(downOf(a.conn)).toEqual([1]);
    expect(downOf(c.conn)).toEqual([1]);
    const b2 = fakeConn();
    createSession(m, b2).onMessage(JSON.stringify({ type: "rejoin", roomId: a.roomId, seatToken: b.token }));
    expect(downOf(a.conn)).toBeUndefined();
    expect(downOf(c.conn)).toBeUndefined();
    expect(downOf(b2)).toBeUndefined();
    m.close();
  });
});
