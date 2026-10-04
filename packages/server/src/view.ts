/**
 * 좌석별 뷰 변환: 서버의 전체 GameState에서 특정 좌석이 봐도 되는 정보만 뽑는다.
 *
 * [원칙] 허용 목록(allowlist) 방식. 모든 필드를 하나씩 명시해 새 객체를 만들고,
 * 스프레드/전체 복사는 쓰지 않는다. GameState에 새 필드가 생겨도 여기에 추가하지 않으면 뷰에 나가지 않는다.
 * 반환값은 원본 state와 참조를 공유하지 않는다(패/멜드/점수 결과를 모두 새로 만든다).
 *
 * [노출 정책]
 * - 본인: 손패 전체, 뽑은 패(본인 차례일 때만), 후리텐 여부, 합법 행동.
 * - 상대: 손패는 장수(handCount)만. 뽑은 패, 후리텐/텐파이 판정, 합법 행동은 없다.
 * - 산패/왕패/뒷도라 표시패: 산패는 남은 장수만. 왕패와 뒷도라 표시패는 국 종료 결과에서만(아래).
 * - 버림패, 멜드, 점수, 리치 여부, 도라 표시패(공개분), 차례/phase, 응답 대기 중인 버림패는 공개 정보.
 * - 안깡: 실제 마작에서도 선언 시 4장을 보여 주므로(종류 공개, 양끝만 뒤집어 놓음) 패 종류와 적5 여부까지
 *   상대에게 공개한다. 도라 계산과 UI 표시에 필요하고 core 표현(AnkanMeld.tiles)과도 같다.
 *   멘젠 여부는 멜드 종류로 누구나 알 수 있다.
 * - 쿠이가에시 금지패(kuikae): 본인 차례(phase turn이고 turn === 본인)일 때만 본인에게 준다. 다른 좌석에게는 항상 빈 배열.
 *   이미 legalActions의 discard에서 제외돼 있으나, UI 안내문/텐파이 힌트 필터용으로 값을 따로 준다.
 * - 응답 대기(pending): discarder/tile과 chankan(창깡 대기일 때만 깡 종류, 깡 선언은 공개 정보)을 공개. ronEligible(론 가능했던 좌석 = 텐파이 파생 정보), responses(다른 좌석이
 *   이미 낸 응답), awaiting(합법 행동이 있는 좌석 = 상대의 부로/론 가능 여부)은 제외한다.
 *   대신 본인에게만 awaitingYou(본인이 지금 행동/응답해야 하는지)를 준다. 상대가 응답해야 하는지/했는지는
 *   어떤 필드로도 알 수 없다.
 *   남은 위험(S-5 메모): 응답 대기가 끝나는 타이밍(상대가 응답할 때까지 걸리는 시간, 자동 패스 즉시 진행 여부)으로
 *   상대의 부로/론 가능 여부가 추측될 수 있다. 서버 루프는 응답 가능 여부와 무관하게 동일한 지연으로 진행해야 한다.
 * - 알려진 낮은 심각도 한계: 안깡의 적5 여부가 공개되고, 뽑은 직후 14장 상태의 후리텐 표시는 임시 플래그만 반영한다.
 *
 * [국 종료(roundEnd/gameEnd) 공개 범위]
 * - 결과(type, deltas, dealerContinues, reason)는 전원에게 공개.
 * - 화료자(wins)의 손패/멜드/화료패/점수 내역(역, 판수, 부수, 지불)은 공개 (화료 시 패를 오픈하는 규칙).
 * - 뒷도라 표시패: 리치한 화료자가 있을 때만 공개 (core 점수 계산이 뒷도라를 반영하는 조건과 동일).
 * - 황패평국의 tenpai 배열(좌석별 텐파이 여부)은 core 결과에 있으므로 공개하지만, 텐파이자의 손패는
 *   core 결과에 담기지 않으므로 공개하지 않는다.
 * - 그 외(패산, 왕패, 비화료자 손패, 구종구패 선언자 손패)는 국 종료 후에도 비공개.
 * - 국 종료 중이 아니면 result는 null.
 */

import { awaitingSeats, doraIndicatorsOf, isFuriten, legalActions, seatWindOf, uraDoraIndicatorsOf } from "@mahjong/core";
import type {
  AbortiveDrawReason,
  Action,
  CalledMeld,
  GamePhase,
  GameState,
  ScoreResult,
  Seat,
  Tile,
  Wind,
} from "@mahjong/core";

// ---------------------------------------------------------------------------
// 뷰 타입
// ---------------------------------------------------------------------------

export interface DiscardView {
  tile: Tile;
  riichi: boolean;
  tsumogiri: boolean;
  calledBy: Seat | null;
}

/** 좌석 하나의 공개 정보 (본인/상대 공통) */
export interface PlayerView {
  seat: Seat;
  seatWind: Wind;
  score: number;
  riichi: boolean;
  /** 손패 장수 (뽑은 패 포함) */
  handCount: number;
  melds: CalledMeld[];
  discards: DiscardView[];
}

