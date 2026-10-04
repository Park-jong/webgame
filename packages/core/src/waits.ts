/**
 * 대기패(텐파이) 계산 - UI 힌트용 순수 함수 모음
 *
 * - 화료 형태 판정은 agari.ts의 isAgari(국사무쌍/치또이쯔 포함)를 그대로 재사용한다.
 * - 손패 + 멜드에서 이미 4장을 쓴 패는 5장째가 없으므로 대기패에서 제외한다.
 * - 역 유무(hasYaku)는 론 기준 기본 역만 본다: 도라와 상황 역(일발/해저 등)은 제외하고
 *   멘젠 여부/리치/자풍/장풍만 반영한다. 컨텍스트를 주지 않으면 hasYaku는 true(미판정)로 둔다.
 * - 후리텐은 "자신의 버림패에 대기패가 있는가"만 본다 (동순/리치 후 일시 후리텐은 호출자 책임).
 */

import type { Tile, Wind } from "./tiles.js";
import { createFullTileSet } from "./tiles.js";
import { tileToIndex } from "./meld.js";
import { isAgari } from "./agari.js";
import type { CalledMeld } from "./call.js";
import { isMenzen } from "./call.js";
import { calculateScore } from "./score.js";
import { sortHand } from "./hand.js";

/** 34종 패 대표(비적도라) 목록, 인덱스 순서 */
const TILE_TYPES: readonly Tile[] = (() => {
  const seen = new Set<number>();
  return createFullTileSet(false).filter((t) => {
    const i = tileToIndex(t);
    if (seen.has(i)) return false;
    seen.add(i);
    return true;
  });
})();

/** 역 판정용 문맥 (대기패의 hasYaku 계산에 쓴다) */
export interface WaitYakuContext {
  seatWind: Wind;
  roundWind: Wind;
  /** 리치 선언 상태 (기본 false) */
  isRiichi?: boolean;
}

export interface WaitOptions {
  /** 역 판정 문맥. 없으면 hasYaku는 모두 true */
  context?: WaitYakuContext;
  /** 남은 장수 계산에 쓸, 손패/자기 멜드 외에 보이는 패 (타인 버림패/멜드/도라 표시패 등) */
  visibleTiles?: readonly Tile[];
}

/** 대기패 한 종류 */
export interface WaitTile {
  /** 대기패 (비적도라 대표 패) */
  tile: Tile;
  /** 남은 장수 (손패/멜드/visibleTiles에서 센 값을 4에서 뺌, 0 이상) */
  remaining: number;
  /** 이 패로 화료할 때 기본 역이 있는지 (false면 역 없음이라 론 불가) */
  hasYaku: boolean;
}

export interface WaitInfo {
  /** 대기패가 하나라도 있으면 텐파이 */
  tenpai: boolean;
  waits: WaitTile[];
  /** 자신의 버림패에 대기패가 있어 론이 불가한지 (discards를 준 경우만 의미 있음) */
  furiten: boolean;
}

/** 14장일 때 "이 패를 버리면 텐파이" 후보 */
export interface DiscardCandidate {
  /** 버릴 패 (같은 종류가 여러 장이면 손패에서 처음 만난 한 장) */
  discard: Tile;
  waits: WaitTile[];
  /** 이 패를 버렸을 때의 후리텐 여부 (버리는 패 자체가 대기패여도 후리텐) */
  furiten: boolean;
}

function countsOf(tiles: readonly Tile[]): number[] {
  const counts = new Array<number>(TILE_TYPES.length).fill(0);
  for (const t of tiles) counts[tileToIndex(t)]! += 1;
  return counts;
}

function meldTiles(melds: readonly CalledMeld[]): Tile[] {
  return melds.flatMap((m) => m.tiles as readonly Tile[]);
}

