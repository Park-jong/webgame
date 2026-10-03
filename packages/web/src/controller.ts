/**
 * 게임 컨트롤러 (UI 프레임워크와 무관한 순수 TS)
 *
 * 사람 = 좌석 0, 봇 = 좌석 1~3. `Session`은 불변처럼 다루며(상태/로그는 매번 새 객체) rng만 공유되는
 * 가변 클로저다. 같은 시드로 시작하고 같은 행동을 넣으면 같은 결과가 나온다.
 */

import {
  YAKU_NAMES,
  YAKUMAN_COUNT,
  awaitingSeats,
  countDora,
  countRedFives,
  createGame,
  decideAction,
  dispatch,
  doraIndicatorsOf,
  legalActions,
  sameExactTile,
  startNextRound,
  uraDoraIndicatorsOf,
} from "@mahjong/core";
import type {
  AbortiveDrawReason,
  Action,
  CalledMeld,
  GameState,
  RandomFn,
  ScoreLimit,
  Seat,
  Tile,
} from "@mahjong/core";
import { WIND_LABEL, tileLabel } from "./tileText";

export const HUMAN_SEAT: Seat = 0;
export const SEAT_NAMES = ["나", "하가", "대면", "상가"] as const;
const MAX_LOG = 100;

/** 시드 지정 가능한 RNG (mulberry32) */
export function createRng(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomSeed(): number {
  return Math.floor(Math.random() * 0x100000000);
}

export interface Session {
  seed: number;
  rng: RandomFn;
  state: GameState;
  /** 최근 행동 로그 (오래된 것이 앞) */
  log: readonly string[];
}

export interface AdvanceOptions {
  /** 리치 후 사람이 츠모기리 외 선택지가 없으면 자동으로 버린다. 기본 true */
  autoRiichiDiscard?: boolean;
}

// ---------------------------------------------------------------------------
// 세션 생성 / 로그
// ---------------------------------------------------------------------------

function withLog(session: Session, entries: readonly string[], state: GameState): Session {
  return { ...session, state, log: [...session.log, ...entries].slice(-MAX_LOG) };
}

export function roundLabel(state: GameState): string {
  return `${WIND_LABEL[state.roundWind]} ${state.kyoku}국 ${state.honba}본장`;
}

export function newSession(seed: number = randomSeed()): Session {
  const rng = createRng(seed);
  const state = createGame(rng);
  return { seed, rng, state, log: [`${roundLabel(state)} 시작 (시드 ${seed})`] };
}

export function describeAction(action: Action): string | null {
  const who = SEAT_NAMES[action.seat] ?? `좌석${action.seat}`;
  switch (action.type) {
    case "discard":
      return `${who}: ${tileLabel(action.tile)} 타패${action.riichi ? " (리치)" : ""}`;
    case "tsumo":
      return `${who}: 츠모`;
    case "ron":
      return `${who}: 론`;
    case "chi":
      return `${who}: 치 (${action.use.map(tileLabel).join(", ")})`;
    case "pon":
      return `${who}: 펑`;
    case "daiminkan":
      return `${who}: 대명깡`;
    case "ankan":
      return `${who}: 안깡 (${tileLabel(action.tile)})`;
    case "shouminkan":
      return `${who}: 가깡 (${tileLabel(action.tile)})`;
    case "kyuushu":
      return `${who}: 구종구패 선언`;
    case "pass":
      return null; // 패스는 로그에 남기지 않는다
  }
}

export const ABORTIVE_NAMES: Record<AbortiveDrawReason, string> = {
  kyuushuKyuuhai: "구종구패",
  suufonRenda: "사풍연타",
  suukaikan: "사개깡",
  suuchaRiichi: "사가리치",
  sanchaHou: "삼가화",
};

const LIMIT_NAMES: Record<ScoreLimit, string> = {
  mangan: "만관",
  haneman: "하네만",
  baiman: "배만",
  sanbaiman: "삼배만",
  yakuman: "역만",
};

// ---------------------------------------------------------------------------
// 행동 적용 / 진행
// ---------------------------------------------------------------------------

/** 행동을 적용한다. 합법 행동이 아니면 IllegalActionError. */
export function applyAction(session: Session, action: Action): Session {
  const next = dispatch(session.state, action);
  const entries: string[] = [];
  const line = describeAction(action);
  if (line) entries.push(line);
  if (isRoundOver(next)) entries.push(describeResult(summarizeRound(next)));
  return withLog(session, entries, next);
}

/** 사람이 지금 선택해야 하는지 (사람의 합법 행동이 있는 상태) */
export function humanMustAct(state: GameState): boolean {
  return awaitingSeats(state).includes(HUMAN_SEAT) && legalActions(state, HUMAN_SEAT).length > 0;
}

export function isRoundOver(state: GameState): boolean {
  return state.phase === "roundEnd" || state.phase === "gameEnd";
}

/** 사람이 리치 중이고 츠모기리 외 선택지가 없을 때 그 행동 */
function autoRiichiAction(state: GameState): Action | null {
  if (state.phase !== "turn" || state.turn !== HUMAN_SEAT || !state.players[HUMAN_SEAT]!.riichi) return null;
  const actions = legalActions(state, HUMAN_SEAT);
  return actions.length === 1 && actions[0]!.type === "discard" ? actions[0]! : null;
}

/** 사람의 선택 없이 자동(봇/리치 후 츠모기리)으로 진행할 행동이 남아 있는지 */
export function autoPending(state: GameState, options: AdvanceOptions = {}): boolean {
  if (isRoundOver(state)) return false;
  if (options.autoRiichiDiscard !== false && autoRiichiAction(state)) return true;
  return !humanMustAct(state) && awaitingSeats(state).some((s) => s !== HUMAN_SEAT);
}

/**
 * 봇(또는 자동 행동) 한 번을 진행한다. 사람이 선택해야 하거나 국이 끝났으면 null.
 * UI가 행동 사이에 지연을 두고 싶을 때 이 함수를 호출한다.
 */
export function stepAuto(session: Session, options: AdvanceOptions = {}): Session | null {
  const { state } = session;
  if (isRoundOver(state)) return null;
  const auto = options.autoRiichiDiscard === false ? null : autoRiichiAction(state);
  if (auto) return applyAction(session, auto);
  if (humanMustAct(state)) return null;
  const seat = awaitingSeats(state).find((s) => s !== HUMAN_SEAT);
  if (seat === undefined) return null; // 방어: 진행 불가 (발생하지 않아야 함)
  return applyAction(session, decideAction(state, seat, session.rng));
}

/** 사람이 행동해야 하는 시점(또는 국 종료)까지 봇 행동을 모두 진행한다. */
export function advance(session: Session, options: AdvanceOptions = {}): Session {
  let current = session;
  for (;;) {
    const next = stepAuto(current, options);
    if (next === null) return current;
    current = next;
  }
}

/** 사람의 합법 행동 */
export function humanActions(state: GameState): Action[] {
  return legalActions(state, HUMAN_SEAT);
}

/** 국 종료 상태에서 다음 국을 시작한다 (사람 차례까지 진행하지는 않는다). */
export function beginNextRound(session: Session): Session {
  const state = startNextRound(session.state, session.rng);
  return withLog(session, [`${roundLabel(state)} 시작`], state);
}

/** 역만 배수 표시 이름 (1: 역만, 2: 더블역만, 3 이상: N배 역만) */
export function yakumanLabel(multiple: number): string {
  return multiple === 1 ? "역만" : multiple === 2 ? "더블역만" : `${multiple}배 역만`;
}

// ---------------------------------------------------------------------------
// 결과 요약
// ---------------------------------------------------------------------------

export interface WinSummary {
  seat: Seat;
  /** 론이면 버린 사람 */
  from: Seat | null;
  winningTile: Tile;
  /** 화료패를 제외한 손패 (정렬) */
  hand: Tile[];
  melds: readonly CalledMeld[];
  /** han은 일반 역의 판수 (역만 역은 0), yakuman은 역만 배수 (일반 역은 0, 더블역만은 2) */
  yaku: { name: string; han: number; yakuman: number }[];
  /** 도라 판수 합계 (= doraCount + redDora + uraDora, core calculateScore의 dora와 동일) */
  dora: number;
  /** 겉도라(깡도라 포함) 판수 */
  doraCount: number;
  /** 적도라 판수 */
  redDora: number;
  /** 뒷도라 판수 (리치 화료일 때만) */
  uraDora: number;
  han: number;
  fu: number;
  limit: string | null;
  /** 역만 역의 배수 합 (역만 역이 있을 때만 1 이상, 일반 화료와 13판 헤아림 역만은 0). 이때 판수/도라는 반영하지 않는다. */
  yakumanMultiple: number;
  isDealer: boolean;
  /** 본장/리치봉 포함 화료자가 받는 수령 합계 */
  total: number;
  /** 화료 손 자체의 점수 (본장/리치봉 제외). handPoints + honbaPoints + riichiPoints === total */
  handPoints: number;
  /** 본장 가산 (300 x 본장 수) */
  honbaPoints: number;
  /** 수령한 리치봉 (1000 x 개수, 다중 론이면 한 화료자에게만) */
  riichiPoints: number;
  /** 기본점 (부 x 2^(판+2), 한도 적용 후) */
  basePoints: number;
  riichi: boolean;
}

/** core ScoreResult의 지불 정보에서 손 점수/본장/리치봉을 분리한다 (core 수정 없이 payment와 basePoints로 역산). */
export function splitPoints(s: {
  basePoints: number;
  isDealer: boolean;
  payment: { type: "ron"; fromDiscarder: number } | { type: "tsumo"; fromDealer: number | null; fromEachNonDealer: number };
  total: number;
}): { handPoints: number; honbaPoints: number; riichiPoints: number } {
  const up = (v: number) => Math.ceil(v / 100) * 100;
  const p = s.payment;
  let paid: number;
  let pure: number;
  if (p.type === "ron") {
    paid = p.fromDiscarder;
    pure = up(s.basePoints * (s.isDealer ? 6 : 4));
  } else if (p.fromDealer === null) {
    paid = p.fromEachNonDealer * 3;
    pure = up(s.basePoints * 2) * 3;
  } else {
    paid = p.fromDealer + p.fromEachNonDealer * 2;
    pure = up(s.basePoints * 2) + up(s.basePoints) * 2;
  }
  return { handPoints: pure, honbaPoints: paid - pure, riichiPoints: s.total - paid };
}

export interface RoundSummary {
  kind: "win" | "draw";
  gameOver: boolean;
  title: string;
  winType: "tsumo" | "ron" | null;
  wins: WinSummary[];
  /** 유국 종류 (황패평국 / 도중유국 사유) */
  drawName: string | null;
  /** 황패평국 좌석별 텐파이 */
  tenpai: boolean[] | null;
  /** 유국만관("유국만관") 달성 좌석 (없으면 빈 배열). 있으면 deltas는 유국만관 지불이다. */
  nagashiMangan?: number[];
  deltas: number[];
  /** 국 종료 후 점수 */
  scores: number[];
  doraIndicators: Tile[];
  /** 리치 화료가 있을 때만 공개 */
  uraDoraIndicators: Tile[];
  dealerContinues: boolean;
}

function removeExact(hand: readonly Tile[], tile: Tile): Tile[] {
  const i = hand.findIndex((t) => sameExactTile(t, tile));
  const copy = [...hand];
  if (i >= 0) copy.splice(i, 1);
  return copy;
}

/** roundEnd/gameEnd 상태의 결과를 UI용 데이터로 정리한다. */
export function summarizeRound(state: GameState): RoundSummary {
  const result = state.result;
  if (!isRoundOver(state) || result === null) throw new Error("국이 끝난 상태가 아닙니다.");
  const wins: WinSummary[] = result.wins.map((w) => {
    const p = state.players[w.seat]!;
    const s = w.score;
    // core scoreWin과 동일한 입력: 화료패를 포함한 손패 + 멜드
    const fullHand = w.from === null ? p.hand : [...p.hand, w.winningTile];
    // 역만 역이 있으면 도라는 판수에 반영하지 않으므로 표시도 하지 않는다
    const yakumanMultiple = s.yaku.reduce((sum, y) => sum + (YAKUMAN_COUNT[y.id] ?? 0), 0);
    const countsDora = yakumanMultiple === 0;
    const doraCount = countsDora ? countDora(fullHand, doraIndicatorsOf(state), p.melds) : 0;
    const uraDora = countsDora && p.riichi ? countDora(fullHand, uraDoraIndicatorsOf(state), p.melds) : 0;
    const redDora = countsDora ? countRedFives(fullHand, p.melds) : 0;
    return {
      seat: w.seat,
      from: w.from,
      winningTile: w.winningTile,
      // 츠모는 손패에 화료패가 포함돼 있고, 론은 포함돼 있지 않다
      hand: w.from === null ? removeExact(p.hand, w.winningTile) : [...p.hand],
      melds: p.melds,
      yaku: s.yaku.map((y) => ({ name: YAKU_NAMES[y.id] ?? y.name, han: y.han, yakuman: YAKUMAN_COUNT[y.id] ?? 0 })),
      dora: s.dora,
      doraCount,
      redDora,
      uraDora,
      han: s.han,
      fu: s.fu,
      limit: yakumanMultiple > 0 ? yakumanLabel(yakumanMultiple) : s.limit ? LIMIT_NAMES[s.limit] : null,
      yakumanMultiple,
      isDealer: s.isDealer,
      total: s.total,
      ...splitPoints(s),
      basePoints: s.basePoints,
      riichi: p.riichi,
    };
  });
  const isWin = wins.length > 0;
  const drawName =
    result.type === "exhaustive"
      ? "황패평국"
      : result.type === "abortive" && result.reason
        ? ABORTIVE_NAMES[result.reason]
        : null;
  return {
    kind: isWin ? "win" : "draw",
    gameOver: state.phase === "gameEnd",
    title: isWin ? (result.type === "tsumo" ? "츠모 화료" : "론 화료") : (drawName ?? "유국"),
    winType: result.type === "tsumo" ? "tsumo" : result.type === "ron" ? "ron" : null,
    wins,
    drawName,
    tenpai: result.tenpai ?? null,
    nagashiMangan: result.nagashiMangan ? [...result.nagashiMangan] : [],
    deltas: [...result.deltas],
    scores: [...state.scores],
    doraIndicators: doraIndicatorsOf(state),
    uraDoraIndicators: wins.some((w) => w.riichi) ? uraDoraIndicatorsOf(state) : [],
    dealerContinues: result.dealerContinues,
  };
}

function describeResult(summary: RoundSummary): string {
  if (summary.kind === "win") {
    return summary.wins
      .map((w) => {
        const who = SEAT_NAMES[w.seat];
        const how = w.from === null ? "츠모" : `론 (${SEAT_NAMES[w.from]})`;
        return `${who} 화료: ${how} ${w.limit ?? `${w.han}판 ${w.fu}부`} ${w.handPoints}점 (수령 ${w.total}점)`;
      })
      .join(" / ");
  }
  return `유국: ${summary.drawName ?? ""}`;
}

/** 최종 순위 (점수 내림차순, 동점은 좌석 번호 순) */
export function finalRanking(scores: readonly number[]): { seat: Seat; score: number; rank: number }[] {
  return scores
    .map((score, seat) => ({ seat, score }))
    .sort((a, b) => b.score - a.score || a.seat - b.seat)
    .map((e, i) => ({ ...e, rank: i + 1 }));
}
