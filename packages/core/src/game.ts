/**
 * 게임 진행 엔진 (한 국(局) 단위 상태 머신 + 동풍전 진행)
 *
 * 모든 함수는 순수 함수이며 입력 상태를 변경하지 않는다. `GameState`는 직렬화 가능한
 * 평범한 객체다(함수/클래스 인스턴스 없음). 난수는 `createGame`/`startNextRound`에
 * `RandomFn`으로만 주입하고, 그 외 진행(`dispatch`)은 완전히 결정적이다.
 *
 * [UI 사용 흐름]
 *   let state = createGame(rng);
 *   while (state.phase === "turn" || state.phase === "response") {
 *     for (const seat of awaitingSeats(state)) {
 *       const actions = legalActions(state, seat);   // 사람이면 선택지로 표시
 *       state = dispatch(state, chosenAction);       // 봇이면 decideAction(state, seat)
 *     }
 *   }
 *   if (state.phase === "roundEnd") state = startNextRound(state, rng);
 *
 * [단계(phase)]
 * - "turn": `state.turn` 좌석이 행동한다 (패를 뽑은 직후, 또는 치/펑 직후로 drawnTile=null).
 * - "response": 직전 버림패에 대해 `pending.awaiting` 좌석들이 론/부로/패스로 응답한다.
 *   (응답할 수 있는 행동이 없는 좌석은 자동 패스되어 awaiting에 들어가지 않는다.)
 * - "roundEnd": 한 국이 끝남(`state.result`). `startNextRound`로 다음 국을 시작한다.
 * - "gameEnd": 게임 종료 (동풍전 4국 종료 또는 점수 마이너스).
 *
 * [패 배치 규약]
 * - 손패(`PlayerState.hand`)는 멜드를 제외한 패이며 "손패 + 3 x 멜드 수"는 행동 직전 14장 (call.ts 규약).
 *   방금 뽑은 패는 손패 맨 뒤에 붙어 있고 `drawnTile`이 그 패를 가리킨다.
 * - 왕패(`deadWall`): [0..3] 영상패, [4..8] 도라 표시패 후보, [9..13] 뒷도라 후보.
 *   깡으로 영상패를 뽑으면 그 슬롯(deadWall[깡 횟수-1])을 산패의 마지막 1장으로
 *   제자리 교체해 왕패 14장, 도라/뒷도라 인덱스, 전체 136장을 유지한다.
 *
 * [룰 선택 / 단순화 - 미구현 목록]
 * - 리치 후 깡 금지 (대기가 변하지 않을 때만 안깡 허용하는 룰은 미구현).
 * - 창깡(가깡/안깡에 대한 론), 영상개화/해저/하저/일발/더블리치/천화/지화 등 상황 역은 미구현.
 * - 후리텐: 자기 버림패에 화료패가 있는 후리텐, 동순 후리텐(론 패스 후 자기 다음 버림패까지),
 *   리치 후 후리텐(영구)은 구현. 국사무쌍 대기는 isAgari가 국사를 지원하지 않아 화료 자체가 불가.
 * - 쿠이가에시(치/펑 직후 같은 패 타패 금지)는 미구현.
 * - 깡도라: 안깡은 즉시, 대명깡/가깡은 그 깡 후 첫 타패 직후(론 판정 전) 공개.
 * - 사개깡/사풍연타/사가리치는 버림패에 론이 없을 때만 그 버림패 직후 유국(부로보다 우선).
 * - 해저 버림패에는 치/펑/깡 불가 (론만 가능). 산패가 비면 깡 불가.
 * - 리치는 버림패가 론당하면 성립하지 않는다(공탁 1000점 미지불). 부로되거나 통과하면 그때 1000점 지불.
 * - 리치 조건: 멘젠(안깡 허용) + 텐파이 유지 + 점수 1000 이상 + 산패 4장 이상.
 * - 삼가화는 `options.tripleRon`(기본 abort). 더블론은 허용하며 본장/리치봉은 첫 화료자(버린 사람 기준 순서)만 수령.
 * - 렌짱: 친 화료 또는 황패 시 친 텐파이. 도중유국은 렌짱. 나가시만관은 미구현.
 * - 게임 종료: 동풍전 4국에서 친이 연장하지 못하거나, 누군가 점수가 0 미만이 되면 종료. 게임 종료 시 남은
 *   리치봉은 정산하지 않고 `riichiSticks`에 남긴다. 친이 4국에서 연장하면 계속된다(올라스 연장 규칙 없음).
 */

