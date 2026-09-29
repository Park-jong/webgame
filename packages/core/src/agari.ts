/**
 * 화료(和了) 판정
 *
 * 14장의 손패(당첨패 포함)가 유효한 승리 형태(표준형 또는 치토이츠)인지 boolean으로 판정한다.
 * 역(役) 유무는 확인하지 않는다 - 순수하게 "패의 모양"만 판정한다 (역 판정은 yaku.ts 담당).
 */

import type { Tile } from "./tiles.js";
import { decomposeStandardHand, isChiitoitsuHand } from "./meld.js";

/**
 * 14장의 손패가 화료 형태(표준형 4멘츠+1대자, 또는 치토이츠)인지 판정한다.
 * 14장이 아니면 무조건 false를 반환한다 (에러를 던지지 않음 - 임의의 손패를 안전하게 검사할 수 있도록).
 */
export function isAgari(tiles: readonly Tile[]): boolean {
  if (tiles.length !== 14) return false;
  if (isChiitoitsuHand(tiles)) return true;
  return decomposeStandardHand(tiles).length > 0;
}
