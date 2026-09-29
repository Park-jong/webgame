/**
 * 점수(부수/판수) 계산
 *
 * 역 판수 합산 → 부수 계산 → 기본점 → 오야/코, 론/츠모별 지불액 산출.
 * 손패가 여러 방식으로 분해될 때는 분해(및 당첨패 대기 해석)마다 (판수, 부수)를 따로 계산하고
 * 점수가 가장 높은 것을 채택한다. 치토이츠도 후보에 포함한다.
 *
 * 채택한 룰 (일반적인 리치마작 기준):
 * - 현재 엔진은 멘젠 손패만 다루므로 모든 멘츠는 안커(암각)로 간주한다. 단 론으로 각자가 완성된
 *   샤보 대기는 그 각자를 밍커(명각)로 계산한다. isConcealed=false 이면 에러를 던진다.
 * - 부수: 기본 20, 멘젠 론 +10, 츠모 +2(핑후 츠모는 20부 고정), 각자 중장패 안커 4/요구패 안커 8
 *   (밍커는 절반), 대자가 삼원패/자풍/장풍이면 각 +2 (자풍=장풍인 더블동 대자는 +2+2=4),
 *   간짱/변짱/단기 대기 +2. 10 단위 올림. 치토이츠는 25부 고정.
 * - 기본점 = 부 × 2^(판+2), 2000 이상이면 만관(2000)으로 제한. 절상만관(1920→2000)은 적용하지 않는다.
 *   5판 만관 / 6~7 하네만 3000 / 8~10 배만 4000 / 11~12 삼배만 6000 / 13판 이상 (헤아림) 역만 8000.
 * - 지불액: 각 지불 금액을 100 단위로 올림. 론은 오야 6배/코 4배, 츠모는 오야 화료 시 각 2배,
 *   코 화료 시 오야 2배 + 코 1배. 본장은 론 300점/츠모 각 100점, 리치봉은 1000점씩 화료자가 가져간다.
 * - 역만 역(국사무쌍 등)은 아직 판정하지 않는다. 도라는 판수 숫자만 외부에서 받는다.
 */

import type { Tile } from "./tiles.js";
import { isSameTileType } from "./tiles.js";
import type { StandardDecomposition } from "./meld.js";
import { decomposeStandardHand } from "./meld.js";
import { isAgari } from "./agari.js";
import {
  YAKU_HAN,
  YAKU_NAMES,
  detectChiitoitsuYaku,
  detectYakuForDecomposition,
  findWaitInterpretations,
  isPinfuForDecomposition,
} from "./yaku.js";
import type { WaitInterpretation, WinContext, YakuId } from "./yaku.js";

/** 점수 계산 선택 인자 */
export interface ScoreOptions {
  /** 도라 판수 합계 (도라/뒷도라/적도라). 기본 0. 역이 하나도 없으면 도라만으로는 화료할 수 없다. */
  dora?: number;
  /** 본장 수. 기본 0. */
  honba?: number;
  /** 場에 쌓인 리치봉 개수 (화료자가 가져감). 기본 0. */
  riichiSticks?: number;
}

export type ScoreLimit = "mangan" | "haneman" | "baiman" | "sanbaiman" | "yakuman";

export interface ScoredYaku {
  id: YakuId;
  name: string;
  han: number;
}

/** 론 지불: 버린 사람이 전액 지불 */
export interface RonPayment {
  type: "ron";
  fromDiscarder: number;
}

/** 츠모 지불: 각자 지불액 (오야가 화료했으면 fromDealer는 null이고 코 3명이 fromEachNonDealer씩 지불) */
export interface TsumoPayment {
  type: "tsumo";
  fromDealer: number | null;
  fromEachNonDealer: number;
}

export interface ScoreResult {
  kind: "scored";
  /** 채택된 분해에서 성립한 역 (역패는 각자마다 별도 항목) */
  yaku: ScoredYaku[];
  /** 역 판수 합계 (도라 제외) */
  yakuHan: number;
  dora: number;
  /** 총 판수 = yakuHan + dora */
  han: number;
  fu: number;
  basePoints: number;
  /** 만관 이상 한도에 해당하면 그 이름, 아니면 null */
  limit: ScoreLimit | null;
  isDealer: boolean;
  payment: RonPayment | TsumoPayment;
  /** 본장/리치봉 포함, 화료자가 최종적으로 받는 점수 총합 */
  total: number;
}

