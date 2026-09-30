import { doraIndicatorsOf } from "@mahjong/core";
import type { Action, GameState } from "@mahjong/core";
import { HUMAN_SEAT, SEAT_NAMES, roundLabel } from "../controller";
import { tileLabel } from "../tileText";
import { ActionBar } from "./ActionBar";
import { Hand, splitDrawn } from "./Hand";
import { MeldView, SeatPanel } from "./SeatPanel";
import { TileView } from "./TileView";

export interface BoardProps {
  state: GameState;
  /** 사람의 합법 행동 (사람 차례가 아니면 빈 배열) */
  actions: readonly Action[];
  riichiMode: boolean;
  onToggleRiichi: () => void;
  onAction: (action: Action) => void;
  log: readonly string[];
}

const MAX_DORA = 5;
const LOG_LINES = 8;

export function Board({ state, actions, riichiMode, onToggleRiichi, onAction, log }: BoardProps) {
  const me = state.players[HUMAN_SEAT]!;
  const isMyTurn = state.phase === "turn" && state.turn === HUMAN_SEAT;
  const { rest, drawn } = splitDrawn(me.hand, isMyTurn ? state.drawnTile : null);
  const indicators = doraIndicatorsOf(state);
  // 사람이 응답(론/치/펑/깡/패스)해야 하는 버림패
  const responseTarget =
    state.phase === "response" && state.pending !== null && actions.length > 0 ? state.pending : null;
  const targetSeat = responseTarget?.discarder ?? null;

  return (
    <div className="board">
      <SeatPanel state={state} seat={2} highlightLastDiscard={targetSeat === 2} />
      <div className="board-middle">
        <SeatPanel state={state} seat={3} highlightLastDiscard={targetSeat === 3} />
        <div className="center-info" aria-label="국 정보">
          <div className="round-label">{roundLabel(state)}</div>
          <div className="info-row">
            <span>리치봉 {state.riichiSticks}</span>
            <span>
              산패 <b data-testid="wall-count">{state.liveWall.length}</b>
            </span>
          </div>
          <div className="dora-indicators" aria-label="도라 표시패">
            {Array.from({ length: MAX_DORA }, (_, i) => (
              <TileView key={i} tile={indicators[i] ?? null} size="sm" />
            ))}
          </div>
          <ul className="log" aria-label="행동 로그">
            {log.slice(-LOG_LINES).map((line, i) => (
              <li key={`${log.length}-${i}`}>{line}</li>
            ))}
          </ul>
        </div>
        <SeatPanel state={state} seat={1} highlightLastDiscard={targetSeat === 1} />
      </div>
      <SeatPanel state={state} seat={HUMAN_SEAT} highlightLastDiscard={targetSeat === HUMAN_SEAT}>
        {/* 멜드가 없어도 줄 자리를 예약해 첫 멜드가 생길 때 액션바가 움직이지 않게 한다 */}
        <div className="melds melds-own" aria-label="내 멜드">
          {me.melds.map((m, i) => (
            <MeldView key={i} meld={m} size="md" />
          ))}
        </div>
        <Hand tiles={rest} drawn={drawn} actions={actions} riichiMode={riichiMode} onAction={onAction} />
        {/* 안내 영역은 항상 높이를 예약해 액션바가 움직이지 않게 한다 */}
        <div className="response-slot">
          {responseTarget && (
            <div className="response-note" role="status">
              {SEAT_NAMES[responseTarget.discarder]}의 버림패{" "}
              <b>{tileLabel(responseTarget.tile)}</b>에 대한 응답
            </div>
          )}
        </div>
        <ActionBar actions={actions} riichiMode={riichiMode} onToggleRiichi={onToggleRiichi} onAction={onAction} />
      </SeatPanel>
    </div>
  );
}
