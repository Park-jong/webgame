import { describe, expect, it } from "vitest";
import type { Tile, Wind } from "./tiles.js";
import type { CalledMeld } from "./call.js";
import type { WinContext, YakuId } from "./yaku.js";
import { YAKU_HAN, YAKU_NAMES, detectYaku, yakuHan } from "./yaku.js";
import { calculateScore, type ScoreResult } from "./score.js";

/** "234m 55p EE CC" 형태 문자열을 패 배열로 (m/p/s 수패, E/S/W/N 풍패, P/F/C 백/발/중) */
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

const chi = (text: string): CalledMeld => {
  const t = parse(text) as [Tile, Tile, Tile];
  return { type: "chi", tiles: t, calledTile: t[0], fromSeat: 3, from: "left" };
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

/** 기본: 코(남), 장풍 서, 론. 멘젠 여부는 멜드로 판정된다. */
function ctx(hand: string, winning: string, melds: CalledMeld[] = [], overrides: Partial<WinContext> = {}): WinContext {
  const concealed = melds.every((m) => m.type === "ankan");
  return {
    hand: parse(hand),
    winningTile: parse(winning)[0]!,
    melds,
    isConcealed: concealed,
    winType: "ron",
    isRiichi: false,
    seatWind: "south",
    roundWind: "west",
    ...overrides,
  };
}

const ids = (c: WinContext): string[] => detectYaku(c).map((y) => y.id).sort();
function score(c: WinContext): ScoreResult {
  const r = calculateScore(c);
  if (r.kind !== "scored") throw new Error("noYaku");
  return r;
}
const scoredIds = (r: ScoreResult): string[] => r.yaku.map((y) => y.id).sort();
const hanOf = (r: ScoreResult, id: YakuId): number | undefined => r.yaku.find((y) => y.id === id)?.han;

describe("판수 구조 (멘젠/후로)와 이름", () => {
  it("새 역 11종의 멘젠/후로 판수", () => {
    const table: [YakuId, number, number][] = [
      ["sanshokuDoukou", 2, 2],
      ["sankantsu", 2, 2],
      ["shousangen", 2, 2],
      ["honroutou", 2, 2],
      ["chanta", 2, 1],
      ["ittsu", 2, 1],
      ["sanshokuDoujun", 2, 1],
      ["ryanpeikou", 3, 0],
      ["junchan", 3, 2],
      ["honitsu", 3, 2],
      ["chinitsu", 6, 5],
    ];
    for (const [id, menzen, open] of table) {
      expect(YAKU_HAN[id]).toEqual({ menzen, open });
      expect(yakuHan(id, true)).toBe(menzen);
      expect(yakuHan(id, false)).toBe(open);
    }
  });

  it("기존 역의 판수는 그대로 (멘젠 전용은 open 0, 나머지는 양쪽 같은 값)", () => {
    for (const id of ["riichi", "menzenTsumo", "pinfu", "iipeikou", "ippatsu"] as const) {
      expect(YAKU_HAN[id]).toEqual({ menzen: 1, open: 0 });
    }
    expect(YAKU_HAN.chiitoitsu).toEqual({ menzen: 2, open: 0 });
    expect(YAKU_HAN.doubleRiichi).toEqual({ menzen: 2, open: 0 });
    for (const id of ["tanyao", "yakuhaiDragon", "yakuhaiSeatWind", "yakuhaiRoundWind", "chankan", "rinshanKaihou"] as const) {
      expect(YAKU_HAN[id]).toEqual({ menzen: 1, open: 1 });
    }
    expect(YAKU_HAN.toitoi).toEqual({ menzen: 2, open: 2 });
    expect(YAKU_HAN.sanankou).toEqual({ menzen: 2, open: 2 });
  });

  it("표시 이름은 역.txt 표기와 같다", () => {
    expect(YAKU_NAMES.sanshokuDoukou).toBe("삼색동각");
    expect(YAKU_NAMES.sankantsu).toBe("산깡쯔");
    expect(YAKU_NAMES.shousangen).toBe("소삼원");
    expect(YAKU_NAMES.honroutou).toBe("혼노두");
    expect(YAKU_NAMES.chanta).toBe("찬타");
    expect(YAKU_NAMES.ittsu).toBe("일기통관");
    expect(YAKU_NAMES.sanshokuDoujun).toBe("삼색동순");
    expect(YAKU_NAMES.ryanpeikou).toBe("량페코");
    expect(YAKU_NAMES.junchan).toBe("준찬타");
    expect(YAKU_NAMES.honitsu).toBe("혼일색");
    expect(YAKU_NAMES.chinitsu).toBe("청일색");
  });
});

describe("삼색동각", () => {
  it("만·통·삭 같은 숫자의 각자 (멘젠 2판, 산안커와 합산 4판)", () => {
    const r = score(ctx("222m 222p 222s 456m 99p", "4m"));
    expect(scoredIds(r)).toEqual(["sanankou", "sanshokuDoukou"]);
    expect(r.yakuHan).toBe(4);
  });

  it("펑해도 2판 (후로 판수 같음), 30부 2판 = 론 2000", () => {
    const r = score(ctx("222m 222p 456m 99p", "4m", [pon("222s")]));
    expect(scoredIds(r)).toEqual(["sanshokuDoukou"]);
    expect(r.yakuHan).toBe(2);
    expect(r.fu).toBe(30); // 20 + 중장패 안커 4 x2 + 중장패 펑 2
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 2000 });
  });

  it("깡도 각자로 센다 (안깡은 멘젠 유지)", () => {
    const c = ctx("222p 222s 456m 99p", "4m", [ankan("2222m")]);
    expect(ids(c)).toContain("sanshokuDoukou");
  });

  it("한 슈트라도 숫자가 다르면 불성립", () => {
    expect(ids(ctx("222m 222p 333s 456m 99p", "4m"))).not.toContain("sanshokuDoukou");
  });
});

