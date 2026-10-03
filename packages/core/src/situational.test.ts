import { describe, expect, it } from "vitest";
import type { Tile, Wind } from "./tiles.js";
import type { CalledMeld } from "./call.js";
import type { WinContext } from "./yaku.js";
import { YAKUMAN_COUNT, YAKU_HAN, YAKU_NAMES, detectYaku } from "./yaku.js";
import { calculateScore, type ScoreResult } from "./score.js";

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
        tiles.push({ kind: "number", suit: suits[last as keyof typeof suits], rank: Number(ch) as 1, isRedFive: false });
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

const pon = (text: string): CalledMeld => {
  const t = parse(text) as [Tile, Tile, Tile];
  return { type: "pon", tiles: t, calledTile: t[0], fromSeat: 2, from: "right" };
};

/** 기본: 코(남), 장풍 서, 론, 멘젠 */
function ctx(hand: string, winning: string, melds: CalledMeld[] = [], overrides: Partial<WinContext> = {}): WinContext {
  return {
    hand: parse(hand),
    winningTile: parse(winning)[0]!,
    melds,
    isConcealed: true,
    winType: "ron",
    isRiichi: false,
    seatWind: "south",
    roundWind: "west",
    ...overrides,
  };
}

const ids = (c: WinContext): string[] => detectYaku(c).map((y) => y.id);

function score(c: WinContext, options: Parameters<typeof calculateScore>[1] = {}): ScoreResult {
  const r = calculateScore(c, options);
  if (r.kind !== "scored") throw new Error("역이 없음");
  return r;
}

/**
 * 기준 손패: 123m 456p 789s 234s + 99m, 당첨패 9m = 단기 대기.
 * 요구패가 있어 탕야오 아님, 멘츠가 모두 순자라 또이또이 아님, 단기라 핑후 아님 -> 상황 역이 없으면 역 없음.
 * 론 부수: 20 + 멘젠론 10 + 단기 2 = 32 -> 40부. 츠모 부수: 20 + 츠모 2 + 단기 2 = 24 -> 30부.
 */
const BASE_HAND = "123m 456p 789s 234s 99m";
const BASE_WIN = "9m";

describe("상황 역 이름 / 테이블", () => {
  it("표시 이름은 역.txt 표기와 같다", () => {
    expect(YAKU_NAMES.ippatsu).toBe("일발");
    expect(YAKU_NAMES.doubleRiichi).toBe("더블리치");
    expect(YAKU_NAMES.chankan).toBe("창깡");
    expect(YAKU_NAMES.rinshanKaihou).toBe("영상개화");
    expect(YAKU_NAMES.haiteiRaoyue).toBe("해저로월");
    expect(YAKU_NAMES.houteiRaoyui).toBe("하저로어");
    expect(YAKU_NAMES.tenhou).toBe("천화");
    expect(YAKU_NAMES.chiihou).toBe("지화");
  });

  it("판수: 일발 1, 더블리치 2, 창깡/영상개화/해저로월/하저로어 1, 천화/지화는 역만 1배", () => {
    expect(YAKU_HAN.ippatsu).toEqual({ menzen: 1, open: 0 });
    expect(YAKU_HAN.doubleRiichi).toEqual({ menzen: 2, open: 0 });
    for (const id of ["chankan", "rinshanKaihou", "haiteiRaoyue", "houteiRaoyui"] as const) {
      expect(YAKU_HAN[id]).toEqual({ menzen: 1, open: 1 });
    }
    expect(YAKU_HAN.tenhou).toEqual({ menzen: 0, open: 0 });
    expect(YAKU_HAN.chiihou).toEqual({ menzen: 0, open: 0 });
    expect(YAKUMAN_COUNT.tenhou).toBe(1);
    expect(YAKUMAN_COUNT.chiihou).toBe(1);
  });

  it("기준 손패는 상황 역이 없으면 역 없음 (도라가 있어도)", () => {
    expect(ids(ctx(BASE_HAND, BASE_WIN))).toEqual([]);
    expect(calculateScore(ctx(BASE_HAND, BASE_WIN), { dora: 3 })).toEqual({ kind: "noYaku" });
  });
});

