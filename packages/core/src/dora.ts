/**
 * 도라 계산
 *
 * 표시패(도라 표시패)의 "다음 패"가 도라패가 되고, 화료 손패에서 도라패와 같은 패의 개수가 곧 도라 판수다.
 * - 수패: 1→2→…→9→1 (같은 슈트 안에서 순환)
 * - 풍패: 동→남→서→북→동
 * - 삼원패: 백→발→중→백
 *
 * 표시패가 여러 장(겉도라 + 깡도라)이면 표시패마다 독립적으로 계산해 합산한다.
 * 같은 도라패가 겹치면 그만큼 중복 가산된다 (예: 표시패 1m, 1m 이면 2m 한 장이 2판).
 * 리치 화료일 때만 뒷도라 표시패를 추가로 센다.
 *
 * 적도라(적5): 손패의 isRedFive 패 한 장마다 +1판이며 `countRedFives` 로 센다.
 * 적5도 일반 5로 취급되므로 도라패(표시패 4)이면 `countDora` 에서도 세어져 2판이 된다 (중복 가산).
 * `countTotalDora` 는 `includeRedFives: true` 를 줄 때만 적도라를 합산한다 (기본 false, 하위 호환).
 * 적도라는 도라와 마찬가지로 역이 아니므로 "역 없음" 화료 불가를 우회하지 못한다.
 *
 * 부로(치/펑/깡) 손패: 멜드에 포함된 패도 도라/적도라 계산에 포함한다 (룰 선택이 아니라 표준 룰).
 * 깡은 4장 모두 센다. 이때 hand는 멜드를 제외한 손패(14 - 3 * 멜드 수 장)이고, 멜드는 별도 인자(melds)로 받는다.
 * melds를 생략하면 기존처럼 멘젠 14장 손패로 취급한다.
 *
 * wall.ts 는 왕패를 `Tile[]` 로만 들고 있고 표시패 전용 타입이 없으므로, 여기서는 `Tile[]` 을 그대로 입력으로 받는다.
 */

import type { Dragon, Tile, Wind } from "./tiles.js";
import { isSameTileType } from "./tiles.js";
import type { CalledMeld } from "./call.js";

const WINDS: Wind[] = ["east", "south", "west", "north"];
const DRAGONS: Dragon[] = ["white", "green", "red"];

/** 멜드 없는 화료 손패 장수 (멘젠 4멘츠 + 대자, 또는 치또이쯔). 멜드가 있으면 멜드당 3장씩 줄어든다. */
const WINNING_HAND_SIZE = 14;

/** 손패 장수를 검증하고, 손패 + 멜드의 모든 패(깡은 4장)를 합쳐 반환한다. */
function collectTiles(hand: readonly Tile[], melds: readonly CalledMeld[], label: string): Tile[] {
  const expected = WINNING_HAND_SIZE - 3 * melds.length;
  if (melds.length > 4 || hand.length !== expected) {
    throw new Error(
      `${label}은(는) 손패 ${expected}장(멜드 ${melds.length}개 기준)에 대해서만 가능합니다: ${hand.length}장 입력됨`,
    );
  }
  return [...hand, ...melds.flatMap((m) => m.tiles as readonly Tile[])];
}

/** 패가 유효한 패(알려진 kind/슈트/랭크/바람/삼원패)인지 확인한다. 아니면 에러를 던진다. */
function assertValidTile(tile: Tile, label: string): void {
  const t = tile as { kind?: unknown; suit?: unknown; rank?: unknown; wind?: unknown; dragon?: unknown };
  let valid = false;
  if (t.kind === "number") {
    valid =
      (t.suit === "man" || t.suit === "pin" || t.suit === "sou") &&
      typeof t.rank === "number" &&
      Number.isInteger(t.rank) &&
      t.rank >= 1 &&
      t.rank <= 9;
  } else if (t.kind === "wind") {
    valid = WINDS.includes(t.wind as Wind);
  } else if (t.kind === "dragon") {
    valid = DRAGONS.includes(t.dragon as Dragon);
  }
  if (!valid) {
    throw new Error(`${label}이(가) 유효한 패가 아닙니다: ${JSON.stringify(tile)}`);
  }
}

/**
 * 표시패로부터 도라패를 구한다. 반환하는 패의 isRedFive 는 항상 false 다.
 * @throws 표시패가 유효한 패가 아니면 에러를 던진다.
 */
