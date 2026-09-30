/**
 * 멘츠(면자) 분해
 *
 * 14장의 손패를 멘츠(순자/각자) 4개 + 대자(쌍) 1개로 나누는 모든 방법을 찾는다.
 * 표준형 외에 치토이츠(칠대자: 서로 다른 패 7쌍)도 별도로 지원한다.
 *
 * 내부적으로는 패를 34종류(만수 1~9, 통수 1~9, 삭수 1~9, 풍패 4종, 삼원패 3종)의
 * 인덱스(0~33)로 매핑해 개수 배열로 다루는 표준적인 방식을 사용한다.
 */

import type { Dragon, NumberSuit, Tile, Wind } from "./tiles.js";

const NUMBER_SUITS: NumberSuit[] = ["man", "pin", "sou"];
const WINDS: Wind[] = ["east", "south", "west", "north"];
const DRAGONS: Dragon[] = ["white", "green", "red"];

/** 패 종류를 34종 인덱스(0~33)로 매핑한다. 적도라 여부는 구분하지 않는다. */
export function tileToIndex(tile: Tile): number {
  if (tile.kind === "number") {
    return NUMBER_SUITS.indexOf(tile.suit) * 9 + (tile.rank - 1);
  }
  if (tile.kind === "wind") {
    return 27 + WINDS.indexOf(tile.wind);
  }
  return 27 + WINDS.length + DRAGONS.indexOf(tile.dragon);
}

/** 34종 인덱스 전체 개수 */
export const TILE_TYPE_COUNT = 34;

/** 인덱스가 어떤 수패 슈트에 속하는지 반환한다 (자패면 null). */
export function indexSuit(index: number): NumberSuit | null {
  if (index < 0 || index >= 27) return null;
  return NUMBER_SUITS[Math.floor(index / 9)]!;
}

/** 인덱스에 해당하는 수패 랭크(1~9)를 반환한다 (수패 인덱스에만 의미가 있음). */
export function indexRank(index: number): number {
  return (index % 9) + 1;
}

/** 순자(순서대로 이어진 세 장, 예: 3-4-5) */
export interface SequenceMeld {
  type: "sequence";
  suit: NumberSuit;
  /** 순자의 시작 숫자 (1~7). 예: startRank=3이면 3-4-5 */
  startRank: number;
  tiles: [Tile, Tile, Tile];
}

/** 각자(같은 패 세 장, 커츠) */
export interface TripletMeld {
  type: "triplet";
  tiles: [Tile, Tile, Tile];
}

export type Meld = SequenceMeld | TripletMeld;

/** 대자(같은 패 두 장, 짝/페어) */
export interface Pair {
  tiles: [Tile, Tile];
}

/** 멘츠 4개 + 대자 1개로 이루어진 표준형 분해 결과 */
export interface StandardDecomposition {
  melds: Meld[];
  pair: Pair;
}

type BlockMove =
  | { block: "triplet"; index: number }
  | { block: "sequence"; index: number }
  | { block: "pair"; index: number };

/**
 * 손패를 멘츠 (4 - calledMeldCount)개 + 대자 1개(표준형)로 분해할 수 있는 모든 조합을 찾는다.
 * calledMeldCount(부로한 멜드 수, 기본 0)만큼 멘츠가 이미 완성돼 있으므로 손패는 14 - 3 * calledMeldCount 장이어야 한다
 * (깡도 3장으로 계산). 반환하는 melds에는 손패 안의 멘츠만 들어 있고 부로 멜드는 포함되지 않는다.
 * 같은 패가 여러 용도(순자 vs 각자 등)로 해석될 수 있는 경우 모든 유효한 해석을 반환한다.
 * 유효한 분해가 하나도 없으면 빈 배열을 반환한다.
 * @throws 입력이 정확히 14 - 3 * calledMeldCount 장이 아니면 에러를 던진다.
 */