describe("산깡쯔", () => {
  it("깡 3개 (안깡/대명깡/가깡 무관) = 산깡쯔 2판 + 탕야오 1판, 60부 3판 론 7700", () => {
    const c = ctx("567m 55p", "7m", [ankan("2222m"), daiminkan("3333p"), shouminkan("4444s")]);
    expect(ids(c)).toEqual(["sankantsu", "tanyao"]);
    const r = score(c);
    expect(r.yakuHan).toBe(3);
    expect(r.fu).toBe(60); // 20 + 안깡 16 + 대명깡 8 + 가깡 8 + 양면 0 = 52 -> 60
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 7700 });
  });

  it("깡 2개이면 불성립", () => {
    expect(ids(ctx("567m 55p 234s", "7m", [ankan("2222m"), daiminkan("3333p")]))).not.toContain("sankantsu");
  });

  it("깡 4개는 스깡쯔 역만이고 산깡쯔는 붙지 않는다", () => {
    const c = ctx("55p", "5p", [ankan("2222m"), ankan("3333m"), ankan("4444m"), daiminkan("6666m")]);
    expect(ids(c)).toEqual(["suukantsu"]);
  });
});

describe("소삼원", () => {
  it("삼원패 2종 각자 + 1종 대자: 소삼원 2판 + 삼원패 2판 = 4판", () => {
    const c = ctx("PPP FFF 234m 567p CC", "2m");
    expect(ids(c)).toEqual(["shousangen", "yakuhaiDragon"]);
    const r = score(c);
    expect(r.yaku.filter((y) => y.id === "yakuhaiDragon")).toHaveLength(2);
    expect(r.yakuHan).toBe(4);
    expect(r.limit).toBe("mangan"); // 20+10+8+8+2 = 48 -> 50부, 4판 3200 -> 만관
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 8000 });
  });

  it("펑으로도 성립하고 후로 판수도 2판 (30부 4판 론 7700)", () => {
    const r = score(ctx("234m 567p CC", "2m", [pon("PPP"), pon("FFF")]));
    expect(scoredIds(r)).toEqual(["shousangen", "yakuhaiDragon", "yakuhaiDragon"]);
    expect(r.yakuHan).toBe(4);
    expect(r.fu).toBe(30); // 20 + 4 + 4 + 대자 2
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 7700 });
  });

  it("대자가 삼원패가 아니면 소삼원이 아니다", () => {
    expect(ids(ctx("PPP FFF 234m 567p 99s", "2m"))).toEqual(["yakuhaiDragon"]);
  });

  it("삼원패 3종 각자는 대삼원 역만이고 소삼원은 붙지 않는다", () => {
    expect(ids(ctx("PPP FFF CCC 234m 55m", "2m"))).toEqual(["daisangen"]);
  });
});

