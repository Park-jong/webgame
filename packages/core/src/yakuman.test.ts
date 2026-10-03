import { describe, expect, it } from "vitest";
import type { Tile, Wind } from "./tiles.js";
import type { CalledMeld } from "./call.js";
import type { WinContext, YakuId } from "./yaku.js";
import {
  YAKUMAN_COUNT,
  YAKU_HAN,
  YAKU_NAMES,
  bestYakuman,
  detectYaku,
  yakumanCandidates,
  yakumanMultiplier,
} from "./yaku.js";
import { isAgari } from "./agari.js";
import { isKokushiHand } from "./meld.js";
import { calculateKokushiShanten, calculateShanten, isTenpai } from "./shanten.js";
import { isTenpaiWithMelds } from "./ryuukyoku.js";
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

/** 기본: 코(남), 장풍 서, 론, 멘젠. melds가 있으면 엔진이 멘젠 여부를 멜드로 다시 판정한다. */
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

// ---------------------------------------------------------------------------
// 이름 통일 / 테이블
// ---------------------------------------------------------------------------

describe("역 표시 이름 (역.txt 표기)", () => {
  it("기존 11개 역의 이름이 명세 0장 표와 같다", () => {
    expect(YAKU_NAMES.riichi).toBe("리치");
    expect(YAKU_NAMES.menzenTsumo).toBe("멘젠쯔모");
    expect(YAKU_NAMES.pinfu).toBe("핑후");
    expect(YAKU_NAMES.tanyao).toBe("탕야오");
    expect(YAKU_NAMES.yakuhaiDragon).toBe("삼원패");
    expect(YAKU_NAMES.yakuhaiSeatWind).toBe("자풍패");
    expect(YAKU_NAMES.yakuhaiRoundWind).toBe("장풍패");
    expect(YAKU_NAMES.iipeikou).toBe("이페코");
    expect(YAKU_NAMES.toitoi).toBe("또이또이");
    expect(YAKU_NAMES.sanankou).toBe("산안커");
    expect(YAKU_NAMES.chiitoitsu).toBe("치또이쯔");
  });

  it("역만/더블역만 이름이 역.txt 표기와 같다", () => {
    expect(YAKU_NAMES.daisangen).toBe("대삼원");
    expect(YAKU_NAMES.suuankou).toBe("스안커");
    expect(YAKU_NAMES.tsuuiisou).toBe("자일색");
    expect(YAKU_NAMES.ryuuiisou).toBe("녹일색");
    expect(YAKU_NAMES.chinroutou).toBe("청노두");
    expect(YAKU_NAMES.kokushiMusou).toBe("국사무쌍");
    expect(YAKU_NAMES.shousuushii).toBe("소사희");
    expect(YAKU_NAMES.suukantsu).toBe("스깡쯔");
    expect(YAKU_NAMES.chuurenPoutou).toBe("구련보등");
    expect(YAKU_NAMES.suuankouTanki).toBe("스안커 단기");
    expect(YAKU_NAMES.kokushiMusou13).toBe("국사무쌍 13면 대기");
    expect(YAKU_NAMES.junseiChuurenPoutou).toBe("순정구련보등");
    expect(YAKU_NAMES.daisuushii).toBe("대사희");
  });

  it("역만 9종은 배수 1, 더블역만 4종은 배수 2이고 판수는 0이다", () => {
    const single: YakuId[] = [
      "daisangen", "suuankou", "tsuuiisou", "ryuuiisou", "chinroutou",
      "kokushiMusou", "shousuushii", "suukantsu", "chuurenPoutou",
    ];
    const double: YakuId[] = ["suuankouTanki", "kokushiMusou13", "junseiChuurenPoutou", "daisuushii"];
    for (const id of single) expect(YAKUMAN_COUNT[id]).toBe(1);
    for (const id of double) expect(YAKUMAN_COUNT[id]).toBe(2);
    for (const id of [...single, ...double]) expect(YAKU_HAN[id]).toEqual({ menzen: 0, open: 0 });
    expect(YAKUMAN_COUNT.riichi).toBeUndefined();
    expect(yakumanMultiplier(["daisangen", "tsuuiisou", "suuankouTanki"])).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// 국사무쌍: 화료 형태 / 샹텐 / 텐파이
// ---------------------------------------------------------------------------

describe("국사무쌍 형태 (isAgari / 샹텐 / 텐파이)", () => {
  const K13 = "19m 19p 19s ESWN PFC"; // 요구패 13종 1장씩 (13장)

  it("요구패 13종 + 그중 1장 중복 14장은 화료 형태다", () => {
    expect(isAgari(parse(`${K13} 1m`))).toBe(true);
    expect(isAgari(parse(`${K13} C`))).toBe(true);
    expect(isKokushiHand(parse(`${K13} 9s`))).toBe(true);
  });

  it("요구패가 아닌 패가 섞이거나 한 종류가 빠지면 화료 형태가 아니다", () => {
    expect(isAgari(parse("19m 19p 19s ESWN PF 2m 1m"))).toBe(false); // 중 대신 2m
    expect(isAgari(parse("19m 19p 19s ESWN PF 11m"))).toBe(false); // 중 없음 + 1m 3장
    expect(isKokushiHand(parse(K13))).toBe(false); // 13장
  });

  it("멜드가 있으면 국사무쌍은 성립하지 않는다 (멘젠 전용)", () => {
    expect(isAgari(parse("19m 19p ESWN PFC"), [pon("NNN")])).toBe(false);
  });

  it("국사무쌍 샹텐: 13면 대기와 12종+중복은 0, 완성은 -1", () => {
    expect(calculateKokushiShanten(parse(K13))).toBe(0);
    expect(calculateShanten(parse(K13))).toBe(0);
    expect(isTenpai(parse(K13))).toBe(true);
    expect(calculateKokushiShanten(parse("19m 19p 19s ESWN PF 1m"))).toBe(0); // C 단일 대기
    expect(isTenpai(parse("19m 19p 19s ESWN PF 1m"))).toBe(true);
    expect(calculateShanten(parse(`${K13} 1m`))).toBe(-1);
  });

  it("국사무쌍 샹텐: 11종이거나 요구패가 아닌 패가 섞이면 1 이상", () => {
    expect(calculateKokushiShanten(parse("19m 19p 19s ESWN PF 2m"))).toBe(1);
    expect(isTenpai(parse("19m 19p 19s ESWN PF 2m"))).toBe(false);
    expect(calculateKokushiShanten(parse("19m 19p 19s ESWN P 22m 3m"))).toBe(2);
  });

  it("황패평국 텐파이 판정(isTenpaiWithMelds)도 같은 샹텐 판정으로 국사무쌍 텐파이를 인정한다", () => {
    expect(isTenpaiWithMelds(parse(K13))).toBe(true);
    expect(isTenpaiWithMelds(parse("19m 19p 19s ESWN PF 1m"))).toBe(true);
    expect(isTenpaiWithMelds(parse("19m 19p 19s ESWN PF 2m"))).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// 국사무쌍 역 / 점수
// ---------------------------------------------------------------------------

describe("국사무쌍 / 국사무쌍 13면 대기", () => {
  it("13면 대기 완성: 화료 직전 13장이 요구패 13종 1장씩이면 어떤 요구패로 화료해도 더블역만", () => {
    for (const tile of ["1m", "9p", "E", "C"]) {
      expect(ids(ctx(`19m 19p 19s ESWN PFC ${tile}`, tile))).toEqual(["kokushiMusou13"]);
    }
  });

  it("단일 대기 완성(중복패가 아닌 패로 완성)이면 국사무쌍 (배수 1)", () => {
    // 손패: 중복 C. 화료패 P를 빼면 P가 없는 12종 + C 2장 -> 단일 대기
    const c = ctx("19m 19p 19s ESWN PF CC", "P");
    expect(ids(c)).toEqual(["kokushiMusou"]);
    const r = score(c);
    expect(r.yakumanCount).toBe(1);
    expect(r.limit).toBe("yakuman");
    expect(r.basePoints).toBe(8000);
  });

  it("점수: 코 론 32000 / 13면 론 64000, 친 론 48000 / 13면 론 96000", () => {
    const single = "19m 19p 19s ESWN PF CC";
    const wait13 = "19m 19p 19s ESWN PFC 1m";
    expect(score(ctx(single, "P")).total).toBe(32000);
    expect(score(ctx(wait13, "1m")).total).toBe(64000);
    expect(score(ctx(single, "P", [], { seatWind: "east" })).total).toBe(48000);
    expect(score(ctx(wait13, "1m", [], { seatWind: "east" })).total).toBe(96000);
  });

  it("점수: 츠모 지불 (코 단일 16000/8000/8000, 친 13면 32000 올)", () => {
    const r = score(ctx("19m 19p 19s ESWN PF CC", "P", [], { winType: "tsumo" }));
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 16000, fromEachNonDealer: 8000 });
    expect(r.total).toBe(32000);
    const d = score(ctx("19m 19p 19s ESWN PFC 1m", "1m", [], { winType: "tsumo", seatWind: "east" }));
    expect(d.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 32000 });
    expect(d.total).toBe(96000);
  });

  it("리치/도라/멘젠쯔모는 판수에 넣지 않는다 (역만 우선)", () => {
    const r = score(ctx("19m 19p 19s ESWN PF CC", "P", [], { isRiichi: true, winType: "tsumo" }), { dora: 5 });
    expect(r.yaku.map((y) => y.id)).toEqual(["kokushiMusou"]);
    expect(r.han).toBe(0);
    expect(r.dora).toBe(0);
    expect(r.yakuHan).toBe(0);
    expect(r.total).toBe(32000);
  });

  it("본장/리치봉: 코 론 단일 대기 본장 2 + 리치봉 1 = 32000 + 600 + 1000", () => {
    const r = score(ctx("19m 19p 19s ESWN PF CC", "P"), { honba: 2, riichiSticks: 1 });
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 32600 });
    expect(r.total).toBe(33600);
  });

  it("국사무쌍은 멘젠이 아니면(isConcealed=false) 성립하지 않는다", () => {
    const open = ids(ctx("19m 19p 19s ESWN PF CC", "P", [], { isConcealed: false }));
    expect(open).not.toContain("kokushiMusou");
    expect(open).not.toContain("kokushiMusou13");
    expect(open).toEqual([]); // 국사무쌍 형태에는 혼노두도 붙지 않는다
  });
});

// ---------------------------------------------------------------------------
// 대삼원 / 소사희 / 대사희
// ---------------------------------------------------------------------------

describe("대삼원", () => {
  it("삼원패 3종 모두 각자 (멘젠, 단기 론은 안커 3개라 스안커 아님)", () => {
    const c = ctx("PPP FFF CCC 234m 55p", "5p");
    expect(ids(c)).toEqual(["daisangen"]);
    expect(score(c).total).toBe(32000);
    expect(score(ctx("PPP FFF CCC 234m 55p", "5p", [], { seatWind: "east" })).total).toBe(48000);
  });

  it("부로 멜드(펑/깡)로 삼원패를 모아도 성립한다", () => {
    expect(ids(ctx("FFF CCC 234m 55p", "2m", [pon("PPP")]))).toEqual(["daisangen"]);
    expect(ids(ctx("CCC 234m 55p", "5p", [daiminkan("PPPP"), ankan("FFFF")]))).toEqual(["daisangen"]);
  });

  it("삼원패 2종 각자 + 1종 대자(소삼원 형태)는 대삼원이 아니다", () => {
    const c = ctx("PPP FFF CC 234m 567p", "7p");
    expect(ids(c)).not.toContain("daisangen");
    const r = score(c);
    expect(r.limit).not.toBe("yakuman");
    expect(r.yakumanCount).toBe(0);
  });
});

describe("소사희 / 대사희", () => {
  it("풍패 3종 각자 + 1종 대자는 소사희 (배수 1, 론 32000)", () => {
    const c = ctx("SSS WWW NN 234m", "2m", [pon("EEE")]);
    expect(ids(c)).toEqual(["shousuushii"]);
    expect(score(c).total).toBe(32000);
  });

  it("풍패 4종 모두 각자는 대사희 (더블역만, 코 론 64000 / 친 론 96000)", () => {
    const c = ctx("SSS WWW NNN 55p", "5p", [pon("EEE")]);
    expect(ids(c)).toEqual(["daisuushii"]);
    expect(score(c).total).toBe(64000);
    expect(score(ctx("SSS WWW NNN 55p", "5p", [pon("EEE")], { seatWind: "east" })).total).toBe(96000);
  });

  it("풍패 3종 각자 + 수패 대자는 소사희도 대사희도 아니다", () => {
    const c = ctx("SSS WWW 234m 55p", "2m", [pon("EEE")]);
    expect(ids(c)).not.toContain("shousuushii");
    expect(ids(c)).not.toContain("daisuushii");
    expect(score(c).limit).not.toBe("yakuman");
  });
});

// ---------------------------------------------------------------------------
// 스안커 / 스안커 단기
// ---------------------------------------------------------------------------

describe("스안커 / 스안커 단기", () => {
  const hand = "111m 333p 555s 777m 99p";

  it("츠모로 샤보(각자) 완성이면 스안커 (코 16000/8000 올 = 32000)", () => {
    const c = ctx(hand, "7m", [], { winType: "tsumo" });
    expect(ids(c)).toEqual(["suuankou"]);
    const r = score(c);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 16000, fromEachNonDealer: 8000 });
    expect(r.total).toBe(32000);
  });

  it("론으로 샤보 완성이면 그 각자는 안커가 아니므로 스안커 불성립 (또이또이 + 산안커)", () => {
    const c = ctx(hand, "7m");
    expect(ids(c)).not.toContain("suuankou");
    expect(ids(c)).not.toContain("suuankouTanki");
    expect(ids(c)).toEqual(expect.arrayContaining(["toitoi", "sanankou"]));
    expect(score(c).limit).not.toBe("yakuman");
  });

  it("단기 대기 완성은 론이어도 스안커 단기 (더블역만, 코 론 64000)", () => {
    const c = ctx(hand, "9p");
    expect(ids(c)).toEqual(["suuankouTanki"]);
    expect(score(c).total).toBe(64000);
  });

  it("단기 츠모 친: 32000 올 = 96000, 산안커는 부여하지 않는다", () => {
    const r = score(ctx(hand, "9p", [], { winType: "tsumo", seatWind: "east" }));
    expect(r.yaku.map((y) => y.id)).toEqual(["suuankouTanki"]);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 32000 });
    expect(r.total).toBe(96000);
  });

  it("안깡은 안커로 센다 (츠모 성립, 론 샤보 불성립)", () => {
    const melds = [ankan("1111m")];
    expect(ids(ctx("333p 555s 777m 99p", "7m", melds, { winType: "tsumo" }))).toEqual(["suuankou"]);
    expect(ids(ctx("333p 555s 777m 99p", "7m", melds))).not.toContain("suuankou");
  });

  it("펑이 있으면 멘젠이 아니므로 성립하지 않는다", () => {
    const c = ctx("333p 555s 777m 99p", "7m", [pon("111m")], { winType: "tsumo" });
    expect(ids(c)).not.toContain("suuankou");
  });

  it("역만이면 리치/멘젠쯔모/도라는 판수에 반영하지 않는다", () => {
    const r = score(ctx(hand, "7m", [], { winType: "tsumo", isRiichi: true }), { dora: 3 });
    expect(r.yaku.map((y) => y.id)).toEqual(["suuankou"]);
    expect(r.han).toBe(0);
    expect(r.dora).toBe(0);
    expect(r.total).toBe(32000);
  });
});

