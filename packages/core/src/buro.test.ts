import { describe, expect, it } from "vitest";
import type { Tile, Wind } from "./tiles.js";
import type { CalledMeld } from "./call.js";
import type { WinContext } from "./yaku.js";
import { isAgari } from "./agari.js";
import { decomposeStandardHand } from "./meld.js";
import { detectYaku } from "./yaku.js";
import { calculateScore, type ScoreResult } from "./score.js";
import { countDora, countRedFives, countTotalDora } from "./dora.js";

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

// --- 멜드 생성 헬퍼 (좌석은 화료자 1, 상가 0 / 하가 2 고정) ---
const chi = (text: string): CalledMeld => {
  const t = parse(text) as [Tile, Tile, Tile];
  return { type: "chi", tiles: t, calledTile: t[0], fromSeat: 0, from: "left" };
};
const pon = (text: string): CalledMeld => {
  const t = parse(text) as [Tile, Tile, Tile];
  return { type: "pon", tiles: t, calledTile: t[0], fromSeat: 2, from: "right" };
};
const daiminkan = (text: string): CalledMeld => {
  const t = parse(text) as [Tile, Tile, Tile, Tile];
  return { type: "daiminkan", tiles: t, calledTile: t[0], fromSeat: 2, from: "right" };
};
const shouminkan = (text: string): CalledMeld => {
  const t = parse(text) as [Tile, Tile, Tile, Tile];
  return { type: "shouminkan", tiles: t, calledTile: t[0], fromSeat: 2, from: "right", addedTile: t[3] };
};
const ankan = (text: string): CalledMeld => {
  const t = parse(text) as [Tile, Tile, Tile, Tile];
  return { type: "ankan", tiles: t };
};

function ctx(hand: string, winning: string, melds: CalledMeld[], overrides: Partial<WinContext> = {}): WinContext {
  return {
    hand: parse(hand),
    winningTile: parse(winning)[0]!,
    melds,
    isConcealed: true, // 부로가 있으면 엔진이 멘젠 여부를 멜드로 다시 판정해야 한다
    winType: "ron",
    isRiichi: false,
    seatWind: "south",
    roundWind: "west",
    ...overrides,
  };
}

const ids = (c: WinContext) => detectYaku(c).map((y) => y.id);

function score(c: WinContext): ScoreResult {
  const r = calculateScore(c);
  if (r.kind !== "scored") throw new Error("역이 없음");
  return r;
}

describe("isAgari / decomposeStandardHand - 멜드 제외 손패", () => {
  it("멜드 1개: 11장 손패가 3멘츠+대자면 화료", () => {
    expect(isAgari(parse("234m 567m 55p 999s"), [pon("111m")])).toBe(true);
  });

  it("멜드 4개: 대자 2장만 남아도 화료 (단기)", () => {
    const melds = [chi("123p"), pon("777s"), daiminkan("1111m"), ankan("2222s")];
    expect(isAgari(parse("EE"), melds)).toBe(true);
    expect(isAgari(parse("EN"), melds)).toBe(false);
  });

  it("손패 장수가 14 - 3 * 멜드 수가 아니면 false", () => {
    expect(isAgari(parse("234m 567m 55p 999s"), [])).toBe(false);
    expect(isAgari(parse("234m 567m 55p 999s 123p"), [pon("111m")])).toBe(false);
  });

  it("멜드가 있으면 치토이츠는 성립하지 않는다", () => {
    expect(isAgari(parse("11m 22m 33m 44m 55m 66m 77m"))).toBe(true);
    expect(isAgari(parse("11m 22m 33m 44m 55m"), [pon("111p")])).toBe(false);
  });

  it("decomposeStandardHand는 calledMeldCount만큼 적은 멘츠로 분해한다", () => {
    const result = decomposeStandardHand(parse("234m 567m 55p 999s"), 1);
    expect(result).toHaveLength(1);
    expect(result[0]!.melds).toHaveLength(3);
    expect(() => decomposeStandardHand(parse("234m 567m 55p 999s"), 0)).toThrow();
  });
});

