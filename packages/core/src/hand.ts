/**
 * 손패(手牌) 조작 유틸리티
 *
 * 손패는 항상 새 배열을 반환하는 불변(immutable) 방식으로 다룬다 (wall.ts의 shuffleTiles와
 * 동일한 스타일). 원본 배열은 절대 변경하지 않는다.
 */

import type { Tile } from "./tiles.js";
import { isSameTileType } from "./tiles.js";
import { tileToIndex } from "./meld.js";

/**
 * 두 패의 표준 정렬 순서를 비교한다.
 * 수패는 슈트(만→통→삭)별로 오름차순, 자패는 그 뒤에 동남서북 → 백발중 순으로 온다.
 * 정렬 순서는 meld.ts의 34종 패 인덱스(tileToIndex)를 그대로 재사용한다 - 인덱스 순서가
 * 바뀌어도 손패 정렬 순서가 자동으로 함께 맞춰지도록, 순서 정의를 한 곳(meld.ts)에만 둔다.
 */
export function compareTiles(a: Tile, b: Tile): number {
  return tileToIndex(a) - tileToIndex(b);
}

/** 손패를 표준 순서로 정렬한 새 배열을 반환한다 (원본은 변경하지 않음). */
export function sortHand(hand: readonly Tile[]): Tile[] {
  return [...hand].sort(compareTiles);
}

/** 손패에 패 한 장을 추가한 새 배열을 반환한다 (원본은 변경하지 않음). */
export function addTile(hand: readonly Tile[], tile: Tile): Tile[] {
  return [...hand, tile];
}

/**
 * 손패에서 지정한 패와 같은 종류의 패를 한 장 제거한 새 배열을 반환한다 (원본은 변경하지 않음).
 * 같은 종류의 패가 여러 장이면 가장 먼저 찾은 한 장만 제거한다 (적도라 여부는 구분하지 않음).
 * @throws 손패에 같은 종류의 패가 없으면 에러를 던진다.
 */
export function removeTile(hand: readonly Tile[], tile: Tile): Tile[] {
  const index = hand.findIndex((t) => isSameTileType(t, tile));
  if (index === -1) {
    throw new Error("손패에 없는 패는 제거할 수 없습니다.");
  }
  const result = [...hand];
  result.splice(index, 1);
  return result;
}