/** 대기패(화료가 되는 패 종류) 목록. 역 유무는 보지 않는다. 손패는 13 - 3 x 멜드 수 장. */
export function findWaitTiles(hand: readonly Tile[], melds: readonly CalledMeld[] = []): Tile[] {
  if (hand.length + melds.length * 3 !== 13) {
    throw new Error(`대기패 계산: 손패 ${hand.length}장 + 멜드 ${melds.length}개는 13장 상당이 아닙니다`);
  }
  const used = countsOf([...hand, ...meldTiles(melds)]);
  return TILE_TYPES.filter((t) => used[tileToIndex(t)]! < 4 && isAgari([...hand, t], melds));
}

/** 해당 패로 론했을 때 기본 역이 있는지 (도라/상황 역 제외) */
export function hasYakuForWait(
  hand: readonly Tile[],
  melds: readonly CalledMeld[],
  tile: Tile,
  context: WaitYakuContext,
): boolean {
  const outcome = calculateScore({
    hand: sortHand([...hand, tile]),
    winningTile: tile,
    isConcealed: isMenzen(melds),
    winType: "ron",
    isRiichi: context.isRiichi ?? false,
    seatWind: context.seatWind,
    roundWind: context.roundWind,
    melds,
  });
  return outcome.kind === "scored";
}

/** 대기패 목록(남은 장수, 역 유무 포함). 손패는 13 - 3 x 멜드 수 장. */
export function calculateWaits(
  hand: readonly Tile[],
  melds: readonly CalledMeld[] = [],
  options: WaitOptions = {},
): WaitTile[] {
  const tiles = findWaitTiles(hand, melds);
  const seen = countsOf([...hand, ...meldTiles(melds), ...(options.visibleTiles ?? [])]);
  return tiles.map((tile) => ({
    tile,
    remaining: Math.max(0, 4 - seen[tileToIndex(tile)]!),
    hasYaku: options.context ? hasYakuForWait(hand, melds, tile, options.context) : true,
  }));
}

/** 대기패 중 자신의 버림패에 있는 것이 있으면 true (후리텐) */
export function isFuritenForWaits(waits: readonly Tile[] | readonly WaitTile[], discards: readonly Tile[]): boolean {
  const discarded = new Set(discards.map(tileToIndex));
  return waits.some((w) => discarded.has(tileToIndex("tile" in w ? w.tile : w)));
}

/** 텐파이 정보 (대기패 + 후리텐). 손패는 13 - 3 x 멜드 수 장. */
export function calculateWaitInfo(
  hand: readonly Tile[],
  melds: readonly CalledMeld[] = [],
  discards: readonly Tile[] = [],
  options: WaitOptions = {},
): WaitInfo {
  const waits = calculateWaits(hand, melds, options);
  return { tenpai: waits.length > 0, waits, furiten: isFuritenForWaits(waits, discards) };
}

/**
 * 14 - 3 x 멜드 수 장(타패 직전)일 때, 버리면 텐파이가 되는 패 후보와 그때의 대기패.
 * 같은 종류는 한 번만(손패에서 처음 만난 장) 나온다.
 */
export function findDiscardCandidates(
  hand: readonly Tile[],
  melds: readonly CalledMeld[] = [],
  discards: readonly Tile[] = [],
  options: WaitOptions = {},
): DiscardCandidate[] {
  if (hand.length + melds.length * 3 !== 14) {
    throw new Error(`타패 후보 계산: 손패 ${hand.length}장 + 멜드 ${melds.length}개는 14장 상당이 아닙니다`);
  }
  const result: DiscardCandidate[] = [];
  const tried = new Set<number>();
  hand.forEach((discard, i) => {
    const index = tileToIndex(discard);
    if (tried.has(index)) return;
    tried.add(index);
    const rest = hand.filter((_, j) => j !== i);
    const waits = calculateWaits(rest, melds, options);
    if (waits.length === 0) return;
    result.push({
      discard,
      waits,
      furiten: isFuritenForWaits(waits, [...discards, discard]),
    });
  });
  return result;
}
