/**
 * 역(役) 판정 - 핵심 역 세트
 *
 * 표시 이름은 역.txt 표기를 따른다 (docs/yaku-spec.md 0장).
 * 구현 범위: 리치, 멘젠쯔모, 핑후, 탕야오, 삼원패/자풍패/장풍패, 이페코, 또이또이(모든 멘츠가 각자),
 * 산안커, 치또이쯔, 그리고 역만/더블역만(대삼원, 스안커, 자일색, 녹일색, 청노두, 국사무쌍, 소사희, 스깡쯔,
 * 구련보등, 스안커 단기, 국사무쌍 13면 대기, 순정구련보등, 대사희), 상황 역(일발, 더블리치, 창깡, 영상개화,
 * 해저로월, 하저로어)과 천화/지화(역만). 인화는 미구현.
 *
 * [부로(치/펑/깡) 손패]
 * - WinContext.melds에 부로 멜드를 넘기면 hand는 멜드를 제외한 손패(14 - 3 * 멜드 수 장)여야 한다.
 * - 멘젠 판정은 isConcealed && 멜드가 모두 안깡 (isContextConcealed). 멘젠 한정 역(리치/멘젠쯔모/핑후/이페코/치또이쯔,
 *   역만 중 스안커/국사무쌍/구련보등)은 부로하면 성립하지 않는다.
 * - 쿠이사가리: YAKU_HAN은 { menzen, open }이다 (찬타/일기통관/삼색동순 2/1, 준찬타/혼일색 3/2, 청일색 6/5).
 *   멘젠 전용 역(량페코 등)은 open이 0이고 부로 시 판정에서 제외된다. 판수는 yakuHan(id, 멘젠 여부)로 읽는다.
 * - 산안커(안커 3개): 안깡은 안커로 세고, 론으로 완성된 샤보 대기의 각자는 안커로 세지 않는다.
 *
 * [역만]
 * - 역만 역은 YAKU_HAN이 0이고 YAKUMAN_COUNT에 배수(1 또는 2)를 갖는다. 더블역만은 별도 id이다.
 * - 역만이 하나라도 있으면 일반 역/도라는 무시하고 복합 역만은 배수를 합산한다 (score.ts).
 * - detectYaku도 역만이 있으면 역만만 반환한다 (calculateScore와 같은 yakumanCandidates를 쓴다).
 *
 * 도라 계산과 점수(부수/판수) 계산은 이 파일의 범위가 아니다 - 각 역은 "성립하는지 여부"만 판정한다.
 */

import type { Tile, Wind } from "./tiles.js";
import { isSameTileType } from "./tiles.js";
import { isAgari } from "./agari.js";
import type { CalledMeld } from "./call.js";
import { isMenzen } from "./call.js";
import type { Meld, SequenceMeld, StandardDecomposition } from "./meld.js";
import {
  TILE_TYPE_COUNT,
  YAOCHUU_INDICES,
  decomposeStandardHand,
  isChiitoitsuHand,
  isKokushiHand,
  tileToIndex,
} from "./meld.js";

export type WinType = "tsumo" | "ron";

/** 역 판정에 필요한 문맥 정보 */
export interface WinContext {
  /** 화료를 구성하는 14장 전체 손패 (당첨패 포함) */
  hand: Tile[];
  /** 당첨패 (론이면 상대가 버린 패, 츠모면 직접 뽑은 패). hand 안에 포함되어 있어야 한다. */
  winningTile: Tile;
  /** 멘젠(門前) 여부 - 치/퐁/깡을 한 번도 하지 않은 완전 비공개 상태인지 */
  isConcealed: boolean;
  /** 츠모(자기 스스로 뽑아 화료)인지 론(타인의 버림패로 화료)인지 */
  winType: WinType;
  /** 리치를 선언한 상태로 화료했는지 */
  isRiichi: boolean;
  /** 자신의 자리 바람 (자풍) */
  seatWind: Wind;
  /** 해당 국의 바람 (장풍) */
  roundWind: Wind;
  /**
   * 부로한 멜드 목록 (선택, 기본 없음). 있으면 hand에는 멜드의 패를 포함하지 않는다
   * (hand 장수 = 14 - 3 * 멜드 수, 깡도 3장으로 계산). 당첨패는 항상 hand 안에 있다.
   */
  melds?: readonly CalledMeld[];

