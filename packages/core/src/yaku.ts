/**
 * 역(役) 판정 - 핵심 역 세트
 *
 * 구현 범위: 리치, 멘젠츠모, 핑후, 탕야오, 역패(자풍/장풍/삼원패), 이페이코, 판퐁(또이또이).
 *
 * 주의: "판퐁"이라는 이름은 표준 마작 용어 중 정확히 무엇을 가리키는지 다소 모호하여,
 * 이 구현에서는 "모든 멘츠가 각자(커츠)로 구성된 역"인 또이따이(対々和/또이또이)로 해석했다.
 * 다른 의도였다면 별도로 알려주면 수정할 수 있다.
 *
 * [부로(치/펑/깡) 손패]
 * - WinContext.melds에 부로 멜드를 넘기면 hand는 멜드를 제외한 손패(14 - 3 * 멜드 수 장)여야 한다.
 * - 멘젠 판정은 isConcealed && 멜드가 모두 안깡 (isContextConcealed). 멘젠 한정 역(리치/멘젠츠모/핑후/이페이코/치토이츠)은
 *   부로하면 성립하지 않는다.
 * - 구현된 역 중 쿠이사가리(부로 시 판수 감소)하는 역은 없다: 탕야오(쿠이탄 허용)/역패/또이또이/삼안커 모두 부로 가능하며 판수가 같다.
 * - 삼안커(안커 3개)를 추가했다: 안깡은 안커로 세고, 론으로 완성된 샤보 대기의 각자는 안커로 세지 않는다.
 *   4개(스안커)는 역만이라 아직 미구현이며 이 경우에도 삼안커 2판으로 판정한다 (멘젠 4안커 형태 포함).
 *
 * 도라 계산과 점수(부수/판수) 계산은 이번 범위에서 제외한다 - 각 역은 "성립하는지 여부"만 판정하고
 * 판수(한 수)는 계산하지 않는다.
 *
 * 치토이츠(칠대자) 자체도 원래 마작 규칙상 하나의 역(2판)이지만, 요청받은 핵심 역 목록에는
 * 없었다. 다만 치토이츠 형태로 화료했는데 그 자체가 역으로 인정되지 않으면 "역 없는 화료"가
 * 되어버리는 문제가 있어, 최소한의 정합성을 위해 "chiitoitsu"를 역으로 함께 판정하도록 추가했다.
 */

import type { Tile, Wind } from "./tiles.js";
import { isSameTileType } from "./tiles.js";
import { isAgari } from "./agari.js";
import type { CalledMeld } from "./call.js";
import { isMenzen } from "./call.js";
import type { Meld, SequenceMeld, StandardDecomposition } from "./meld.js";
import { decomposeStandardHand, isChiitoitsuHand, tileToIndex } from "./meld.js";

export type WinType = "tsumo" | "ron";

/** 역 판정에 필요한 문맥 정보 */
export interface WinContext {
  /** 화료를 구성하는 14장 전체 손패 (당첨패 포함) */
  hand: Tile[];
  /** 당첨패 (론이면 상대가 버린 패, 츠모면 직접 뽑은 패). hand 안에 포함되어 있어야 한다. */
  winningTile: Tile;
  /** 멘젠(門前) 여부 - 치/퐁/깡을 한 번도 하지 않은 완전 비공개 상태인지 */
  isConcealed: boolean;
  /** 츠모(자기 스스로 뽑아 화료)인지 론(타인의 버림패로 화료)인지 */
  winType: WinType;
  /** 리치를 선언한 상태로 화료했는지 */
  isRiichi: boolean;
  /** 자신의 자리 바람 (자풍) */
  seatWind: Wind;
  /** 해당 국의 바람 (장풍) */
  roundWind: Wind;
  /**
   * 부로한 멜드 목록 (선택, 기본 없음). 있으면 hand에는 멜드의 패를 포함하지 않는다
   * (hand 장수 = 14 - 3 * 멜드 수, 깡도 3장으로 계산). 당첨패는 항상 hand 안에 있다.
   */
  melds?: readonly CalledMeld[];
}

export type YakuId =
  | "riichi"
  | "menzenTsumo"
  | "pinfu"
  | "tanyao"
  | "yakuhaiDragon"
  | "yakuhaiSeatWind"
  | "yakuhaiRoundWind"
  | "iipeikou"
  | "toitoi"
  | "sanankou"
  | "chiitoitsu";

export interface YakuMatch {
  id: YakuId;
  /** 역의 한글 이름 (표시용) */
  name: string;
}