describe("혼노두", () => {
  it("요구패만 + 수패와 자패 모두: 혼노두 2판 + 또이또이 2판 + 자풍패 1판 (펑 2개, 후로 5판)", () => {
    const c = ctx("111m 999p NN", "N", [pon("EEE"), pon("SSS")]);
    expect(ids(c)).toEqual(["honroutou", "toitoi", "yakuhaiSeatWind"]);
    const r = score(c);
    expect(r.yakuHan).toBe(5);
    expect(r.limit).toBe("mangan");
  });

  it("삼색동각과 합산: 혼노두 2 + 또이또이 2 + 삼색동각 2 = 6판 하네만 (펑 2개 + 론 샤보)", () => {
    const r = score(ctx("111s EEE NN", "1s", [pon("111m"), pon("111p")]));
    expect(scoredIds(r)).toEqual(["honroutou", "sanshokuDoukou", "toitoi"]);
    expect(r.yakuHan).toBe(6);
    expect(r.limit).toBe("haneman");
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 12000 });
  });

  it("치또이쯔 형태(7쌍 모두 요구패)에도 적용: 치또이쯔 2 + 혼노두 2 = 4판 25부 론 6400", () => {
    const r = score(ctx("11m 99m 11p 99p 11s EE NN", "N"));
    expect(scoredIds(r)).toEqual(["chiitoitsu", "honroutou"]);
    expect(r.fu).toBe(25);
    expect(r.yakuHan).toBe(4);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 6400 }); // 25 x 2^6 = 1600 x 4
  });

  it("수패만(청노두)이나 자패만(자일색)은 역만이라 혼노두가 아니다", () => {
    expect(ids(ctx("111m 999m 111p 999p 11s", "1m"))).toEqual(["chinroutou"]);
    expect(ids(ctx("EEE SSS WWW NNN PP", "P"))).not.toContain("honroutou");
  });

  it("요구패가 아닌 패가 섞이면 불성립", () => {
    expect(ids(ctx("111m 999p 222s EEE NN", "N"))).not.toContain("honroutou");
  });
});

describe("찬타 / 준찬타", () => {
  it("찬타: 모든 멘츠/대자에 요구패, 순자와 자패 있음 (멘젠 2판)", () => {
    const r = score(ctx("123m 789p 111s EEE NN", "3m"));
    expect(scoredIds(r)).toEqual(["chanta"]);
    expect(r.yakuHan).toBe(2);
  });

  it("찬타 후로 1판: 치 후 40부 1판 론 1300", () => {
    const r = score(ctx("789p 111s EEE NN", "9p", [chi("123m")]));
    expect(scoredIds(r)).toEqual(["chanta"]);
    expect(hanOf(r, "chanta")).toBe(1);
    expect(r.fu).toBe(40); // 20 + 111s 8 + EEE 8 = 36 -> 40 (후로 론은 멘젠 가산 없음)
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 1300 });
  });

  it("순자가 없으면 찬타가 아니다 (혼노두가 된다)", () => {
    const c = ctx("111m 999p EEE SSS NN", "1m");
    expect(ids(c)).toContain("honroutou");
    expect(ids(c)).not.toContain("chanta");
  });

  it("요구패가 없는 멘츠나 대자가 있으면 불성립", () => {
    expect(ids(ctx("123m 789p 456s EEE NN", "3m"))).not.toContain("chanta");
    expect(ids(ctx("123m 789p 111s EEE 55s", "3m"))).not.toContain("chanta");
  });

  it("준찬타: 자패 없음, 멘젠 3판 / 후로 2판", () => {
    const base = score(ctx("123m 789m 123p 789p 11s", "2p"));
    expect(scoredIds(base)).toEqual(["junchan"]);
    expect(base.yakuHan).toBe(3);
    const open = score(ctx("789m 123p 789p 11s", "2p", [chi("123m")]));
    expect(scoredIds(open)).toEqual(["junchan"]);
    expect(open.yakuHan).toBe(2);
  });

  it("자패가 하나라도 있으면 준찬타가 아니라 찬타", () => {
    const c = ctx("123m 789m 123p 789p EE", "2p");
    expect(ids(c)).toContain("chanta");
    expect(ids(c)).not.toContain("junchan");
  });
});

