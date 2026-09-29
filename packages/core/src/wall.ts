import type { Tile } from "./tiles.js";

/** 난수 생성 함수 타입. 테스트에서는 시드 고정 함수를 주입해 결정적으로 검증한다. */
export type RandomFn = () => number;

/**
 * Fisher-Yates 셔플. 원본 배열을 변경하지 않고 새 배열을 반환한다.
 *
 * 주의: 실제 서버에서 패를 섞을 때는 `Math.random()` 대신 암호학적으로
 * 안전한 난수(crypto.getRandomValues 등)를 사용해야 한다. 클라이언트가
 * 패 순서를 예측할 수 없어야 부정행위를 막을 수 있기 때문이다.
 */
export function shuffleTiles(tiles: Tile[], rng: RandomFn = Math.random): Tile[] {
  const result = [...tiles];
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = result[i]!;
    result[i] = result[j]!;
    result[j] = tmp;
  }
  return result;
}

export const NUM_PLAYERS = 4;
export const HAND_SIZE = 13;
export const DEAD_WALL_SIZE = 14;

export interface DealResult {
  /** 플레이어 0~3의 초기 손패 (각 13장, 정렬되지 않은 상태) */
  hands: [Tile[], Tile[], Tile[], Tile[]];
  /** 왕패(王牌) - 도라 표시패와 깡 보충패가 나오는 영역, 게임 끝까지 그대로 유지 */
  deadWall: Tile[];
  /** 이후 각 턴마다 순서대로 뽑게 될 패 (남은 산패) */
  liveWall: Tile[];
}

/**
 * 셔플된 136패를 표준 규칙대로 배분한다.
 * - 각 플레이어 13장씩 (딜러의 14번째 패는 첫 턴 드로우로 처리하므로 여기 포함하지 않음)
 * - 왕패 14장 고정
 * - 나머지는 산패로 순서대로 드로우
 */
export function dealTiles(shuffledTiles: Tile[]): DealResult {
  const expectedTotal = NUM_PLAYERS * HAND_SIZE + DEAD_WALL_SIZE;
  if (shuffledTiles.length < expectedTotal) {
    throw new Error(
      `패 수가 부족합니다: ${shuffledTiles.length}장 (최소 ${expectedTotal}장 필요)`,
    );
  }

  let cursor = 0;
  const hands: Tile[][] = [];
  for (let player = 0; player < NUM_PLAYERS; player++) {
    hands.push(shuffledTiles.slice(cursor, cursor + HAND_SIZE));
    cursor += HAND_SIZE;
  }

  const deadWall = shuffledTiles.slice(cursor, cursor + DEAD_WALL_SIZE);
  cursor += DEAD_WALL_SIZE;

  const liveWall = shuffledTiles.slice(cursor);

  return {
    hands: hands as DealResult["hands"],
    deadWall,
    liveWall,
  };
}