export interface PendingView {
  discarder: Seat;
  tile: Tile;
  /** 깡 선언에 대한 창깡 대기일 때만 존재 (깡 종류). 일반 버림패 응답이면 키 자체가 없다. */
  chankan?: "shouminkan" | "ankan";
}

export interface WinView {
  seat: Seat;
  from: Seat | null;
  winningTile: Tile;
  /** 화료자 손패 (론이면 화료패 제외 13장 기준, core 보관 그대로) */
  hand: Tile[];
  melds: CalledMeld[];
  score: ScoreResult;
}

export interface RoundResultView {
  type: "tsumo" | "ron" | "exhaustive" | "abortive";
  wins: WinView[];
  tenpai?: boolean[];
  reason?: AbortiveDrawReason;
  deltas: number[];
  dealerContinues: boolean;
  /** 유국만관 달성 좌석 (달성자가 있을 때만 존재, core RoundResult와 동일) */
  nagashiMangan?: Seat[];
  /** 리치한 화료자가 있을 때만 공개되는 뒷도라 표시패 */
  uraDoraIndicators: Tile[];
}

export interface SeatView {
  /** 이 뷰의 주인 좌석 */
  seat: Seat;
  phase: GamePhase;
  turn: Seat;
  dealer: Seat;
  roundWind: Wind;
  kyoku: number;
  honba: number;
  riichiSticks: number;
  /** 공개된 도라 표시패 */
  doraIndicators: Tile[];
  /** 남은 산패 장수 (내용은 비공개) */
  liveWallCount: number;
  /** 좌석 번호 순서 */
  players: PlayerView[];
  /** 본인 손패 전체 */
  hand: Tile[];
  /** 본인이 방금 뽑은 패 (본인 차례일 때만, 아니면 null) */
  drawnTile: Tile | null;
  /** 본인 후리텐 여부 */
  furiten: boolean;
  /** 쿠이가에시로 버릴 수 없는 패 종류 (본인 차례일 때만, 아니면 빈 배열) */
  kuikae: Tile[];
  /** 본인의 합법 행동 */
  legalActions: Action[];
  /** 본인이 지금 행동/응답해야 하는지 (상대의 대기 여부는 노출하지 않는다) */
  awaitingYou: boolean;
  pending: PendingView | null;
  result: RoundResultView | null;
}

// ---------------------------------------------------------------------------
// 복사 헬퍼 (허용 목록 방식으로 새 객체 생성)
// ---------------------------------------------------------------------------

function tileView(t: Tile): Tile {
  switch (t.kind) {
    case "number":
      return { kind: "number", suit: t.suit, rank: t.rank, isRedFive: t.isRedFive };
    case "wind":
      return { kind: "wind", wind: t.wind };
    case "dragon":
      return { kind: "dragon", dragon: t.dragon };
  }
}

function tilesView(ts: readonly Tile[]): Tile[] {
  return ts.map(tileView);
}

function meldView(m: CalledMeld): CalledMeld {
  switch (m.type) {
    case "chi":
      return {
        type: "chi",
        tiles: [tileView(m.tiles[0]), tileView(m.tiles[1]), tileView(m.tiles[2])],
        calledTile: tileView(m.calledTile),
        fromSeat: m.fromSeat,
        from: m.from,
      };
    case "pon":
      return {
        type: "pon",
        tiles: [tileView(m.tiles[0]), tileView(m.tiles[1]), tileView(m.tiles[2])],
        calledTile: tileView(m.calledTile),
        fromSeat: m.fromSeat,
        from: m.from,
      };
    case "daiminkan":
      return {
        type: "daiminkan",
        tiles: [tileView(m.tiles[0]), tileView(m.tiles[1]), tileView(m.tiles[2]), tileView(m.tiles[3])],
        calledTile: tileView(m.calledTile),
        fromSeat: m.fromSeat,
        from: m.from,
      };
    case "shouminkan":
      return {
        type: "shouminkan",
        tiles: [tileView(m.tiles[0]), tileView(m.tiles[1]), tileView(m.tiles[2]), tileView(m.tiles[3])],
        calledTile: tileView(m.calledTile),
        fromSeat: m.fromSeat,
        from: m.from,
        addedTile: tileView(m.addedTile),
      };
    case "ankan":
      return {
        type: "ankan",
        tiles: [tileView(m.tiles[0]), tileView(m.tiles[1]), tileView(m.tiles[2]), tileView(m.tiles[3])],
      };
  }
}

function meldsView(ms: readonly CalledMeld[]): CalledMeld[] {
  return ms.map(meldView);
}

