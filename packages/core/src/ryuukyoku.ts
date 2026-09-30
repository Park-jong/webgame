/**
 * 유국(流局) / 흐름국 처리
 *
 * 모든 함수는 순수 함수이며 입력을 변경하지 않는다.
 *
 * [좌석 규약] call.ts와 동일: 좌석은 0~3, 친(親, 딜러)의 좌석은 호출자가 넘긴다.
 *
 * [룰 선택 사항 - 기본값은 천봉(텐호) 룰 기준]
 * - 노텐 벌부: 총 3000점 (텐파이 1/2/3명이면 노텐자가 각각 1000/1500/3000 지불).
 *   전원 텐파이/전원 노텐이면 점수 이동 없음.
 * - 렌짱: 황패평국 시 친이 텐파이면 렌짱(연장), 노텐이면 친 교대.
 *   도중유국은 항상 렌짱(친 유지, 본장 +1)으로 취급한다.
 * - 텐파이 판정은 shanten.ts의 샹텐수 0 기준이다. 화료패 4장을 모두 자기가 들고 있는
 *   경우(카라텐)나 화료 불가 형태(역 없음)도 텐파이로 인정한다(구분하지 않음).
 *   부로가 있으면 치토이츠는 제외한다. 부로 없는 13장은 국사무쌍 텐파이(13면 대기 및
 *   12종+1장 중복)도 shanten.ts와 별개로 판정해 텐파이로 인정한다.
 * - 구종구패: 자기 첫 순(부로/깡 없음, 다른 누구의 부로도 없음)의 14장 손패에서
 *   요구패(1/9/자패) 9종 이상이면 선언 가능. 선언은 선택이므로 "선언 가능 여부"만 판정한다.
 * - 사풍연타: 첫 순 4명의 첫 버림패가 모두 같은 풍패이고 그 사이 부로가 없을 때.
 * - 사개깡: 깡이 총 4회이고 한 명이 모두 한 것이 아닐 때 (한 명이 4깡이면 스깡쯔 텐파이로 계속).
 *   5회째 이상은 항상 유국으로 본다. 실제 유국 시점은 4번째 깡 후 버림패에 론이 없을 때이며,
 *   그 타이밍 제어는 호출자(게임 진행 로직) 책임이다.
 * - 사가리치: 4명 모두 리치 선언 완료 (4번째 리치 버림패에 론이 없을 때 유국, 타이밍은 호출자 책임).
 * - 삼가화: 동시에 3명이 론. 옵션 tripleRon으로 "abort"(유국, 기본) / "allow"(전원 화료 인정).
 *   (더블론은 이 모듈의 범위 밖이며 항상 허용)
 */

import type { Tile } from "./tiles.js";
import { isSameTileType } from "./tiles.js";
import { tileToIndex } from "./meld.js";
import { calculateShanten, calculateStandardShanten } from "./shanten.js";
import type { CalledMeld, Seat } from "./call.js";

/** 노텐 벌부 총액 */
export const NOTEN_PENALTY_TOTAL = 3000;

// ---------------------------------------------------------------------------
// 결과 타입
// ---------------------------------------------------------------------------

/** 도중유국 종류 */
export type AbortiveDrawReason =
  | "kyuushuKyuuhai" // 구종구패
  | "suufonRenda" // 사풍연타
  | "suukaikan" // 사개깡
  | "suuchaRiichi" // 사가리치
  | "sanchaHou"; // 삼가화

/** 황패평국 (패산 소진) */
export interface ExhaustiveDraw {
  type: "exhaustive";
  /** 좌석별 텐파이 여부 (길이 4) */
  tenpai: boolean[];
  /** 좌석별 점수 증감 (길이 4, 합계 0) */
  scoreDeltas: number[];
  /** 친이 텐파이라 렌짱하는지 */
  renchan: boolean;
}

/** 도중유국 */
export interface AbortiveDraw {
  type: "abortive";
  reason: AbortiveDrawReason;
  /** 도중유국은 항상 렌짱 (친 유지, 본장 증가) */
  renchan: true;
}

export type RyuukyokuResult = ExhaustiveDraw | AbortiveDraw;

// ---------------------------------------------------------------------------
// 황패평국
// ---------------------------------------------------------------------------

/**
 * 국사무쌍 텐파이 판정 (부로 없는 13장 전용, shanten.ts가 국사를 다루지 않아 별도 처리).
 * 13장이 모두 요구패이고 서로 다른 종류가 12종 이상(13면 대기 또는 12종+1장 중복)이면 텐파이.
 */
function isKokushiTenpai(hand: readonly Tile[]): boolean {
  if (hand.length !== 13 || !hand.every(isYaochuu)) return false;
  return countYaochuuKinds(hand) >= 12;
}

/**
 * 텐파이 판정. 부로가 있으면 멜드당 3장을 손패에 더해 13장으로 맞춰 계산한다.
 * @param hand 손패 (부로 없음: 13장, 부로 있음: 13 - 3*멜드 수 장)
 * @throws 손패 + 멜드가 13장 상당이 아니면 에러
 */
export function isTenpaiWithMelds(hand: readonly Tile[], melds: readonly CalledMeld[] = []): boolean {
  if (hand.length + melds.length * 3 !== 13) {
    throw new Error(`텐파이 판정: 손패 ${hand.length}장 + 멜드 ${melds.length}개는 13장 상당이 아닙니다`);
  }
  if (melds.length === 0) return calculateShanten(hand) === 0 || isKokushiTenpai(hand);
  const padded: Tile[] = [...hand];
  for (const meld of melds) padded.push(meld.tiles[0], meld.tiles[1], meld.tiles[2]);
  return calculateStandardShanten(padded) === 0;
}

