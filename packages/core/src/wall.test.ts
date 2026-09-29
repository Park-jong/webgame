import { describe, expect, it } from "vitest";
import { createFullTileSet } from "./tiles.js";
import { DEAD_WALL_SIZE, HAND_SIZE, NUM_PLAYERS, dealTiles, shuffleTiles } from "./wall.js";

/** 테스트용 결정적 시드 난수 (mulberry32) */
function seededRandom(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

describe("shuffleTiles", () => {
  it("패 개수를 그대로 유지한다", () => {
    const tiles = createFullTileSet();
    const shuffled = shuffleTiles(tiles, seededRandom(1));
    expect(shuffled).toHaveLength(tiles.length);
  });

  it("원본 배열을 변경하지 않는다", () => {
    const tiles = createFullTileSet();
    const original = [...tiles];
    shuffleTiles(tiles, seededRandom(1));
    expect(tiles).toEqual(original);
  });

  it("같은 시드로는 같은 결과를 낸다 (결정적)", () => {
    const tiles = createFullTileSet();
    const a = shuffleTiles(tiles, seededRandom(42));
    const b = shuffleTiles(tiles, seededRandom(42));
    expect(a).toEqual(b);
  });

  it("다른 시드로는 다른 순서를 낸다", () => {
    const tiles = createFullTileSet();
    const a = shuffleTiles(tiles, seededRandom(1));
    const b = shuffleTiles(tiles, seededRandom(2));
    expect(a).not.toEqual(b);
  });
});

describe("dealTiles", () => {
  it("4명에게 13장씩, 왕패 14장, 나머지는 산패로 배분한다", () => {
    const shuffled = shuffleTiles(createFullTileSet(), seededRandom(7));
    const result = dealTiles(shuffled);

    expect(result.hands).toHaveLength(NUM_PLAYERS);
    for (const hand of result.hands) {
      expect(hand).toHaveLength(HAND_SIZE);
    }
    expect(result.deadWall).toHaveLength(DEAD_WALL_SIZE);
    expect(result.liveWall).toHaveLength(136 - NUM_PLAYERS * HAND_SIZE - DEAD_WALL_SIZE);
  });

  it("배분된 패의 총합은 136장이고 원본 패 구성과 정확히 일치한다", () => {
    const shuffled = shuffleTiles(createFullTileSet(), seededRandom(7));
    const result = dealTiles(shuffled);

    const total = [
      ...result.hands.flat(),
      ...result.deadWall,
      ...result.liveWall,
    ];
    expect(total).toHaveLength(136);

    // 객체 배열은 기본 sort()로 비교할 수 없으므로 직렬화한 문자열로 다중집합을 비교한다.
    const toSortedKeys = (tiles: typeof total) =>
      tiles.map((t) => JSON.stringify(t)).sort();
    expect(toSortedKeys(total)).toEqual(toSortedKeys(shuffled));
  });

  it("패가 부족하면 에러를 던진다", () => {
    expect(() => dealTiles(createFullTileSet().slice(0, 10))).toThrow();
  });
});