// ---------------------------------------------------------------------------
// 자일색 / 녹일색 / 청노두
// ---------------------------------------------------------------------------

describe("자일색", () => {
  it("자패만으로 이루어지면 성립한다 (부로 포함)", () => {
    const c = ctx("SSS WWW FF", "F", [pon("EEE"), pon("PPP")]);
    expect(ids(c)).toEqual(["tsuuiisou"]);
    expect(score(c).total).toBe(32000);
  });

  it("치또이쯔 형태(자패 7쌍)도 인정하며 치또이쯔 역은 따로 부여하지 않는다", () => {
    const c = ctx("EE SS WW NN PP FF CC", "C");
    expect(ids(c)).toEqual(["tsuuiisou"]);
    expect(score(c).total).toBe(32000);
  });

  it("수패가 하나라도 섞이면 성립하지 않는다", () => {
    const c = ctx("EEE SSS WWW PPP 11m", "1m");
    expect(ids(c)).not.toContain("tsuuiisou");
  });
});

describe("녹일색", () => {
  it("삭수 2·3·4·6·8과 발만으로 이루어지면 성립한다", () => {
    const c = ctx("234s 234s 666s 888s FF", "F");
    expect(ids(c)).toEqual(["ryuuiisou"]);
    expect(score(c).total).toBe(32000);
    expect(ids(ctx("234s 234s 666s 888s 44s", "4s"))).toEqual(["ryuuiisou"]);
  });

  it("발이 없어도 2·3·4·6·8삭만이면 성립한다 / 부로 멜드도 합쳐 판정한다", () => {
    expect(ids(ctx("234s 666s 888s FF", "F", [pon("222s")]))).toEqual(["ryuuiisou"]);
  });

  it("삭수 1·5·7·9나 중/백이 섞이면 성립하지 않는다", () => {
    for (const bad of ["111s", "555s", "777s", "999s", "CCC", "PPP"]) {
      const c = ctx("234s 666s 888s FF", "F", [pon(bad)]);
      expect(ids(c)).not.toContain("ryuuiisou");
    }
  });

  it("다른 슈트의 같은 숫자는 녹일색이 아니다", () => {
    expect(ids(ctx("234s 666s 888s FF", "F", [pon("222p")]))).not.toContain("ryuuiisou");
  });
});

