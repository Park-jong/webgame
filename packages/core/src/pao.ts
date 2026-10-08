/**
 * 패오(책임지불, 包)
 *
 * 대삼원(삼원패 3종 멜드)과 대사희(바람패 4종 멜드)에서, 마지막 멜드를 완성시킨 버림패의 주인이
 * 책임자가 된다. 그 역만으로 화료하면 책임자가 대신 지불한다.
 *
 * 이 모듈은 멜드 목록(생성 순서)만으로 책임자를 판정하는 순수 함수만 둔다.
 * 안깡으로 마지막 멜드를 만들었거나 카칸으로 확장한 경우는 새 멜드가 아니므로 책임자가 생기지 않는다
 * (카칸은 원래 펑의 `fromSeat`가 그대로 유지되며, 펑 자리에서 제자리 교체되어 순서도 유지된다).
 *
 * [지불 규칙] (`game.ts`가 적용)
 * - 츠모: 책임자가 그 역만 몫을 세 사람 분 모두 지불한다. 본장도 책임자가 전부 낸다.
 * - 론: 그 역만 몫을 책임자와 버린 사람이 절반씩 낸다. 본장은 버린 사람이 낸다. 버린 사람이 책임자면 전액.
 * - 역만이 겹친 경우(예: 대삼원 + 자일색) 책임 대상이 아닌 역만 몫은 보통대로 지불한다.
 * - 소사희, 사깡쯔 등은 책임지불 대상이 아니다.
 */

import type { CalledMeld, Seat } from "./call.js";
import type { YakuId } from "./yaku.js";

export interface PaoInfo {
  /** 대삼원의 책임자 (없으면 null) */
  dragon: Seat | null;
  /** 대사희의 책임자 (없으면 null) */
  wind: Seat | null;
}

/** 멜드 목록(생성 순서)에서 대삼원/대사희의 책임자를 찾는다. */
export function findPao(melds: readonly CalledMeld[]): PaoInfo {
  const dragons = new Set<string>();
  const winds = new Set<string>();
  const info: PaoInfo = { dragon: null, wind: null };
  for (const meld of melds) {
    const tile = meld.tiles[0];
    if (tile.kind === "dragon") {
      dragons.add(tile.dragon);
      if (dragons.size === 3 && meld.type !== "ankan") info.dragon = meld.fromSeat;
    } else if (tile.kind === "wind") {
      winds.add(tile.wind);
      if (winds.size === 4 && meld.type !== "ankan") info.wind = meld.fromSeat;
    }
  }
  return info;
}

/** 책임 대상 역만 하나의 배수 */
const PAO_YAKUMAN: Partial<Record<YakuId, "dragon" | "wind">> = {
  daisangen: "dragon",
  daisuushii: "wind",
};

const PAO_MULTIPLIER: Partial<Record<YakuId, number>> = {
  daisangen: 1,
  daisuushii: 2,
};

export interface PaoLiability {
  /** 대신 지불하는 좌석 */
  liable: Seat;
  /** 책임 대상 역만의 배수 합 (대삼원 1, 대사희 2) */
  multiplier: number;
}

/**
 * 성립한 역 중 책임 대상 역만이 있고 그 책임자가 있으면 책임 정보를 반환한다.
 * 화료자가 곧 책임자일 수는 없다(자기 버림패는 가져올 수 없음).
 */
export function paoLiability(melds: readonly CalledMeld[], yakuIds: readonly YakuId[]): PaoLiability | null {
  const info = findPao(melds);
  let liable: Seat | null = null;
  let multiplier = 0;
  for (const id of yakuIds) {
    const kind = PAO_YAKUMAN[id];
    if (kind === undefined) continue;
    const seat = info[kind];
    if (seat === null) continue;
    liable = seat;
    multiplier += PAO_MULTIPLIER[id]!;
  }
  return liable === null ? null : { liable, multiplier };
}
