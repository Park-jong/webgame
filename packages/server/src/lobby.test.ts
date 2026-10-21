import { describe, expect, it } from "vitest";
import { RoomManager } from "./room";
import { createSession } from "./session";
import { fakeConn, type FakeConn } from "./test-utils";

// 시작 전 대기실 착석 현황(lobby 메시지): 참가/퇴장 때 방 전원에게 방송되고, 시작 후에는 보내지 않는다.

const lobbies = (c: FakeConn) => c.sent.filter((m) => m.type === "lobby");
const lastLobby = (c: FakeConn) => lobbies(c).at(-1);

function sit(m: RoomManager, roomId?: string) {
  const conn = fakeConn();
  const session = createSession(m, conn);
  session.onMessage(JSON.stringify(roomId === undefined ? { type: "join" } : { type: "join", roomId }));
  const joined = conn.sent.find((x) => x.type === "joined");
  if (!joined || joined.type !== "joined") throw new Error("입장 실패");
  return { conn, session, roomId: joined.roomId, seat: joined.seat };
}

describe("대기실 착석 현황", () => {
  it("입장하면 본인 joined 뒤에 현황을 받고, 기존 참가자도 갱신을 받는다", () => {
    const m = new RoomManager();
    const a = sit(m);
    expect(a.conn.sent.map((x) => x.type)).toEqual(["joined", "lobby"]);
    expect(lastLobby(a.conn)).toEqual({ type: "lobby", seats: ["human", "empty", "empty", "empty"] });
    const b = sit(m, a.roomId);
    expect(lastLobby(a.conn)).toEqual({ type: "lobby", seats: ["human", "human", "empty", "empty"] });
    expect(b.conn.sent.map((x) => x.type)).toEqual(["joined", "lobby"]);
    expect(lastLobby(b.conn)).toEqual({ type: "lobby", seats: ["human", "human", "empty", "empty"] });
    m.close();
  });

  it("시작 전에 나가면 좌석이 비고 남은 사람에게 알리며, 다음 사람이 그 자리에 앉는다", () => {
    const m = new RoomManager();
    const a = sit(m);
    const b = sit(m, a.roomId);
    const c = sit(m, a.roomId);
    b.session.onClose();
    expect(lastLobby(a.conn)).toEqual({ type: "lobby", seats: ["human", "empty", "human", "empty"] });
    expect(lastLobby(c.conn)).toEqual({ type: "lobby", seats: ["human", "empty", "human", "empty"] });
    const d = sit(m, a.roomId);
    expect(d.seat).toBe(1);
    expect(lastLobby(a.conn)).toEqual({ type: "lobby", seats: ["human", "human", "human", "empty"] });
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
});