describe("청노두", () => {
  it("수패 1·9만으로 이루어지면 성립한다", () => {
    const c = ctx("111p 999p 11s", "1s", [pon("111m"), pon("999m")]);
    expect(ids(c)).toEqual(["chinroutou"]);
    expect(score(c).total).toBe(32000);
  });

  it("자패가 하나라도 섞이면 성립하지 않는다 (혼노두는 17번 범위)", () => {
    const c = ctx("111p 999p 11s", "1s", [pon("111m"), pon("EEE")]);
    expect(ids(c)).not.toContain("chinroutou");
    expect(score(c).limit).not.toBe("yakuman");
  });

  it("2~8 수패가 섞이면 성립하지 않는다", () => {
    expect(ids(ctx("111p 999p 11s", "1s", [pon("111m"), pon("222m")]))).not.toContain("chinroutou");
  });
});

// ---------------------------------------------------------------------------
// 스깡쯔
// ---------------------------------------------------------------------------

describe("스깡쯔", () => {
  it("깡 4개 + 대자는 성립한다 (대명깡/가깡 포함)", () => {
    const melds = [ankan("1111m"), ankan("2222p"), daiminkan("3333s"), shouminkan("4444m")];
    const c = ctx("55p", "5p", melds);
    expect(ids(c)).toEqual(["suukantsu"]);
    expect(score(c).total).toBe(32000);
  });

  it("깡이 3개뿐이면 성립하지 않는다", () => {
    const melds = [ankan("1111m"), ankan("2222p"), daiminkan("3333s"), pon("666m")];
    const c = ctx("55p", "5p", melds);
    expect(ids(c)).not.toContain("suukantsu");
    expect(score(c).limit).not.toBe("yakuman");
  });

  it("안깡 4개 + 대자 츠모는 스깡쯔 + 스안커 단기의 복합 (3배 = 기본점 24000)", () => {
    const melds = [ankan("1111m"), ankan("2222p"), ankan("3333s"), ankan("4444m")];
    const r = score(ctx("55p", "5p", melds, { winType: "tsumo" }));
    expect(r.yaku.map((y) => y.id).sort()).toEqual(["suukantsu", "suuankouTanki"].sort());
    expect(r.yakumanCount).toBe(3);
    expect(r.basePoints).toBe(24000);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 48000, fromEachNonDealer: 24000 });
    expect(r.total).toBe(96000);
  });
});