export const YAKU_NAMES: Record<YakuId, string> = {
  riichi: "리치",
  menzenTsumo: "멘젠츠모",
  pinfu: "핑후",
  tanyao: "탕야오",
  yakuhaiDragon: "역패 (삼원패)",
  yakuhaiSeatWind: "역패 (자풍)",
  yakuhaiRoundWind: "역패 (장풍)",
  iipeikou: "이페이코",
  toitoi: "판퐁 (또이또이)",
  sanankou: "삼안커",
  chiitoitsu: "치토이츠",
};

/** 역별 판수 (멘젠 한정 역만 다루므로 멘젠 기준 판수) */
export const YAKU_HAN: Record<YakuId, number> = {
  riichi: 1,
  menzenTsumo: 1,
  pinfu: 1,
  tanyao: 1,
  yakuhaiDragon: 1,
  yakuhaiSeatWind: 1,
  yakuhaiRoundWind: 1,
  iipeikou: 1,
  toitoi: 2,
  sanankou: 2,
  chiitoitsu: 2,
};

/** 부로 멜드 목록 (없으면 빈 배열) */
export function meldsOf(ctx: WinContext): readonly CalledMeld[] {
  return ctx.melds ?? [];
}

/** 실제 멘젠 여부: isConcealed이면서 부로(치/펑/대명깡/가깡)가 없어야 한다 (안깡은 멘젠 유지). */
export function isContextConcealed(ctx: WinContext): boolean {
  return ctx.isConcealed && isMenzen(meldsOf(ctx));
}

/** 부로 멜드를 분해용 Meld(순자/각자)로 변환한다. 깡은 각자로 취급한다 (4번째 패는 버린다). */
export function calledMeldToMeld(called: CalledMeld): Meld {
  if (called.type === "chi") {
    const sorted = [...called.tiles].sort((a, b) => tileToIndex(a) - tileToIndex(b)) as [Tile, Tile, Tile];
    const first = sorted[0];
    if (first.kind !== "number") throw new Error("치 멜드에 수패가 아닌 패가 있습니다.");
    return { type: "sequence", suit: first.suit, startRank: first.rank, tiles: sorted };
  }
  return { type: "triplet", tiles: [called.tiles[0], called.tiles[1], called.tiles[2]] };
}

/** 손패 분해의 멘츠 + 부로 멜드를 합친 전체 멘츠 목록 (부로 멜드가 뒤에 온다). */
function allMelds(decomposition: StandardDecomposition, ctx: WinContext): Meld[] {
  return [...decomposition.melds, ...meldsOf(ctx).map(calledMeldToMeld)];
}

/** 손패 + 멜드의 모든 패 (깡은 4장 모두 포함) */
export function allTilesOf(ctx: WinContext): Tile[] {
  return [...ctx.hand, ...meldsOf(ctx).flatMap((m) => m.tiles as readonly Tile[])];
}

/** 손패 장수가 14 - 3 * 멜드 수인지 검증한다. */
export function assertHandSize(ctx: WinContext, label: string): void {
  const expected = 14 - 3 * meldsOf(ctx).length;
  if (ctx.hand.length !== expected) {
    throw new Error(
      `${label}은(는) 당첨패를 포함한 ${expected}장 손패에 대해서만 가능합니다 (멜드 ${meldsOf(ctx).length}개): ${ctx.hand.length}장 입력됨`,
    );
  }
}

/** 모든 패가 2~8 사이의 숫자패인지 (단패/자패가 하나도 없는지) 확인한다. */
function isAllSimples(hand: readonly Tile[]): boolean {
  return hand.every((tile) => tile.kind === "number" && tile.rank >= 2 && tile.rank <= 8);
}

/** 해당 패가 역패(삼원패 또는 자풍/장풍에 해당하는 풍패)인지 확인한다. */
export function isYakuhaiTile(tile: Tile, ctx: WinContext): boolean {
  if (tile.kind === "dragon") return true;
  if (tile.kind === "wind") return tile.wind === ctx.seatWind || tile.wind === ctx.roundWind;
  return false;
}

export type WaitShape = "ryanmen" | "penchan" | "kanchan" | "tanki" | "shanpon";

/** 당첨패가 분해의 어느 블록으로 완성되었다고 해석할 수 있는지 (대기 형태 + 해당 멘츠 위치) */
export interface WaitInterpretation {
  shape: WaitShape;
  /** 당첨패가 속한 멘츠의 `melds` 인덱스 (대자로 해석한 단기 대기면 null) */
  meldIndex: number | null;
}

/**
 * 이 분해(decomposition)에서 당첨패가 어떤 대기 형태로 완성되었는지 찾는다.
 * 같은 종류의 패가 여러 블록(대자/멘츠)에 걸쳐 있을 수 있으므로, 당첨패가 들어맞는
 * 모든 위치의 해석을 반환한다 (가장 유리한 해석을 고르기 위함).
 */