/**
 * 노텐 벌부 점수 증감을 계산한다.
 * @param tenpai 좌석별 텐파이 여부 (길이 4)
 * @returns 좌석별 점수 증감 (길이 4). 텐파이 0/4명이면 전부 0.
 */
export function calculateNotenPenalty(tenpai: readonly boolean[]): number[] {
  if (tenpai.length !== 4) throw new Error(`좌석은 4개여야 합니다: ${tenpai.length}`);
  const tenpaiCount = tenpai.filter(Boolean).length;
  if (tenpaiCount === 0 || tenpaiCount === 4) return [0, 0, 0, 0];
  const receive = NOTEN_PENALTY_TOTAL / tenpaiCount;
  const pay = NOTEN_PENALTY_TOTAL / (4 - tenpaiCount);
  return tenpai.map((t) => (t ? receive : -pay));
}

/** 친이 텐파이일 때만 렌짱 */
export function isDealerRenchan(tenpai: readonly boolean[], dealer: Seat): boolean {
  return tenpai[dealer] === true;
}

/**
 * 황패평국(패산 소진) 결과를 계산한다.
 * @param hands 좌석별 손패 (길이 4, 부로 수만큼 장수가 줄어듦)
 * @param dealer 친 좌석
 * @param meldsBySeat 좌석별 부로 (생략 시 전원 부로 없음)
 */
export function resolveExhaustiveDraw(
  hands: readonly (readonly Tile[])[],
  dealer: Seat,
  meldsBySeat: readonly (readonly CalledMeld[])[] = [[], [], [], []],
): ExhaustiveDraw {
  if (hands.length !== 4) throw new Error(`손패는 4명분이어야 합니다: ${hands.length}`);
  if (meldsBySeat.length !== 4) throw new Error(`부로는 4명분이어야 합니다: ${meldsBySeat.length}`);
  if (!Number.isInteger(dealer) || dealer < 0 || dealer > 3) {
    throw new Error(`친 좌석은 0~3의 정수여야 합니다: ${dealer}`);
  }
  const tenpai = hands.map((h, seat) => isTenpaiWithMelds(h, meldsBySeat[seat] ?? []));
  return {
    type: "exhaustive",
    tenpai,
    scoreDeltas: calculateNotenPenalty(tenpai),
    renchan: isDealerRenchan(tenpai, dealer),
  };
}

// ---------------------------------------------------------------------------
// 도중유국
// ---------------------------------------------------------------------------

function isYaochuu(tile: Tile): boolean {
  if (tile.kind !== "number") return true;
  return tile.rank === 1 || tile.rank === 9;
}

/** 손패의 요구패(1/9/자패) 종류 수 */
export function countYaochuuKinds(hand: readonly Tile[]): number {
  const kinds = new Set<number>();
  for (const tile of hand) {
    if (isYaochuu(tile)) kinds.add(tileToIndex(tile));
  }
  return kinds.size;
}

/**
 * 구종구패 선언 가능 여부.
 * @param hand 첫 츠모 직후 14장 손패
 * @param isFirstTurn 자기 첫 순인가 (그 전에 누구의 부로/깡도 없어야 함)
 * @param melds 자기 부로 (있으면 불가)
 */
export function canDeclareKyuushuKyuuhai(
  hand: readonly Tile[],
  isFirstTurn: boolean,
  melds: readonly CalledMeld[] = [],
): boolean {
  if (!isFirstTurn || melds.length > 0 || hand.length !== 14) return false;
  return countYaochuuKinds(hand) >= 9;
}

/**
 * 사풍연타 판정.
 * @param firstDiscards 첫 순 4명의 첫 버림패 (버린 순서대로, 4장일 때만 성립)
 * @param anyCallsMade 그 사이(또는 이전)에 부로/깡이 있었는가
 */
export function isSuufonRenda(firstDiscards: readonly Tile[], anyCallsMade: boolean): boolean {
  if (anyCallsMade || firstDiscards.length !== 4) return false;
  const first = firstDiscards[0]!;
  return first.kind === "wind" && firstDiscards.every((t) => isSameTileType(t, first));
}

/**
 * 사개깡 판정.
 * @param kanSeats 깡을 한 좌석 목록 (깡 발생 순서대로, 깡 1회당 1항목)
 */
export function isSuukaikan(kanSeats: readonly Seat[]): boolean {
  if (kanSeats.length < 4) return false;
  if (kanSeats.length === 4 && kanSeats.every((s) => s === kanSeats[0])) return false;
  return true;
}

/** 사가리치 판정 (좌석별 리치 여부, 길이 4) */
export function isSuuchaRiichi(riichi: readonly boolean[]): boolean {
  return riichi.length === 4 && riichi.every(Boolean);
}

export interface RyuukyokuOptions {
  /** 삼가화 처리: "abort"=유국(기본), "allow"=3명 모두 화료 인정 */
  tripleRon?: "abort" | "allow";
}

/** 삼가화 유국 여부 */
export function isSanchaHou(ronCount: number, options: RyuukyokuOptions = {}): boolean {
  if (!Number.isInteger(ronCount) || ronCount < 0 || ronCount > 3) {
    throw new Error(`론 인원은 0~3의 정수여야 합니다: ${ronCount}`);
  }
  return ronCount === 3 && (options.tripleRon ?? "abort") === "abort";
}

/** 도중유국 결과 생성 */
export function abortiveDraw(reason: AbortiveDrawReason): AbortiveDraw {
  return { type: "abortive", reason, renchan: true };
}
