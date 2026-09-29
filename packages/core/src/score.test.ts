import { describe, expect, it } from "vitest";
import type { Tile, Wind } from "./tiles.js";
import type { WinContext } from "./yaku.js";
import { calculateScore, type ScoreOptions, type ScoreResult } from "./score.js";

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

function ctx(hand: string, winning: string, overrides: Partial<WinContext> = {}): WinContext {
  return {
    hand: parse(hand),
    winningTile: parse(winning)[0]!,
    isConcealed: true,
    winType: "ron",
    isRiichi: false,
    seatWind: "south",
    roundWind: "east",
    ...overrides,
  };
}

function score(c: WinContext, options?: ScoreOptions): ScoreResult {
  const result = calculateScore(c, options);
  if (result.kind !== "scored") throw new Error("역이 없음");
  return result;
}

const PINFU_TANYAO = "234m 456m 345p 678s 55p"; // 리치+핑후+탕야오 (2m 대기)
const PINFU_HAND = "123m 456m 345p 678s 99p"; // 핑후 전용 (1m 대기)

describe("calculateScore - 점수표 사례", () => {
  it("30부 3판 코 론: 3900", () => {
    const r = score(ctx(PINFU_TANYAO, "2m", { isRiichi: true }));
    expect(r.han).toBe(3);
    expect(r.fu).toBe(30);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 3900 });
    expect(r.total).toBe(3900);
  });

  it("30부 3판 오야 론: 5800", () => {
    const r = score(ctx(PINFU_TANYAO, "2m", { isRiichi: true, seatWind: "east" }));
    expect(r.isDealer).toBe(true);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 5800 });
  });

  it("20부 2판 핑후 츠모 (코): 400/700", () => {
    const r = score(ctx(PINFU_HAND, "1m", { winType: "tsumo" }));
    expect(r.yaku.map((y) => y.id).sort()).toEqual(["menzenTsumo", "pinfu"]);
    expect(r.fu).toBe(20);
    expect(r.han).toBe(2);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 700, fromEachNonDealer: 400 });
    expect(r.total).toBe(1500);
  });

  it("20부 2판 핑후 츠모 (오야): 700 올", () => {
    const r = score(ctx(PINFU_HAND, "1m", { winType: "tsumo", seatWind: "east" }));
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 700 });
    expect(r.total).toBe(2100);
  });

  it("핑후 론은 30부", () => {
    const r = score(ctx(PINFU_HAND, "1m", { isRiichi: true }));
    expect(r.fu).toBe(30);
    expect(r.han).toBe(2);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 2000 });
  });

  it("25부 2판 치토이츠 론: 1600", () => {
    const r = score(ctx("11m 33m 55p 77p 99s 22s EE", "1m"));
    expect(r.yaku.map((y) => y.id)).toEqual(["chiitoitsu"]);
    expect(r.fu).toBe(25);
    expect(r.han).toBe(2);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 1600 });
  });

  it("치토이츠 + 탕야오 3판 25부 론: 3200", () => {
    const r = score(ctx("22m 33m 44p 66p 77s 88s 55s", "2m"));
    expect(r.han).toBe(3);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 3200 });
  });
});

describe("calculateScore - 부수", () => {
  it("역패 각자 안커(요구패 8) + 간짱 + 멘젠 론 = 40부", () => {
    const r = score(ctx("CCC 234m 567p 678s 99p", "3m"));
    expect(r.fu).toBe(40);
    expect(r.han).toBe(1);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 1300 });
  });

  it("츠모 샤보 대기: 각자는 안커 (30부, 역패+멘젠츠모 2판 500/1000)", () => {
    const r = score(ctx("CCC 234m 567p 678s 99p", "C", { winType: "tsumo" }));
    expect(r.fu).toBe(30);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 1000, fromEachNonDealer: 500 });
  });

  it("론 샤보 대기: 완성된 각자는 밍커 취급 (안커 4 + 밍커 요구패 4 -> 40부)", () => {
    const r = score(ctx("555s 999p 234m 678m 22p", "9p", { isRiichi: true }));
    expect(r.fu).toBe(40);
  });

  it("단기 대기 +2", () => {
    const r = score(ctx("234m 567m 234p 678s 99s", "9s", { isRiichi: true }));
    expect(r.fu).toBe(40);
  });

  it("더블동 대자는 4부 (오야, 자풍=장풍=동)", () => {
    const hand = "111m 234p 567s 678s EE";
    const double = score(ctx(hand, "2p", { isRiichi: true, seatWind: "east", roundWind: "east" }));
    const single = score(ctx(hand, "2p", { isRiichi: true, seatWind: "south", roundWind: "east" }));
    expect(double.fu).toBe(50); // 20+10+8+4=42
    expect(single.fu).toBe(40); // 20+10+8+2=40
  });
});