describe("창깡 / 하저로어 (론)", () => {
  it("창깡만으로 화료: 1판 40부 = 기본점 320, 코 론 1300", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { isChankan: true });
    expect(ids(c)).toEqual(["chankan"]);
    const r = score(c);
    expect(r.yakuHan).toBe(1);
    expect(r.fu).toBe(40);
    expect(r.basePoints).toBe(320); // 40 x 2^3
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 1300 }); // 320 x 4 = 1280 -> 1300
  });

  it("하저로어만으로 화료: 1판 40부 코 론 1300, 친 론은 1920 -> 2000", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { isHoutei: true });
    expect(ids(c)).toEqual(["houteiRaoyui"]);
    expect(score(c).payment).toEqual({ type: "ron", fromDiscarder: 1300 });
    // 친 론: 320 x 6 = 1920 -> 2000
    expect(score({ ...c, seatWind: "east" }).payment).toEqual({ type: "ron", fromDiscarder: 2000 });
  });

  it("부로 손패에서도 창깡이 성립한다 (1판/1판)", () => {
    // 펑 222s + 123m 456p 789s... 손패 11장: 123m 456p 789p 99m (9m 단기)
    const c = ctx("123m 456p 789p 99m", "9m", [pon("222s")], { isConcealed: false, isChankan: true });
    expect(ids(c)).toEqual(["chankan"]);
  });

  it("창깡은 론 전용, 하저로어도 론 전용 (츠모에서는 무시)", () => {
    const tsumo = ctx(BASE_HAND, BASE_WIN, [], { winType: "tsumo", isChankan: true, isHoutei: true });
    expect(ids(tsumo)).toEqual(["menzenTsumo"]);
  });

  it("창깡이면 하저로어는 붙지 않는다", () => {
    expect(ids(ctx(BASE_HAND, BASE_WIN, [], { isChankan: true, isHoutei: true }))).toEqual(["chankan"]);
  });
});

describe("영상개화 / 해저로월 (츠모)", () => {
  it("영상개화 + 멘젠쯔모 = 2판 30부: 기본점 480, 코 츠모 친 1000 / 자 500", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { winType: "tsumo", isRinshan: true });
    expect(ids(c)).toEqual(["menzenTsumo", "rinshanKaihou"]);
    const r = score(c);
    expect(r.yakuHan).toBe(2);
    expect(r.fu).toBe(30);
    expect(r.basePoints).toBe(480); // 30 x 2^4
    // 친: 960 -> 1000, 자: 480 -> 500 x 2
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 1000, fromEachNonDealer: 500 });
    expect(r.total).toBe(2000);
  });

  it("해저로월 + 멘젠쯔모 = 2판 30부 (영상개화와 같은 점수)", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { winType: "tsumo", isHaitei: true });
    expect(ids(c)).toEqual(["menzenTsumo", "haiteiRaoyue"]);
    expect(score(c).total).toBe(2000);
  });

  it("영상패로 마지막 산패를 뽑은 경우(isRinshan + isHaitei)는 영상개화만 성립한다", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { winType: "tsumo", isRinshan: true, isHaitei: true });
    expect(ids(c)).toEqual(["menzenTsumo", "rinshanKaihou"]);
  });

  it("영상개화/해저로월은 츠모 전용 (론에서는 무시)", () => {
    expect(ids(ctx(BASE_HAND, BASE_WIN, [], { isRinshan: true, isHaitei: true }))).toEqual([]);
  });

  it("부로 손패에서도 영상개화는 1판 (쿠이: 멘젠쯔모 없음)", () => {
    const c = ctx("123m 456p 789p 99m", "9m", [pon("222s")], {
      isConcealed: false,
      winType: "tsumo",
      isRinshan: true,
    });
    expect(ids(c)).toEqual(["rinshanKaihou"]);
    // 20 + 츠모 2 + 펑 중장패 2 + 단기 2 = 26 -> 30부, 1판: 30 x 8 = 240
    const r = score(c);
    expect(r.fu).toBe(30);
    expect(r.basePoints).toBe(240);
  });
});

