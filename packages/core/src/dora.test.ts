import { describe, expect, it } from "vitest";
import type { Tile, Wind } from "./tiles.js";
import type { WinContext } from "./yaku.js";
import { calculateScore } from "./score.js";
import { countDora, countTotalDora, doraFromIndicator } from "./dora.js";

/** "234m 55p EE CC" 같은 문자열을 패 배열로 변환한다 (m/p/s 수패, E/S/W/N 풍패, P/F/C 백/발/중) */
function parse(text: string): Tile[] {
  const suits = { m: "man", p: "pin", s: "sou" } as const;
  const winds: Record<string, Wind> = { E: "east", S: "south", W: "west", N: "north" };
  const dragons = { P: "white", F: "green", C: "red" } as const;
  const tiles: Tile[] = [];
  for (const token of text.split(/\s+/).filter(Boolean)) {
    const last = token[token.length - 1] as string;
    if (last in suits) {
      for (const ch of token.slice(0, -1)) {
        tiles.push({
          kind: "number",
          suit: suits[last as keyof typeof suits],
          rank: Number(ch) as 1,
          isRedFive: false,
        });
      }
    } else {
      for (const ch of token) {
        if (ch in winds) tiles.push({ kind: "wind", wind: winds[ch]! });
        else tiles.push({ kind: "dragon", dragon: dragons[ch as keyof typeof dragons] });
      }
    }
  }
  return tiles;
}

const one = (text: string): Tile => parse(text)[0]!;

describe("doraFromIndicator", () => {
  it("수패는 +1, 9는 같은 슈트의 1로 순환", () => {
    expect(doraFromIndicator(one("1m"))).toEqual(one("2m"));
    expect(doraFromIndicator(one("8p"))).toEqual(one("9p"));
    expect(doraFromIndicator(one("9m"))).toEqual(one("1m"));
    expect(doraFromIndicator(one("9p"))).toEqual(one("1p"));
    expect(doraFromIndicator(one("9s"))).toEqual(one("1s"));
  });

  it("풍패: 동→남→서→북→동", () => {
    expect(doraFromIndicator(one("E"))).toEqual(one("S"));
    expect(doraFromIndicator(one("S"))).toEqual(one("W"));
    expect(doraFromIndicator(one("W"))).toEqual(one("N"));
    expect(doraFromIndicator(one("N"))).toEqual(one("E"));
  });

  it("삼원패: 백→발→중→백", () => {
    expect(doraFromIndicator(one("P"))).toEqual(one("F"));
    expect(doraFromIndicator(one("F"))).toEqual(one("C"));
    expect(doraFromIndicator(one("C"))).toEqual(one("P"));
  });

  it("적오 표시패여도 5의 다음인 6을 가리키며 결과는 적도라가 아니다", () => {
    const red: Tile = { kind: "number", suit: "sou", rank: 5, isRedFive: true };
    expect(doraFromIndicator(red)).toEqual(one("6s"));
  });

  it("유효하지 않은 표시패는 에러", () => {
    const badRank = { kind: "number", suit: "man", rank: 0, isRedFive: false } as unknown as Tile;
    const badKind = { kind: "flower" } as unknown as Tile;
    expect(() => doraFromIndicator(badRank)).toThrow("유효한 패가 아닙니다");
    expect(() => doraFromIndicator(badKind)).toThrow("유효한 패가 아닙니다");
  });
});

// 14장: 2m 1장, 5p 3장, 6s 1장, 8s 1장 등
const HAND = parse("234m 456m 345p 678s 55p");

