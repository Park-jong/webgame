// SeatView 입력 어댑터 (순수 함수). UI가 core GameState 대신 SeatView만으로 그릴 수 있게 한다.
// 계산 본체는 controller.ts의 공통 함수(computeTenpaiView / buildRoundSummary)를 그대로 쓴다.
import type { Action, Seat, Tile } from "@mahjong/core";
import { SEAT_NAMES, buildRoundSummary, computeTenpaiView } from "../controller";
import type { RoundSummary, TenpaiView } from "../controller";
import { relativeSeat } from "./seatView";
import type { ClientAction, SeatView } from "./seatView";

// ---------------------------------------------------------------------------
// 텐파이 표시
// ---------------------------------------------------------------------------

/** 대기패 잔여 장수 계산용 공개 패: 도라 표시패 + 부로되지 않은 모든 버림패 + 타인 멜드 */
function visibleTilesFromView(view: SeatView): Tile[] {
  const tiles: Tile[] = [...view.doraIndicators];
  for (const p of view.players) {
    for (const d of p.discards) if (d.calledBy === null) tiles.push(d.tile);
    if (p.seat !== view.seat) for (const m of p.melds) tiles.push(...(m.tiles as readonly Tile[]));
  }
  return tiles;
}

/**
 * humanTenpaiView(state)와 같은 결과를 SeatView만으로 계산한다. 국이 끝났으면 null.
 * - 후리텐: view.furiten(임시 후리텐 포함)을 furitenTemp 대신 쓴다. 버림패 기반 후리텐은 공개 정보로 직접 계산된다.
 * - 쿠이가에시 금지패: view.kuikae (본인 차례에만 값이 있음).
 */
export function tenpaiViewFromSeatView(view: SeatView): TenpaiView | null {
  if (view.phase === "roundEnd" || view.phase === "gameEnd") return null;
  const me = view.players[view.seat]!;
  return computeTenpaiView({
    phase: view.phase,
    turn: view.turn,
    seat: view.seat,
    hand: view.hand,
    melds: me.melds,
    riichi: me.riichi,
    discards: me.discards.map((d) => d.tile),
    seatWind: me.seatWind,
    roundWind: view.roundWind,
    drawnTile: view.drawnTile,
    furitenTemp: view.furiten,
    kuikae: view.kuikae,
    visibleTiles: visibleTilesFromView(view),
  });
}

// ---------------------------------------------------------------------------
// 결과 요약
// ---------------------------------------------------------------------------

/** summarizeRound(state)와 같은 구조의 결과 요약. 국이 끝난 뷰(result 존재)만 허용한다. */
export function summarizeFromView(view: SeatView): RoundSummary {
  const result = view.result;
  if ((view.phase !== "roundEnd" && view.phase !== "gameEnd") || result === null) {
    throw new Error("국이 끝난 상태가 아닙니다.");
  }
  return buildRoundSummary({
    result,
    riichiOf: (seat) => view.players[seat]!.riichi,
    gameOver: view.phase === "gameEnd",
    scores: view.players.map((p) => p.score),
    doraIndicators: view.doraIndicators,
    uraDoraIndicators: result.uraDoraIndicators,
  });
}

// ---------------------------------------------------------------------------
// 행동 전송
// ---------------------------------------------------------------------------

/** core Action에서 seat를 제거해 서버 메시지의 action으로 만든다. */
export function toClientAction(action: Action): ClientAction {
  const { seat: _seat, ...rest } = action;
  return rest as ClientAction;
}

function canonical(v: unknown): string {
  return JSON.stringify(v, (_k, val: unknown) =>
    val && typeof val === "object" && !Array.isArray(val)
      ? Object.fromEntries(Object.entries(val as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)))
      : val,
  );
}

/**
 * UI가 고른 행동을 view.legalActions에서 찾아 서버 전송용 action으로 돌려준다.
 * 합법 행동에 없으면 null (보내지 않는다).
 */
export function clientActionFromView(view: SeatView, chosen: Action): ClientAction | null {
  const target = canonical(toClientAction(chosen));
  const found = view.legalActions.find((a) => canonical(toClientAction(a)) === target);
  return found ? toClientAction(found) : null;
}

// ---------------------------------------------------------------------------
// 좌석 회전
// ---------------------------------------------------------------------------

export type SeatPosition = "self" | "right" | "across" | "left";

const POSITIONS: readonly SeatPosition[] = ["self", "right", "across", "left"];

/** 화면 위치: 내 좌석 기준 0=아래(self), 1=오른쪽(하가), 2=위(대면), 3=왼쪽(상가). Board 고정 배치와 같다. */
export function seatPosition(seat: Seat, mySeat: Seat): SeatPosition {
  return POSITIONS[relativeSeat(seat, mySeat)]!;
}

/** 표시 이름 (SEAT_NAMES를 내 좌석 기준 상대 위치로 대응: 나/하가/대면/상가) */
export function seatName(seat: Seat, mySeat: Seat): string {
  return SEAT_NAMES[relativeSeat(seat, mySeat)]!;
}

/** 화면 배치 순서: 위/왼쪽/오른쪽/아래에 놓을 실제 좌석 */
export function seatLayout(mySeat: Seat): { top: Seat; left: Seat; right: Seat; bottom: Seat } {
  const at = (rel: number) => (((mySeat + rel) % 4) as Seat);
  return { top: at(2), left: at(3), right: at(1), bottom: mySeat };
}