import type { Tile, Wind } from "./tiles.js";
import { createFullTileSet, isSameTileType, tileToString } from "./tiles.js";
import type { RandomFn } from "./wall.js";
import { dealTiles, shuffleTiles } from "./wall.js";
import { sortHand } from "./hand.js";
import { tileToIndex } from "./meld.js";
import { isAgari } from "./agari.js";
import type { CalledMeld, Seat } from "./call.js";
import {
  applyAnkan,
  applyChi,
  applyDaiminkan,
  applyPon,
  applyShouminkan,
  canAnkan,
  canChi,
  canDaiminkan,
  canPon,
  canShouminkan,
  isMenzen,
} from "./call.js";
import type { WinContext } from "./yaku.js";
import type { ScoreOutcome, ScoreResult, TsumoPayment } from "./score.js";
import { calculateScore } from "./score.js";
import { countTotalDora } from "./dora.js";
import type { AbortiveDrawReason } from "./ryuukyoku.js";
import {
  abortiveDraw,
  canDeclareKyuushuKyuuhai,
  isSanchaHou,
  isSuuchaRiichi,
  isSuufonRenda,
  isSuukaikan,
  isTenpaiWithMelds,
  resolveExhaustiveDraw,
} from "./ryuukyoku.js";
import { calculateShanten, calculateStandardShanten } from "./shanten.js";

// ---------------------------------------------------------------------------
// 타입
// ---------------------------------------------------------------------------

export interface GameOptions {
  /** 삼가화 처리 (ryuukyoku.ts와 동일). 기본 "abort" */
  tripleRon: "abort" | "allow";
  /** 시작 점수. 기본 25000 */
  startingScore: number;
  /** 적도라 사용 여부. 기본 true */
  useRedFives: boolean;
}

export const DEFAULT_GAME_OPTIONS: GameOptions = {
  tripleRon: "abort",
  startingScore: 25000,
  useRedFives: true,
};

/** 동풍전의 마지막 국 번호 */
export const LAST_KYOKU = 4;
/** 리치 선언에 필요한 최소 점수 / 리치봉 1개의 점수 */
export const RIICHI_STICK_POINTS = 1000;

const WINDS: Wind[] = ["east", "south", "west", "north"];

export interface DiscardEntry {
  tile: Tile;
  /** 리치 선언 패인지 */
  riichi: boolean;
  /** 방금 뽑은 패를 그대로 버렸는지 */
  tsumogiri: boolean;
  /** 이 버림패를 가져간(치/펑/깡) 좌석. 가져가도 버림패 목록에는 남는다(후리텐 판정용). */
  calledBy: Seat | null;
}

export interface PlayerState {
  hand: readonly Tile[];
  melds: readonly CalledMeld[];
  discards: readonly DiscardEntry[];
  riichi: boolean;
}

/** 버림패에 대한 응답 대기 상태 */
export interface PendingDiscard {
  discarder: Seat;
  tile: Tile;
  /** 아직 응답하지 않은 좌석 */
  awaiting: readonly Seat[];
  /** 이 버림패에 론할 수 있었던 좌석 (론하지 않으면 동순 후리텐) */
  ronEligible: readonly Seat[];
  /** 지금까지 받은 응답 */
  responses: readonly Action[];
}

export type Action =
  /** 타패. riichi: true면 리치 선언 타패 */
  | { type: "discard"; seat: Seat; tile: Tile; riichi?: boolean }
  | { type: "tsumo"; seat: Seat }
  | { type: "ankan"; seat: Seat; tile: Tile }
  | { type: "shouminkan"; seat: Seat; tile: Tile }
  /** 구종구패 유국 선언 */
  | { type: "kyuushu"; seat: Seat }
  | { type: "ron"; seat: Seat }
  | { type: "chi"; seat: Seat; use: [Tile, Tile] }
  | { type: "pon"; seat: Seat; use: [Tile, Tile] }
  | { type: "daiminkan"; seat: Seat }
  | { type: "pass"; seat: Seat };

export interface WinResult {
  seat: Seat;
  /** 론이면 버린 사람 좌석, 츠모면 null */
  from: Seat | null;
  winningTile: Tile;
  score: ScoreResult;
}

export interface RoundResult {
  type: "tsumo" | "ron" | "exhaustive" | "abortive";
  /** 화료 목록 (더블론이면 2개, 유국이면 빈 배열). 순서는 버린 사람 기준 진행 순서(첫 항목이 본장/리치봉 수령자). */
  wins: WinResult[];
  /** 황패평국일 때 좌석별 텐파이 여부 */
  tenpai?: boolean[];
  /** 도중유국 사유 */
  reason?: AbortiveDrawReason;
  /** 좌석별 점수 증감 (리치봉 수령분 포함, 이번 국에서 낸 리치봉은 제외 - 리치 선언 시 이미 반영) */
  deltas: number[];
  /** 친이 연장(렌짱)하는지 */
  dealerContinues: boolean;
}

export type GamePhase = "turn" | "response" | "roundEnd" | "gameEnd";

