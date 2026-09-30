/**
 * 화료(和了) 판정
 *
 * 손패(당첨패 포함)가 유효한 승리 형태(표준형 또는 치토이츠)인지 boolean으로 판정한다.
 * 역(役) 유무는 확인하지 않는다 - 순수하게 "패의 모양"만 판정한다 (역 판정은 yaku.ts 담당).
 *
 * 부로(치/펑/깡) 멜드가 있으면 멜드를 제외한 손패로 나머지 멘츠 + 대자를 판정한다.
 * 이때 손패 장수는 14 - 3 * 멜드 수 (깡도 3장으로 계산, call.ts의 규약과 동일).
 */

import type { Tile } from "./tiles.js";
import type { CalledMeld } from "./call.js";
import { decomposeStandardHand, isChiitoitsuHand } from "./meld.js";

/**
 * 손패가 화료 형태(표준형 (4-멜드수)멘츠+1대자, 또는 멜드가 없을 때 치토이츠)인지 판정한다.
 * 장수가 14 - 3 * 멜드 수가 아니면 무조건 false를 반환한다 (에러를 던지지 않음 - 임의의 손패를 안전하게 검사할 수 있도록).
 * @param melds 부로한 멜드 목록 (생략 시 멘젠 14장 손패). 멜드의 패는 tiles에 포함하지 않는다.
 */
export function isAgari(tiles: readonly Tile[], melds: readonly CalledMeld[] = []): boolean {
  if (melds.length > 4) return false;
  if (tiles.length !== 14 - 3 * melds.length) return false;
  if (melds.length === 0 && isChiitoitsuHand(tiles)) return true;
  return decomposeStandardHand(tiles, melds.length).length > 0;
}
