/**
 * 샹텐(向聴) 및 텐파이(聴牌) 판정
 *
 * 샹텐수는 "화료까지 몇 번의 교환이 더 필요한가"를 나타내는 값이다.
 * - -1: 이미 화료(완성)된 상태
 * -  0: 텐파이 (한 장만 더 있으면 화료)
 * -  N(>0): 텐파이까지 패 N번을 더 교환해야 하는 상태
 *
 * 표준형(멘츠4+대자1)과 치토이츠(칠대자) 두 형태를 모두 계산해 더 작은(= 더 화료에 가까운)
 * 값을 최종 샹텐수로 사용한다. 코쿠시무소(국사무쌍) 등 특수형은 이번 범위에서 제외한다.
 */

import type { Tile } from "./tiles.js";
import { TILE_TYPE_COUNT, indexRank, indexSuit, tileToIndex } from "./meld.js";

function toTypeCounts(tiles: readonly Tile[]): number[] {
  const counts = new Array(TILE_TYPE_COUNT).fill(0) as number[];
  for (const tile of tiles) {
    counts[tileToIndex(tile)]! += 1;
  }
  return counts;
}

/**
 * 표준형(멘츠 4개 + 대자 1개) 기준으로 샹텐수를 계산한다.
 * 34종 패 개수 배열을 대상으로, 가능한 모든 멘츠/타츠(부분 멘츠)/대자 조합을 탐색해
 * 최소 샹텐수를 찾는 표준적인 재귀 알고리즘을 사용한다.
 */
export function calculateStandardShanten(tiles: readonly Tile[]): number {
  const counts = toTypeCounts(tiles);
  let best = Infinity;

  function evaluate(melds: number, partials: number, hasPair: boolean): number {
    // 멘츠+타츠는 최대 4개까지만 유효하다 (그 이상은 어차피 못 쓴다)
    const usablePartials = melds + partials > 4 ? 4 - melds : partials;
    return 8 - melds * 2 - usablePartials - (hasPair ? 1 : 0);
  }

  function scan(from: number, melds: number, partials: number, hasPair: boolean): void {
    let i = from;
    while (i < TILE_TYPE_COUNT && counts[i] === 0) i++;

    if (i === TILE_TYPE_COUNT) {
      best = Math.min(best, evaluate(melds, partials, hasPair));
      return;
    }

    const suit = indexSuit(i);
    const rank = indexRank(i);
    const blocksUsed = melds + partials;

    // 완성 멘츠: 각자(같은 패 3장)
    if (counts[i]! >= 3) {
      counts[i]! -= 3;
      scan(i, melds + 1, partials, hasPair);
      counts[i]! += 3;
    }

    // 완성 멘츠: 순자(연속 세 숫자)
    if (suit !== null && rank <= 7 && counts[i + 1]! > 0 && counts[i + 2]! > 0) {
      counts[i]! -= 1;
      counts[i + 1]! -= 1;
      counts[i + 2]! -= 1;
      scan(i, melds + 1, partials, hasPair);
      counts[i]! += 1;
      counts[i + 1]! += 1;
      counts[i + 2]! += 1;
    }

    // 대자로 확정 (아직 대자가 없을 때만, 블록 수 제한과 무관)
    if (!hasPair && counts[i]! >= 2) {
      counts[i]! -= 2;
      scan(i, melds, partials, true);
      counts[i]! += 2;
    }

    // 타츠(부분 멘츠): 대자 후보(장차 각자가 될 짝)
    if (blocksUsed < 4 && counts[i]! >= 2) {
      counts[i]! -= 2;
      scan(i, melds, partials + 1, hasPair);
      counts[i]! += 2;
    }

    // 타츠: 양쪽/변짱 형태 (연속 두 숫자, 예: 4-5)
    if (blocksUsed < 4 && suit !== null && rank <= 8 && counts[i + 1]! > 0) {
      counts[i]! -= 1;
      counts[i + 1]! -= 1;
      scan(i, melds, partials + 1, hasPair);
      counts[i]! += 1;
      counts[i + 1]! += 1;
    }

    // 타츠: 간짱 형태 (한 칸 띈 두 숫자, 예: 4-6)
    if (blocksUsed < 4 && suit !== null && rank <= 7 && counts[i + 2]! > 0) {
      counts[i]! -= 1;
      counts[i + 2]! -= 1;
      scan(i, melds, partials + 1, hasPair);
      counts[i]! += 1;
      counts[i + 2]! += 1;
    }

    // 고립패로 두고 건너뛴다 (이 종류의 패는 어떤 블록에도 쓰지 않음)
    const saved = counts[i]!;
    counts[i] = 0;
    scan(i + 1, melds, partials, hasPair);
    counts[i] = saved;
  }

  scan(0, 0, 0, false);
  return best;
}

/**
 * 치토이츠(칠대자) 기준으로 샹텐수를 계산한다.
 * 공식: 6 - (이미 짝을 이룬 패 종류 수) + max(0, 7 - (서로 다른 패 종류 수))
 */
export function calculateChiitoitsuShanten(tiles: readonly Tile[]): number {
  const counts = new Map<number, number>();
  for (const tile of tiles) {
    const idx = tileToIndex(tile);
    counts.set(idx, (counts.get(idx) ?? 0) + 1);
  }

  const kinds = counts.size;
  let pairs = 0;
  for (const count of counts.values()) {
    if (count >= 2) pairs += 1;
  }

  return 6 - pairs + Math.max(0, 7 - kinds);
}

/**
 * 손패의 샹텐수를 계산한다 (표준형과 치토이츠형 중 더 작은 값).
 * 13장(화료 전) 또는 14장(직전에 패를 뽑았거나 화료 여부를 확인할 때) 모두 지원한다.
 * @throws 손패가 13장 또는 14장이 아니면 에러를 던진다.
 */
export function calculateShanten(tiles: readonly Tile[]): number {
  if (tiles.length !== 13 && tiles.length !== 14) {
    throw new Error(`샹텐 계산은 13장 또는 14장 손패에 대해서만 가능합니다: ${tiles.length}장 입력됨`);
  }
  return Math.min(calculateStandardShanten(tiles), calculateChiitoitsuShanten(tiles));
}

/**
 * 13장 손패가 텐파이(한 장만 더 있으면 화료) 상태인지 판정한다.
 * @throws 손패가 정확히 13장이 아니면 에러를 던진다.
 */
export function isTenpai(hand: readonly Tile[]): boolean {
  if (hand.length !== 13) {
    throw new Error(`텐파이 판정은 13장 손패에 대해서만 가능합니다: ${hand.length}장 입력됨`);
  }
  return calculateShanten(hand) === 0;
}
