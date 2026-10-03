import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import { isAgari } from "./agari.js";

function num(rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, suit: "man" | "pin" | "sou" = "man"): Tile {
  return { kind: "number", suit, rank, isRedFive: false };
}
function wind(w: "east" | "south" | "west" | "north"): Tile {
  return { kind: "wind", wind: w };
}
function dragon(d: "white" | "green" | "red"): Tile {
  return { kind: "dragon", dragon: d };
}
function repeat(tile: Tile, n: number): Tile[] {
  return Array.from({ length: n }, () => tile);
}

describe("isAgari", () => {
  it("표준형(멘츠4+대자1)으로 완성된 14장 손패는 화료로 판정한다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"), num(9, "sou"),
      ...repeat(dragon("white"), 3),
      ...repeat(num(9, "man"), 2),
    ];
    expect(isAgari(hand)).toBe(true);
  });

  it("치또이쯔(칠대자)로 완성된 14장 손패는 화료로 판정한다", () => {
    const hand: Tile[] = [
      ...repeat(num(2, "man"), 2), ...repeat(num(4, "man"), 2), ...repeat(num(6, "pin"), 2),
      ...repeat(num(8, "pin"), 2), ...repeat(num(3, "sou"), 2), ...repeat(wind("east"), 2),
      ...repeat(dragon("red"), 2),
    ];
    expect(isAgari(hand)).toBe(true);
  });

  it("멘츠/대자로도, 치또이쯔로도 분해되지 않는 14장 손패는 화료가 아니다", () => {
    const hand: Tile[] = [
      ...repeat(num(2, "man"), 3),
      num(4, "man"), num(4, "man"),
      num(6, "pin"), num(6, "pin"),
      num(8, "pin"), num(8, "pin"),
      num(3, "sou"), num(3, "sou"),
      num(5, "sou"), num(5, "sou"),
      num(9, "sou"), // 7종류 채우려다 실패, 표준형도 실패
    ];
    expect(hand).toHaveLength(14);
    expect(isAgari(hand)).toBe(false);
  });

  it("텐파이 상태(13장)는 화료가 아니다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"),
      ...repeat(dragon("white"), 3),
      ...repeat(num(9, "man"), 2),
    ];
    expect(hand).toHaveLength(13);
    expect(isAgari(hand)).toBe(false);
  });

  it("아무 형태도 갖추지 못한 흩어진 14장 손패는 화료가 아니다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(4, "man"), num(7, "man"),
      num(1, "pin"), num(4, "pin"), num(7, "pin"),
      num(1, "sou"), num(4, "sou"), num(7, "sou"),
      wind("east"), wind("south"), wind("west"), wind("north"),
      dragon("white"),
    ];
    expect(hand).toHaveLength(14);
    expect(isAgari(hand)).toBe(false);
  });
});