  // --- 상황 역 플래그 (모두 선택, 미지정이면 false) ---
  /** 리치(더블리치 포함) 후 자신의 다음 타패 전에 화료했는지 (일발). 멘젠 + 리치일 때만 성립 */
  isIppatsu?: boolean;
  /** 더블리치로 리치했는지. 리치를 대체한다(리치는 부여하지 않음). 리치 상태로 간주한다 */
  isDoubleRiichi?: boolean;
  /** 깡 후 영상패로 츠모 화료했는지 (영상개화, 츠모 한정) */
  isRinshan?: boolean;
  /** 다른 사람의 가깡/안깡 패로 론했는지 (창깡, 론 한정) */
  isChankan?: boolean;
  /** 마지막 산패로 츠모 화료했는지 (해저로월, 츠모 한정, 영상패면 성립하지 않음) */
  isHaitei?: boolean;
  /** 마지막 산패를 뽑은 사람의 버림패로 론했는지 (하저로어, 론 한정) */
  isHoutei?: boolean;
  /** 친의 첫 츠모로 화료했는지 (천화, 역만, 멘젠 츠모 한정) */
  isTenhou?: boolean;
  /** 자의 첫 츠모로 화료했는지 (지화, 역만, 멘젠 츠모 한정) */
  isChiihou?: boolean;
}

export type YakuId =
  | "riichi"
  | "menzenTsumo"
  | "pinfu"
  | "tanyao"
  | "yakuhaiDragon"
  | "yakuhaiSeatWind"
  | "yakuhaiRoundWind"
  | "iipeikou"
  | "toitoi"
  | "sanankou"
  | "chiitoitsu"
  // 일반 역 (17-1)
  | "sanshokuDoukou"
  | "sankantsu"
  | "shousangen"
  | "honroutou"
  | "chanta"
  | "ittsu"
  | "sanshokuDoujun"
  | "ryanpeikou"
  | "junchan"
  | "honitsu"
  | "chinitsu"
  // 상황 역
  | "ippatsu"
  | "doubleRiichi"
  | "chankan"
  | "rinshanKaihou"
  | "haiteiRaoyue"
  | "houteiRaoyui"
  // 역만
  | "tenhou"
  | "chiihou"
  | "daisangen"
  | "suuankou"
  | "tsuuiisou"
  | "ryuuiisou"
  | "chinroutou"
  | "kokushiMusou"
  | "shousuushii"
  | "suukantsu"
  | "chuurenPoutou"
  // 더블역만
  | "suuankouTanki"
  | "kokushiMusou13"
  | "junseiChuurenPoutou"
  | "daisuushii";

export interface YakuMatch {
  id: YakuId;
  /** 역의 한글 이름 (표시용) */
  name: string;
}

export const YAKU_NAMES: Record<YakuId, string> = {
  riichi: "리치",
  menzenTsumo: "멘젠쯔모",
  pinfu: "핑후",
  tanyao: "탕야오",
  yakuhaiDragon: "삼원패",
  yakuhaiSeatWind: "자풍패",
  yakuhaiRoundWind: "장풍패",
  iipeikou: "이페코",
  toitoi: "또이또이",
  sanankou: "산안커",
  chiitoitsu: "치또이쯔",
  sanshokuDoukou: "삼색동각",
  sankantsu: "산깡쯔",
  shousangen: "소삼원",
  honroutou: "혼노두",
  chanta: "찬타",
  ittsu: "일기통관",
  sanshokuDoujun: "삼색동순",
  ryanpeikou: "량페코",
  junchan: "준찬타",
  honitsu: "혼일색",
  chinitsu: "청일색",
  ippatsu: "일발",
  doubleRiichi: "더블리치",
  chankan: "창깡",
  rinshanKaihou: "영상개화",
  haiteiRaoyue: "해저로월",
  houteiRaoyui: "하저로어",
  tenhou: "천화",
  chiihou: "지화",
  daisangen: "대삼원",
  suuankou: "스안커",
  tsuuiisou: "자일색",
  ryuuiisou: "녹일색",
  chinroutou: "청노두",
  kokushiMusou: "국사무쌍",
  shousuushii: "소사희",
  suukantsu: "스깡쯔",
  chuurenPoutou: "구련보등",
  suuankouTanki: "스안커 단기",
  kokushiMusou13: "국사무쌍 13면 대기",
  junseiChuurenPoutou: "순정구련보등",
  daisuushii: "대사희",
};

/** 역만 역의 배수 (일반 역은 없음). 더블역만은 별도 id로 두고 배수 2를 갖는다. */
export const YAKUMAN_COUNT: Partial<Record<YakuId, number>> = {
  tenhou: 1,
  chiihou: 1,
  daisangen: 1,
  suuankou: 1,
  tsuuiisou: 1,
  ryuuiisou: 1,
  chinroutou: 1,
  kokushiMusou: 1,
  shousuushii: 1,
  suukantsu: 1,
  chuurenPoutou: 1,
  suuankouTanki: 2,
  kokushiMusou13: 2,
  junseiChuurenPoutou: 2,
  daisuushii: 2,
};

/** 역이 역만(더블역만 포함)인지 */
export function isYakumanId(id: YakuId): boolean {
  return (YAKUMAN_COUNT[id] ?? 0) > 0;
}