describe("일발 / 더블리치", () => {
  it("리치 + 일발 론 = 2판 40부: 코 2600", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { isRiichi: true, isIppatsu: true });
    expect(ids(c)).toEqual(["riichi", "ippatsu"]);
    const r = score(c);
    expect(r.basePoints).toBe(640); // 40 x 2^4
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 2600 });
  });

  it("리치 없이 일발 플래그만 있으면 무시한다", () => {
    expect(ids(ctx(BASE_HAND, BASE_WIN, [], { isIppatsu: true }))).toEqual([]);
  });

  it("일발은 멘젠 전용: 부로 손패에서는 불성립 (창깡만 남음)", () => {
    const c = ctx("123m 456p 789p 99m", "9m", [pon("222s")], {
      isConcealed: false,
      isRiichi: true,
      isIppatsu: true,
      isChankan: true,
    });
    expect(ids(c)).toEqual(["chankan"]);
  });

  it("안깡만 있는 손패(멘젠)는 일발이 유지된다", () => {
    const ankan: CalledMeld = { type: "ankan", tiles: parse("2222s") as [Tile, Tile, Tile, Tile] };
    const c = ctx("123m 456p 789p 99m", "9m", [ankan], { isRiichi: true, isIppatsu: true });
    expect(ids(c)).toContain("ippatsu");
  });

  it("더블리치는 리치를 대체한다: 2판 (리치는 부여하지 않음), 코 론 40부 2600", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { isRiichi: true, isDoubleRiichi: true });
    expect(ids(c)).toEqual(["doubleRiichi"]);
    const r = score(c);
    expect(r.yakuHan).toBe(2);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 2600 });
  });

  it("더블리치 플래그만 있어도 리치 상태로 간주한다", () => {
    expect(ids(ctx(BASE_HAND, BASE_WIN, [], { isDoubleRiichi: true }))).toEqual(["doubleRiichi"]);
  });

  it("더블리치 + 일발 = 3판 40부: 기본점 1280, 코 론 5200", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { isRiichi: true, isDoubleRiichi: true, isIppatsu: true });
    expect(ids(c)).toEqual(["doubleRiichi", "ippatsu"]);
    const r = score(c);
    expect(r.yakuHan).toBe(3);
    expect(r.basePoints).toBe(1280); // 40 x 2^5
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 5200 }); // 1280 x 4 = 5120 -> 5200
  });

  it("리치 + 일발 + 창깡 = 3판", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { isRiichi: true, isIppatsu: true, isChankan: true });
    expect(ids(c)).toEqual(["riichi", "ippatsu", "chankan"]);
    expect(score(c).yakuHan).toBe(3);
  });
});

describe("천화 / 지화 (역만 1배)", () => {
  const tsumo = { winType: "tsumo" as const };

  it("천화: 친 츠모, 기본점 8000, 올 16000 = 48000", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { ...tsumo, seatWind: "east", isTenhou: true });
    expect(ids(c)).toEqual(["tenhou"]);
    const r = score(c);
    expect(r.limit).toBe("yakuman");
    expect(r.yakumanCount).toBe(1);
    expect(r.basePoints).toBe(8000);
    expect(r.yakuHan).toBe(0);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 16000 });
    expect(r.total).toBe(48000);
  });

  it("지화: 자 츠모, 친 16000 + 자 8000 x 2 = 32000", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { ...tsumo, isChiihou: true });
    expect(ids(c)).toEqual(["chiihou"]);
    const r = score(c);
    expect(r.yakumanCount).toBe(1);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 16000, fromEachNonDealer: 8000 });
    expect(r.total).toBe(32000);
  });

  it("천화/지화는 일반 역과 도라를 무시한다 (리치/일발/영상개화/도라 3이 있어도 역만 1배)", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], {
      ...tsumo,
      isRiichi: true,
      isDoubleRiichi: true,
      isIppatsu: true,
      isRinshan: true,
      isHaitei: true,
      isChiihou: true,
    });
    expect(ids(c)).toEqual(["chiihou"]);
    const r = score(c, { dora: 3 });
    expect(r.yaku.map((y) => y.id)).toEqual(["chiihou"]);
    expect(r.dora).toBe(0);
    expect(r.total).toBe(32000);
  });

  it("본장/리치봉: 친 천화 1본장 + 리치봉 2 = (16000 + 100) x 3 + 2000 = 50300", () => {
    const c = ctx(BASE_HAND, BASE_WIN, [], { ...tsumo, seatWind: "east", isTenhou: true });
    const r = score(c, { honba: 1, riichiSticks: 2 });
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 16100 });
    expect(r.total).toBe(50300);
  });

  it("론이거나 부로 손패면 천화/지화는 불성립", () => {
    expect(ids(ctx(BASE_HAND, BASE_WIN, [], { isTenhou: true, isChiihou: true }))).toEqual([]);
    const open = ctx("123m 456p 789p 99m", "9m", [pon("222s")], {
      isConcealed: false,
      winType: "tsumo",
      isChiihou: true,
      isRinshan: true,
    });
    expect(ids(open)).toEqual(["rinshanKaihou"]);
  });

  it("다른 역만과 합산한다: 천화 + 스안커 = 2배, 기본점 16000, 올 32000 = 96000", () => {
    // 111m 222p 333s 444m + 99p, 4m 츠모 (샤보 완성) = 스안커 (단기 아님)
    const c = ctx("111m 444m 222p 333s 99p", "4m", [], { ...tsumo, seatWind: "east", isTenhou: true });
    expect(ids(c)).toEqual(["tenhou", "suuankou"]);
    const r = score(c);
    expect(r.yakumanCount).toBe(2);
    expect(r.basePoints).toBe(16000);
    expect(r.total).toBe(96000);
  });
});
