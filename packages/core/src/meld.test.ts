import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import { decomposeStandardHand, isChiitoitsuHand, tileToIndex } from "./meld.js";

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

describe("tileToIndex", () => {
  it("만수/통수/삭수/풍패/삼원패를 서로 다른 0~33 범위 인덱스로 매핑한다", () => {
    const indices = new Set<number>();
    for (const suit of ["man", "pin", "sou"] as const) {
      for (let rank = 1; rank <= 9; rank++) {
        indices.add(tileToIndex(num(rank as 1, suit)));
      }
    }
    for (const w of ["east", "south", "west", "north"] as const) indices.add(tileToIndex(wind(w)));
    for (const d of ["white", "green", "red"] as const) indices.add(tileToIndex(dragon(d)));
    expect(indices.size).toBe(34);
    for (const i of indices) {
      expect(i).toBeGreaterThanOrEqual(0);
      expect(i).toBeLessThan(34);
    }
  });
});

describe("decomposeStandardHand", () => {
  it("멘츠4(순자3+각자1)+대자1로 이루어진 손패를 정확히 분해한다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"), num(9, "sou"),
      ...repeat(dragon("white"), 3),
      ...repeat(num(9, "man"), 2),
    ];
    const results = decomposeStandardHand(hand);
    expect(results.length).toBeGreaterThanOrEqual(1);
    const result = results[0]!;
    expect(result.melds).toHaveLength(4);
    expect(result.pair.tiles).toHaveLength(2);

    const triplets = result.melds.filter((m) => m.type === "triplet");
    const sequences = result.melds.filter((m) => m.type === "sequence");
    expect(triplets).toHaveLength(1);
    expect(sequences).toHaveLength(3);
  });

  it("같은 9장(111222333)을 각자3개 또는 순자3개(123x3)로 해석하는 등 모호한 손패는 여러 분해를 반환한다", () => {
    const hand: Tile[] = [
      ...repeat(num(1, "man"), 3),
      ...repeat(num(2, "man"), 3),
      ...repeat(num(3, "man"), 3),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      ...repeat(num(9, "sou"), 2),
    ];
    const results = decomposeStandardHand(hand);
    expect(results.length).toBeGreaterThanOrEqual(2);

    const hasAllTriplets = results.some(
      (r) => r.melds.filter((m) => m.type === "triplet").length === 3,
    );
    const hasAllSequences = results.some(
      (r) => r.melds.filter((m) => m.type === "sequence").length === 4,
    );
    expect(hasAllTriplets).toBe(true);
    expect(hasAllSequences).toBe(true);
  });

  it("멘츠+대자로 분해할 수 없는 손패는 빈 배열을 반환한다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(4, "man"), num(7, "man"),
      num(1, "pin"), num(4, "pin"), num(7, "pin"),
      num(1, "sou"), num(4, "sou"), num(7, "sou"),
      wind("east"), wind("south"), wind("west"), wind("north"),
      dragon("white"),
    ];
    expect(decomposeStandardHand(hand)).toEqual([]);
  });

  it("정확히 14장이 아니면 에러를 던진다", () => {
    expect(() => decomposeStandardHand([num(1, "man")])).toThrow();
  });
});

describe("isChiitoitsuHand", () => {
  it("서로 다른 패 7쌍으로 이루어진 손패는 치또이쯔로 판정한다", () => {
    const hand: Tile[] = [
      ...repeat(num(2, "man"), 2),
      ...repeat(num(4, "man"), 2),
      ...repeat(num(6, "pin"), 2),
      ...repeat(num(8, "pin"), 2),
      ...repeat(num(3, "sou"), 2),
      ...repeat(wind("east"), 2),
      ...repeat(dragon("red"), 2),
    ];
    expect(isChiitoitsuHand(hand)).toBe(true);
  });

  it("같은 패가 3장 이상 모여 있으면(예: 4장) 치또이쯔로 인정하지 않는다", () => {
    const hand: Tile[] = [
      ...repeat(num(2, "man"), 3), // 3장 - 무효
      ...repeat(num(4, "man"), 2),
      ...repeat(num(6, "pin"), 2),
      ...repeat(num(8, "pin"), 2),
      ...repeat(num(3, "sou"), 2),
      ...repeat(wind("east"), 2),
      num(9, "sou"), // 1장짜리 홀패 - 짝을 못 이룸
    ];
    expect(hand).toHaveLength(14);
    expect(isChiitoitsuHand(hand)).toBe(false);
  });

  it("서로 다른 패 종류가 7종이 아니면(예: 6종) 치또이쯔로 인정하지 않는다", () => {
    const hand: Tile[] = [
      ...repeat(num(2, "man"), 2),
      ...repeat(num(4, "man"), 2),
      ...repeat(num(6, "pin"), 2),
      ...repeat(num(8, "pin"), 2),
      ...repeat(num(3, "sou"), 2),
      ...repeat(wind("east"), 4), // 종류는 6개뿐
    ];
    expect(isChiitoitsuHand(hand)).toBe(false);
  });

  it("14장이 아니면 치또이쯔로 인정하지 않는다", () => {
    expect(isChiitoitsuHand([num(1, "man")])).toBe(false);
  });
});
