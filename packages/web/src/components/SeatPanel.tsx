import type { ReactNode } from "react";
import { sameExactTile } from "@mahjong/core";
import type { CalledMeld, Seat } from "@mahjong/core";
import { seatName } from "../model/fromView";
import { relativeSeat } from "../model/seatView";
import type { DiscardView, SeatView } from "../model/seatView";
import { WIND_LABEL } from "../tileText";
import { TileView } from "./TileView";

const FROM_LABEL = { left: "상가", across: "대면", right: "하가" } as const;

export function MeldView({ meld, size = "md" }: { meld: CalledMeld; size?: "sm" | "md" | "lg" }) {
  const kindLabel = { chi: "치", pon: "펑", daiminkan: "대명깡", shouminkan: "가깡", ankan: "안깡" }[meld.type];
  // 안깡 외에는 가져온 패(눕힌 패)와 출처 라벨을 표시한다
  const from = meld.type === "ankan" ? null : meld.from;
  const calledIndex =
    meld.type === "ankan" ? -1 : meld.tiles.findIndex((t) => sameExactTile(t, meld.calledTile));
  return (
    <span className="meld" aria-label={kindLabel} data-meld={meld.type} data-from={from ?? undefined}>
      {meld.tiles.map((t, i) => {
        // 안깡은 양끝 뒷면
        const hidden = meld.type === "ankan" && (i === 0 || i === 3);
        return <TileView key={i} tile={hidden ? null : t} size={size} sideways={i === calledIndex} />;
      })}
      {from && <span className="meld-from">{FROM_LABEL[from]}</span>}
    </span>
  );
}

export function Pond({
  discards,
  size = "sm",
  highlightLast = false,
}: {
  discards: readonly DiscardView[];
  size?: "sm" | "md";
  /** 마지막 버림패를 응답 대상으로 강조 */
  highlightLast?: boolean;
}) {
  return (
    <div className="pond" aria-label="버림패">
      {discards.map((d, i) => {
        const target = highlightLast && i === discards.length - 1;
        return (
          <span
            key={i}
            className={["pond-entry", target ? "pond-target" : "", d.riichi ? "pond-riichi" : ""].filter(Boolean).join(" ")}
            data-response-target={target || undefined}
            data-riichi={d.riichi || undefined}
          >
            <TileView tile={d.tile} size={size} riichi={d.riichi} dimmed={d.calledBy !== null} />
            {d.riichi && <span className="riichi-mark">리치</span>}
          </span>
        );
      })}
    </div>
  );
}

export interface SeatPanelProps {
  view: SeatView;
  /** 그릴 실제 좌석 */
  seat: Seat;
  /** 이 좌석의 마지막 버림패를 응답 대상으로 강조 */
  highlightLastDiscard?: boolean;
  children?: ReactNode;
}

/** 좌석 패널. 내 좌석(view.seat)은 손패를 숨기지 않고, 이름/위치는 내 좌석 기준 상대값이다. */
export function SeatPanel({ view, seat, highlightLastDiscard = false, children }: SeatPanelProps) {
  const p = view.players[seat]!;
  const mySeat = view.seat;
  const name = seatName(seat, mySeat);
  const isDealer = view.dealer === seat;
  const isTurn = (view.phase === "turn" || view.phase === "response") && view.turn === seat;
  const isHuman = seat === mySeat;
  // 클래스의 번호는 화면 위치(내 기준 상대 좌석): 0=아래, 1=오른쪽, 2=위, 3=왼쪽
  const classes = ["seat-panel", `seat-${relativeSeat(seat, mySeat)}`];
  if (isTurn) classes.push("seat-turn");
  return (
    <section className={classes.join(" ")} aria-label={`${name} 영역`} data-turn={isTurn} data-seat={seat}>
      <header className="seat-header">
        <strong>{name}</strong>
        <span className="badge">{WIND_LABEL[p.seatWind]}</span>
        {isDealer && <span className="badge badge-dealer">친</span>}
        {p.riichi && <span className="badge badge-riichi">리치</span>}
        {!isHuman && (
          <span className="hand-count" aria-hidden="true">
            손패 {p.handCount}
          </span>
        )}
        <span className="seat-score" aria-label={`${name} 점수`}>
          {p.score}
        </span>
      </header>
      {!isHuman && (
        <div className="opponent-hand" aria-label={`${name} 손패 ${p.handCount}장`}>
          {Array.from({ length: p.handCount }, (_, i) => (
            <TileView key={i} tile={null} size="sm" />
          ))}
        </div>
      )}
      {/* 내 멜드는 Board의 손패 위 큰 줄에서만 보여준다 (중복 표시 방지) */}
      {!isHuman && p.melds.length > 0 && (
        <div className="melds">
          {p.melds.map((m, i) => (
            <MeldView key={i} meld={m} size="sm" />
          ))}
        </div>
      )}
      <Pond discards={p.discards} highlightLast={highlightLastDiscard} />
      {children}
    </section>
  );
}
