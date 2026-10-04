import { describe, expect, it } from "vitest";
import { createGame } from "@mahjong/core";
import type { Seat } from "@mahjong/core";
import { relativeSeat, viewFor } from "./seatView";
import type { SeatView } from "./seatView";

describe("relativeSeat", () => {
  it("본인은 0, 이후 반시계 순서로 1~3", () => {
    expect(relativeSeat(2, 2)).toBe(0);
    expect(relativeSeat(3, 2)).toBe(1);
    expect(relativeSeat(0, 2)).toBe(2);
    expect(relativeSeat(1, 2)).toBe(3);
  });
  it("mySeat=0이면 좌석 번호 그대로", () => {
    for (const s of [0, 1, 2, 3] as Seat[]) expect(relativeSeat(s, 0)).toBe(s);
  });
});

describe("viewFor 스모크", () => {
  it("createGame 상태에서 SeatView 형태가 타입과 일치", () => {
    const view: SeatView = viewFor(createGame(), 0);
    expect(view.seat).toBe(0);
    expect(view.players).toHaveLength(4);
    expect(view.result).toBeNull();
  });
});
