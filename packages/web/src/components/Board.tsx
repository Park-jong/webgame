import type { Action, GameState } from "@mahjong/core";
import { HUMAN_SEAT } from "../controller";
import { viewFor } from "../model/seatView";
import { BoardView } from "./BoardView";

export interface BoardProps {
  state: GameState;
  /** 사람의 합법 행동 (사람 차례가 아니면 빈 배열) */
  actions: readonly Action[];
  riichiMode: boolean;
  onToggleRiichi: () => void;
  onAction: (action: Action) => void;
  log: readonly string[];
}

/** core GameState(사람 = 좌석 0)를 받는 얇은 래퍼. 실제 렌더는 SeatView 기반 BoardView가 한다. */
export function Board({ state, ...rest }: BoardProps) {
  return <BoardView view={viewFor(state, HUMAN_SEAT)} {...rest} />;
}