/** 역 id 목록의 역만 배수 합 (역만이 없으면 0) */
export function yakumanMultiplier(ids: readonly YakuId[]): number {
  return ids.reduce((sum, id) => sum + (YAKUMAN_COUNT[id] ?? 0), 0);
}

/** 역의 판수 (멘젠 / 후로). 후로 불가 역(멘젠 전용)은 open이 0이다. 역만 역은 둘 다 0이고 YAKUMAN_COUNT를 쓴다. */
export interface YakuHan {
  menzen: number;
  open: number;
}

const both = (han: number): YakuHan => ({ menzen: han, open: han });
const menzenOnly = (han: number): YakuHan => ({ menzen: han, open: 0 });
const kuisagari = (menzen: number, open: number): YakuHan => ({ menzen, open });

/** 역별 판수 (멘젠/후로). 쿠이사가리 역은 후로 판수가 더 작다. */
export const YAKU_HAN: Record<YakuId, YakuHan> = {
  riichi: menzenOnly(1),
  menzenTsumo: menzenOnly(1),
  pinfu: menzenOnly(1),
  tanyao: both(1),
  yakuhaiDragon: both(1),
  yakuhaiSeatWind: both(1),
  yakuhaiRoundWind: both(1),
  iipeikou: menzenOnly(1),
  toitoi: both(2),
  sanankou: both(2),
  chiitoitsu: menzenOnly(2),
  sanshokuDoukou: both(2),
  sankantsu: both(2),
  shousangen: both(2),
  honroutou: both(2),
  chanta: kuisagari(2, 1),
  ittsu: kuisagari(2, 1),
  sanshokuDoujun: kuisagari(2, 1),
  ryanpeikou: menzenOnly(3),
  junchan: kuisagari(3, 2),
  honitsu: kuisagari(3, 2),
  chinitsu: kuisagari(6, 5),
  ippatsu: menzenOnly(1),
  doubleRiichi: menzenOnly(2),
  chankan: both(1),
  rinshanKaihou: both(1),
  haiteiRaoyue: both(1),
  houteiRaoyui: both(1),
  tenhou: both(0),
  chiihou: both(0),
  daisangen: both(0),
  suuankou: both(0),
  tsuuiisou: both(0),
  ryuuiisou: both(0),
  chinroutou: both(0),
  kokushiMusou: both(0),
  shousuushii: both(0),
  suukantsu: both(0),
  chuurenPoutou: both(0),
  suuankouTanki: both(0),
  kokushiMusou13: both(0),
  junseiChuurenPoutou: both(0),
  daisuushii: both(0),
};

/** 멘젠 여부에 따른 실제 판수 (후로 불가 역은 후로일 때 0) */
export function yakuHan(id: YakuId, concealed: boolean): number {
  return concealed ? YAKU_HAN[id].menzen : YAKU_HAN[id].open;
}

/** 부로 멜드 목록 (없으면 빈 배열) */
export function meldsOf(ctx: WinContext): readonly CalledMeld[] {
  return ctx.melds ?? [];
}

/** 실제 멘젠 여부: isConcealed이면서 부로(치/펑/대명깡/가깡)가 없어야 한다 (안깡은 멘젠 유지). */
export function isContextConcealed(ctx: WinContext): boolean {
  return ctx.isConcealed && isMenzen(meldsOf(ctx));
}

/** 부로 멜드를 분해용 Meld(순자/각자)로 변환한다. 깡은 각자로 취급한다 (4번째 패는 버린다). */
export function calledMeldToMeld(called: CalledMeld): Meld {
  if (called.type === "chi") {
    const sorted = [...called.tiles].sort((a, b) => tileToIndex(a) - tileToIndex(b)) as [Tile, Tile, Tile];
    const first = sorted[0];
    if (first.kind !== "number") throw new Error("치 멜드에 수패가 아닌 패가 있습니다.");
    return { type: "sequence", suit: first.suit, startRank: first.rank, tiles: sorted };
  }
  return { type: "triplet", tiles: [called.tiles[0], called.tiles[1], called.tiles[2]] };
}

/** 손패 분해의 멘츠 + 부로 멜드를 합친 전체 멘츠 목록 (부로 멜드가 뒤에 온다). */
function allMelds(decomposition: StandardDecomposition, ctx: WinContext): Meld[] {
  return [...decomposition.melds, ...meldsOf(ctx).map(calledMeldToMeld)];
}

/** 손패 + 멜드의 모든 패 (깡은 4장 모두 포함) */
export function allTilesOf(ctx: WinContext): Tile[] {
  return [...ctx.hand, ...meldsOf(ctx).flatMap((m) => m.tiles as readonly Tile[])];
}