describe("역 - 부로 손패", () => {
  it("부로하면 리치/멘젠츠모/핑후/이페이코는 성립하지 않고 탕야오(쿠이탄)는 성립한다", () => {
    const c = ctx("234m 456s 678s 55p", "5p", [chi("345p")], { isRiichi: true, winType: "tsumo" });
    expect(ids(c)).toEqual(["tanyao"]);
  });

  it("이페이코 형태라도 부로하면 성립하지 않는다", () => {
    const c = ctx("234m 234m 456s 88p", "8p", [chi("345p")]);
    expect(ids(c)).toEqual(["tanyao"]);
  });

  it("안깡만 있으면 멘젠이 유지되어 리치/멘젠츠모가 성립한다", () => {
    const c = ctx("345p 678s 234s 99p", "9p", [ankan("2222m")], { isRiichi: true, winType: "tsumo" });
    expect(ids(c)).toEqual(expect.arrayContaining(["riichi", "menzenTsumo"]));
  });

  it("안깡이 있어도 핑후는 성립하지 않는다 (각자가 있으므로)", () => {
    const c = ctx("345p 678s 234s 99p", "3p", [ankan("2222m")]);
    expect(ids(c)).not.toContain("pinfu");
  });

  it("부로 멜드의 역패(펑)와 또이또이가 성립한다", () => {
    const c = ctx("888p 222s 99m", "9m", [pon("PPP"), pon("SSS")]);
    expect(ids(c)).toEqual(expect.arrayContaining(["toitoi", "yakuhaiDragon", "yakuhaiSeatWind"]));
  });

  it("깡 멜드도 역패로 인정된다", () => {
    const c = ctx("234p 567s 88m", "2p", [daiminkan("CCCC"), chi("123m")]);
    expect(ids(c)).toContain("yakuhaiDragon");
  });

  it("탕야오는 멜드의 패도 검사한다 (멜드에 1/9/자패가 있으면 불성립)", () => {
    const c = ctx("234p 567s 55m", "2p", [pon("999m"), chi("456m")]);
    expect(ids(c)).not.toContain("tanyao");
  });

  it("삼안커: 안깡 + 안커 2개 (탕키 론)", () => {
    const c = ctx("555m 888p 99s", "9s", [ankan("2222m"), pon("EEE")]);
    expect(ids(c)).toContain("sanankou");
  });

  it("삼안커: 론으로 완성된 샤보 각자는 안커로 세지 않는다", () => {
    const c = ctx("555m 888p 99s", "5m", [ankan("2222m"), pon("EEE")]);
    expect(ids(c)).not.toContain("sanankou");
  });

  it("삼안커: 츠모로 완성된 샤보 각자는 안커로 센다", () => {
    const c = ctx("555m 888p 99s", "5m", [ankan("2222m"), pon("EEE")], { winType: "tsumo" });
    expect(ids(c)).toContain("sanankou");
  });

  it("손패 장수가 멜드 수와 맞지 않으면 에러", () => {
    expect(() => detectYaku(ctx("234m 456s 678s 55p 345p", "5p", [chi("345p")]))).toThrow();
  });
});

describe("점수 - 부로 손패", () => {
  it("부로 론 20부 형태(쿠이핑후)는 30부: 탕야오 1판 30부 론 1000점", () => {
    const r = score(ctx("345m 456s 678s 66m", "3m", [chi("234p")]));
    expect(r.fu).toBe(30);
    expect(r.han).toBe(1);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 1000 });
  });

  it("부로 츠모 22부는 30부 (멘젠츠모 없음)", () => {
    const r = score(ctx("345m 456s 678s 66m", "3m", [chi("234p")], { winType: "tsumo" }));
    expect(r.fu).toBe(30);
    expect(r.yaku.map((y) => y.id)).toEqual(["tanyao"]);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 500, fromEachNonDealer: 300 });
  });

  it("멜드 부수: 펑 요구패 4 + 안깡 중장패 16 (론, 부로라 멘젠 가산 없음) = 40부", () => {
    const r = score(ctx("234p 567s 88m", "2p", [pon("CCC"), ankan("5555m")]));
    expect(r.fu).toBe(40);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 1300 });
  });

  it("멜드 부수: 대명깡 중장패 8 + 펑 요구패 4 = 32 → 40부", () => {
    const r = score(ctx("234p 567s 88m", "2p", [daiminkan("5555m"), pon("PPP")]));
    expect(r.fu).toBe(40);
  });

  it("멜드 부수: 가깡은 명깡으로 계산 (요구패 16)", () => {
    // 20 + 16 (가깡 1m) + 4 (자풍 펑) = 40부
    const r = score(ctx("234p 567s 88m", "2p", [shouminkan("1111m"), pon("SSS")]));
    expect(r.fu).toBe(40);
  });

  it("멜드 부수: 요구패 안깡 32 + 자풍 펑 4 = 56 → 60부, 1판 60부 론 2000", () => {
    const r = score(ctx("234p 567s 88m", "2p", [ankan("1111m"), pon("SSS")]));
    expect(r.fu).toBe(60);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 2000 });
  });

  it("치는 0부: 치만 있고 쿠이핑후 형태면 30부", () => {
    const r = score(ctx("234p 567s 88m", "2p", [chi("123m"), pon("CCC")]));
    // 20 + 4 (중 펑) = 24 → 30부
    expect(r.fu).toBe(30);
  });

  it("안깡만 있는 손패는 멘젠 론 가산(+10)이 유지된다", () => {
    // 20 + 10 (멘젠 론) + 16 (2m 안깡) = 46 → 50부, 리치 1판
    const r = score(ctx("345p 678s 234s 99p", "3p", [ankan("2222m")], { isRiichi: true }));
    expect(r.fu).toBe(50);
    expect(r.han).toBe(1);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 1600 });
  });

  it("삼안커는 2판으로 계산된다 (리치 + 멘젠츠모 + 삼안커 = 4판)", () => {
    const r = score(ctx("555p 888s 234m 99s", "9s", [ankan("2222m")], { isRiichi: true, winType: "tsumo" }));
    expect(r.yaku.map((y) => y.id)).toEqual(expect.arrayContaining(["riichi", "menzenTsumo", "sanankou"]));
    expect(r.han).toBe(4);
    expect(r.limit).toBe("mangan"); // 20 + 2 + 4 + 4 + 16 + 2 = 48 → 50부 4판 = 3200 → 만관 상한
  });

  it("isConcealed=true여도 부로 멜드가 있으면 멘젠 취급하지 않는다 (리치 불성립 → 역 없음)", () => {
    const c = ctx("234p 567s 88m", "2p", [chi("123m"), chi("456m")], { isRiichi: true });
    expect(calculateScore(c)).toEqual({ kind: "noYaku" });
  });

  it("isConcealed=false인데 부로 멜드가 없으면 에러, 안깡만 있어도 에러", () => {
    expect(() => calculateScore(ctx("234m 456m 345p 678s 55p", "2m", [], { isConcealed: false }))).toThrow();
    expect(() =>
      calculateScore(ctx("345p 678s 234s 99p", "3p", [ankan("2222m")], { isConcealed: false })),
    ).toThrow();
  });

  it("멜드가 있는데 14장 손패를 주면 에러", () => {
    expect(() => calculateScore(ctx("234m 456m 345p 678s 55p", "2m", [chi("123s")]))).toThrow();
  });
});

