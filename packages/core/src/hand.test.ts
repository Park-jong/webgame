import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import { addTile, compareTiles, removeTile, sortHand } from "./hand.js";
import { tileToIndex } from "./meld.js";

function num(rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, suit: "man" | "pin" | "sou" = "man"): Tile {
  return { kind: "number", suit, rank, isRedFive: false };
}
function wind(w: "east" | "south" | "west" | "north"): Tile {
  return { kind: "wind", wind: w };
}
function dragon(d: "white" | "green" | "red"): Tile {
  return { kind: "dragon", dragon: d };
}

describe("sortHand", () => {
  it("수패를 슈트별(만→통→삭)로, 슈트 내에서는 오름차순으로 정렬한다", () => {
    const hand: Tile[] = [num(5, "sou"), num(1, "man"), num(3, "pin"), num(2, "man"), num(1, "sou")];
    const sorted = sortHand(hand);
    expect(sorted).toEqual([num(1, "man"), num(2, "man"), num(3, "pin"), num(1, "sou"), num(5, "sou")]);
  });

  it("자패는 수패 뒤에, 풍패(동남서북) 다음 삼원패(백발중) 순으로 정렬한다", () => {
    const hand: Tile[] = [dragon("red"), wind("north"), num(9, "sou"), dragon("white"), wind("east")];
    const sorted = sortHand(hand);
    expect(sorted).toEqual([
      num(9, "sou"),
      wind("east"),
      wind("north"),
      dragon("white"),
      dragon("red"),
    ]);
  });

  it("원본 배열을 변경하지 않는다", () => {
    const hand: Tile[] = [num(3, "man"), num(1, "man")];
    const original = [...hand];
    sortHand(hand);
    expect(hand).toEqual(original);
  });

  it("빈 손패를 정렬해도 에러 없이 빈 배열을 반환한다", () => {
    expect(sortHand([])).toEqual([]);
  });
});

describe("compareTiles", () => {
  it("같은 종류의 패는 0을 반환한다", () => {
    expect(compareTiles(num(3, "man"), num(3, "man"))).toBe(0);
  });

  it("적도라 여부와 무관하게 같은 숫자패는 동일 순서로 취급한다", () => {
    const a: Tile = { kind: "number", suit: "man", rank: 5, isRedFive: true };
    const b: Tile = { kind: "number", suit: "man", rank: 5, isRedFive: false };
    expect(compareTiles(a, b)).toBe(0);
  });

  it("meld.ts의 tileToIndex와 동일한 순서 기준을 사용한다 (중복 구현 방지 회귀 테스트)", () => {
    const allTiles: Tile[] = [
      num(1, "man"), num(5, "man"), num(9, "man"),
      num(1, "pin"), num(5, "pin"), num(9, "pin"),
      num(1, "sou"), num(5, "sou"), num(9, "sou"),
      wind("east"), wind("south"), wind("west"), wind("north"),
      dragon("white"), dragon("green"), dragon("red"),
    ];
    for (const a of allTiles) {
      for (const b of allTiles) {
        const expected = Math.sign(tileToIndex(a) - tileToIndex(b));
        expect(Math.sign(compareTiles(a, b))).toBe(expected);
      }
    }
  });
});

describe("addTile", () => {
  it("손패 끝에 패를 한 장 추가한 새 배열을 반환한다", () => {
    const hand: Tile[] = [num(1, "man")];
    const result = addTile(hand, num(2, "man"));
    expect(result).toEqual([num(1, "man"), num(2, "man")]);
  });

  it("원본 배열을 변경하지 않는다", () => {
    const hand: Tile[] = [num(1, "man")];
    addTile(hand, num(2, "man"));
    expect(hand).toEqual([num(1, "man")]);
  });
});

describe("removeTile", () => {
  it("같은 종류의 패를 한 장 제거한 새 배열을 반환한다", () => {
    const hand: Tile[] = [num(1, "man"), num(2, "man"), num(2, "man")];
    const result = removeTile(hand, num(2, "man"));
    expect(result).toEqual([num(1, "man"), num(2, "man")]);
  });

  it("적도라 여부와 무관하게 같은 종류로 취급해 제거한다", () => {
    const redFive: Tile = { kind: "number", suit: "man", rank: 5, isRedFive: true };
    const normalFive: Tile = { kind: "number", suit: "man", rank: 5, isRedFive: false };
    const hand: Tile[] = [redFive];
    const result = removeTile(hand, normalFive);
    expect(result).toEqual([]);
  });

  it("원본 배열을 변경하지 않는다", () => {
    const hand: Tile[] = [num(1, "man"), num(2, "man")];
    removeTile(hand, num(1, "man"));
    expect(hand).toEqual([num(1, "man"), num(2, "man")]);
  });

  it("손패에 없는 패를 제거하려 하면 에러를 던진다", () => {
    const hand: Tile[] = [num(1, "man")];
    expect(() => removeTile(hand, num(9, "sou"))).toThrow();
  });
});