// ---------------------------------------------------------------------------
// 구련보등 / 순정구련보등
// ---------------------------------------------------------------------------

describe("구련보등 / 순정구련보등", () => {
  it("화료패를 뺀 13장이 정확히 1112345678999이면 순정구련보등 (더블역만, 코 론 64000)", () => {
    const c = ctx("1112345678999m 5m", "5m");
    expect(ids(c)).toEqual(["junseiChuurenPoutou"]);
    expect(score(c).total).toBe(64000);
  });

  it("1112345678999 + 1 에서 1로 화료해도 9면 대기 형태이므로 순정구련보등", () => {
    expect(ids(ctx("1112345678999m 1m", "1m"))).toEqual(["junseiChuurenPoutou"]);
  });

  it("추가 패가 아닌 다른 패로 화료하면 (화료패를 빼면 1112345678999가 아님) 구련보등 (배수 1)", () => {
    const c = ctx("1112345678999m 5m", "1m");
    expect(ids(c)).toEqual(["chuurenPoutou"]);
    const r = score(c);
    expect(r.yakumanCount).toBe(1);
    expect(r.total).toBe(32000);
  });

  it("친 츠모 순정구련보등: 32000 올 = 96000", () => {
    const r = score(ctx("1112345678999m 5m", "5m", [], { winType: "tsumo", seatWind: "east" }));
    expect(r.total).toBe(96000);
  });

  it("멘젠이 아니면 성립하지 않는다 (isConcealed=false / 안깡 포함 모두)", () => {
    // 구련보등은 아니지만 한 슈트뿐이므로 청일색(17-1 추가)은 성립한다
    const open = ids(ctx("1112345678999m 5m", "5m", [], { isConcealed: false }));
    expect(open).not.toContain("chuurenPoutou");
    expect(open).not.toContain("junseiChuurenPoutou");
    expect(open).toContain("chinitsu");
    // 안깡이 있으면 손패가 11장이라 구련보등 형태를 만들 수 없다 (역만 없음)
    const withKan = ids(ctx("2345678m 999m 5m", "8m", [ankan("1111m")]));
    expect(withKan).not.toContain("chuurenPoutou");
    expect(withKan).toContain("chinitsu");
  });

  it("한 슈트라도 1·9가 3장씩 없으면 구련보등이 아니다", () => {
    const c = ctx("123m 456m 789m 111m 22m", "2m");
    expect(ids(c)).not.toContain("chuurenPoutou");
    expect(ids(c)).not.toContain("junseiChuurenPoutou");
  });
});

