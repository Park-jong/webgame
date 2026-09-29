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
 * 범위 밖 (이후 단계):
 * - 적도라: 손패의 isRedFive 패에 대한 +1판은 여기서 세지 않는다 (별도 규칙/Tile 확장 필요).
 * - 부저 손패: 엔진이 아직 지원하지 않으므로 14장 멘젠 손패만 다룬다.
 *
 * wall.ts 는 왕패를 `Tile[]` 로만 들고 있고 표시패 전용 타입이 없으므로, 여기서는 `Tile[]` 을 그대로 입력으로 받는다.
 */

import type { Dragon, Tile, Wind } from "./tiles.js";
import { isSameTileType } from "./tiles.js";

const WINDS: Wind[] = ["east", "south", "west", "north"];
const DRAGONS: Dragon[] = ["white", "green", "red"];

/** 화료 손패 장수 (멘젠 4멘츠 + 대자, 또는 치토이츠) */
const WINNING_HAND_SIZE = 14;

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
 * @throws 손패가 14장이 아니거나, 손패/표시패에 유효하지 않은 패가 있으면 에러를 던진다.
 */
export function countDora(hand: readonly Tile[], indicators: readonly Tile[]): number {
  if (hand.length !== WINNING_HAND_SIZE) {
    throw new Error(`도라 계산은 14장 손패에 대해서만 가능합니다: ${hand.length}장 입력됨`);
  }
  hand.forEach((tile, i) => assertValidTile(tile, `손패[${i}]`));

  let total = 0;
  for (const indicator of indicators) {
    const dora = doraFromIndicator(indicator);
    total += hand.filter((tile) => isSameTileType(tile, dora)).length;
  }
  return total;
}

export interface TotalDoraInput {
  /** 화료를 구성하는 14장 전체 손패 */
  hand: readonly Tile[];
  /** 겉도라 표시패 (깡도라 표시패 포함) */
  doraIndicators: readonly Tile[];
  /** 뒷도라 표시패 (리치 화료일 때만 적용) */
  uraDoraIndicators: readonly Tile[];
  /** 리치 화료 여부 */
  isRiichi: boolean;
}

/**
 * 겉도라 + (리치일 때만) 뒷도라의 총 판수를 구한다. 적도라는 포함하지 않는다.
 * 리치가 아니면 뒷도라 표시패는 검증/계산하지 않고 무시한다.
 * 결과는 `calculateScore(ctx, { dora })` 에 그대로 넘길 수 있다.
 */
export function countTotalDora(input: TotalDoraInput): number {
  const omote = countDora(input.hand, input.doraIndicators);
  if (!input.isRiichi) return omote;
  return omote + countDora(input.hand, input.uraDoraIndicators);
}