/** 역이 하나도 없어 화료할 수 없는 경우 (도라만 있는 경우 포함) */
export interface NoYakuResult {
  kind: "noYaku";
}

export type ScoreOutcome = ScoreResult | NoYakuResult;

const CHIITOITSU_FU = 25;

function roundUp(value: number, unit: number): number {
  return Math.ceil(value / unit) * unit;
}

function isTerminalOrHonor(tile: Tile): boolean {
  return tile.kind !== "number" || tile.rank === 1 || tile.rank === 9;
}

/** 표준형 분해 + 대기 해석 하나에 대한 최종 부수 (10 단위 올림 적용) */
function calculateStandardFu(
  decomposition: StandardDecomposition,
  wait: WaitInterpretation,
  isPinfu: boolean,
  ctx: WinContext,
): number {
  const isTsumo = ctx.winType === "tsumo";
  // 핑후 츠모는 20부 고정 (츠모부 없음)
  if (isPinfu && isTsumo) return 20;

  let fu = 20;
  fu += isTsumo ? 2 : 10; // 츠모부 / 멘젠 론 가산

  decomposition.melds.forEach((meld, index) => {
    if (meld.type !== "triplet") return;
    let value = isTerminalOrHonor(meld.tiles[0]) ? 8 : 4;
    // 론으로 완성된 샤보 대기의 각자는 밍커로 취급
    if (!isTsumo && wait.shape === "shanpon" && wait.meldIndex === index) value /= 2;
    fu += value;
  });

  // 대자 부수: 삼원패 2, 자풍 2, 장풍 2 (더블동 대자는 2+2=4)
  const pairTile = decomposition.pair.tiles[0];
  if (pairTile.kind === "dragon") {
    fu += 2;
  } else if (pairTile.kind === "wind") {
    if (pairTile.wind === ctx.seatWind) fu += 2;
    if (pairTile.wind === ctx.roundWind) fu += 2;
  }

  // 대기 부수: 간짱/변짱/단기
  if (wait.shape === "kanchan" || wait.shape === "penchan" || wait.shape === "tanki") fu += 2;

  return roundUp(fu, 10);
}

/** 판수/부수로 기본점과 한도를 계산한다. */
function calculateBasePoints(han: number, fu: number): { basePoints: number; limit: ScoreLimit | null } {
  if (han >= 13) return { basePoints: 8000, limit: "yakuman" };
  if (han >= 11) return { basePoints: 6000, limit: "sanbaiman" };
  if (han >= 8) return { basePoints: 4000, limit: "baiman" };
  if (han >= 6) return { basePoints: 3000, limit: "haneman" };
  if (han >= 5) return { basePoints: 2000, limit: "mangan" };
  const raw = fu * 2 ** (han + 2);
  if (raw >= 2000) return { basePoints: 2000, limit: "mangan" };
  return { basePoints: raw, limit: null };
}

/** 후보 하나 (분해/대기 해석 하나에 대한 역+부수) */
interface Candidate {
  yakuIds: YakuId[];
  fu: number;
}

function buildCandidates(ctx: WinContext): Candidate[] {
  const candidates: Candidate[] = [];

  const chiitoitsuYaku = detectChiitoitsuYaku(ctx);
  if (chiitoitsuYaku.length > 0) {
    candidates.push({ yakuIds: chiitoitsuYaku, fu: CHIITOITSU_FU });
  }

  for (const decomposition of decomposeStandardHand(ctx.hand)) {
    const baseIds = detectYakuForDecomposition(decomposition, ctx).filter((id) => id !== "pinfu");
    const pinfuPossible = isPinfuForDecomposition(decomposition, ctx);
    for (const wait of findWaitInterpretations(decomposition, ctx.winningTile)) {
      // 핑후는 당첨패를 양면 대기로 해석한 경우에만 성립
      const isPinfu = pinfuPossible && wait.shape === "ryanmen";
      candidates.push({
        yakuIds: isPinfu ? [...baseIds, "pinfu"] : baseIds,
        fu: calculateStandardFu(decomposition, wait, isPinfu, ctx),
      });
    }
  }
  return candidates;
}