describe("calculateScore - 한도/도라", () => {
  it("도라를 더해 만관/하네만/배만/삼배만/헤아림 역만", () => {
    const c = ctx(PINFU_TANYAO, "2m", { isRiichi: true }); // 3판 30부
    const ron = (dora: number) => score(c, { dora });
    expect(ron(2).limit).toBe("mangan");
    expect(ron(2).payment).toEqual({ type: "ron", fromDiscarder: 8000 });
    expect(ron(3).limit).toBe("haneman");
    expect(ron(3).payment).toEqual({ type: "ron", fromDiscarder: 12000 });
    expect(ron(5).limit).toBe("baiman");
    expect(ron(5).payment).toEqual({ type: "ron", fromDiscarder: 16000 });
    expect(ron(8).limit).toBe("sanbaiman");
    expect(ron(8).payment).toEqual({ type: "ron", fromDiscarder: 24000 });
    expect(ron(10).limit).toBe("yakuman");
    expect(ron(10).payment).toEqual({ type: "ron", fromDiscarder: 32000 });
  });

  it("오야 만관 론 12000, 코 만관 츠모 2000/4000", () => {
    const dealer = score(ctx(PINFU_TANYAO, "2m", { isRiichi: true, seatWind: "east" }), { dora: 2 });
    expect(dealer.payment).toEqual({ type: "ron", fromDiscarder: 12000 });
    const tsumo = score(ctx(PINFU_TANYAO, "2m", { isRiichi: true, winType: "tsumo" }), { dora: 1 });
    expect(tsumo.han).toBe(5); // 리치+츠모+핑후+탕야오+도라1
    expect(tsumo.payment).toEqual({ type: "tsumo", fromDealer: 4000, fromEachNonDealer: 2000 });
  });

  it("4판 30부는 절상만관 없이 7700", () => {
    const r = score(ctx(PINFU_TANYAO, "2m", { isRiichi: true }), { dora: 1 });
    expect(r.han).toBe(4);
    expect(r.basePoints).toBe(1920);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 7700 });
  });

  it("4판 40부 이상은 만관", () => {
    const r = score(ctx("CCC 234m 567p 678s 99p", "3m", { isRiichi: true }), { dora: 2 });
    expect(r.han).toBe(4);
    expect(r.fu).toBe(40);
    expect(r.limit).toBe("mangan");
  });
});

describe("calculateScore - 본장/리치봉", () => {
  it("론: 본장 300점씩 + 리치봉", () => {
    const r = score(ctx(PINFU_TANYAO, "2m", { isRiichi: true }), { honba: 2, riichiSticks: 1 });
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 4500 });
    expect(r.total).toBe(5500);
  });

  it("츠모: 본장 100점씩 각자 추가", () => {
    const r = score(ctx(PINFU_HAND, "1m", { winType: "tsumo" }), { honba: 2 });
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 900, fromEachNonDealer: 600 });
    expect(r.total).toBe(2100);
  });
});