/** 손패 장수가 14 - 3 * 멜드 수인지 검증한다. */
export function assertHandSize(ctx: WinContext, label: string): void {
  const expected = 14 - 3 * meldsOf(ctx).length;
  if (ctx.hand.length !== expected) {
    throw new Error(
      `${label}은(는) 당첨패를 포함한 ${expected}장 손패에 대해서만 가능합니다 (멜드 ${meldsOf(ctx).length}개): ${ctx.hand.length}장 입력됨`,
    );
  }
}

/** 모든 패가 2~8 사이의 숫자패인지 (단패/자패가 하나도 없는지) 확인한다. */
function isAllSimples(hand: readonly Tile[]): boolean {
  return hand.every((tile) => tile.kind === "number" && tile.rank >= 2 && tile.rank <= 8);
}

/** 해당 패가 역패(삼원패 또는 자풍/장풍에 해당하는 풍패)인지 확인한다. */
export function isYakuhaiTile(tile: Tile, ctx: WinContext): boolean {
  if (tile.kind === "dragon") return true;
  if (tile.kind === "wind") return tile.wind === ctx.seatWind || tile.wind === ctx.roundWind;
  return false;
}

export type WaitShape = "ryanmen" | "penchan" | "kanchan" | "tanki" | "shanpon";

/** 당첨패가 분해의 어느 블록으로 완성되었다고 해석할 수 있는지 (대기 형태 + 해당 멘츠 위치) */
export interface WaitInterpretation {
  shape: WaitShape;
  /** 당첨패가 속한 멘츠의 `melds` 인덱스 (대자로 해석한 단기 대기면 null) */
  meldIndex: number | null;
}

/**
 * 이 분해(decomposition)에서 당첨패가 어떤 대기 형태로 완성되었는지 찾는다.
 * 같은 종류의 패가 여러 블록(대자/멘츠)에 걸쳐 있을 수 있으므로, 당첨패가 들어맞는
 * 모든 위치의 해석을 반환한다 (가장 유리한 해석을 고르기 위함).
 */
export function findWaitInterpretations(
  decomposition: StandardDecomposition,
  winningTile: Tile,
): WaitInterpretation[] {
  const results: WaitInterpretation[] = [];

  if (isSameTileType(decomposition.pair.tiles[0], winningTile)) {
    results.push({ shape: "tanki", meldIndex: null });
  }

  decomposition.melds.forEach((meld, meldIndex) => {
    if (meld.type === "triplet") {
      if (isSameTileType(meld.tiles[0], winningTile)) {
        results.push({ shape: "shanpon", meldIndex });
      }
      return;
    }

    const positionInMeld = meld.tiles.findIndex((t) => isSameTileType(t, winningTile));
    if (positionInMeld === -1) return;

    if (positionInMeld === 1) {
      // 순자의 가운데 패로 완성 = 항상 간짱
      results.push({ shape: "kanchan", meldIndex });
    } else if (positionInMeld === 0) {
      // 순자의 낮은 쪽 패로 완성: 7-8-9 형태에서 7로 완성되면 변짱, 그 외엔 양짱
      results.push({ shape: meld.startRank + 2 === 9 ? "penchan" : "ryanmen", meldIndex });
    } else {
      // 순자의 높은 쪽 패로 완성: 1-2-3 형태에서 3으로 완성되면 변짱, 그 외엔 양짱
      results.push({ shape: meld.startRank === 1 ? "penchan" : "ryanmen", meldIndex });
    }
  });

  return results;
}

function findWaitShapes(decomposition: StandardDecomposition, winningTile: Tile): WaitShape[] {
  return findWaitInterpretations(decomposition, winningTile).map((w) => w.shape);
}

/** 특정 분해(decomposition) 기준으로 핑후 성립 여부를 확인한다. */
export function isPinfuForDecomposition(decomposition: StandardDecomposition, ctx: WinContext): boolean {
  if (!isContextConcealed(ctx)) return false;
  if (allMelds(decomposition, ctx).some((meld) => meld.type === "triplet")) return false;
  if (isYakuhaiTile(decomposition.pair.tiles[0], ctx)) return false;
  return findWaitShapes(decomposition, ctx.winningTile).includes("ryanmen");
}

/** 특정 분해 기준으로 성립하는 역패(자풍/장풍/삼원패) 목록을 확인한다. */
function yakuhaiIdsForDecomposition(decomposition: StandardDecomposition, ctx: WinContext): YakuId[] {
  const ids: YakuId[] = [];
  for (const meld of allMelds(decomposition, ctx)) {
    if (meld.type !== "triplet") continue;
    const tile = meld.tiles[0];
    if (tile.kind === "dragon") {
      ids.push("yakuhaiDragon");
    } else if (tile.kind === "wind") {
      if (tile.wind === ctx.seatWind) ids.push("yakuhaiSeatWind");
      if (tile.wind === ctx.roundWind) ids.push("yakuhaiRoundWind");
    }
  }
  return ids;
}

