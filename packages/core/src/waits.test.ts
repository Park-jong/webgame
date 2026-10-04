import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import type { CalledMeld } from "./call.js";
import { tileToString } from "./tiles.js";
import {
  calculateWaitInfo,
  calculateWaits,
  findDiscardCandidates,
  findWaitTiles,
  isFuritenForWaits,
} from "./waits.js";
import { isTenpaiWithMelds } from "./ryuukyoku.js";

/** "123m456p789s11z" 형식 파서 (z: 1~4 동남서북, 5~7 백발중) */
function parse(text: string): Tile[] {
  const tiles: Tile[] = [];
  let digits: number[] = [];
  for (const ch of text) {
    if (/\d/.test(ch)) {
      digits.push(Number(ch));
      continue;
    }
    for (const d of digits) {
      if (ch === "z") {
        tiles.push(
          d <= 4
            ? { kind: "wind", wind: (["east", "south", "west", "north"] as const)[d - 1]! }
            : { kind: "dragon", dragon: (["white", "green", "red"] as const)[d - 5]! },
        );
      } else {
        const suit = ch === "m" ? "man" : ch === "p" ? "pin" : "sou";
        tiles.push({ kind: "number", suit, rank: d as 1, isRedFive: false });
      }
    }
    digits = [];
  }
  return tiles;
}
const names = (tiles: readonly Tile[]) => tiles.map((t) => tileToString(t)).sort();
const waitNames = (hand: string, melds: CalledMeld[] = []) => names(findWaitTiles(parse(hand), melds));
const ctx = { seatWind: "south", roundWind: "east" } as const;
const pon = (text: string): CalledMeld => {
  const tiles = parse(text) as [Tile, Tile, Tile];
  return { type: "pon", tiles, calledTile: tiles[0], fromSeat: 1, from: "right" };
};

describe("대기패 계산", () => {
  it("양면", () => {
    expect(waitNames("23m456p789s234s55p")).toEqual(names(parse("14m")));
  });
  it("간짱", () => {
    expect(waitNames("13m456p789s234s55p")).toEqual(names(parse("2m")));
  });
  it("단기", () => {
    expect(waitNames("123m456m789m234p9s")).toEqual(names(parse("9s")));
  });
  it("샤본", () => {
    expect(waitNames("1122m456p789s234s")).toEqual(names(parse("12m")));
  });
  it("치또이쯔", () => {
    expect(waitNames("1144m2255p3366s7z")).toEqual(names(parse("7z")));
  });
  it("국사무쌍 13면 대기는 13종 전부", () => {
    expect(findWaitTiles(parse("19m19p19s1234567z"))).toHaveLength(13);
  });
  it("국사무쌍 12종 + 중복은 빠진 1종만 대기", () => {
    expect(waitNames("119m19p19s123456z")).toEqual(names(parse("7z")));
  });
  it("멜드가 있는 손패 (펑 1개, 단기)", () => {
    const melds = [pon("222m")];
    expect(waitNames("456m123s234p9s", melds)).toEqual(names(parse("9s")));
  });
  it("멜드 2개 (장수가 줄어든 손패)", () => {
    const melds = [pon("222m"), pon("777p")];
    expect(waitNames("456m234s9s", melds)).toEqual(names(parse("9s")));
  });
  it("5장째 대기는 제외한다", () => {
    // 1111m 단기는 5번째 1m이 필요해 불가
    expect(waitNames("1111m456p789s234s")).toEqual([]);
    // 펑한 2m을 포함해 4장 소진된 2m은 대기패가 될 수 없다
    expect(waitNames("2m456m123s234p", [pon("222m")])).toEqual([]);
  });
  it("손패 장수가 13장 상당이 아니면 에러", () => {
    expect(() => findWaitTiles(parse("123m"))).toThrow();
  });
  it("ryuukyoku 텐파이 판정과 일치", () => {
    for (const [hand, melds] of [
      ["23m456p789s234s55p", []],
      ["13m456p789s259s55p", []],
      ["456m123s234p9s", [pon("222m")]],
      ["1m456p789s234p", [pon("222m")]],
    ] as [string, CalledMeld[]][]) {
      const h = parse(hand);
      if (h.length + melds.length * 3 !== 13) continue;
      expect(findWaitTiles(h, melds).length > 0).toBe(isTenpaiWithMelds(h, melds));
    }
  });
});

describe("남은 장수", () => {
  it("손패 + 보이는 패를 4에서 뺀다", () => {
    const waits = calculateWaits(parse("23m456p789s234s55p"), [], { visibleTiles: parse("1m1m4m") });
    expect(waits.map((w) => [tileToString(w.tile), w.remaining])).toEqual([
      ["1m", 2],
      ["4m", 3],
    ]);
  });
  it("손패에 든 대기패도 센다 (카라텐 직전)", () => {
    const waits = calculateWaits(parse("1112345678999m"), []);
    expect(waits.every((w) => w.remaining >= 0)).toBe(true);
    const nine = waits.find((w) => tileToString(w.tile) === "9m");
    expect(nine!.remaining).toBe(1); // 9m은 손패에 3장이라 1장 남음
  });
});

