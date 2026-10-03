import { describe, expect, it } from "vitest";
import type { Tile, Wind } from "./tiles.js";
import type { WinContext } from "./yaku.js";
import { calculateScore } from "./score.js";
import { countDora, countRedFives, countTotalDora, doraFromIndicator } from "./dora.js";

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

/** 지정한 인덱스의 5패를 적5로 바꾼 손패를 반환한다 */
function withRed(hand: Tile[], indices: number[]): Tile[] {
  return hand.map((t, i) => (indices.includes(i) ? ({ ...t, isRedFive: true } as Tile) : t));
}

// HAND 인덱스: 234m(0-2) 456m(3-5, 5m=4) 345p(6-8, 5p=8) 678s(9-11) 55p(12,13)
const RED_5M = 4;
const RED_5P = 8;
// 치또이쯔 인덱스: 11m(0,1) 55m(2,3) 55p(4,5) 77p 99s 22s EE
const CHIITOI = parse("11m 55m 55p 77p 99s 22s EE");

describe("countRedFives", () => {
  it("적5가 0장이면 0", () => {
    expect(countRedFives(HAND)).toBe(0);
  });

  it("적5 1장이면 1", () => {
    expect(countRedFives(withRed(HAND, [RED_5M]))).toBe(1);
  });

  it("만/통/삭 3슈트에 각 1장이면 3", () => {
    // 234m(0-2) 555m(3-5) 345p(6-8) 555s(9-11) 55p(12,13)
    const hand = withRed(parse("234m 555m 345p 555s 55p"), [3, 8, 9]);
    expect(hand).toHaveLength(14);
    expect(countRedFives(hand)).toBe(3);
  });

  it("치또이쯔 손패의 적5도 센다", () => {
    expect(countRedFives(withRed(CHIITOI, [2, 4]))).toBe(2);
  });

  it("손패가 14장이 아니면 에러", () => {
    expect(() => countRedFives(parse("123m"))).toThrow("14장");
  });

  it("유효하지 않은 패가 있으면 에러", () => {
    const bad = { kind: "dragon", dragon: "blue" } as unknown as Tile;
    expect(() => countRedFives([...HAND.slice(0, 13), bad])).toThrow("유효한 패가 아닙니다");
  });

  it("5가 아닌 패에 isRedFive 가 붙은 비정상 입력은 에러 (HAND[0] 은 2m)", () => {
    expect(() => countRedFives(withRed(HAND, [0]))).toThrow("5가 아닌 패");
  });
});

describe("countTotalDora 적도라 옵션", () => {
  const red = withRed(HAND, [RED_5M, RED_5P]);

  it("옵션 생략/false 는 적도라를 더하지 않는다 (하위 호환)", () => {
    const input = { hand: red, doraIndicators: [], uraDoraIndicators: [], isRiichi: true };
    expect(countTotalDora(input)).toBe(0);
    expect(countTotalDora({ ...input, includeRedFives: false })).toBe(0);
  });

  it("includeRedFives: true 이면 적도라를 합산", () => {
    expect(
      countTotalDora({
        hand: red,
        doraIndicators: [],
        uraDoraIndicators: [],
        isRiichi: false,
        includeRedFives: true,
      }),
    ).toBe(2);
  });

  it("적5이면서 겉도라 대상이면 중복 가산 (5p 3장 도라 + 적5 2장 = 5)", () => {
    expect(
      countTotalDora({
        hand: red,
        doraIndicators: parse("4p"),
        uraDoraIndicators: [],
        isRiichi: false,
        includeRedFives: true,
      }),
    ).toBe(3 + 2);
  });

  it("적5이면서 뒷도라 대상이면 리치일 때 중복 가산 (5m 뒷도라 1 + 적5 2 = 3)", () => {
    expect(
      countTotalDora({
        hand: red,
        doraIndicators: [],
        uraDoraIndicators: parse("4m"),
        isRiichi: true,
        includeRedFives: true,
      }),
    ).toBe(1 + 2);
  });

  it("리치가 아니면 뒷도라는 무시하지만 적도라는 그대로 센다", () => {
    expect(
      countTotalDora({
        hand: red,
        doraIndicators: [],
        uraDoraIndicators: parse("4m"),
        isRiichi: false,
        includeRedFives: true,
      }),
    ).toBe(2);
  });

  it("치또이쯔 손패: 적5 2장 + 겉도라 5m 2장 = 4", () => {
    expect(
      countTotalDora({
        hand: withRed(CHIITOI, [2, 4]),
        doraIndicators: parse("4m"),
        uraDoraIndicators: [],
        isRiichi: false,
        includeRedFives: true,
      }),
    ).toBe(2 + 2);
  });

  it("옵션 없이는 5가 아닌 패의 isRedFive 오염을 검사하지 않고 기존처럼 동작", () => {
    expect(
      countTotalDora({
        hand: withRed(HAND, [0]),
        doraIndicators: [],
        uraDoraIndicators: [],
        isRiichi: false,
      }),
    ).toBe(0);
  });
});

describe("calculateScore 통합 - 적도라", () => {
  const base: WinContext = {
    hand: withRed(HAND, [RED_5M, RED_5P]),
    winningTile: one("2m"),
    isConcealed: true,
    winType: "ron",
    isRiichi: true,
    seatWind: "south",
    roundWind: "east",
  };

  it("적도라 2장이 더해져 3판 → 5판 만관 (론 8000)", () => {
    const dora = countTotalDora({
      hand: base.hand,
      doraIndicators: [],
      uraDoraIndicators: [],
      isRiichi: true,
      includeRedFives: true,
    });
    expect(dora).toBe(2);
    const result = calculateScore(base, { dora });
    if (result.kind !== "scored") throw new Error("역이 없음");
    expect(result.han).toBe(5);
    expect(result.limit).toBe("mangan");
    expect(result.payment).toEqual({ type: "ron", fromDiscarder: 8000 });
  });

  it("적5가 있어도 역/부수 판정은 일반 5와 동일하다", () => {
    const plain = calculateScore({ ...base, hand: HAND });
    const redHand = calculateScore(base);
    if (plain.kind !== "scored" || redHand.kind !== "scored") throw new Error("역이 없음");
    expect(redHand.han).toBe(plain.han);
    expect(redHand.fu).toBe(plain.fu);
    expect(redHand.yaku).toEqual(plain.yaku);
  });

  it("역이 없으면 적도라가 있어도 noYaku", () => {
    const hand = withRed(parse("123m 456m 345p 789s 55p"), [RED_5M, RED_5P]);
    const dora = countTotalDora({
      hand,
      doraIndicators: [],
      uraDoraIndicators: [],
      isRiichi: false,
      includeRedFives: true,
    });
    expect(dora).toBe(2);
    const result = calculateScore(
      { ...base, hand, winningTile: one("4p"), isRiichi: false },
      { dora },
    );
    expect(result.kind).toBe("noYaku");
  });
});