describe("calculateScore - 최적 분해 선택", () => {
  it("222333444m 는 순자 3벌(이페이코+핑후+탕야오 30부)이 각자 해석보다 높다", () => {
    const r = score(ctx("222333444m 567p 88s", "2m"));
    expect(r.yaku.map((y) => y.id).sort()).toEqual(["iipeikou", "pinfu", "tanyao"]);
    expect(r.han).toBe(3);
    expect(r.fu).toBe(30);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 3900 });
  });

  it("치토이츠와 표준형이 모두 가능하면 더 높은 쪽을 채택", () => {
    // 치토이츠 후보: 리치1+치토이츠2 = 3판 25부 -> 기본점 800 (론 3200)
    // 표준형 후보: 123m x2 + 456m x2 + 77m, 1m은 23m 양면 -> 리치+핑후+이페이코 3판 30부 -> 기본점 960 (론 3900)
    const r = score(ctx("11m 22m 33m 44m 55m 66m 77m", "1m", { isRiichi: true }));
    expect(r.yaku.map((y) => y.id).sort()).toEqual(["iipeikou", "pinfu", "riichi"]);
    expect(r.han).toBe(3);
    expect(r.fu).toBe(30);
    expect(r.basePoints).toBe(960);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 3900 });
  });

  it("삼원패 각자 2개는 역패 2판", () => {
    const r = score(ctx("PPP FFF 234m 567p 99s", "3m"));
    expect(r.yaku.filter((y) => y.id === "yakuhaiDragon")).toHaveLength(2);
    expect(r.han).toBe(2);
  });
});

describe("calculateScore - 역 없음/입력 오류", () => {
  it("역이 없으면 noYaku (도라가 있어도 마찬가지)", () => {
    const c = ctx("234m 567m 234p 678s 99s", "3m"); // 간짱 대기 -> 핑후 아님
    expect(calculateScore(c)).toEqual({ kind: "noYaku" });
    expect(calculateScore(c, { dora: 3 })).toEqual({ kind: "noYaku" });
  });

  it("14장이 아니면 에러", () => {
    expect(() => calculateScore(ctx("234m", "2m"))).toThrow("14장");
    // 13장 (텐파이 상태)
    expect(() => calculateScore(ctx("123m 456m 789m 12p 77s 99s", "1m"))).toThrow("14장");
  });

  it("14장이지만 화료형이 아니면 에러", () => {
    // 3+3+2+2+2+2 = 14장, 손패에 1m 포함, 화료형 아님 (isAgari 경로)
    expect(() => calculateScore(ctx("123m 456m 12p 45p 77s 99s", "1m"))).toThrow("화료 형태");
  });

  it("winningTile이 손패에 없으면 에러", () => {
    // 유효한 화료 손패이지만 9s는 손패에 없음
    expect(() => calculateScore(ctx(PINFU_HAND, "9s", { isRiichi: true }))).toThrow("winningTile");
  });

  it("멘젠이 아니면 에러", () => {
    expect(() => calculateScore(ctx(PINFU_TANYAO, "2m", { isConcealed: false }))).toThrow();
  });

  it("dora/honba/riichiSticks는 0 이상의 정수여야 한다 (소수/NaN/Infinity/음수는 에러)", () => {
    const c = ctx(PINFU_HAND, "1m", { isRiichi: true });
    const keys = ["dora", "honba", "riichiSticks"] as const;
    for (const key of keys) {
      for (const bad of [1.5, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
        const opts: ScoreOptions = {};
        opts[key] = bad;
        expect(() => calculateScore(c, opts), `${key}=${bad}`).toThrow(key);
      }
      const zero: ScoreOptions = {};
      zero[key] = 0;
      expect(() => calculateScore(c, zero)).not.toThrow();
    }
  });
});

describe("calculateScore - 핑후 양면+단기 동시 해석", () => {
  it("4m이 양면(23m+4m)으로도 단기(44m)로도 해석되면 양면이 채택되어 핑후가 붙는다", () => {
    const r = score(ctx("23444m 234p 567p 678s", "4m"));
    expect(r.yaku.map((y) => y.id).sort()).toEqual(["pinfu", "tanyao"]);
    expect(r.han).toBe(2);
    expect(r.fu).toBe(30); // 단기 해석이면 40부(핑후 없음, 1판 1300)지만 양면 30부 2판이 더 높다
    expect(r.basePoints).toBe(480);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 2000 });
  });
});

