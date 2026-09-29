/**
 * 역(役) 판정 - 핵심 역 세트
 *
 * 구현 범위: 리치, 멘젠츠모, 핑후, 탕야오, 역패(자풍/장풍/삼원패), 이페이코, 판퐁(또이또이).
 *
 * 주의: "판퐁"이라는 이름은 표준 마작 용어 중 정확히 무엇을 가리키는지 다소 모호하여,
 * 이 구현에서는 "모든 멘츠가 각자(커츠)로 구성된 역"인 또이따이(対々和/또이또이)로 해석했다.
 * 다른 의도였다면 별도로 알려주면 수정할 수 있다.
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
import type { Meld, SequenceMeld, StandardDecomposition } from "./meld.js";
import { decomposeStandardHand, isChiitoitsuHand } from "./meld.js";

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
  | "chiitoitsu";

export interface YakuMatch {
  id: YakuId;
  /** 역의 한글 이름 (표시용) */
  name: string;
}

const YAKU_NAMES: Record<YakuId, string> = {
  riichi: "리치",
  menzenTsumo: "멘젠츠모",
  pinfu: "핑후",
  tanyao: "탕야오",
  yakuhaiDragon: "역패 (삼원패)",
  yakuhaiSeatWind: "역패 (자풍)",
  yakuhaiRoundWind: "역패 (장풍)",
  iipeikou: "이페이코",
  toitoi: "판퐁 (또이또이)",
  chiitoitsu: "치토이츠",
};

/** 모든 패가 2~8 사이의 숫자패인지 (단패/자패가 하나도 없는지) 확인한다. */
function isAllSimples(hand: readonly Tile[]): boolean {
  return hand.every((tile) => tile.kind === "number" && tile.rank >= 2 && tile.rank <= 8);
}

/** 해당 패가 역패(삼원패 또는 자풍/장풍에 해당하는 풍패)인지 확인한다. */
function isYakuhaiTile(tile: Tile, ctx: WinContext): boolean {
  if (tile.kind === "dragon") return true;
  if (tile.kind === "wind") return tile.wind === ctx.seatWind || tile.wind === ctx.roundWind;
  return false;
}

type WaitShape = "ryanmen" | "penchan" | "kanchan" | "tanki" | "shanpon";

/**
 * 이 분해(decomposition)에서 당첨패가 어떤 대기 형태로 완성되었는지 찾는다.
 * 같은 종류의 패가 여러 블록(대자/멘츠)에 걸쳐 있을 수 있으므로, 당첨패가 들어맞는
 * 모든 위치의 대기 형태를 반환한다 (가장 유리한 해석을 고르기 위함).
 */
function findWaitShapes(decomposition: StandardDecomposition, winningTile: Tile): WaitShape[] {
  const shapes: WaitShape[] = [];

  if (isSameTileType(decomposition.pair.tiles[0], winningTile)) {
    shapes.push("tanki");
  }

  for (const meld of decomposition.melds) {
    if (meld.type === "triplet") {
      if (isSameTileType(meld.tiles[0], winningTile)) {
        shapes.push("shanpon");
      }
      continue;
    }

    const positionInMeld = meld.tiles.findIndex((t) => isSameTileType(t, winningTile));
    if (positionInMeld === -1) continue;

    if (positionInMeld === 1) {
      // 순자의 가운데 패로 완성 = 항상 간짱
      shapes.push("kanchan");
      continue;
    }

    if (positionInMeld === 0) {
      // 순자의 낮은 쪽 패로 완성: 7-8-9 형태에서 7로 완성되면 변짱, 그 외엔 양짱
      shapes.push(meld.startRank + 2 === 9 ? "penchan" : "ryanmen");
    } else {
      // 순자의 높은 쪽 패로 완성: 1-2-3 형태에서 3으로 완성되면 변짱, 그 외엔 양짱
      shapes.push(meld.startRank === 1 ? "penchan" : "ryanmen");
    }
  }

  return shapes;
}

/** 특정 분해(decomposition) 기준으로 핑후 성립 여부를 확인한다. */
function isPinfuForDecomposition(decomposition: StandardDecomposition, ctx: WinContext): boolean {
  if (decomposition.melds.some((meld) => meld.type === "triplet")) return false;
  if (isYakuhaiTile(decomposition.pair.tiles[0], ctx)) return false;
  return findWaitShapes(decomposition, ctx.winningTile).includes("ryanmen");
}

/** 특정 분해 기준으로 성립하는 역패(자풍/장풍/삼원패) 목록을 확인한다. */
function yakuhaiIdsForDecomposition(decomposition: StandardDecomposition, ctx: WinContext): YakuId[] {
  const ids: YakuId[] = [];
  for (const meld of decomposition.melds) {
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
 * 화료 손패에 대해 성립하는 핵심 역 목록을 판정한다.
 * 같은 손패가 여러 방식으로 분해될 수 있는 경우, 분해마다 성립하는 역을 모두 모아 합집합으로 반환한다
 * (실전에서는 가장 유리한 해석을 채택하는 것과 동일한 방식).
 * @throws hand가 14장이 아니거나, hand가 화료 형태가 아니거나, winningTile이 hand에 없으면 에러를 던진다.
 */
export function detectYaku(ctx: WinContext): YakuMatch[] {
  if (ctx.hand.length !== 14) {
    throw new Error(`역 판정은 당첨패를 포함한 14장 손패에 대해서만 가능합니다: ${ctx.hand.length}장 입력됨`);
  }
  if (!ctx.hand.some((tile) => isSameTileType(tile, ctx.winningTile))) {
    throw new Error("winningTile은 hand에 포함된 패여야 합니다.");
  }
  if (!isAgari(ctx.hand)) {
    throw new Error("화료 형태가 아닌 손패는 역을 판정할 수 없습니다.");
  }

  const ids = new Set<YakuId>();

  // 손패 형태(분해)와 무관하게 문맥만으로 판정되는 역
  if (ctx.isRiichi && ctx.isConcealed) ids.add("riichi");
  if (ctx.isConcealed && ctx.winType === "tsumo") ids.add("menzenTsumo");
  if (isAllSimples(ctx.hand)) ids.add("tanyao");
  if (ctx.isConcealed && isChiitoitsuHand(ctx.hand)) ids.add("chiitoitsu");

  // 표준형(멘츠4+대자1) 분해가 필요한 역
  const decompositions = decomposeStandardHand(ctx.hand);
  for (const decomposition of decompositions) {
    if (ctx.isConcealed && isPinfuForDecomposition(decomposition, ctx)) ids.add("pinfu");
    if (ctx.isConcealed && hasIipeikou(decomposition)) ids.add("iipeikou");
    if (isToitoi(decomposition.melds)) ids.add("toitoi");
    for (const id of yakuhaiIdsForDecomposition(decomposition, ctx)) ids.add(id);
  }

  return [...ids].map((id) => ({ id, name: YAKU_NAMES[id] }));
}

/** 화료 손패에 성립하는 역이 하나라도 있는지 확인한다 (역 없는 화료는 실전에서는 무효). */
export function hasAnyYaku(ctx: WinContext): boolean {
  return detectYaku(ctx).length > 0;
}