/** 분해 안의 "동일한 순자 쌍" 개수 (같은 순자 2벌 = 1쌍, 4벌 = 2쌍). 1이면 이페코, 2이면 량페코. */
function identicalSequencePairs(decomposition: StandardDecomposition): number {
  const counts = new Map<string, number>();
  for (const m of decomposition.melds) {
    if (m.type !== "sequence") continue;
    const key = `${m.suit}${m.startRank}`;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  let pairs = 0;
  for (const c of counts.values()) pairs += Math.floor(c / 2);
  return pairs;
}

/** 혼노두: 모든 패가 요구패이고 수패와 자패가 모두 있음 (자일색/청노두는 역만이라 해당 없음) */
function isHonroutou(tiles: readonly Tile[]): boolean {
  return (
    tiles.every(isYaochuuTile) && tiles.some((t) => t.kind === "number") && tiles.some((t) => t.kind !== "number")
  );
}

function isYaochuuTile(tile: Tile): boolean {
  return tile.kind !== "number" || tile.rank === 1 || tile.rank === 9;
}

/**
 * 분해(+부로 멜드) 단위로 판정되는 일반 역 (17-1): 삼색동각, 산깡쯔, 소삼원, 일기통관, 삼색동순,
 * 찬타/준찬타, 량페코/이페코(멘젠). 혼노두/혼일색/청일색은 패 구성만으로 정해져 detectContextYaku가 판정한다.
 */
function shapeYakuForDecomposition(decomposition: StandardDecomposition, ctx: WinContext): YakuId[] {
  const ids: YakuId[] = [];
  const melds = allMelds(decomposition, ctx);
  const pairTile = decomposition.pair.tiles[0];
  const sequences = melds.filter((m): m is SequenceMeld => m.type === "sequence");
  const triplets = melds.filter((m) => m.type === "triplet");

  if (isContextConcealed(ctx)) {
    const pairs = identicalSequencePairs(decomposition);
    if (pairs >= 2) ids.push("ryanpeikou");
    else if (pairs === 1) ids.push("iipeikou");
  }

  const suits = ["man", "pin", "sou"] as const;
  const hasSeq = (suit: string, rank: number): boolean =>
    sequences.some((m) => m.suit === suit && m.startRank === rank);
  const hasTriplet = (suit: string, rank: number): boolean =>
    triplets.some((m) => {
      const t = m.tiles[0];
      return t.kind === "number" && t.suit === suit && t.rank === rank;
    });
  if (suits.some((suit) => hasSeq(suit, 1) && hasSeq(suit, 4) && hasSeq(suit, 7))) ids.push("ittsu");
  for (let rank = 1; rank <= 7; rank++) {
    if (suits.every((suit) => hasSeq(suit, rank))) {
      ids.push("sanshokuDoujun");
      break;
    }
  }
  for (let rank = 1; rank <= 9; rank++) {
    if (suits.every((suit) => hasTriplet(suit, rank))) {
      ids.push("sanshokuDoukou");
      break;
    }
  }

  if (isHonroutou(allTilesOf(ctx))) ids.push("honroutou");

  // 깡 3개 (4개는 스깡쯔 역만)
  if (meldsOf(ctx).filter((m) => m.type !== "chi" && m.type !== "pon").length === 3) ids.push("sankantsu");

  // 소삼원: 삼원패 2종 각자 + 1종 대자
  const dragonTriplets = triplets.filter((m) => m.tiles[0].kind === "dragon").length;
  if (dragonTriplets === 2 && pairTile.kind === "dragon") ids.push("shousangen");

  // 찬타/준찬타: 모든 멘츠와 대자에 요구패, 순자 1개 이상 (혼노두는 순자가 없으므로 자연히 배타)
  const everyGroupHasYaochuu = melds.every((m) => m.tiles.some(isYaochuuTile)) && isYaochuuTile(pairTile);
  if (everyGroupHasYaochuu && sequences.length >= 1) {
    ids.push(allTilesOf(ctx).some((t) => t.kind !== "number") ? "chanta" : "junchan");
  }
  return ids;
}

/** 특정 분해 기준으로 또이또이(모든 멘츠가 각자) 성립 여부를 확인한다. */
function isToitoi(melds: readonly Meld[]): boolean {
  return melds.every((meld) => meld.type === "triplet");
}

/**
 * 이 분해 + 대기 해석에서 안커(암각)의 개수. 안깡은 안커로 세고, 론으로 완성된 샤보 대기의 각자는 세지 않는다.
 * wait를 생략하면 당첨패의 모든 해석 중 가장 유리한(안커가 가장 많은) 값을 쓴다.
 */
export function countConcealedTriplets(
  decomposition: StandardDecomposition,
  ctx: WinContext,
  wait?: WaitInterpretation,
): number {
  const ankan = meldsOf(ctx).filter((m) => m.type === "ankan").length;
  const countFor = (w: WaitInterpretation): number =>
    decomposition.melds.filter(
      (meld, index) =>
        meld.type === "triplet" && !(ctx.winType === "ron" && w.shape === "shanpon" && w.meldIndex === index),
    ).length;
  if (wait) return ankan + countFor(wait);
  const waits = findWaitInterpretations(decomposition, ctx.winningTile);
  return ankan + waits.reduce((max, w) => Math.max(max, countFor(w)), 0);
}

/**
 * 패 구성만으로 정해지는 역: 혼일색(한 슈트 + 자패), 청일색(한 슈트만).
 * 혼노두(요구패만, 수패+자패 모두 있음)도 구성만으로 정해지지만 국사무쌍 형태에는 붙으면 안 되므로
 * 표준형 분해/치또이쯔 형태가 확정된 곳에서만 isHonroutou로 판정한다.
 */
function tileCompositionYaku(tiles: readonly Tile[]): YakuId[] {
  const ids: YakuId[] = [];
  const numbers = tiles.filter((t) => t.kind === "number");
  const hasHonor = numbers.length < tiles.length;
  if (numbers.length === 0) return ids;
  const first = numbers[0]!;
  if (first.kind === "number" && numbers.every((t) => t.kind === "number" && t.suit === first.suit)) {
    ids.push(hasHonor ? "honitsu" : "chinitsu");
  }
  return ids;
}

/** 손패 형태와 무관하게 문맥만으로 판정되는 역 (리치/더블리치/일발/멘젠쯔모/탕야오/창깡/영상개화/해저/하저) */
function detectContextYaku(ctx: WinContext): YakuId[] {
  const ids: YakuId[] = [];
  const concealed = isContextConcealed(ctx);
  const riichi = ctx.isRiichi || ctx.isDoubleRiichi === true;
  if (riichi && concealed) ids.push(ctx.isDoubleRiichi ? "doubleRiichi" : "riichi");
  if (riichi && concealed && ctx.isIppatsu) ids.push("ippatsu");
  if (concealed && ctx.winType === "tsumo") ids.push("menzenTsumo");
  if (ctx.winType === "ron" && ctx.isChankan) ids.push("chankan");
  if (ctx.winType === "tsumo" && ctx.isRinshan) ids.push("rinshanKaihou");
  if (ctx.winType === "tsumo" && ctx.isHaitei && !ctx.isRinshan) ids.push("haiteiRaoyue");
  if (ctx.winType === "ron" && ctx.isHoutei && !ctx.isChankan) ids.push("houteiRaoyui");
  const tiles = allTilesOf(ctx);
  if (isAllSimples(tiles)) ids.push("tanyao"); // 쿠이탄 허용
  ids.push(...tileCompositionYaku(tiles));
  return ids;
}

/**
 * 하나의 특정 표준형 분해를 기준으로 성립하는 역 id 목록을 반환한다 (점수 계산용).
 * detectYaku와 달리 합집합이 아니라 이 분해 하나만 본다. 역패는 각자마다 하나씩 나오므로
 * 삼원패 각자가 2개면 "yakuhaiDragon"이 2번 포함된다 (판수 카운트용).
 */
export function detectYakuForDecomposition(
  decomposition: StandardDecomposition,
  ctx: WinContext,
  wait?: WaitInterpretation,
): YakuId[] {
  const ids = detectContextYaku(ctx);
  if (isPinfuForDecomposition(decomposition, ctx)) ids.push("pinfu");
  if (isToitoi(allMelds(decomposition, ctx))) ids.push("toitoi");
  if (countConcealedTriplets(decomposition, ctx, wait) >= 3) ids.push("sanankou");
  ids.push(...yakuhaiIdsForDecomposition(decomposition, ctx));
  ids.push(...shapeYakuForDecomposition(decomposition, ctx));
  return ids;
}

/** 치또이쯔 형태로 화료했을 때 성립하는 역 id 목록 (치또이쯔 형태가 아니면 빈 배열). 점수 계산용. */
export function detectChiitoitsuYaku(ctx: WinContext): YakuId[] {
  if (!isContextConcealed(ctx) || !isChiitoitsuHand(ctx.hand)) return [];
  const ids: YakuId[] = [...detectContextYaku(ctx), "chiitoitsu"];
  if (isHonroutou(ctx.hand)) ids.push("honroutou");
  return ids;
}

// ---------------------------------------------------------------------------
// 역만 / 더블역만
// ---------------------------------------------------------------------------

function isGreenTile(tile: Tile): boolean {
  if (tile.kind === "dragon") return tile.dragon === "green";
  return tile.kind === "number" && tile.suit === "sou" && [2, 3, 4, 6, 8].includes(tile.rank);
}

function countTileTypes(tiles: readonly Tile[]): number[] {
  const counts = new Array(TILE_TYPE_COUNT).fill(0) as number[];
  for (const tile of tiles) counts[tileToIndex(tile)]! += 1;
  return counts;
}

/** 국사무쌍 (멘젠 14장). 화료 직전 13장이 요구패 13종 1장씩이면 13면 대기(더블역만). */
function detectKokushi(ctx: WinContext): YakuId[] {
  if (!isContextConcealed(ctx) || !isKokushiHand(ctx.hand)) return [];
  const counts = countTileTypes(ctx.hand);
  counts[tileToIndex(ctx.winningTile)]! -= 1;
  const isThirteenWaits = YAOCHUU_INDICES.every((index) => counts[index] === 1);
  return [isThirteenWaits ? "kokushiMusou13" : "kokushiMusou"];
}

/**
 * 구련보등 (멜드 없는 멘젠 14장, 한 슈트 1112345678999 + 임의의 같은 슈트 1장).
 * 화료패를 뺀 13장이 정확히 1112345678999이면 9면 대기 = 순정구련보등(더블역만).
 */
function detectChuuren(ctx: WinContext): YakuId[] {
  if (meldsOf(ctx).length > 0 || !isContextConcealed(ctx)) return [];
  const first = ctx.hand[0];
  if (first === undefined || first.kind !== "number") return [];
  if (!ctx.hand.every((t) => t.kind === "number" && t.suit === first.suit)) return [];
  const counts = countTileTypes(ctx.hand);
  const base = tileToIndex(first) - (first.rank - 1); // 슈트 시작 인덱스
  const required = [3, 1, 1, 1, 1, 1, 1, 1, 3];
  if (!required.every((n, r) => counts[base + r]! >= n)) return [];
  counts[tileToIndex(ctx.winningTile)]! -= 1;
  const isPure = required.every((n, r) => counts[base + r] === n);
  return [isPure ? "junseiChuurenPoutou" : "chuurenPoutou"];
}

/** 치또이쯔 형태의 역만: 자패 7쌍 = 자일색 */
function detectChiitoitsuYakuman(ctx: WinContext): YakuId[] {
  if (!isContextConcealed(ctx) || !isChiitoitsuHand(ctx.hand)) return [];
  return ctx.hand.every((t) => t.kind !== "number") ? ["tsuuiisou"] : [];
}

/**
 * 표준형 분해 + 대기 해석 하나 기준의 역만 id 목록 (복합 역만이면 여러 개).
 * 후로 가능한 역만(대삼원/자일색/녹일색/청노두/소사희/대사희/스깡쯔)은 멜드와 손패 전체를 합쳐 판정하고,
 * 멘젠 전용인 스안커는 안커 4개(안깡 포함, 론 샤보 완성 각자는 제외)이고 단기 대기면 스안커 단기가 된다.
 */
export function detectYakumanForDecomposition(
  decomposition: StandardDecomposition,
  ctx: WinContext,
  wait: WaitInterpretation,
): YakuId[] {
  const ids: YakuId[] = [];
  const melds = allMelds(decomposition, ctx);
  const tiles = allTilesOf(ctx);
  const tripletTiles = melds.filter((m) => m.type === "triplet").map((m) => m.tiles[0]);

  if (tripletTiles.filter((t) => t.kind === "dragon").length === 3) ids.push("daisangen");

  const windTriplets = tripletTiles.filter((t) => t.kind === "wind").length;
  const pairTile = decomposition.pair.tiles[0];
  if (windTriplets === 4) ids.push("daisuushii");
  else if (windTriplets === 3 && pairTile.kind === "wind") ids.push("shousuushii");

  if (meldsOf(ctx).filter((m) => m.type !== "chi" && m.type !== "pon").length === 4) ids.push("suukantsu");

  if (tiles.every((t) => t.kind !== "number")) ids.push("tsuuiisou");
  if (tiles.every(isGreenTile)) ids.push("ryuuiisou");
  if (tiles.every((t) => t.kind === "number" && (t.rank === 1 || t.rank === 9))) ids.push("chinroutou");

  if (isContextConcealed(ctx) && countConcealedTriplets(decomposition, ctx, wait) === 4) {
    ids.push(wait.shape === "tanki" ? "suuankouTanki" : "suuankou");
  }
  return ids;
}

/**
 * 이 화료의 모든 역만 후보 (후보 하나 = 한 해석에서 동시에 성립하는 역만 id들).
 * 국사무쌍/구련보등/치또이쯔 자일색은 형태 하나로 정해지고, 표준형은 분해 x 대기 해석마다 판정한다.
 * 역만이 없으면 빈 배열. calculateScore와 detectYaku가 모두 이 함수를 쓴다.
 */
export function yakumanCandidates(ctx: WinContext): YakuId[][] {
  const candidates = formYakumanCandidates(ctx);
  // 천화/지화는 형태와 무관한 문맥 역만이다. 형태 역만이 있으면 합산하고, 없으면 단독 후보가 된다.
  const situational: YakuId[] = [];
  if (isContextConcealed(ctx) && ctx.winType === "tsumo") {
    if (ctx.isTenhou) situational.push("tenhou");
    else if (ctx.isChiihou) situational.push("chiihou");
  }
  if (situational.length === 0) return candidates;
  if (candidates.length === 0) return [situational];
  return candidates.map((ids) => [...situational, ...ids]);
}

/** 손패 형태로 정해지는 역만 후보 */
function formYakumanCandidates(ctx: WinContext): YakuId[][] {
  const candidates: YakuId[][] = [];
  for (const ids of [detectKokushi(ctx), detectChuuren(ctx), detectChiitoitsuYakuman(ctx)]) {
    if (ids.length > 0) candidates.push(ids);
  }
  for (const decomposition of decomposeStandardHand(ctx.hand, meldsOf(ctx).length)) {
    for (const wait of findWaitInterpretations(decomposition, ctx.winningTile)) {
      const ids = detectYakumanForDecomposition(decomposition, ctx, wait);
      if (ids.length > 0) candidates.push(ids);
    }
  }
  return candidates;
}

/** 역만 후보 중 배수 합이 가장 큰 것 (같으면 먼저 나온 것). 역만이 없으면 null. */
export function bestYakuman(ctx: WinContext): YakuId[] | null {
  let best: YakuId[] | null = null;
  for (const ids of yakumanCandidates(ctx)) {
    if (best === null || yakumanMultiplier(ids) > yakumanMultiplier(best)) best = ids;
  }
  return best;
}

/**
 * 화료 손패에 대해 성립하는 핵심 역 목록을 판정한다.
 * 역만이 있으면 일반 역은 무시하고 역만(복합이면 모두)만 반환한다 (calculateScore와 같은 채택 기준).
 * 같은 손패가 여러 방식으로 분해될 수 있는 경우, 분해마다 성립하는 역을 모두 모아 합집합으로 반환한다
 * (실전에서는 가장 유리한 해석을 채택하는 것과 동일한 방식).
 * @throws hand가 14장이 아니거나, hand가 화료 형태가 아니거나, winningTile이 hand에 없으면 에러를 던진다.
 */
export function detectYaku(ctx: WinContext): YakuMatch[] {
  assertHandSize(ctx, "역 판정");
  if (!ctx.hand.some((tile) => isSameTileType(tile, ctx.winningTile))) {
    throw new Error("winningTile은 hand에 포함된 패여야 합니다.");
  }
  if (!isAgari(ctx.hand, meldsOf(ctx))) {
    throw new Error("화료 형태가 아닌 손패는 역을 판정할 수 없습니다.");
  }

  const yakuman = bestYakuman(ctx);
  if (yakuman !== null) return yakuman.map((id) => ({ id, name: YAKU_NAMES[id] }));

  const ids = new Set<YakuId>();

  // 손패 형태(분해)와 무관하게 문맥만으로 판정되는 역
  for (const id of detectContextYaku(ctx)) ids.add(id);
  if (isContextConcealed(ctx) && isChiitoitsuHand(ctx.hand)) {
    ids.add("chiitoitsu");
    if (isHonroutou(ctx.hand)) ids.add("honroutou");
  }

  // 표준형(멘츠4+대자1) 분해가 필요한 역
  const decompositions = decomposeStandardHand(ctx.hand, meldsOf(ctx).length);
  for (const decomposition of decompositions) {
    if (isPinfuForDecomposition(decomposition, ctx)) ids.add("pinfu");
    if (isToitoi(allMelds(decomposition, ctx))) ids.add("toitoi");
    if (countConcealedTriplets(decomposition, ctx) >= 3) ids.add("sanankou");
    for (const id of yakuhaiIdsForDecomposition(decomposition, ctx)) ids.add(id);
    for (const id of shapeYakuForDecomposition(decomposition, ctx)) ids.add(id);
  }
  // 량페코가 성립하면 이페코는 부여하지 않는다 (다른 분해에서 이페코만 나온 경우 포함)
  if (ids.has("ryanpeikou")) ids.delete("iipeikou");

  return [...ids].map((id) => ({ id, name: YAKU_NAMES[id] }));
}

/** 화료 손패에 성립하는 역이 하나라도 있는지 확인한다 (역 없는 화료는 실전에서는 무효). */
export function hasAnyYaku(ctx: WinContext): boolean {
  return detectYaku(ctx).length > 0;
}