describe("일기통관", () => {
  it("한 슈트 123·456·789 (멘젠 2판)", () => {
    const r = score(ctx("123m 456m 789m 234p 55s", "3p"));
    expect(scoredIds(r)).toEqual(["ittsu"]);
    expect(r.yakuHan).toBe(2);
  });

  it("후로 1판 (치 후 30부 1판 론 1000)", () => {
    const r = score(ctx("456m 789m 234p 55s", "3p", [chi("123m")]));
    expect(scoredIds(r)).toEqual(["ittsu"]);
    expect(hanOf(r, "ittsu")).toBe(1);
    expect(r.fu).toBe(30); // 20 + 간짱 2 = 22 -> 30
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 1000 });
  });

  it("슈트가 섞이면 불성립", () => {
    expect(ids(ctx("123m 456m 789p 234p 55s", "3p"))).not.toContain("ittsu");
  });

  it("혼일색과 합산: 멘젠 2 + 3 = 5판 만관 / 후로 1 + 2 = 3판", () => {
    const r = score(ctx("123m 456m 789m EEE 55m", "3m"));
    expect(scoredIds(r)).toEqual(["honitsu", "ittsu"]);
    expect(r.yakuHan).toBe(5);
    expect(r.limit).toBe("mangan");
    const open = score(ctx("123m 789m EEE 55m", "3m", [chi("456m")]));
    expect(scoredIds(open)).toEqual(["honitsu", "ittsu"]);
    expect(open.yakuHan).toBe(3);
    expect(open.fu).toBe(30); // 20 + EEE 8 + 변짱 2
    expect(open.payment).toEqual({ type: "ron", fromDiscarder: 3900 }); // 30 x 2^5 = 960 x 4 = 3840 -> 3900
  });
});

describe("삼색동순", () => {
  it("만·통·삭 같은 숫자의 순자 (멘젠 2판, 후로 1판)", () => {
    const base = score(ctx("123m 123p 123s 456m 99p", "5m"));
    expect(scoredIds(base)).toEqual(["sanshokuDoujun"]);
    expect(base.yakuHan).toBe(2);
    const open = score(ctx("123p 123s 456m 99p", "5m", [chi("123m")]));
    expect(scoredIds(open)).toEqual(["sanshokuDoujun"]);
    expect(open.yakuHan).toBe(1);
  });

  it("숫자가 다르면 불성립", () => {
    expect(ids(ctx("123m 123p 234s 456m 99p", "5m"))).not.toContain("sanshokuDoujun");
  });
});