describe("도라 - 멜드 포함", () => {
  const hand = parse("234p 567s 88m");
  const melds = [pon("222m"), daiminkan("3333p")];

  it("멜드의 패도 도라로 센다 (깡은 4장 모두)", () => {
    // 표시패 1m → 도라 2m: 펑 3장 / 표시패 2p → 도라 3p: 대명깡 4장 + 손패 3p 1장
    expect(countDora(hand, [parse("1m")[0]!], melds)).toBe(3);
    expect(countDora(hand, [parse("2p")[0]!], melds)).toBe(5);
  });

  it("표시패가 여러 장이면 합산한다", () => {
    expect(countDora(hand, parse("1m 2p"), melds)).toBe(8);
  });

  it("가깡/안깡의 4장도 모두 센다", () => {
    expect(countDora(hand, [parse("1s")[0]!], [ankan("2222s"), pon("EEE")])).toBe(4);
    expect(countDora(hand, [parse("1s")[0]!], [shouminkan("2222s"), pon("EEE")])).toBe(4);
  });

  it("멜드 안의 적5도 센다", () => {
    const red: Tile = { kind: "number", suit: "man", rank: 5, isRedFive: true };
    const redPon: CalledMeld = {
      type: "pon",
      tiles: [red, ...(parse("55m") as [Tile, Tile])],
      calledTile: red,
      fromSeat: 2,
      from: "right",
    };
    expect(countRedFives(hand, [redPon, pon("EEE")])).toBe(1);
    expect(countRedFives(hand, melds)).toBe(0);
  });

  it("countTotalDora는 melds를 겉도라/뒷도라/적도라 모두에 반영한다", () => {
    const total = countTotalDora({
      hand,
      melds,
      doraIndicators: [parse("1m")[0]!],
      uraDoraIndicators: [parse("2p")[0]!],
      isRiichi: true,
      includeRedFives: true,
    });
    expect(total).toBe(8);
  });

  it("손패 장수가 14 - 3 * 멜드 수가 아니면 에러 (멜드 없이 11장도 에러)", () => {
    expect(() => countDora(hand, [], [])).toThrow();
    expect(() => countDora(parse("234p 567s 88m 123m 99p"), [], melds)).toThrow();
    expect(() => countRedFives(hand)).toThrow();
  });

  it("melds 생략 시 기존과 같이 14장 멘젠 손패로 동작한다", () => {
    expect(countDora(parse("234m 456m 345p 678s 55p"), [parse("1m")[0]!])).toBe(1);
  });
});
