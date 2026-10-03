import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import {
  calculateChiitoitsuShanten,
  calculateShanten,
  calculateStandardShanten,
  isTenpai,
} from "./shanten.js";

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

describe("calculateStandardShanten", () => {
  it("이미 완성된 14장 손패는 -1(화료)을 반환한다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"), num(9, "sou"),
      ...repeat(dragon("white"), 3),
      ...repeat(num(9, "man"), 2),
    ];
    expect(calculateStandardShanten(hand)).toBe(-1);
  });

  it("멘츠4개가 완성되고 홀패 하나만 남은 13장(단기 대기)은 0(텐파이)을 반환한다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"), num(9, "sou"),
      ...repeat(dragon("white"), 3),
      num(9, "man"), // 홀패 - 대자가 되면 화료
    ];
    expect(hand).toHaveLength(13);
    expect(calculateStandardShanten(hand)).toBe(0);
  });

  it("양짱 대기(하나만 더 있으면 화료)인 13장은 0(텐파이)을 반환한다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"),
      ...repeat(dragon("white"), 3),
      ...repeat(num(9, "man"), 2),
    ];
    expect(hand).toHaveLength(13);
    expect(calculateStandardShanten(hand)).toBe(0);
  });

  it("아무 멘츠도 타츠도 없는 흩어진 13장은 샹텐수가 크다(최댓값 8)", () => {
    const hand: Tile[] = [
      num(1, "man"), num(4, "man"), num(7, "man"),
      num(1, "pin"), num(4, "pin"), num(7, "pin"),
      num(1, "sou"), num(4, "sou"), num(7, "sou"),
      wind("east"), wind("south"), wind("west"), wind("north"),
    ];
    expect(hand).toHaveLength(13);
    expect(calculateStandardShanten(hand)).toBe(8);
  });
});

describe("calculateChiitoitsuShanten", () => {
  it("완성된 치또이쯔(7쌍, 14장)는 -1을 반환한다", () => {
    const hand: Tile[] = [
      ...repeat(num(2, "man"), 2), ...repeat(num(4, "man"), 2), ...repeat(num(6, "pin"), 2),
      ...repeat(num(8, "pin"), 2), ...repeat(num(3, "sou"), 2), ...repeat(wind("east"), 2),
      ...repeat(dragon("red"), 2),
    ];
    expect(calculateChiitoitsuShanten(hand)).toBe(-1);
  });

  it("6쌍 + 홀패 1장(13장)인 치또이쯔 텐파이는 0을 반환한다", () => {
    const hand: Tile[] = [
      ...repeat(num(2, "man"), 2), ...repeat(num(4, "man"), 2), ...repeat(num(6, "pin"), 2),
      ...repeat(num(8, "pin"), 2), ...repeat(num(3, "sou"), 2), ...repeat(wind("east"), 2),
      dragon("red"),
    ];
    expect(hand).toHaveLength(13);
    expect(calculateChiitoitsuShanten(hand)).toBe(0);
  });

  it("13장이 전부 서로 다른 패면 샹텐수가 최대(6)이다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"), num(4, "man"), num(5, "man"),
      num(1, "pin"), num(2, "pin"), num(3, "pin"), num(4, "pin"), num(5, "pin"),
      num(1, "sou"), num(2, "sou"), num(3, "sou"),
    ];
    expect(hand).toHaveLength(13);
    expect(calculateChiitoitsuShanten(hand)).toBe(6);
  });

  it("같은 패를 3장 이상 모아도 치또이쯔 관점에서는 쌍 1개로만 인정한다 (3장째는 낭비)", () => {
    // man2를 3장 모아도 쌍은 1개로만 카운트된다. 7종류는 채웠지만(kinds=7) 실제 쌍은 5개뿐이라
    // "6쌍+홀패1장" 형태(샹텐 0)보다 못한 샹텐 1이 나와야 한다 - 여분의 3장째는 낭비임을 검증한다.
    const hand: Tile[] = [
      ...repeat(num(2, "man"), 3), // 쌍 1개분만 인정, 나머지 1장은 낭비
      ...repeat(num(4, "man"), 2), ...repeat(num(6, "pin"), 2), ...repeat(num(8, "pin"), 2),
      ...repeat(num(3, "sou"), 2),
      wind("east"),
      dragon("red"),
    ];
    expect(hand).toHaveLength(13);
    expect(calculateChiitoitsuShanten(hand)).toBe(1);
  });
});

describe("calculateShanten", () => {
  it("표준형과 치또이쯔형 중 더 작은 값을 최종 샹텐수로 사용한다", () => {
    // 6쌍짜리 치또이쯔 텐파이 모양이면서 표준형으로는 텐파이가 아닌 손패
    const hand: Tile[] = [
      ...repeat(num(2, "man"), 2), ...repeat(num(4, "man"), 2), ...repeat(num(6, "pin"), 2),
      ...repeat(num(8, "pin"), 2), ...repeat(num(3, "sou"), 2), ...repeat(wind("east"), 2),
      dragon("red"),
    ];
    expect(calculateShanten(hand)).toBe(0);
  });

  it("13장도 14장도 아닌 손패는 에러를 던진다", () => {
    expect(() => calculateShanten([num(1, "man")])).toThrow();
  });
});

describe("isTenpai", () => {
  it("텐파이 손패(13장)는 true를 반환한다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"),
      ...repeat(dragon("white"), 3),
      ...repeat(num(9, "man"), 2),
    ];
    expect(isTenpai(hand)).toBe(true);
  });

  it("텐파이가 아닌 손패(13장)는 false를 반환한다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(4, "man"), num(7, "man"),
      num(1, "pin"), num(4, "pin"), num(7, "pin"),
      num(1, "sou"), num(4, "sou"), num(7, "sou"),
      wind("east"), wind("south"), wind("west"), wind("north"),
    ];
    expect(isTenpai(hand)).toBe(false);
  });

  it("13장이 아닌 손패는 에러를 던진다", () => {
    expect(() => isTenpai([num(1, "man")])).toThrow();
    const fourteen: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"), num(9, "sou"),
      ...repeat(dragon("white"), 3),
      ...repeat(num(9, "man"), 2),
    ];
    expect(() => isTenpai(fourteen)).toThrow();
  });
});