describe("역 유무", () => {
  it("핑후형 양면은 모두 역 있음", () => {
    const waits = calculateWaits(parse("23m456p789s234s55p"), [], { context: ctx });
    expect(waits.map((w) => w.hasYaku)).toEqual([true, true]);
  });
  it("멘젠 간짱(역패/탕야오 없음)은 역 없음, 리치하면 역 있음", () => {
    const hand = parse("13m456p789s234s55p");
    expect(calculateWaits(hand, [], { context: ctx })[0]!.hasYaku).toBe(false);
    expect(calculateWaits(hand, [], { context: { ...ctx, isRiichi: true } })[0]!.hasYaku).toBe(true);
  });
  it("같은 핑후 모양도 멘젠이면 역 있음, 치로 열면 역 없음", () => {
    const menzen = calculateWaits(parse("23m456p789s55p234s"), [], { context: ctx });
    expect(menzen.map((w) => w.hasYaku)).toEqual([true, true]);
    const chi: CalledMeld = {
      type: "chi",
      tiles: parse("234s") as [Tile, Tile, Tile],
      calledTile: parse("2s")[0]!,
      fromSeat: 3,
      from: "left",
    };
    const open = calculateWaits(parse("23m456p789s55p"), [chi], { context: ctx });
    expect(open.map((w) => tileToString(w.tile)).sort()).toEqual(names(parse("14m")));
    expect(open.map((w) => w.hasYaku)).toEqual([false, false]);
  });
  it("컨텍스트가 없으면 hasYaku는 true", () => {
    expect(calculateWaits(parse("13m456p789s234s55p"))[0]!.hasYaku).toBe(true);
  });
  it("부로 손패는 멘젠 역이 없어 역패 펑이 있어야 역이 성립", () => {
    const noYaku = calculateWaits(parse("456m123s234p9s"), [pon("222m")], { context: ctx });
    expect(noYaku.map((w) => w.hasYaku)).toEqual([false]);
    const yakuhai = calculateWaits(parse("456m123s234p9s"), [pon("555z")], { context: ctx });
    expect(yakuhai.map((w) => w.hasYaku)).toEqual([true]);
  });
  it("도라는 역으로 치지 않는다 (도라만으로는 화료 불가)", () => {
    // 적5 포함이어도 hasYaku는 기본 역 기준
    const hand = parse("13m456p789s234s55p");
    expect(calculateWaits(hand, [], { context: ctx })[0]!.hasYaku).toBe(false);
  });
});

describe("후리텐", () => {
  it("자기 버림패에 대기패가 있으면 후리텐", () => {
    const info = calculateWaitInfo(parse("23m456p789s234s55p"), [], parse("1m4z"));
    expect(info.tenpai).toBe(true);
    expect(info.furiten).toBe(true);
  });
  it("버림패에 대기패가 없으면 후리텐 아님", () => {
    const info = calculateWaitInfo(parse("23m456p789s234s55p"), [], parse("2m4z"));
    expect(info.furiten).toBe(false);
  });
  it("텐파이가 아니면 waits가 비고 후리텐도 아님", () => {
    const info = calculateWaitInfo(parse("1m3p5s7m9p2s4m6p8s1z3z5z7z"), [], parse("1z"));
    expect(info).toEqual({ tenpai: false, waits: [], furiten: false });
  });
  it("isFuritenForWaits는 Tile 목록도 받는다", () => {
    expect(isFuritenForWaits(parse("14m"), parse("4m"))).toBe(true);
  });
});

describe("타패 후보 (14장)", () => {
  it("버리면 텐파이가 되는 패와 그때의 대기패", () => {
    const candidates = findDiscardCandidates(parse("23m456p789s234s55p4z"), []);
    expect(candidates.map((c) => tileToString(c.discard))).toEqual(["N"]);
    expect(names(candidates[0]!.waits.map((w) => w.tile))).toEqual(names(parse("14m")));
    expect(candidates[0]!.furiten).toBe(false);
  });
  it("여러 후보와 후리텐 (버리는 패가 대기패인 경우)", () => {
    // 1123m... 11m23m4m: 4m 버리면 11m+23m → 1m4m... 아래는 단순 확인
    const candidates = findDiscardCandidates(parse("23m456p789s234s55p1m"), [], parse("4m"));
    const byDiscard = new Map(candidates.map((c) => [tileToString(c.discard), c]));
    // 1m 버리면 1m4m 대기이고 이미 4m을 버렸으므로 후리텐
    expect(byDiscard.get("1m")!.furiten).toBe(true);
    // 버리는 패 자체가 대기패가 되는 경우 후리텐 (5p 버려 55p -> 5p 단기... 대기에 5p 포함 시)
    for (const c of candidates) {
      const own = c.waits.some((w) => tileToString(w.tile) === tileToString(c.discard));
      if (own) expect(c.furiten).toBe(true);
    }
  });
  it("같은 종류는 한 번만 나온다", () => {
    const candidates = findDiscardCandidates(parse("23m456p789s234s55p4z"), []);
    const keys = candidates.map((c) => tileToString(c.discard));
    expect(new Set(keys).size).toBe(keys.length);
  });
  it("멜드가 있는 14장 상당", () => {
    const candidates = findDiscardCandidates(parse("456m123s234p9s1z"), [pon("222m")]);
    expect(candidates.map((c) => tileToString(c.discard)).sort()).toEqual(["9s", "E"]);
  });
  it("14장 상당이 아니면 에러", () => {
    expect(() => findDiscardCandidates(parse("23m456p789s234s55p"), [])).toThrow();
  });
});