export function doraFromIndicator(indicator: Tile): Tile {
  assertValidTile(indicator, "도라 표시패");
  if (indicator.kind === "number") {
    const next = indicator.rank === 9 ? 1 : indicator.rank + 1;
    return { kind: "number", suit: indicator.suit, rank: next as 1, isRedFive: false };
  }
  if (indicator.kind === "wind") {
    const next = WINDS[(WINDS.indexOf(indicator.wind) + 1) % WINDS.length]!;
    return { kind: "wind", wind: next };
  }
  const next = DRAGONS[(DRAGONS.indexOf(indicator.dragon) + 1) % DRAGONS.length]!;
  return { kind: "dragon", dragon: next };
}

/**
 * 손패에서 표시패들이 가리키는 도라의 개수(판수)를 센다.
 * 표시패마다 독립적으로 계산해 합산하므로 표시패가 0장이면 0을 반환한다.
 * @param melds 부로 멜드 (선택). 멜드의 패도 도라로 센다 (깡은 4장 모두).
 * @throws 손패가 14 - 3 * 멜드 수 장이 아니거나, 손패/멜드/표시패에 유효하지 않은 패가 있으면 에러를 던진다.
 */
export function countDora(hand: readonly Tile[], indicators: readonly Tile[], melds: readonly CalledMeld[] = []): number {
  const tiles = collectTiles(hand, melds, "도라 계산");
  tiles.forEach((tile, i) => assertValidTile(tile, `손패[${i}]`));
  hand = tiles;

  let total = 0;
  for (const indicator of indicators) {
    const dora = doraFromIndicator(indicator);
    total += hand.filter((tile) => isSameTileType(tile, dora)).length;
  }
  return total;
}

/**
 * 손패의 적도라(isRedFive === true) 개수를 센다. 리치/표시패와 무관하다.
 * @param melds 부로 멜드 (선택). 멜드에 포함된 적5도 센다.
 * @throws 손패가 14 - 3 * 멜드 수 장이 아니거나 유효하지 않은 패가 있거나, 5가 아닌 패에 isRedFive 가 붙어 있으면 에러를 던진다.
 */
export function countRedFives(hand: readonly Tile[], melds: readonly CalledMeld[] = []): number {
  let total = 0;
  collectTiles(hand, melds, "적도라 계산").forEach((tile, i) => {
    assertValidTile(tile, `손패[${i}]`);
    if (tile.kind === "number" && tile.isRedFive === true) {
      // 5가 아닌 패의 isRedFive 는 존재할 수 없는 데이터(오염된 입력)다.
      // 조용히 무시하면 판수 오계산을 숨기고, 세면 없는 도라를 만들므로 에러로 처리한다.
      if (tile.rank !== 5) {
        throw new Error(`손패[${i}]: 5가 아닌 패에 적도라 표시가 있습니다: ${JSON.stringify(tile)}`);
      }
      total += 1;
    }
  });
  return total;
}

export interface TotalDoraInput {
  /** 화료를 구성하는 손패 (멜드가 없으면 14장, 있으면 멜드 제외 14 - 3 * 멜드 수 장) */
  hand: readonly Tile[];
  /** 부로 멜드 (선택). 멜드의 패도 도라로 센다. */
  melds?: readonly CalledMeld[];
  /** 겉도라 표시패 (깡도라 표시패 포함) */
  doraIndicators: readonly Tile[];
  /** 뒷도라 표시패 (리치 화료일 때만 적용) */
  uraDoraIndicators: readonly Tile[];
  /** 리치 화료 여부 */
  isRiichi: boolean;
  /** true 이면 적도라(isRedFive)도 합산한다. 기본 false (기존 동작 유지) */
  includeRedFives?: boolean;
}

/**
 * 겉도라 + (리치일 때만) 뒷도라의 총 판수를 구한다. 적도라는 `includeRedFives: true` 일 때만 더한다.
 * 리치가 아니면 뒷도라 표시패는 검증/계산하지 않고 무시한다.
 * 결과는 `calculateScore(ctx, { dora })` 에 그대로 넘길 수 있다.
 */
export function countTotalDora(input: TotalDoraInput): number {
  const melds = input.melds ?? [];
  let total = countDora(input.hand, input.doraIndicators, melds);
  if (input.isRiichi) total += countDora(input.hand, input.uraDoraIndicators, melds);
  if (input.includeRedFives === true) total += countRedFives(input.hand, melds);
  return total;
}