export function findWaitInterpretations(
  decomposition: StandardDecomposition,
  winningTile: Tile,
): WaitInterpretation[] {
  const results: WaitInterpretation[] = [];

  if (isSameTileType(decomposition.pair.tiles[0], winningTile)) {
    results.push({ shape: "tanki", meldIndex: null });
  }

  decomposition.melds.forEach((meld, meldIndex) => {
    if (meld.type === "triplet") {
      if (isSameTileType(meld.tiles[0], winningTile)) {
        results.push({ shape: "shanpon", meldIndex });
      }
      return;
    }

    const positionInMeld = meld.tiles.findIndex((t) => isSameTileType(t, winningTile));
    if (positionInMeld === -1) return;

    if (positionInMeld === 1) {
      // 순자의 가운데 패로 완성 = 항상 간짱
      results.push({ shape: "kanchan", meldIndex });
    } else if (positionInMeld === 0) {
      // 순자의 낮은 쪽 패로 완성: 7-8-9 형태에서 7로 완성되면 변짱, 그 외엔 양짱
      results.push({ shape: meld.startRank + 2 === 9 ? "penchan" : "ryanmen", meldIndex });
    } else {
      // 순자의 높은 쪽 패로 완성: 1-2-3 형태에서 3으로 완성되면 변짱, 그 외엔 양짱
      results.push({ shape: meld.startRank === 1 ? "penchan" : "ryanmen", meldIndex });
    }
  });

  return results;
}

function findWaitShapes(decomposition: StandardDecomposition, winningTile: Tile): WaitShape[] {
  return findWaitInterpretations(decomposition, winningTile).map((w) => w.shape);
}

/** 특정 분해(decomposition) 기준으로 핑후 성립 여부를 확인한다. */
export function isPinfuForDecomposition(decomposition: StandardDecomposition, ctx: WinContext): boolean {
  if (!isContextConcealed(ctx)) return false;
  if (allMelds(decomposition, ctx).some((meld) => meld.type === "triplet")) return false;
  if (isYakuhaiTile(decomposition.pair.tiles[0], ctx)) return false;
  return findWaitShapes(decomposition, ctx.winningTile).includes("ryanmen");
}

/** 특정 분해 기준으로 성립하는 역패(자풍/장풍/삼원패) 목록을 확인한다. */
function yakuhaiIdsForDecomposition(decomposition: StandardDecomposition, ctx: WinContext): YakuId[] {
  const ids: YakuId[] = [];
  for (const meld of allMelds(decomposition, ctx)) {
    if (meld.type !== "triplet") continue;
    const tile = meld.tiles[0];
    if (tile.kind === "dragon") {
      ids.push("yakuhaiDragon");
    } else if (tile.kind === "wind") {
      if (tile.wind === ctx.seatWind) ids.push("yakuhaiSeatWind");
      if (tile.wind === ctx.roundWind) ids.push("yakuhaiRoundWind");
    }
  }
  return ids;
}

/** 특정 분해 기준으로 이페이코(동일한 순자 두 벌) 성립 여부를 확인한다. */
function hasIipeikou(decomposition: StandardDecomposition): boolean {
  const sequences = decomposition.melds.filter((m): m is SequenceMeld => m.type === "sequence");
  for (let i = 0; i < sequences.length; i++) {
    for (let j = i + 1; j < sequences.length; j++) {
      const a = sequences[i]!;
      const b = sequences[j]!;
      if (a.suit === b.suit && a.startRank === b.startRank) return true;
    }
  }
  return false;
}

/** 특정 분해 기준으로 판퐁(또이또이: 모든 멘츠가 각자) 성립 여부를 확인한다. */
function isToitoi(melds: readonly Meld[]): boolean {
  return melds.every((meld) => meld.type === "triplet");
}

/**
 * 이 분해 + 대기 해석에서 안커(암각)의 개수. 안깡은 안커로 세고, 론으로 완성된 샤보 대기의 각자는 세지 않는다.
 * wait를 생략하면 당첨패의 모든 해석 중 가장 유리한(안커가 가장 많은) 값을 쓴다.
 */
export function countConcealedTriplets(
  decomposition: StandardDecomposition,
  ctx: WinContext,
  wait?: WaitInterpretation,
): number {
  const ankan = meldsOf(ctx).filter((m) => m.type === "ankan").length;
  const countFor = (w: WaitInterpretation): number =>
    decomposition.melds.filter(
      (meld, index) =>
        meld.type === "triplet" && !(ctx.winType === "ron" && w.shape === "shanpon" && w.meldIndex === index),
    ).length;
  if (wait) return ankan + countFor(wait);
  const waits = findWaitInterpretations(decomposition, ctx.winningTile);
  return ankan + waits.reduce((max, w) => Math.max(max, countFor(w)), 0);
}