describe("calculateScore - 40부/50부 부수 조합", () => {
  // 손패: 1m 각자(요구패 안커 8) + 3p 간짱 (론 시 20+10+8+2)
  const KANCHAN_YAOCHU = "111m 234p 567s 678s 99p";
  // 손패: 5m 각자(중장패 안커 4) + 4p 양면
  const MIDDLE_TRIPLET = "555m 234p 567s 678s 99p";
  // 손패: 요구패 안커 2개(1m, 9p) + 4s 양면
  const TWO_YAOCHU = "111m 999p 234s 567s 55p";
  // 손패: 요구패 안커(1m) + 중장패 안커(5p) + 4s 양면
  const MIXED = "111m 555p 234s 678s 99p";

  it("올림 경계: 정확히 40부 (20+10+8+2) 는 올림 없음, 리치 1판 1300", () => {
    const r = score(ctx(KANCHAN_YAOCHU, "3p", { isRiichi: true }));
    expect(r.fu).toBe(40);
    expect(r.han).toBe(1);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 1300 });
  });

  it("올림 경계: 정확히 30부 (츠모 20+2+8) 는 올림 없음, 리치+츠모 2판 500/1000", () => {
    const r = score(ctx(KANCHAN_YAOCHU, "4p", { isRiichi: true, winType: "tsumo" }));
    expect(r.fu).toBe(30);
    expect(r.han).toBe(2);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 1000, fromEachNonDealer: 500 });
    expect(r.total).toBe(2000);
  });

  it("40부 2판 코 론: 2600 (론 20+10+중장패 안커4=34 -> 40, 도라1)", () => {
    const r = score(ctx(MIDDLE_TRIPLET, "4p", { isRiichi: true }), { dora: 1 });
    expect(r.fu).toBe(40);
    expect(r.han).toBe(2);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 2600 });
  });

  it("40부 2판 오야 론: 3900", () => {
    const r = score(ctx(MIDDLE_TRIPLET, "4p", { isRiichi: true, seatWind: "east" }), { dora: 1 });
    expect(r.fu).toBe(40);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 3900 });
  });

  it("40부 2판 코 츠모: 700/1300 (츠모 20+2+8+간짱2=32 -> 40)", () => {
    const r = score(ctx(KANCHAN_YAOCHU, "3p", { isRiichi: true, winType: "tsumo" }));
    expect(r.fu).toBe(40);
    expect(r.han).toBe(2);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 1300, fromEachNonDealer: 700 });
    expect(r.total).toBe(2700);
  });

  it("40부 3판 코 론: 5200", () => {
    const r = score(ctx(KANCHAN_YAOCHU, "3p", { isRiichi: true }), { dora: 2 });
    expect(r.fu).toBe(40);
    expect(r.han).toBe(3);
    expect(r.basePoints).toBe(1280);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 5200 });
  });

  it("40부 3판 오야 츠모: 2600 올", () => {
    const r = score(ctx(KANCHAN_YAOCHU, "3p", { isRiichi: true, winType: "tsumo", seatWind: "east" }), {
      dora: 1,
    });
    expect(r.fu).toBe(40);
    expect(r.han).toBe(3);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 2600 });
    expect(r.total).toBe(7800);
  });

  it("50부 2판 코 론: 3200 (요구패 안커 2개 + 멘젠 론 = 46 -> 50, 도라1)", () => {
    const r = score(ctx(TWO_YAOCHU, "4s", { isRiichi: true }), { dora: 1 });
    expect(r.fu).toBe(50);
    expect(r.han).toBe(2);
    expect(r.basePoints).toBe(800);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 3200 });
  });

  it("50부 2판 오야 론: 4800", () => {
    const r = score(ctx(TWO_YAOCHU, "4s", { isRiichi: true, seatWind: "east" }), { dora: 1 });
    expect(r.fu).toBe(50);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 4800 });
  });

  it("같은 손패 츠모는 20+2+16=38 -> 40부 (론과 부수가 다름)", () => {
    const r = score(ctx(TWO_YAOCHU, "4s", { isRiichi: true, winType: "tsumo" }));
    expect(r.fu).toBe(40);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 1300, fromEachNonDealer: 700 });
  });

  it("요구패 안커 + 중장패 안커 혼합: 론 20+10+8+4=42 -> 50, 1판 1600", () => {
    const r = score(ctx(MIXED, "4s", { isRiichi: true }));
    expect(r.fu).toBe(50);
    expect(r.han).toBe(1);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 1600 });
  });

  it("요구패 안커 + 중장패 안커 혼합: 츠모 20+2+8+4=34 -> 40, 2판 700/1300", () => {
    const r = score(ctx(MIXED, "4s", { isRiichi: true, winType: "tsumo" }));
    expect(r.fu).toBe(40);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 1300, fromEachNonDealer: 700 });
  });
});

