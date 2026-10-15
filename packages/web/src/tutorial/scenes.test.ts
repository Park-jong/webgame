import { describe, expect, it } from "vitest";
import {
  calculateScore,
  calculateWaits,
  decomposeStandardHand,
  findDiscardCandidates,
  hasYakuForWait,
  isAgari,
  isSameTileType,
  sortHand,
} from "@mahjong/core";
import type { Tile } from "@mahjong/core";
import { parseTiles, sceneWaits, TENPAI_HAND, TUTORIAL_SCENES } from "./scenes";

const scene = (id: string) => TUTORIAL_SCENES.find((s) => s.id === id)!;
const full = (id: string): Tile[] => {
  const s = scene(id);
  return s.drawn ? [...s.hand, s.drawn] : [...s.hand];
};
const countOf = (tiles: readonly Tile[], tile: Tile) => tiles.filter((x) => isSameTileType(x, tile)).length;

describe("parseTiles", () => {
  it("수패와 자패를 읽는다", () => {
    const tiles = parseTiles("12m 5z");
    expect(tiles).toHaveLength(3);
    expect(tiles[2]).toEqual({ kind: "dragon", dragon: "white" });
  });
  it("종류 표기가 없으면 오류", () => {
    expect(() => parseTiles("123")).toThrow();
  });
});

describe("튜토리얼 장면 데이터", () => {
  it("모든 장면은 어떤 패도 4장을 넘지 않는다", () => {
    for (const s of TUTORIAL_SCENES) {
      const all = [...s.hand, ...(s.drawn ? [s.drawn] : []), ...(s.opponentDiscard ? [s.opponentDiscard] : [])];
      for (const tile of all) expect(countOf(all, tile), s.id).toBeLessThanOrEqual(4);
    }
  });

  it("groups 합계는 손패 장수와 같다", () => {
    for (const s of TUTORIAL_SCENES) {
      if (s.groups) expect(s.groups.reduce((a, b) => a + b, 0)).toBe(s.hand.length);
    }
  });

  it("1단계: 예시 14장은 몸통 4개 + 머리 1개의 완성형", () => {
    const hand = scene("goal").hand;
    expect(hand).toHaveLength(14);
    expect(isAgari(hand)).toBe(true);
    const dec = decomposeStandardHand(hand);
    expect(dec.length).toBeGreaterThan(0);
    expect(dec[0]!.melds).toHaveLength(4);
  });

  it("2단계: 14장이며 목표 패는 북, 북을 버리면 텐파이", () => {
    const s = scene("discard");
    const all = full("discard");
    expect(all).toHaveLength(14);
    expect(s.goal).toEqual({ type: "tile", index: 13 });
    expect(all[13]).toEqual({ kind: "wind", wind: "north" });
    const candidates = findDiscardCandidates(all);
    expect(candidates.some((c) => c.discard.kind === "wind")).toBe(true);
  });

  it("3단계: 5통에 대해 치와 펑이 모두 가능하고 결과 몸통이 맞다", () => {
    const s = scene("call");
    const d = s.opponentDiscard!;
    expect(s.hand).toHaveLength(13);
    expect(countOf(s.hand, d)).toBe(2); // 펑
    expect(s.hand.some((x) => x.kind === "number" && x.suit === "pin" && x.rank === 4)).toBe(true); // 치 4-5-6
    expect(s.hand.some((x) => x.kind === "number" && x.suit === "pin" && x.rank === 6)).toBe(true);
    const key = (tiles: readonly Tile[]) => tiles.map((x) => JSON.stringify(x)).sort();
    for (const [kind, r] of Object.entries(s.callResults!)) {
      expect(r.meld, kind).toHaveLength(3);
      expect(r.hand, kind).toHaveLength(11);
      // 남은 손패 + 몸통 = 원래 손패 + 버림패
      expect(key([...r.hand, ...r.meld]), kind).toEqual(key([...s.hand, d]));
    }
  });

  it("4단계: 13장 텐파이이고 대기패는 3삭 하나", () => {
    const s = scene("tenpai");
    expect(s.hand).toHaveLength(13);
    const waits = calculateWaits(s.hand);
    expect(waits).toHaveLength(1);
    expect(waits[0]!.tile).toMatchObject({ kind: "number", suit: "sou", rank: 3 });
    expect(waits[0]!.remaining).toBe(4);
    expect(sceneWaits(s)).toEqual(waits);
  });

  it("5단계: 9삭만 버려야 텐파이가 유지되고 대기패는 4단계와 같다", () => {
    const s = scene("riichi");
    const all = full("riichi");
    expect(all).toHaveLength(14);
    expect(s.goal).toEqual({ type: "riichi", index: 13 });
    expect(all[13]).toMatchObject({ kind: "number", suit: "sou", rank: 9 });
    const candidates = findDiscardCandidates(all);
    expect(candidates).toHaveLength(1);
    expect(candidates[0]!.discard).toMatchObject({ suit: "sou", rank: 9 });
    expect(candidates[0]!.waits.map((w) => w.tile)).toEqual(calculateWaits(parseTiles(TENPAI_HAND)).map((w) => w.tile));
  });

  it("6단계: 뽑은 패로 실제 화료가 되고 리치 역이 붙는다", () => {
    const s = scene("win");
    const all = full("win");
    expect(all).toHaveLength(14);
    expect(isAgari(all)).toBe(true);
    expect(s.drawn).toMatchObject({ suit: "sou", rank: 3 });
    const outcome = calculateScore({
      hand: sortHand(all),
      winningTile: s.drawn!,
      isConcealed: true,
      winType: "tsumo",
      isRiichi: true,
      seatWind: "east",
      roundWind: "east",
    });
    expect(outcome.kind).toBe("scored");
    if (outcome.kind === "scored") expect(outcome.yaku.map((y) => y.id)).toContain("riichi");
    expect(s.doneHand).toHaveLength(14);
    expect(isAgari(s.doneHand!)).toBe(true);
  });

  it("7단계: 결과 카드 표기는 core 계산 결과와 같다", () => {
    const y = scene("yaku");
    const outcome = calculateScore({
      hand: sortHand(full("win")),
      winningTile: scene("win").drawn!,
      isConcealed: true,
      winType: "tsumo",
      isRiichi: true,
      seatWind: "east",
      roundWind: "east",
    });
    expect(outcome.kind).toBe("scored");
    if (outcome.kind === "scored") {
      expect(y.resultCard?.yaku).toEqual(outcome.yaku.map((m) => m.name));
    }
    expect(isAgari(y.hand)).toBe(true);
  });

  it("7단계: (seatWind=동 가정) 리치 없이 론하면 역이 없고 리치가 있으면 역이 있다", () => {
    // 북 머리는 자리바람(동)·장풍(동)과 달라 역패가 아니다. 자리바람이 북이면 성립하지 않는다.
    const tenpai = parseTiles(TENPAI_HAND);
    const three = { kind: "number", suit: "sou", rank: 3, isRedFive: false } as const;
    const ctx = { seatWind: "east", roundWind: "east" } as const;
    expect(hasYakuForWait(tenpai, [], three, { ...ctx, isRiichi: false })).toBe(false);
    expect(hasYakuForWait(tenpai, [], three, { ...ctx, isRiichi: true })).toBe(true);
  });
});
