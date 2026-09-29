import { describe, expect, it } from "vitest";
import { createFullTileSet, isSameTileType, tileToString } from "./tiles.js";

describe("createFullTileSet", () => {
  it("표준 136패를 생성한다", () => {
    const tiles = createFullTileSet();
    expect(tiles).toHaveLength(136);
  });

  it("수패는 종류당(만/통/삭 x 1~9) 정확히 4장씩이다", () => {
    const tiles = createFullTileSet();
    for (const suit of ["man", "pin", "sou"] as const) {
      for (let rank = 1; rank <= 9; rank++) {
        const count = tiles.filter(
          (t) => t.kind === "number" && t.suit === suit && t.rank === rank,
        ).length;
        expect(count).toBe(4);
      }
    }
  });

  it("자패(풍패 4종 + 삼원패 3종)는 종류당 4장씩, 총 28장이다", () => {
    const tiles = createFullTileSet();
    const honors = tiles.filter((t) => t.kind !== "number");
    expect(honors).toHaveLength(28);
  });

  it("적도라 옵션이 켜지면 만/통/삭 각 1장씩 총 3장이 적도라다", () => {
    const tiles = createFullTileSet(true);
    const redFives = tiles.filter((t) => t.kind === "number" && t.isRedFive);
    expect(redFives).toHaveLength(3);
  });

  it("적도라 옵션을 끄면 적도라가 없다", () => {
    const tiles = createFullTileSet(false);
    const redFives = tiles.filter((t) => t.kind === "number" && t.isRedFive);
    expect(redFives).toHaveLength(0);
  });
});

describe("isSameTileType", () => {
  it("같은 숫자패는 적도라 여부와 무관하게 같은 타입으로 본다", () => {
    const a = { kind: "number", suit: "man", rank: 5, isRedFive: true } as const;
    const b = { kind: "number", suit: "man", rank: 5, isRedFive: false } as const;
    expect(isSameTileType(a, b)).toBe(true);
  });

  it("다른 종류의 패는 다르다고 판단한다", () => {
    const a = { kind: "wind", wind: "east" } as const;
    const b = { kind: "dragon", dragon: "white" } as const;
    expect(isSameTileType(a, b)).toBe(false);
  });
});

describe("tileToString", () => {
  it("숫자패를 랭크+슈트 문자열로 변환한다", () => {
    expect(tileToString({ kind: "number", suit: "man", rank: 1, isRedFive: false })).toBe("1m");
    expect(tileToString({ kind: "number", suit: "pin", rank: 9, isRedFive: false })).toBe("9p");
  });

  it("풍패/삼원패를 약어로 변환한다", () => {
    expect(tileToString({ kind: "wind", wind: "east" })).toBe("E");
    expect(tileToString({ kind: "dragon", dragon: "red" })).toBe("Rd");
  });
});