function scoreView(s: ScoreResult): ScoreResult {
  return {
    kind: "scored",
    yaku: s.yaku.map((y) => ({ id: y.id, name: y.name, han: y.han })),
    yakuHan: s.yakuHan,
    dora: s.dora,
    han: s.han,
    fu: s.fu,
    basePoints: s.basePoints,
    limit: s.limit,
    yakumanCount: s.yakumanCount,
    isDealer: s.isDealer,
    payment:
      s.payment.type === "ron"
        ? { type: "ron", fromDiscarder: s.payment.fromDiscarder }
        : {
            type: "tsumo",
            fromDealer: s.payment.fromDealer,
            fromEachNonDealer: s.payment.fromEachNonDealer,
          },
    total: s.total,
  };
}

/** 합법 행동도 허용 목록으로 새로 만든다 (seat 포함: core Action 형태 유지) */
function actionView(a: Action): Action {
  switch (a.type) {
    case "discard":
      return a.riichi === undefined
        ? { type: "discard", seat: a.seat, tile: tileView(a.tile) }
        : { type: "discard", seat: a.seat, tile: tileView(a.tile), riichi: a.riichi };
    case "ankan":
    case "shouminkan":
      return { type: a.type, seat: a.seat, tile: tileView(a.tile) };
    case "chi":
    case "pon":
      return { type: a.type, seat: a.seat, use: [tileView(a.use[0]), tileView(a.use[1])] };
    case "tsumo":
    case "kyuushu":
    case "ron":
    case "daiminkan":
    case "pass":
      return { type: a.type, seat: a.seat };
  }
}

function resultView(state: GameState): RoundResultView | null {
  if (state.phase !== "roundEnd" && state.phase !== "gameEnd") return null;
  const r = state.result;
  if (r === null) return null;
  const wins: WinView[] = r.wins.map((w) => {
    const p = state.players[w.seat]!;
    return {
      seat: w.seat,
      from: w.from,
      winningTile: tileView(w.winningTile),
      hand: tilesView(p.hand),
      melds: meldsView(p.melds),
      score: scoreView(w.score),
    };
  });
  const showUra = r.wins.some((w) => state.players[w.seat]!.riichi);
  const view: RoundResultView = {
    type: r.type,
    wins,
    deltas: [...r.deltas],
    dealerContinues: r.dealerContinues,
    uraDoraIndicators: showUra ? tilesView(uraDoraIndicatorsOf(state)) : [],
  };
  if (r.tenpai !== undefined) view.tenpai = [...r.tenpai];
  if (r.reason !== undefined) view.reason = r.reason;
  if (r.nagashiMangan !== undefined) view.nagashiMangan = [...r.nagashiMangan];
  return view;
}

// ---------------------------------------------------------------------------
// 변환
// ---------------------------------------------------------------------------

/** state를 변경하지 않는 순수 함수. seat 좌석이 봐도 되는 정보만 담은 뷰를 만든다. */
export function viewFor(state: GameState, seat: Seat): SeatView {
  const me = state.players[seat];
  if (!Number.isInteger(seat) || !me) throw new Error(`좌석은 0~3이어야 합니다: ${seat}`);

  const players: PlayerView[] = state.players.map((p, i) => ({
    seat: i,
    seatWind: seatWindOf(state, i),
    score: state.scores[i]!,
    riichi: p.riichi,
    handCount: p.hand.length,
    melds: meldsView(p.melds),
    discards: p.discards.map((d) => ({
      tile: tileView(d.tile),
      riichi: d.riichi,
      tsumogiri: d.tsumogiri,
      calledBy: d.calledBy,
    })),
  }));

  // 후리텐은 버린 뒤(13 - 3 x 멜드 수 장)에만 의미가 있다. 뽑은 직후 14장 상태에서는 core 규약상 대기를 볼 수 없으므로
  // isFuriten이 임시 후리텐 플래그만 반영한다 (core 동작 그대로).
  const furiten = isFuriten(state, seat);

  const pending = state.pending;
  const isMyTurn = state.phase === "turn" && state.turn === seat;
  let pendingView: PendingView | null = null;
  if (state.phase === "response" && pending !== null) {
    pendingView = { discarder: pending.discarder, tile: tileView(pending.tile) };
    if (pending.chankan !== undefined) pendingView.chankan = pending.chankan;
  }
  return {
    seat,
    phase: state.phase,
    turn: state.turn,
    dealer: state.dealer,
    roundWind: state.roundWind,
    kyoku: state.kyoku,
    honba: state.honba,
    riichiSticks: state.riichiSticks,
    doraIndicators: tilesView(doraIndicatorsOf(state)),
    liveWallCount: state.liveWall.length,
    players,
    hand: tilesView(me.hand),
    drawnTile: isMyTurn && state.drawnTile !== null ? tileView(state.drawnTile) : null,
    furiten,
    kuikae: isMyTurn ? tilesView(state.kuikae) : [],
    legalActions: legalActions(state, seat).map(actionView),
    awaitingYou: awaitingSeats(state).includes(seat),
    pending: pendingView,
    result: resultView(state),
  };
}