interface ScoredCandidate {
  candidate: Candidate;
  yakuHan: number;
  han: number;
  basePoints: number;
  limit: ScoreLimit | null;
}

/**
 * 화료 손패의 점수를 계산한다.
 * 여러 분해/대기 해석 중 (기본점 → 판수 → 부수) 순으로 가장 높은 것을 채택한다.
 * @returns 역이 하나도 없으면 `{ kind: "noYaku" }`, 있으면 점수 결과.
 * @throws 14장이 아니거나, 화료 형태가 아니거나, winningTile이 hand에 없거나, 멘젠이 아니거나,
 *   dora/honba/riichiSticks가 0 이상의 정수가 아니면 에러를 던진다.
 */
export function calculateScore(ctx: WinContext, options: ScoreOptions = {}): ScoreOutcome {
  const dora = options.dora ?? 0;
  const honba = options.honba ?? 0;
  const riichiSticks = options.riichiSticks ?? 0;

  if (ctx.hand.length !== 14) {
    throw new Error(`점수 계산은 당첨패를 포함한 14장 손패에 대해서만 가능합니다: ${ctx.hand.length}장 입력됨`);
  }
  if (!ctx.hand.some((tile) => isSameTileType(tile, ctx.winningTile))) {
    throw new Error("winningTile은 hand에 포함된 패여야 합니다.");
  }
  if (!isAgari(ctx.hand)) {
    throw new Error("화료 형태가 아닌 손패는 점수를 계산할 수 없습니다.");
  }
  if (!ctx.isConcealed) {
    throw new Error("부저(치/퐁/깡) 손패의 점수 계산은 아직 지원하지 않습니다.");
  }
  for (const [name, value] of [
    ["dora", dora],
    ["honba", honba],
    ["riichiSticks", riichiSticks],
  ] as const) {
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`${name}는 0 이상의 정수여야 합니다: ${value}`);
    }
  }

  const isDealer = ctx.seatWind === "east";
  let best: ScoredCandidate | null = null;

  for (const candidate of buildCandidates(ctx)) {
    const yakuHan = candidate.yakuIds.reduce((sum, id) => sum + YAKU_HAN[id], 0);
    if (yakuHan === 0) continue; // 역 없음: 도라만으로는 화료 불가
    const han = yakuHan + dora;
    const { basePoints, limit } = calculateBasePoints(han, candidate.fu);
    const isBetter =
      best === null ||
      basePoints > best.basePoints ||
      (basePoints === best.basePoints &&
        (han > best.han || (han === best.han && candidate.fu > best.candidate.fu)));
    if (isBetter) best = { candidate, yakuHan, han, basePoints, limit };
  }

  if (best === null) return { kind: "noYaku" };

  const { candidate, yakuHan, han, basePoints, limit } = best;
  let payment: RonPayment | TsumoPayment;
  let paidTotal: number;
  if (ctx.winType === "ron") {
    const fromDiscarder = roundUp(basePoints * (isDealer ? 6 : 4), 100) + 300 * honba;
    payment = { type: "ron", fromDiscarder };
    paidTotal = fromDiscarder;
  } else if (isDealer) {
    const each = roundUp(basePoints * 2, 100) + 100 * honba;
    payment = { type: "tsumo", fromDealer: null, fromEachNonDealer: each };
    paidTotal = each * 3;
  } else {
    const fromDealer = roundUp(basePoints * 2, 100) + 100 * honba;
    const fromEachNonDealer = roundUp(basePoints, 100) + 100 * honba;
    payment = { type: "tsumo", fromDealer, fromEachNonDealer };
    paidTotal = fromDealer + fromEachNonDealer * 2;
  }

  return {
    kind: "scored",
    yaku: candidate.yakuIds.map((id) => ({ id, name: YAKU_NAMES[id], han: YAKU_HAN[id] })),
    yakuHan,
    dora,
    han,
    fu: candidate.fu,
    basePoints,
    limit,
    isDealer,
    payment,
    total: paidTotal + 1000 * riichiSticks,
  };
}