/** 손패 형태와 무관하게 문맥만으로 판정되는 역 (리치/멘젠츠모/탕야오) */
function detectContextYaku(ctx: WinContext): YakuId[] {
  const ids: YakuId[] = [];
  const concealed = isContextConcealed(ctx);
  if (ctx.isRiichi && concealed) ids.push("riichi");
  if (concealed && ctx.winType === "tsumo") ids.push("menzenTsumo");
  if (isAllSimples(allTilesOf(ctx))) ids.push("tanyao"); // 쿠이탄 허용
  return ids;
}

/**
 * 하나의 특정 표준형 분해를 기준으로 성립하는 역 id 목록을 반환한다 (점수 계산용).
 * detectYaku와 달리 합집합이 아니라 이 분해 하나만 본다. 역패는 각자마다 하나씩 나오므로
 * 삼원패 각자가 2개면 "yakuhaiDragon"이 2번 포함된다 (판수 카운트용).
 */
export function detectYakuForDecomposition(
  decomposition: StandardDecomposition,
  ctx: WinContext,
  wait?: WaitInterpretation,
): YakuId[] {
  const ids = detectContextYaku(ctx);
  if (isPinfuForDecomposition(decomposition, ctx)) ids.push("pinfu");
  if (isContextConcealed(ctx) && hasIipeikou(decomposition)) ids.push("iipeikou");
  if (isToitoi(allMelds(decomposition, ctx))) ids.push("toitoi");
  if (countConcealedTriplets(decomposition, ctx, wait) >= 3) ids.push("sanankou");
  ids.push(...yakuhaiIdsForDecomposition(decomposition, ctx));
  return ids;
}

/** 치토이츠 형태로 화료했을 때 성립하는 역 id 목록 (치토이츠 형태가 아니면 빈 배열). 점수 계산용. */
export function detectChiitoitsuYaku(ctx: WinContext): YakuId[] {
  if (!isContextConcealed(ctx) || !isChiitoitsuHand(ctx.hand)) return [];
  return [...detectContextYaku(ctx), "chiitoitsu"];
}

/**
 * 화료 손패에 대해 성립하는 핵심 역 목록을 판정한다.
 * 같은 손패가 여러 방식으로 분해될 수 있는 경우, 분해마다 성립하는 역을 모두 모아 합집합으로 반환한다
 * (실전에서는 가장 유리한 해석을 채택하는 것과 동일한 방식).
 * @throws hand가 14장이 아니거나, hand가 화료 형태가 아니거나, winningTile이 hand에 없으면 에러를 던진다.
 */
export function detectYaku(ctx: WinContext): YakuMatch[] {
  assertHandSize(ctx, "역 판정");
  if (!ctx.hand.some((tile) => isSameTileType(tile, ctx.winningTile))) {
    throw new Error("winningTile은 hand에 포함된 패여야 합니다.");
  }
  if (!isAgari(ctx.hand, meldsOf(ctx))) {
    throw new Error("화료 형태가 아닌 손패는 역을 판정할 수 없습니다.");
  }

  const ids = new Set<YakuId>();

  // 손패 형태(분해)와 무관하게 문맥만으로 판정되는 역
  for (const id of detectContextYaku(ctx)) ids.add(id);
  if (isContextConcealed(ctx) && isChiitoitsuHand(ctx.hand)) ids.add("chiitoitsu");

  // 표준형(멘츠4+대자1) 분해가 필요한 역
  const decompositions = decomposeStandardHand(ctx.hand, meldsOf(ctx).length);
  for (const decomposition of decompositions) {
    if (isPinfuForDecomposition(decomposition, ctx)) ids.add("pinfu");
    if (isContextConcealed(ctx) && hasIipeikou(decomposition)) ids.add("iipeikou");
    if (isToitoi(allMelds(decomposition, ctx))) ids.add("toitoi");
    if (countConcealedTriplets(decomposition, ctx) >= 3) ids.add("sanankou");
    for (const id of yakuhaiIdsForDecomposition(decomposition, ctx)) ids.add(id);
  }

  return [...ids].map((id) => ({ id, name: YAKU_NAMES[id] }));
}

/** 화료 손패에 성립하는 역이 하나라도 있는지 확인한다 (역 없는 화료는 실전에서는 무효). */
export function hasAnyYaku(ctx: WinContext): boolean {
  return detectYaku(ctx).length > 0;
}