describe("량페코 / 이페코", () => {
  it("같은 순자 2벌이 두 쌍: 량페코 3판 + 핑후 1판 (이페코 없음), 30부 4판 1920점 론 7700", () => {
    const r = score(ctx("112233m 445566p 77s", "1m"));
    expect(scoredIds(r)).toEqual(["pinfu", "ryanpeikou"]);
    expect(r.yakuHan).toBe(4);
    expect(r.fu).toBe(30);
    expect(r.basePoints).toBe(1920);
    expect(r.limit).toBeNull();
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 7700 });
  });

  it("량페코와 치또이쯔 해석이 모두 가능하면 점수가 높은 량페코를 채택 (치또이쯔는 25부 2판 = 400)", () => {
    const r = score(ctx("112233m 445566p 77s", "1m"));
    expect(scoredIds(r)).not.toContain("chiitoitsu");
  });

  it("후로하면 량페코/이페코 모두 불성립", () => {
    const c = ctx("123m 123m 456p 77s", "7s", [chi("456p")]);
    expect(ids(c)).not.toContain("ryanpeikou");
    expect(ids(c)).not.toContain("iipeikou");
  });

  it("한 쌍만이면 이페코 (량페코 아님)", () => {
    const c = ctx("123m 123m 456p 789s 99p", "9p");
    expect(ids(c)).toContain("iipeikou");
    expect(ids(c)).not.toContain("ryanpeikou");
  });
});

describe("혼일색 / 청일색", () => {
  it("혼일색: 한 슈트 + 자패 (멘젠 3판 / 후로 2판)", () => {
    const base = score(ctx("234m 567m 888m EEE 99m", "2m"));
    expect(scoredIds(base)).toEqual(["honitsu"]);
    expect(base.yakuHan).toBe(3);
    const open = score(ctx("234m 567m 888m 99m", "2m", [pon("EEE")]));
    expect(scoredIds(open)).toEqual(["honitsu"]);
    expect(open.yakuHan).toBe(2);
  });

  it("자패가 없으면 청일색 (혼일색과 배타): 멘젠 6판 하네만 12000 / 후로 5판 만관 8000", () => {
    const base = score(ctx("234m 567m 888m 345m 99m", "3m"));
    expect(scoredIds(base)).toEqual(["chinitsu"]);
    expect(base.yakuHan).toBe(6);
    expect(base.limit).toBe("haneman");
    expect(base.payment).toEqual({ type: "ron", fromDiscarder: 12000 });
    const open = score(ctx("234m 567m 888m 99m", "3m", [chi("345m")]));
    expect(scoredIds(open)).toEqual(["chinitsu"]);
    expect(open.yakuHan).toBe(5);
    expect(open.limit).toBe("mangan");
    expect(open.payment).toEqual({ type: "ron", fromDiscarder: 8000 });
  });

  it("두 슈트가 섞이면 불성립", () => {
    expect(ids(ctx("234m 567p 888m EEE 99m", "2m"))).toEqual([]);
  });

  it("치또이쯔 형태에도 적용: 치또이쯔 + 혼일색 = 5판 만관", () => {
    const r = score(ctx("11m 22m 44m 66m 88m 99m EE", "E"));
    expect(scoredIds(r)).toEqual(["chiitoitsu", "honitsu"]);
    expect(r.yakuHan).toBe(5);
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 8000 });
  });

  it("치또이쯔 + 청일색 = 8판 배만 16000", () => {
    const r = score(ctx("11m 22m 33m 44m 66m 88m 99m", "9m"));
    expect(scoredIds(r)).toEqual(["chiitoitsu", "chinitsu"]);
    expect(r.yakuHan).toBe(8);
    expect(r.limit).toBe("baiman");
    expect(r.payment).toEqual({ type: "ron", fromDiscarder: 16000 });
  });
});

describe("역만 우선 / 역 있음 판정", () => {
  it("역만이 있으면 새 일반 역은 무시한다 (대삼원 + 혼일색 형태)", () => {
    const c = ctx("PPP FFF CCC 234m 55m", "2m");
    expect(ids(c)).toEqual(["daisangen"]);
  });

  it("새 역만으로도 화료 가능 (noYaku 아님)", () => {
    expect(calculateScore(ctx("123m 123p 123s 456m 99p", "5m")).kind).toBe("scored");
    expect(calculateScore(ctx("234m 567p 888m 345s 99m", "2m")).kind).toBe("noYaku");
  });
});