export function decomposeStandardHand(tiles: readonly Tile[], calledMeldCount = 0): StandardDecomposition[] {
  if (!Number.isInteger(calledMeldCount) || calledMeldCount < 0 || calledMeldCount > 4) {
    throw new Error(`부로 멜드 수는 0~4의 정수여야 합니다: ${calledMeldCount}`);
  }
  const expectedSize = 14 - 3 * calledMeldCount;
  if (tiles.length !== expectedSize) {
    throw new Error(`표준형 분해는 정확히 ${expectedSize}장이 필요합니다: ${tiles.length}장 입력됨`);
  }
  const concealedMeldCount = 4 - calledMeldCount;

  const counts = new Array(TILE_TYPE_COUNT).fill(0) as number[];
  const buckets: Tile[][] = Array.from({ length: TILE_TYPE_COUNT }, () => []);
  for (const tile of tiles) {
    const idx = tileToIndex(tile);
    counts[idx]! += 1;
    buckets[idx]!.push(tile);
  }

  const results: StandardDecomposition[] = [];
  const seenKeys = new Set<string>();

  function finalize(moves: BlockMove[]): void {
    const consumed = new Array(TILE_TYPE_COUNT).fill(0) as number[];
    const take = (index: number): Tile => {
      const bucket = buckets[index]!;
      const tile = bucket[consumed[index]!]!;
      consumed[index]! += 1;
      return tile;
    };

    const melds: Meld[] = [];
    let pair: Pair | null = null;

    for (const move of moves) {
      if (move.block === "pair") {
        pair = { tiles: [take(move.index), take(move.index)] };
      } else if (move.block === "triplet") {
        melds.push({ type: "triplet", tiles: [take(move.index), take(move.index), take(move.index)] });
      } else {
        const suit = indexSuit(move.index);
        if (suit === null) continue; // 이론상 발생하지 않음 (자패는 순자를 만들 수 없음)
        melds.push({
          type: "sequence",
          suit,
          startRank: indexRank(move.index),
          tiles: [take(move.index), take(move.index + 1), take(move.index + 2)],
        });
      }
    }

    if (!pair) return; // 방어적 처리: 정상 경로에서는 발생하지 않음

    // 정렬 후 중복 제거용 키 생성 (탐색 경로가 달라도 결과가 같으면 하나만 남긴다)
    const key = [...moves]
      .map((m) => `${m.block}:${m.index}`)
      .sort()
      .join(",");
    if (seenKeys.has(key)) return;
    seenKeys.add(key);

    melds.sort((a, b) => tileToIndex(a.tiles[0]) - tileToIndex(b.tiles[0]));
    results.push({ melds, pair });
  }

  function search(from: number, moves: BlockMove[]): void {
    let i = from;
    while (i < TILE_TYPE_COUNT && counts[i] === 0) i++;

    if (i === TILE_TYPE_COUNT) {
      const meldCount = moves.filter((m) => m.block !== "pair").length;
      const pairCount = moves.filter((m) => m.block === "pair").length;
      if (meldCount === concealedMeldCount && pairCount === 1) {
        finalize(moves);
      }
      return;
    }

    const suit = indexSuit(i);
    const rank = indexRank(i);
    const hasPairAlready = moves.some((m) => m.block === "pair");

    // 각자(커츠): 같은 패 3장
    if (counts[i]! >= 3) {
      counts[i]! -= 3;
      moves.push({ block: "triplet", index: i });
      search(i, moves);
      moves.pop();
      counts[i]! += 3;
    }

    // 순자: 연속된 세 숫자 (수패만 가능, 시작 숫자는 7 이하)
    if (suit !== null && rank <= 7 && counts[i + 1]! > 0 && counts[i + 2]! > 0) {
      counts[i]! -= 1;
      counts[i + 1]! -= 1;
      counts[i + 2]! -= 1;
      moves.push({ block: "sequence", index: i });
      search(i, moves);
      moves.pop();
      counts[i]! += 1;
      counts[i + 1]! += 1;
      counts[i + 2]! += 1;
    }

    // 대자: 같은 패 2장 (아직 대자를 쓰지 않았을 때만)
    if (!hasPairAlready && counts[i]! >= 2) {
      counts[i]! -= 2;
      moves.push({ block: "pair", index: i });
      search(i, moves);
      moves.pop();
      counts[i]! += 2;
    }

    // 위 어떤 방법으로도 이 인덱스의 패를 전부 소진할 수 없으면 이 경로는 실패로 남는다.
    // (되돌아갈 다른 분기가 없으므로 아무것도 하지 않고 반환 - 탐색은 자연히 종료된다)
  }

  search(0, []);
  return results;
}

/** 패 종류(적도라 무관)를 문자열 키로 변환한다. */
function tileTypeKey(tile: Tile): string {
  return String(tileToIndex(tile));
}

/**
 * 정확히 14장의 손패가 치토이츠(칠대자: 서로 다른 패 7쌍) 형태인지 판정한다.
 * 같은 패가 3장 이상 모여 있으면(예: 한 종류를 4장 다 모음) 치토이츠로 인정하지 않는다.
 */
export function isChiitoitsuHand(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;

  const counts = new Map<string, number>();
  for (const tile of tiles) {
    const key = tileTypeKey(tile);
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }

  if (counts.size !== 7) return false;
  return [...counts.values()].every((count) => count === 2);
}