export interface GameState {
  options: GameOptions;
  phase: GamePhase;
  players: readonly PlayerState[];
  /** 좌석별 점수 */
  scores: readonly number[];
  liveWall: readonly Tile[];
  deadWall: readonly Tile[];
  /** 공개된 도라 표시패 수 (1~5) */
  doraCount: number;
  /** 지금 행동할 좌석 (phase "turn"). 다른 phase에서는 마지막 행동자 */
  turn: Seat;
  /** 방금 뽑은 패 (뽑지 않고 치/펑 직후면 null) */
  drawnTile: Tile | null;
  pending: PendingDiscard | null;
  dealer: Seat;
  roundWind: Wind;
  /** 국 번호 1~4 */
  kyoku: number;
  honba: number;
  /** 공탁 리치봉 개수 */
  riichiSticks: number;
  /** 깡을 한 좌석 목록 (깡 발생 순서) */
  kanSeats: readonly Seat[];
  /** 이번 국에 부로/깡이 한 번이라도 있었는지 (구종구패/사풍연타 판정) */
  anyCalls: boolean;
  /** 첫 순 버림패 (최대 4장, 사풍연타 판정) */
  firstDiscards: readonly Tile[];
  /** 대명깡/가깡 후 아직 공개하지 않은 깡도라 수 */
  pendingKanDora: number;
  /** 방금 리치 선언한 좌석 (버림패가 론당하지 않으면 리치봉 지불) */
  pendingRiichi: Seat | null;
  /** 동순/리치 후 후리텐 (자기 다음 버림패까지, 리치 중이면 영구) */
  furitenTemp: readonly boolean[];
  /** 국 종료 결과 (phase가 roundEnd/gameEnd일 때) */
  result: RoundResult | null;
}

/** 불가능한 행동을 시도했을 때 던지는 에러 */
export class IllegalActionError extends Error {
  constructor(
    public readonly reason: "phase" | "notAwaiting" | "illegal" | "noYaku" | "furiten" | "notAgari",
    message: string,
  ) {
    super(message);
    this.name = "IllegalActionError";
  }
}

// ---------------------------------------------------------------------------
// 패 유틸
// ---------------------------------------------------------------------------

/** 종류 + 적5 여부까지 같은 패인지 */
export function sameExactTile(a: Tile, b: Tile): boolean {
  return isSameTileType(a, b) && (a.kind !== "number" || (b.kind === "number" && a.isRedFive === b.isRedFive));
}

function removeExactTile(hand: readonly Tile[], tile: Tile): Tile[] {
  const index = hand.findIndex((t) => sameExactTile(t, tile));
  if (index === -1) throw new Error(`손패에 없는 패입니다: ${tileToString(tile)}`);
  const result = [...hand];
  result.splice(index, 1);
  return result;
}

/** 34종 패(적5 아님) 목록 */
const TILE_TYPES: readonly Tile[] = (() => {
  const seen = new Set<number>();
  return createFullTileSet(false).filter((t) => {
    const i = tileToIndex(t);
    if (seen.has(i)) return false;
    seen.add(i);
    return true;
  });
})();

/** 손패(13 - 3 x 멜드 수 장)의 대기패 종류 목록. 화료 형태만 보며 역 유무는 보지 않는다. */
export function waitingTileTypes(hand: readonly Tile[], melds: readonly CalledMeld[] = []): Tile[] {
  const counts = new Map<number, number>();
  for (const t of [...hand, ...melds.flatMap((m) => m.tiles as readonly Tile[])]) {
    counts.set(tileToIndex(t), (counts.get(tileToIndex(t)) ?? 0) + 1);
  }
  return TILE_TYPES.filter(
    (t) => (counts.get(tileToIndex(t)) ?? 0) < 4 && isAgari([...hand, t], melds),
  );
}

// ---------------------------------------------------------------------------
// 조회 헬퍼
// ---------------------------------------------------------------------------

/** 좌석의 자풍 (친 = 동) */
export function seatWindOf(state: GameState, seat: Seat): Wind {
  return WINDS[(seat - state.dealer + 4) % 4]!;
}

/** 공개된 겉도라 표시패 (깡도라 포함) */
export function doraIndicatorsOf(state: GameState): Tile[] {
  return state.deadWall.slice(4, 4 + state.doraCount);
}

/** 뒷도라 표시패 (공개된 겉도라 수만큼) */
export function uraDoraIndicatorsOf(state: GameState): Tile[] {
  return state.deadWall.slice(9, 9 + state.doraCount);
}

function player(state: GameState, seat: Seat): PlayerState {
  const p = state.players[seat];
  if (!p) throw new Error(`좌석은 0~3이어야 합니다: ${seat}`);
  return p;
}

function withPlayer(state: GameState, seat: Seat, patch: Partial<PlayerState>): GameState {
  return { ...state, players: state.players.map((p, i) => (i === seat ? { ...p, ...patch } : p)) };
}

function withScores(state: GameState, deltas: readonly number[]): GameState {
  return { ...state, scores: state.scores.map((s, i) => s + (deltas[i] ?? 0)) };
}

// ---------------------------------------------------------------------------
// 화료 / 후리텐 판정
// ---------------------------------------------------------------------------