describe("calculateScore - 오야 리치 츠모 지불 총액", () => {
  it("오야 리치+츠모+핑후+탕야오 4판 20부: 2600 올, 본장 2/리치봉 1 포함", () => {
    const c = ctx(PINFU_TANYAO, "2m", { isRiichi: true, winType: "tsumo", seatWind: "east" });
    const r = score(c, { honba: 2, riichiSticks: 1 });
    expect(r.han).toBe(4);
    expect(r.fu).toBe(20);
    expect(r.basePoints).toBe(1280);
    expect(r.isDealer).toBe(true);
    expect(r.payment.type).toBe("tsumo");
    if (r.payment.type !== "tsumo") throw new Error("츠모 지불이 아님");
    expect(r.payment.fromDealer).toBeNull();
    expect(r.payment.fromEachNonDealer).toBe(2800); // 2560 -> 2600 + 본장 200
    expect(r.total).toBe(2800 * 3 + 1000);
  });
});

describe("calculateScore - 요구패 안커 + 샤보 밍커", () => {
  // 중 안커(8) + 9p 각자 + 5p 대자 (9p 샤보)
  const SHANPON_YAOCHU = "CCC 999p 234m 678s 55p";
  // 중 안커(8) + 5p 각자 + 9s 대자 (5p 샤보)
  const SHANPON_MIDDLE = "CCC 555p 234m 678s 99s";

  it("론 요구패 샤보: 완성 각자만 밍커 4, 다른 요구패 안커는 8 유지 (20+10+8+4=42 -> 50)", () => {
    const r = score(ctx(SHANPON_YAOCHU, "9p", { isRiichi: true }));
    expect(r.yaku.map((y) => y.id).sort()).toEqual(["riichi", "yakuhaiDragon"]);
    expect(r.fu).toBe(50); // 둘 다 밍커 취급이면 38 -> 40
    expect(r.han).toBe(2);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 3200 });
  });

  it("츠모 요구패 샤보: 둘 다 안커 (20+2+8+8=38 -> 40, 3판 1300/2600)", () => {
    const r = score(ctx(SHANPON_YAOCHU, "9p", { isRiichi: true, winType: "tsumo" }));
    expect(r.fu).toBe(40);
    expect(r.han).toBe(3);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 2600, fromEachNonDealer: 1300 });
  });

  it("론 중장패 샤보: 완성 각자 밍커 2 (20+10+8+2=40), 안커였다면 42 -> 50", () => {
    const shanpon = score(ctx(SHANPON_MIDDLE, "5p", { isRiichi: true }));
    expect(shanpon.fu).toBe(40);
    expect(shanpon.payment).toEqual({ type: "ron", fromDiscarder: 2600 });
    // 같은 각자가 샤보로 완성되지 않은 경우(2m 양면)에는 안커 4
    const anko = score(ctx(SHANPON_MIDDLE, "4m", { isRiichi: true }));
    expect(anko.fu).toBe(50);
  });
});
