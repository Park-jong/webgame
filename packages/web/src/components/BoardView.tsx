import type { ReactNode } from "react";
import type { Action } from "@mahjong/core";
import { ACK_TEXT } from "../game/messages";
import type { AckState } from "../game/types";
import { roundLabel } from "../controller";
import { seatLayout, seatName, tenpaiViewFromSeatView } from "../model/fromView";
import type { SeatView } from "../model/seatView";
import { tileLabel } from "../tileText";
import { ActionBar } from "./ActionBar";
import { Hand, splitDrawn } from "./Hand";
import { MeldView, SeatPanel } from "./SeatPanel";
import { TenpaiInfo } from "./TenpaiInfo";
import { TileView } from "./TileView";

export interface BoardViewProps {
  /** 내 좌석(view.seat) 기준 뷰. 화면은 내 좌석이 아래가 되도록 회전한다 */
  view: SeatView;
  /** 내 합법 행동 (내가 행동할 차례가 아니면 빈 배열) */
  actions: readonly Action[];
  riichiMode: boolean;
  onToggleRiichi: () => void;
  onAction: (action: Action) => void;
  log: readonly string[];
  /** 마감 카운트다운 자리 (서버 모드). 주면 국 정보 안에 고정 높이 영역으로 그린다 */
  clock?: ReactNode;
  /** 내 행동의 진행 표시 (기본 none) */
  ackState?: AckState;
}

const MAX_DORA = 5;
const LOG_LINES = 8;

/** SeatView만으로 그리는 대국 화면 */
export function BoardView({ view, actions, riichiMode, onToggleRiichi, onAction, log, clock, ackState = "none" }: BoardViewProps) {
  const mySeat = view.seat;
  const layout = seatLayout(mySeat);
  const me = view.players[mySeat]!;
  const isMyTurn = view.phase === "turn" && view.turn === mySeat;
  const { rest, drawn } = splitDrawn(view.hand, isMyTurn ? view.drawnTile : null);
  const indicators = view.doraIndicators;
  // 내가 응답(론/치/펑/깡/패스)해야 하는 버림패
  const responseTarget = view.phase === "response" && view.pending !== null && actions.length > 0 ? view.pending : null;
  // 창깡 응답은 버림패가 아니므로 버림패 강조를 하지 않는다
  const isChankan = responseTarget?.chankan !== undefined;
  const targetSeat = responseTarget && !isChankan ? responseTarget.discarder : null;

  return (
    <div className="board">
      <SeatPanel view={view} seat={layout.top} highlightLastDiscard={targetSeat === layout.top} />
      <div className="board-middle">
        <SeatPanel view={view} seat={layout.left} highlightLastDiscard={targetSeat === layout.left} />
        <div className="center-info" aria-label="국 정보">
          <div className="round-label">{roundLabel(view)}</div>
          {clock !== undefined && <div className="clock-slot">{clock}</div>}
          <div className="info-row">
            <span>리치봉 {view.riichiSticks}</span>
            <span>
              산패 <b data-testid="wall-count">{view.liveWallCount}</b>
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
        <SeatPanel view={view} seat={layout.right} highlightLastDiscard={targetSeat === layout.right} />
      </div>
      <SeatPanel view={view} seat={layout.bottom} highlightLastDiscard={targetSeat === layout.bottom}>
        {/* 멜드가 없어도 줄 자리를 예약해 첫 멜드가 생길 때 액션바가 움직이지 않게 한다 */}
        <div className="melds melds-own" aria-label="내 멜드">
          {me.melds.map((m, i) => (
            <MeldView key={i} meld={m} size="md" />
          ))}
        </div>
        <Hand tiles={rest} drawn={drawn} actions={actions} riichiMode={riichiMode} onAction={onAction} />
        <TenpaiInfo view={tenpaiViewFromSeatView(view)} />
        {/* 안내 영역은 항상 높이를 예약해 액션바가 움직이지 않게 한다 */}
        <div className="response-slot">
          {ackState === "none" && isMyTurn && view.kuikae.length > 0 && (
            <div className="response-note" role="status">
              쿠이가에시: <b>{view.kuikae.map(tileLabel).join(", ")}</b> 버릴 수 없음
            </div>
          )}
          {ackState !== "none" && (
            <div className="response-note" role="status" data-testid="ack-note">
              {ACK_TEXT[ackState]}
            </div>
          )}
          {responseTarget && (
            <div className="response-note" role="status">
              {isChankan ? (
                <>
                  {seatName(responseTarget.discarder, mySeat)}의 {responseTarget.chankan === "ankan" ? "안깡" : "가깡"} 패{" "}
                  <b>{tileLabel(responseTarget.tile)}</b>에 대한 응답 (창깡)
                </>
              ) : (
                <>
                  {seatName(responseTarget.discarder, mySeat)}의 버림패 <b>{tileLabel(responseTarget.tile)}</b>에 대한 응답
                </>
              )}
            </div>
          )}
        </div>
        <ActionBar actions={actions} riichiMode={riichiMode} onToggleRiichi={onToggleRiichi} onAction={onAction} />
      </SeatPanel>
    </div>
  );
}