function winContext(state: GameState, seat: Seat, winType: "tsumo" | "ron", tile: Tile): WinContext {
  const p = player(state, seat);
  const hand = winType === "ron" ? sortHand([...p.hand, tile]) : [...p.hand];
  return {
    hand,
    winningTile: tile,
    isConcealed: isMenzen(p.melds),
    winType,
    isRiichi: p.riichi,
    seatWind: seatWindOf(state, seat),
    roundWind: state.roundWind,
    melds: p.melds,
  };
}

/** 화료 점수 계산 (도라/뒷도라/적도라/본장/리치봉 반영). 역이 없으면 noYaku. */
function scoreWin(
  state: GameState,
  seat: Seat,
  winType: "tsumo" | "ron",
  tile: Tile,
  honba: number,
  riichiSticks: number,
): ScoreOutcome {
  const ctx = winContext(state, seat, winType, tile);
  const p = player(state, seat);
  const dora = countTotalDora({
    hand: ctx.hand,
    melds: p.melds,
    doraIndicators: doraIndicatorsOf(state),
    uraDoraIndicators: p.riichi ? uraDoraIndicatorsOf(state) : [],
    isRiichi: p.riichi,
    includeRedFives: true,
  });
  return calculateScore(ctx, { dora, honba, riichiSticks });
}

/**
 * 후리텐 여부: 자기 버림패(부로된 것 포함)에 대기패가 있거나, 동순/리치 후 후리텐 상태.
 * 손패는 13 - 3 x 멜드 수 장(버림 후 상태)이어야 한다.
 */
export function isFuriten(state: GameState, seat: Seat): boolean {
  if (state.furitenTemp[seat]) return true;
  const p = player(state, seat);
  const waits = new Set(waitingTileTypes(p.hand, p.melds).map(tileToIndex));
  return p.discards.some((d) => waits.has(tileToIndex(d.tile)));
}

function canRon(state: GameState, seat: Seat, tile: Tile): boolean {
  const p = player(state, seat);
  if (!isAgari([...p.hand, tile], p.melds)) return false;
  if (scoreWin(state, seat, "ron", tile, 0, 0).kind !== "scored") return false;
  return !isFuriten(state, seat);
}

function canTsumo(state: GameState, seat: Seat): boolean {
  const p = player(state, seat);
  if (state.drawnTile === null || !isAgari(p.hand, p.melds)) return false;
  return scoreWin(state, seat, "tsumo", state.drawnTile, 0, 0).kind === "scored";
}

/** 리치 선언 가능 조건 중 손패와 무관한 부분 */
function canDeclareRiichiNow(state: GameState, seat: Seat): boolean {
  const p = player(state, seat);
  return (
    !p.riichi &&
    isMenzen(p.melds) &&
    state.scores[seat]! >= RIICHI_STICK_POINTS &&
    state.liveWall.length >= 4 &&
    state.drawnTile !== null
  );
}

/** 부로 멜드 포함 손패의 샹텐 수 (멜드 패를 손패에 더해 13/14장으로 맞춰 계산) */
export function shantenWithMelds(hand: readonly Tile[], melds: readonly CalledMeld[] = []): number {
  if (melds.length === 0) return calculateShanten(hand);
  const padded = [...hand, ...melds.flatMap((m) => [m.tiles[0], m.tiles[1], m.tiles[2]])];
  return calculateStandardShanten(padded);
}

// ---------------------------------------------------------------------------
// legalActions
// ---------------------------------------------------------------------------