describe("countDora", () => {
  it("표시패 1장: 도라패와 같은 패 개수", () => {
    expect(countDora(HAND, parse("1m"))).toBe(1); // 도라 2m x1
    expect(countDora(HAND, parse("4p"))).toBe(3); // 도라 5p x3 (345p 의 5p + 55p)
  });

  it("도라패가 손에 없으면 0", () => {
    expect(countDora(HAND, parse("E"))).toBe(0); // 도라 남
  });

  it("표시패 0장이면 0", () => {
    expect(countDora(HAND, [])).toBe(0);
  });

  it("표시패가 여러 장이면 각각 독립 계산해 합산", () => {
    // 1m -> 2m(1장), 5s -> 6s(1장), 7s -> 8s(1장)
    expect(countDora(HAND, parse("1m 5s 7s"))).toBe(3);
  });

  it("같은 도라패가 겹치면 중복 가산", () => {
    expect(countDora(HAND, parse("1m 1m"))).toBe(2);
    expect(countDora(HAND, parse("4p 4p"))).toBe(6);
  });

  it("도라패가 손에 4장 있으면 4판 (9m 표시 → 1m)", () => {
    const hand = parse("1111m 234p 567p 78s 99s");
    expect(hand).toHaveLength(14);
    expect(countDora(hand, parse("9m"))).toBe(4);
  });

  it("경계: 9s 표시 → 1s, 북 표시 → 동", () => {
    const hand = parse("111s 234m 567p 789m EE");
    expect(hand).toHaveLength(14);
    expect(countDora(hand, parse("9s"))).toBe(3); // 1s x3
    expect(countDora(hand, parse("N"))).toBe(2); // 동 x2
  });

  it("경계: 발 표시 → 중, 중 표시 → 백", () => {
    const hand = parse("CC PPP 234m 567p 789s");
    expect(hand).toHaveLength(14);
    expect(countDora(hand, parse("F"))).toBe(2); // 중 x2
    expect(countDora(hand, parse("C"))).toBe(3); // 백 x3
  });

  it("손패가 14장이 아니면 에러", () => {
    expect(() => countDora(parse("123m"), parse("1m"))).toThrow("14장");
  });

  it("손패/표시패에 유효하지 않은 패가 있으면 에러", () => {
    const bad = { kind: "wind", wind: "up" } as unknown as Tile;
    expect(() => countDora([...HAND.slice(0, 13), bad], [])).toThrow("유효한 패가 아닙니다");
    expect(() => countDora(HAND, [bad])).toThrow("유효한 패가 아닙니다");
  });

  it("적도라는 세지 않는다 (범위 밖)", () => {
    const hand = HAND.map((t, i) => (i === 0 ? ({ ...t, isRedFive: true } as Tile) : t));
    expect(countDora(hand, [])).toBe(0);
  });
});

describe("countTotalDora", () => {
  it("리치면 겉도라 + 뒷도라 합산", () => {
    const total = countTotalDora({
      hand: HAND,
      doraIndicators: parse("1m"), // 2m x1
      uraDoraIndicators: parse("4p"), // 5p x3
      isRiichi: true,
    });
    expect(total).toBe(4);
  });

  it("리치가 아니면 뒷도라는 세지 않는다", () => {
    const total = countTotalDora({
      hand: HAND,
      doraIndicators: parse("1m"),
      uraDoraIndicators: parse("4p"),
      isRiichi: false,
    });
    expect(total).toBe(1);
  });

  it("표시패 0장이면 0", () => {
    expect(
      countTotalDora({ hand: HAND, doraIndicators: [], uraDoraIndicators: [], isRiichi: true }),
    ).toBe(0);
  });

  it("깡도라처럼 표시패가 여러 장이어도 합산", () => {
    const total = countTotalDora({
      hand: HAND,
      doraIndicators: parse("1m 5s"), // 2m x1 + 6s x1
      uraDoraIndicators: parse("4p 4p"), // 5p x3, 두 번
      isRiichi: true,
    });
    expect(total).toBe(2 + 6);
  });
});

describe("calculateScore 통합", () => {
  const base: WinContext = {
    hand: parse("234m 456m 345p 678s 55p"),
    winningTile: one("2m"),
    isConcealed: true,
    winType: "ron",
    isRiichi: true,
    seatWind: "south",
    roundWind: "east",
  };

  it("도라 판수가 점수에 반영된다 (리치+핑후+탕야오 3판 → 도라 4판 더해 7판 하네만)", () => {
    const dora = countTotalDora({
      hand: base.hand,
      doraIndicators: parse("1m"), // 2m x1
      uraDoraIndicators: parse("4p"), // 5p x3
      isRiichi: base.isRiichi,
    });
    expect(dora).toBe(4);

    const without = calculateScore(base);
    const withDora = calculateScore(base, { dora });
    if (without.kind !== "scored" || withDora.kind !== "scored") throw new Error("역이 없음");
    expect(without.han).toBe(3);
    expect(withDora.han).toBe(7);
    expect(withDora.limit).toBe("haneman");
    expect(withDora.payment).toEqual({ type: "ron", fromDiscarder: 12000 });
  });

  it("역이 없으면 도라가 있어도 noYaku", () => {
    // 리치 없음 + 4p 간짱 론(핑후 아님) + 요구패 포함(탕야오 아님) → 역 없음
    const hand = parse("123m 456m 345p 789s 55p");
    const dora = countDora(hand, parse("4p")); // 5p x3
    expect(dora).toBe(3);
    const result = calculateScore(
      { ...base, hand, winningTile: one("4p"), isRiichi: false },
      { dora },
    );
    expect(result.kind).toBe("noYaku");
  });
});