// ---------------------------------------------------------------------------
// 복합 역만 / 우선순위 / 헤아림 역만
// ---------------------------------------------------------------------------

describe("복합 역만과 점수", () => {
  it("대삼원 + 자일색 = 2배 (코 론 64000 / 친 론 96000 / 코 츠모 32000+16000 올)", () => {
    const melds = [pon("PPP"), pon("FFF")];
    const base = ctx("CCC EEE SS", "S", melds);
    const r = score(base);
    expect(r.yaku.map((y) => y.id).sort()).toEqual(["daisangen", "tsuuiisou"]);
    expect(r.yakumanCount).toBe(2);
    expect(r.basePoints).toBe(16000);
    expect(r.total).toBe(64000);
    expect(score(ctx("CCC EEE SS", "S", melds, { seatWind: "east" })).total).toBe(96000);
    const t = score(ctx("CCC EEE SS", "S", melds, { winType: "tsumo" }));
    expect(t.payment).toEqual({ type: "tsumo", fromDealer: 32000, fromEachNonDealer: 16000 });
    expect(t.total).toBe(64000);
  });

  it("더블역만과 역만 합산: 스안커 단기(2) + 자일색(1) = 3배, 코 론 96000", () => {
    const r = score(ctx("EEE SSS WWW PPP FF", "F"));
    expect(r.yaku.map((y) => y.id).sort()).toEqual(["suuankouTanki", "tsuuiisou"]);
    expect(r.yakumanCount).toBe(3);
    expect(r.total).toBe(96000);
  });

  it("역만 + 본장/리치봉: 코 론 대삼원 본장 2 리치봉 1 = 32600 지불, 33600 수령", () => {
    const r = score(ctx("PPP FFF CCC 234m 55p", "5p"), { honba: 2, riichiSticks: 1 });
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 32600 });
    expect(r.total).toBe(33600);
  });

  it("역만 + 본장 츠모 (코): 오야 16100, 코 8100 x 2", () => {
    const r = score(ctx("PPP FFF CCC 234m 55p", "5p", [], { winType: "tsumo" }), { honba: 1 });
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 16100, fromEachNonDealer: 8100 });
    expect(r.total).toBe(32300);
  });

  it("13판 이상 헤아림 역만은 8000 (1배) 그대로이고 도라가 많아도 역만 역과 합치지 않는다", () => {
    // 리치 + 멘젠쯔모 + 핑후 + 탕야오 = 4판, 도라 9 = 13판 -> 헤아림 역만
    const kazoe = score(
      ctx("234m 567m 234p 678s 55p", "4p", [], { winType: "tsumo", isRiichi: true }),
      { dora: 9 },
    );
    expect(kazoe.han).toBe(13);
    expect(kazoe.limit).toBe("yakuman");
    expect(kazoe.yakumanCount).toBe(1);
    expect(kazoe.basePoints).toBe(8000);
    expect(kazoe.total).toBe(32000);
    // 대삼원 + 도라 10은 헤아림으로 2배가 되지 않는다
    const real = score(ctx("PPP FFF CCC 234m 55p", "5p"), { dora: 10 });
    expect(real.yakumanCount).toBe(1);
    expect(real.basePoints).toBe(8000);
    expect(real.total).toBe(32000);
  });

  it("역만이 아닌 화료의 yakumanCount는 0이다", () => {
    const r = score(ctx("234m 567m 234p 678s 55p", "4p", [], { winType: "tsumo", isRiichi: true }));
    expect(r.yakumanCount).toBe(0);
    expect(r.limit).toBe(null);
  });
});