function uniqueTiles(hand: readonly Tile[]): Tile[] {
  const seen = new Set<string>();
  return hand.filter((t) => {
    const key = tileToString(t);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function turnActions(state: GameState, seat: Seat): Action[] {
  const p = player(state, seat);
  const actions: Action[] = [];
  if (canTsumo(state, seat)) actions.push({ type: "tsumo", seat });

  // 타패 (리치 중이면 츠모기리만)
  const candidates =
    p.riichi && state.drawnTile !== null ? [state.drawnTile] : uniqueTiles(p.hand);
  for (const tile of candidates) actions.push({ type: "discard", seat, tile });

  // 리치 선언 타패: 14장 손패가 샹텐 0(텐파이 가능)일 때만 후보별로 텐파이 유지 확인.
  // (국사무쌍 텐파이는 화료 자체가 불가능하므로 이 사전 검사에서 제외한다.)
  if (canDeclareRiichiNow(state, seat) && shantenWithMelds(p.hand, p.melds) <= 0) {
    for (const tile of uniqueTiles(p.hand)) {
      if (isTenpaiWithMelds(removeExactTile(p.hand, tile), p.melds)) {
        actions.push({ type: "discard", seat, tile, riichi: true });
      }
    }
  }

  // 깡 (리치 후 깡 금지, 산패가 없거나 이미 4깡이면 불가, 부로 직후처럼 뽑지 않은 상태에서도 불가)
  if (!p.riichi && state.drawnTile !== null && state.liveWall.length > 0 && state.kanSeats.length < 4) {
    for (const tile of canAnkan(p.hand)) actions.push({ type: "ankan", seat, tile });
    for (const option of canShouminkan(p.hand, p.melds)) {
      actions.push({ type: "shouminkan", seat, tile: option.tile });
    }
  }

  if (canDeclareKyuushuKyuuhai(p.hand, !state.anyCalls && p.discards.length === 0, p.melds)) {
    actions.push({ type: "kyuushu", seat });
  }
  return actions;
}

/** 버림패에 대해 seat가 취할 수 있는 응답 (없으면 빈 배열, 있으면 pass 포함) */
function responseActions(state: GameState, seat: Seat, discarder: Seat, tile: Tile): Action[] {
  const p = player(state, seat);
  const actions: Action[] = [];
  if (canRon(state, seat, tile)) actions.push({ type: "ron", seat });
  if (!p.riichi && state.liveWall.length > 0) {
    for (const option of canPon(p.hand, tile)) actions.push({ type: "pon", seat, use: option.use });
    if (state.kanSeats.length < 4 && canDaiminkan(p.hand, tile)) actions.push({ type: "daiminkan", seat });
    for (const option of canChi(p.hand, tile, discarder, seat)) {
      actions.push({ type: "chi", seat, use: option.use });
    }
  }
  if (actions.length > 0) actions.push({ type: "pass", seat });
  return actions;
}

/** 좌석이 지금 취할 수 있는 모든 합법 행동. 행동할 차례가 아니면 빈 배열. */
export function legalActions(state: GameState, seat: Seat): Action[] {
  if (state.phase === "turn") {
    return seat === state.turn ? turnActions(state, seat) : [];
  }
  if (state.phase === "response" && state.pending !== null) {
    if (!state.pending.awaiting.includes(seat)) return [];
    return responseActions(state, seat, state.pending.discarder, state.pending.tile);
  }
  return [];
}

/** 지금 행동해야 하는(합법 행동이 있는) 좌석 목록 */
export function awaitingSeats(state: GameState): Seat[] {
  if (state.phase === "turn") return [state.turn];
  if (state.phase === "response" && state.pending !== null) return [...state.pending.awaiting];
  return [];
}

// ---------------------------------------------------------------------------
// 게임 / 국 시작
// ---------------------------------------------------------------------------

interface RoundSetup {
  options: GameOptions;
  scores: readonly number[];
  dealer: Seat;
  roundWind: Wind;
  kyoku: number;
  honba: number;
  riichiSticks: number;
}

function drawTile(state: GameState, seat: Seat): GameState {
  const tile = state.liveWall[0];
  if (tile === undefined) throw new Error("산패가 비어 있어 패를 뽑을 수 없습니다.");
  const p = player(state, seat);
  return {
    ...withPlayer(state, seat, { hand: [...p.hand, tile] }),
    liveWall: state.liveWall.slice(1),
    phase: "turn",
    turn: seat,
    drawnTile: tile,
    pending: null,
  };
}

/** 깡 후 영상패 뽑기. kanSeats에 이번 깡이 이미 추가된 상태여야 한다. 뽑힌 슬롯을 산패 마지막 1장으로 제자리 교체. */
function drawRinshan(state: GameState, seat: Seat): GameState {
  const tile = state.deadWall[state.kanSeats.length - 1];
  const last = state.liveWall[state.liveWall.length - 1];
  if (tile === undefined || last === undefined) throw new Error("영상패를 뽑을 수 없습니다.");
  const p = player(state, seat);
  // 뽑힌 영상패 슬롯을 산패 마지막 장으로 제자리 교체 (길이 14 유지, 도라/뒷도라 인덱스 불변)
  const slot = state.kanSeats.length - 1;
  return {
    ...withPlayer(state, seat, { hand: [...p.hand, tile] }),
    liveWall: state.liveWall.slice(0, -1),
    deadWall: state.deadWall.map((t, i) => (i === slot ? last : t)),
    phase: "turn",
    turn: seat,
    drawnTile: tile,
    pending: null,
  };
}

function dealRound(setup: RoundSetup, rng: RandomFn): GameState {
  const deal = dealTiles(shuffleTiles(createFullTileSet(setup.options.useRedFives), rng));
  const state: GameState = {
    options: setup.options,
    phase: "turn",
    players: deal.hands.map((hand) => ({ hand: sortHand(hand), melds: [], discards: [], riichi: false })),
    scores: setup.scores,
    liveWall: deal.liveWall,
    deadWall: deal.deadWall,
    doraCount: 1,
    turn: setup.dealer,
    drawnTile: null,
    pending: null,
    dealer: setup.dealer,
    roundWind: setup.roundWind,
    kyoku: setup.kyoku,
    honba: setup.honba,
    riichiSticks: setup.riichiSticks,
    kanSeats: [],
    anyCalls: false,
    firstDiscards: [],
    pendingKanDora: 0,
    pendingRiichi: null,
    furitenTemp: [false, false, false, false],
    result: null,
  };
  return drawTile(state, setup.dealer);
}

/** 새 게임(동풍전 1국 0본장, 친 = 좌석 0)을 시작한다. 친은 첫 패를 뽑은 상태로 시작한다. */
export function createGame(rng: RandomFn = Math.random, options: Partial<GameOptions> = {}): GameState {
  const merged: GameOptions = { ...DEFAULT_GAME_OPTIONS, ...options };
  return dealRound(
    {
      options: merged,
      scores: [0, 1, 2, 3].map(() => merged.startingScore),
      dealer: 0,
      roundWind: "east",
      kyoku: 1,
      honba: 0,
      riichiSticks: 0,
    },
    rng,
  );
}

/** 국이 끝난(roundEnd) 상태에서 다음 국을 시작한다. 친 연장이면 본장 +1, 아니면 친 교대. */
export function startNextRound(state: GameState, rng: RandomFn = Math.random): GameState {
  if (state.phase !== "roundEnd" || state.result === null) {
    throw new IllegalActionError("phase", `다음 국은 국 종료 상태에서만 시작할 수 있습니다: ${state.phase}`);
  }
  const { result } = state;
  const continues = result.dealerContinues;
  const honba = result.wins.length > 0 && !continues ? 0 : state.honba + 1;
  return dealRound(
    {
      options: state.options,
      scores: state.scores,
      dealer: continues ? state.dealer : (state.dealer + 1) % 4,
      roundWind: state.roundWind,
      kyoku: continues ? state.kyoku : state.kyoku + 1,
      honba,
      riichiSticks: state.riichiSticks,
    },
    rng,
  );
}

// ---------------------------------------------------------------------------
// 국 종료
// ---------------------------------------------------------------------------

function finishRound(state: GameState, result: RoundResult, riichiSticks: number): GameState {
  const scored = withScores(state, result.deltas);
  const gameOver =
    scored.scores.some((s) => s < 0) || (!result.dealerContinues && state.kyoku >= LAST_KYOKU);
  return {
    ...scored,
    phase: gameOver ? "gameEnd" : "roundEnd",
    riichiSticks,
    pending: null,
    drawnTile: null,
    result,
  };
}

/** 리치 선언 타패가 론당하지 않았을 때 리치봉을 지불한다. */
function settleRiichi(state: GameState): GameState {
  if (state.pendingRiichi === null) return state;
  const seat = state.pendingRiichi;
  const deltas = [0, 0, 0, 0];
  deltas[seat] = -RIICHI_STICK_POINTS;
  return { ...withScores(state, deltas), riichiSticks: state.riichiSticks + 1, pendingRiichi: null };
}

function finishAbortive(state: GameState, reason: AbortiveDrawReason): GameState {
  const draw = abortiveDraw(reason);
  return finishRound(
    state,
    { type: "abortive", wins: [], reason, deltas: [0, 0, 0, 0], dealerContinues: draw.renchan },
    state.riichiSticks,
  );
}

function finishExhaustive(state: GameState): GameState {
  const draw = resolveExhaustiveDraw(
    state.players.map((p) => p.hand),
    state.dealer,
    state.players.map((p) => p.melds),
  );
  return finishRound(
    state,
    {
      type: "exhaustive",
      wins: [],
      tenpai: draw.tenpai,
      deltas: draw.scoreDeltas,
      dealerContinues: draw.renchan,
    },
    state.riichiSticks,
  );
}

function finishTsumo(state: GameState, seat: Seat): GameState {
  const tile = state.drawnTile!;
  const outcome = scoreWin(state, seat, "tsumo", tile, state.honba, state.riichiSticks);
  if (outcome.kind !== "scored") throw new IllegalActionError("noYaku", "역이 없어 츠모 화료할 수 없습니다.");
  const pay = outcome.payment as TsumoPayment;
  const deltas = [0, 0, 0, 0];
  for (let s = 0; s < 4; s++) {
    if (s === seat) continue;
    const amount = s === state.dealer ? pay.fromDealer! : pay.fromEachNonDealer;
    deltas[s]! -= amount;
    deltas[seat]! += amount;
  }
  deltas[seat]! += RIICHI_STICK_POINTS * state.riichiSticks;
  return finishRound(
    state,
    {
      type: "tsumo",
      wins: [{ seat, from: null, winningTile: tile, score: outcome }],
      deltas,
      dealerContinues: seat === state.dealer,
    },
    0,
  );
}

function finishRon(state: GameState, discarder: Seat, tile: Tile, winners: readonly Seat[]): GameState {
  // 버린 사람 기준 진행 순서. 첫 화료자만 본장/리치봉을 가져간다(더블론 허용).
  const ordered = [...winners].sort((a, b) => ((a - discarder + 4) % 4) - ((b - discarder + 4) % 4));
  const deltas = [0, 0, 0, 0];
  const wins: WinResult[] = [];
  ordered.forEach((seat, index) => {
    const head = index === 0;
    const outcome = scoreWin(state, seat, "ron", tile, head ? state.honba : 0, head ? state.riichiSticks : 0);
    if (outcome.kind !== "scored" || outcome.payment.type !== "ron") {
      throw new IllegalActionError("noYaku", "역이 없어 론 화료할 수 없습니다.");
    }
    const paid = outcome.payment.fromDiscarder;
    deltas[seat]! += paid;
    deltas[discarder]! -= paid;
    if (head) deltas[seat]! += RIICHI_STICK_POINTS * state.riichiSticks;
    wins.push({ seat, from: discarder, winningTile: tile, score: outcome });
  });
  return finishRound(
    state,
    { type: "ron", wins, deltas, dealerContinues: ordered.includes(state.dealer) },
    0,
  );
}

// ---------------------------------------------------------------------------
// 행동 처리
// ---------------------------------------------------------------------------

function beginResponse(state: GameState, discarder: Seat, tile: Tile): GameState {
  const awaiting: Seat[] = [];
  const ronEligible: Seat[] = [];
  for (let offset = 1; offset < 4; offset++) {
    const seat = (discarder + offset) % 4;
    const actions = responseActions(state, seat, discarder, tile);
    if (actions.length === 0) continue;
    awaiting.push(seat);
    if (actions.some((a) => a.type === "ron")) ronEligible.push(seat);
  }
  const next: GameState = {
    ...state,
    phase: "response",
    pending: { discarder, tile, awaiting, ronEligible, responses: [] },
  };
  return awaiting.length === 0 ? resolveResponses(next) : next;
}

function applyDiscard(state: GameState, action: Extract<Action, { type: "discard" }>): GameState {
  const { seat, tile } = action;
  const p = player(state, seat);
  const entry: DiscardEntry = {
    tile,
    riichi: action.riichi === true,
    tsumogiri: state.drawnTile !== null && sameExactTile(tile, state.drawnTile),
    calledBy: null,
  };
  const recordsFirst = !state.anyCalls && p.discards.length === 0 && state.firstDiscards.length < 4;
  const moved = withPlayer(state, seat, {
    hand: sortHand(removeExactTile(p.hand, tile)),
    discards: [...p.discards, entry],
    riichi: p.riichi || entry.riichi,
  });
  const next: GameState = {
    ...moved,
    drawnTile: null,
    // 동순 후리텐은 자기 버림패로 해제된다 (리치 후에는 영구)
    furitenTemp: state.furitenTemp.map((f, i) => (i === seat && !p.riichi ? false : f)),
    firstDiscards: recordsFirst ? [...state.firstDiscards, tile] : state.firstDiscards,
    doraCount: state.doraCount + state.pendingKanDora,
    pendingKanDora: 0,
    pendingRiichi: entry.riichi ? seat : null,
  };
  return beginResponse(next, seat, tile);
}

function applyKan(
  state: GameState,
  seat: Seat,
  callState: { hand: readonly Tile[]; melds: readonly CalledMeld[] },
  revealNow: boolean,
): GameState {
  const moved = withPlayer(state, seat, { hand: sortHand(callState.hand), melds: callState.melds });
  return drawRinshan(
    {
      ...moved,
      kanSeats: [...state.kanSeats, seat],
      anyCalls: true,
      doraCount: state.doraCount + (revealNow ? 1 : 0),
      pendingKanDora: state.pendingKanDora + (revealNow ? 0 : 1),
    },
    seat,
  );
}

/** 버림패에 대한 모든 응답이 모였을 때 우선순위(론 > 펑/깡 > 치)를 해결한다. */
function resolveResponses(state: GameState): GameState {
  const pending = state.pending!;
  const { discarder, tile } = pending;
  const ronSeats = pending.responses.filter((r) => r.type === "ron").map((r) => r.seat);

  if (ronSeats.length > 0) {
    if (isSanchaHou(ronSeats.length, state.options)) return finishAbortive(settleRiichi(state), "sanchaHou");
    return finishRon(state, discarder, tile, ronSeats);
  }

  // 론할 수 있었지만 하지 않은 좌석은 동순 후리텐
  const furitenTemp = state.furitenTemp.map((f, i) => f || pending.ronEligible.includes(i));
  let next = settleRiichi({ ...state, furitenTemp });

  if (isSuuchaRiichi(next.players.map((p) => p.riichi))) return finishAbortive(next, "suuchaRiichi");
  if (isSuufonRenda(next.firstDiscards, next.anyCalls)) return finishAbortive(next, "suufonRenda");
  if (isSuukaikan(next.kanSeats)) return finishAbortive(next, "suukaikan");

  const call =
    pending.responses.find((r) => r.type === "pon" || r.type === "daiminkan") ??
    pending.responses.find((r) => r.type === "chi");
  if (call) {
    const p = player(next, call.seat);
    const callState = { hand: p.hand, melds: p.melds };
    // 버림패는 버림패 목록에 남기고 가져간 좌석만 표시한다 (후리텐 판정용)
    const dp = player(next, discarder);
    const discards = dp.discards.map((d, i) => (i === dp.discards.length - 1 ? { ...d, calledBy: call.seat } : d));
    next = withPlayer(next, discarder, { discards });
    next = { ...next, pending: null };
    if (call.type === "chi") {
      const r = applyChi(callState, tile, discarder, call.seat, call.use);
      next = withPlayer(next, call.seat, { hand: sortHand(r.hand), melds: r.melds });
    } else if (call.type === "pon") {
      const r = applyPon(callState, tile, discarder, call.seat, call.use);
      next = withPlayer(next, call.seat, { hand: sortHand(r.hand), melds: r.melds });
    } else {
      return applyKan(next, call.seat, applyDaiminkan(callState, tile, discarder, call.seat), false);
    }
    return { ...next, anyCalls: true, phase: "turn", turn: call.seat, drawnTile: null };
  }

  if (next.liveWall.length === 0) return finishExhaustive(next);
  return drawTile(next, (discarder + 1) % 4);
}

function respond(state: GameState, action: Action): GameState {
  const pending = state.pending!;
  const next: GameState = {
    ...state,
    pending: {
      ...pending,
      awaiting: pending.awaiting.filter((s) => s !== action.seat),
      responses: [...pending.responses, action],
    },
  };
  return next.pending!.awaiting.length === 0 ? resolveResponses(next) : next;
}

// ---------------------------------------------------------------------------
// dispatch
// ---------------------------------------------------------------------------

function actionKey(action: Action): string {
  switch (action.type) {
    case "discard":
      return `discard:${tileToString(action.tile)}:${action.riichi === true ? "r" : "-"}`;
    case "ankan":
      return `ankan:${tileToIndex(action.tile)}`;
    case "shouminkan":
      return `shouminkan:${tileToString(action.tile)}`;
    case "chi":
    case "pon":
      return `${action.type}:${action.use.map(tileToString).sort().join(",")}`;
    default:
      return action.type;
  }
}

/** 불가능한 화료 시도의 원인을 진단해 에러를 만든다. */
function diagnoseIllegal(state: GameState, action: Action): IllegalActionError {
  const label = `좌석 ${action.seat}의 ${action.type} 행동은 지금 할 수 없습니다.`;
  if (state.phase !== "turn" && state.phase !== "response") {
    return new IllegalActionError("phase", `${label} (진행 중인 국이 아님: ${state.phase})`);
  }
  if (action.type === "ron" && state.pending) {
    const p = player(state, action.seat);
    if (isAgari([...p.hand, state.pending.tile], p.melds)) {
      if (scoreWin(state, action.seat, "ron", state.pending.tile, 0, 0).kind === "noYaku") {
        return new IllegalActionError("noYaku", `${label} (역 없음)`);
      }
      return new IllegalActionError("furiten", `${label} (후리텐)`);
    }
    return new IllegalActionError("notAgari", `${label} (화료 형태가 아님)`);
  }
  if (action.type === "tsumo" && state.drawnTile !== null) {
    const p = player(state, action.seat);
    if (isAgari(p.hand, p.melds)) return new IllegalActionError("noYaku", `${label} (역 없음)`);
    return new IllegalActionError("notAgari", `${label} (화료 형태가 아님)`);
  }
  const waiting =
    state.phase === "turn" ? action.seat !== state.turn : !state.pending?.awaiting.includes(action.seat);
  return new IllegalActionError(waiting ? "notAwaiting" : "illegal", label);
}

/**
 * 행동 하나를 처리해 다음 상태를 반환한다. 합법 행동(`legalActions`)이 아니면 `IllegalActionError`를 던진다.
 * 응답 단계에서는 모든 응답이 모여야 다음 상태로 진행된다 (응답이 남았으면 phase는 그대로 "response").
 */
export function dispatch(state: GameState, action: Action): GameState {
  const key = actionKey(action);
  if (!legalActions(state, action.seat).some((a) => actionKey(a) === key)) {
    throw diagnoseIllegal(state, action);
  }

  if (state.phase === "response") return respond(state, action);

  const seat = action.seat;
  const p = player(state, seat);
  switch (action.type) {
    case "discard":
      return applyDiscard(state, action);
    case "tsumo":
      return finishTsumo(state, seat);
    case "kyuushu":
      return finishAbortive(state, "kyuushuKyuuhai");
    case "ankan": {
      const callState = applyAnkan({ hand: p.hand, melds: p.melds }, action.tile);
      return applyKan(state, seat, callState, true);
    }
    case "shouminkan": {
      const callState = applyShouminkan({ hand: p.hand, melds: p.melds }, action.tile);
      return applyKan(state, seat, callState, false);
    }
    default:
      throw diagnoseIllegal(state, action);
  }
}