// ---------------------------------------------------------------------------
// 모호한 해석: 해석마다 역만 집합이 다르면 배수 합이 가장 큰 해석을 채택한다
// ---------------------------------------------------------------------------

describe("여러 해석 중 최고 배수 채택 (bestYakuman)", () => {
  /** 후보들의 배수 집합 (오름차순, 중복 제거) */
  const multipliers = (c: WinContext): number[] =>
    [...new Set(yakumanCandidates(c).map(yakumanMultiplier))].sort((a, b) => a - b);
  const best = (c: WinContext): string[] => [...(bestYakuman(c) ?? [])].sort();

  // 삭수 222333444s는 각자 3개(222/333/444)로도, 순자 234s 3개로도 읽힌다.
  // 각자 해석에서는 안커가 늘어 스안커가 되고, 순자 해석에서는 녹일색(전부 초록패)만 성립한다.
  // 녹일색은 분해와 무관하게 성립하므로 후보가 항상 2종류 이상 생기고, 배수만 갈린다.
  const HAND = "222333444s 666s 88s";

  it("츠모 2s: 각자 해석(샤보 대기) 녹일색 + 스안커 = 2배 vs 순자 해석 녹일색 1배 -> 2배 채택", () => {
    const c = ctx(HAND, "2s", [], { winType: "tsumo" });
    expect(multipliers(c)).toEqual([1, 2]);
    expect(best(c)).toEqual(["ryuuiisou", "suuankou"]);
    expect(detectYaku(c).map((y) => y.id).sort()).toEqual(["ryuuiisou", "suuankou"]);
    const r = score(c);
    expect(r.yakumanCount).toBe(2);
    expect(r.basePoints).toBe(16000);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 32000, fromEachNonDealer: 16000 });
    expect(r.total).toBe(64000);
  });

  it("론 2s: 같은 손패라도 각자 해석은 샤보 론이라 스안커가 깨진다 -> 모든 해석이 녹일색 1배", () => {
    const c = ctx(HAND, "2s");
    expect(multipliers(c)).toEqual([1]);
    expect(best(c)).toEqual(["ryuuiisou"]);
    const r = score(c);
    expect(r.yakumanCount).toBe(1);
    expect(r.total).toBe(32000);
  });

  it("츠모 8s: 각자 해석에서 8s는 대자 단기 -> 스안커 단기(2) + 녹일색(1) = 3배 vs 순자 해석 1배 -> 3배 채택", () => {
    const c = ctx(HAND, "8s", [], { winType: "tsumo" });
    expect(multipliers(c)).toEqual([1, 3]);
    expect(best(c)).toEqual(["ryuuiisou", "suuankouTanki"]);
    const r = score(c);
    expect(r.yakumanCount).toBe(3);
    expect(r.payment).toEqual({ type: "tsumo", fromDealer: 48000, fromEachNonDealer: 24000 });
    expect(r.total).toBe(96000);
  });

  it("론 8s: 단기 대기는 론이어도 안커 4개 유지 -> 3배 채택 (샤보 론과 달리 깨지지 않는다)", () => {
    const c = ctx(HAND, "8s");
    expect(multipliers(c)).toEqual([1, 3]);
    expect(best(c)).toEqual(["ryuuiisou", "suuankouTanki"]);
    expect(score(c).total).toBe(96000);
  });

  // 삭수 222333444s + 888s + 66s: 위와 같은 구조 (각자 해석 vs 순자 해석)
  it("츠모 4s / 츠모 6s / 론 4s: 4s는 각자 안의 샤보(2배 vs 1배), 6s는 단기(3배 vs 1배), 론 4s는 샤보 론이라 1배뿐", () => {
    const hand = "222333444s 888s 66s";
    const shanpon = ctx(hand, "4s", [], { winType: "tsumo" });
    expect(multipliers(shanpon)).toEqual([1, 2]);
    expect(best(shanpon)).toEqual(["ryuuiisou", "suuankou"]);
    expect(score(shanpon).total).toBe(64000);

    const tanki = ctx(hand, "6s", [], { winType: "tsumo" });
    expect(multipliers(tanki)).toEqual([1, 3]);
    expect(best(tanki)).toEqual(["ryuuiisou", "suuankouTanki"]);
    expect(score(tanki).total).toBe(96000);

    const ronShanpon = ctx(hand, "4s");
    expect(multipliers(ronShanpon)).toEqual([1]);
    expect(score(ronShanpon).total).toBe(32000);
  });

  it("안깡이 있어도 같다: 안깡 6666s + 222333444s 88s 츠모 2s는 2배, 8s는 3배 (순자 해석은 1배)", () => {
    // 안깡 1개 + 손패 11장. 각자 해석은 안깡 + 각자 3개 = 안커 4개, 순자 해석은 안커 1개뿐이라 녹일색만 성립.
    // 안깡 6666s도 녹일색에 포함된다.
    const melds = [ankan("6666s")];
    const hand = "222333444s 88s";
    const shanpon = ctx(hand, "2s", melds, { winType: "tsumo" });
    expect(multipliers(shanpon)).toEqual([1, 2]);
    expect(best(shanpon)).toEqual(["ryuuiisou", "suuankou"]);
    expect(score(shanpon).total).toBe(64000);

    const tanki = ctx(hand, "8s", melds, { winType: "tsumo" });
    expect(multipliers(tanki)).toEqual([1, 3]);
    expect(best(tanki)).toEqual(["ryuuiisou", "suuankouTanki"]);
    expect(score(tanki).total).toBe(96000);

    expect(multipliers(ctx(hand, "2s", melds))).toEqual([1]); // 론 샤보: 스안커 깨짐
  });
});
