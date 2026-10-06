import type { Seat, Tile } from "@mahjong/core";
import { finalRanking, yakumanLabel } from "../controller";
import type { RoundSummary } from "../controller";
import { seatName } from "../model/fromView";
import { NEXT_ROUND_TEXT } from "../game/messages";
import { useSecondsLeft } from "../game/useCountdown";
import type { Clock } from "../game/useCountdown";
import { TileView } from "./TileView";
import { MeldView } from "./SeatPanel";

function Tiles({ tiles, label }: { tiles: readonly Tile[]; label: string }) {
  return (
    <div className="result-tiles" aria-label={label}>
      {tiles.map((t, i) => (
        <TileView key={i} tile={t} size="sm" />
      ))}
    </div>
  );
}

function ScoreTable({ summary, mySeat }: { summary: RoundSummary; mySeat: Seat }) {
  return (
    <table className="score-table">
      <thead>
        <tr>
          <th>좌석</th>
          <th>변동</th>
          <th>점수</th>
        </tr>
      </thead>
      <tbody>
        {summary.scores.map((score, seat) => {
          const delta = summary.deltas[seat] ?? 0;
          return (
            <tr key={seat}>
              <td>{seatName(seat, mySeat)}</td>
              <td className={delta > 0 ? "plus" : delta < 0 ? "minus" : ""}>
                {delta > 0 ? `+${delta}` : delta}
              </td>
              <td>{score}</td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}

/** 서버 모드: 서버가 다음 국을 자동 시작하므로 다음 국 버튼 대신 카운트다운을 보여 준다 */
export interface AutoNext {
  /** 추정 자동 시작 시각. null이면 연결이 끊겨 카운트다운을 멈춘 상태 */
  at: number | null;
  clock: Clock;
}

function AutoNextNote({ autoNext }: { autoNext: AutoNext }) {
  const left = useSecondsLeft(autoNext.at, autoNext.clock);
  const text =
    left === null ? NEXT_ROUND_TEXT.offline : left > 0 ? NEXT_ROUND_TEXT.countdown(left) : NEXT_ROUND_TEXT.waiting;
  return (
    <p className="auto-next" role="status" data-testid="auto-next">
      {text}
    </p>
  );
}

export interface ResultModalProps {
  summary: RoundSummary;
  onNext: () => void;
  /** 주면(서버 모드, 게임 종료 전) 카운트다운 + 결과 닫기로 푸터를 바꾼다 */
  autoNext?: AutoNext;
  /** 내 좌석 (표시 이름 기준). 기본 0 */
  mySeat?: Seat;
}

export function ResultModal({ summary, onNext, autoNext, mySeat = 0 }: ResultModalProps) {
  const auto = autoNext !== undefined && !summary.gameOver ? autoNext : null;
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="국 결과">
        <header className="modal-header">
          <h2>{summary.title}</h2>
        </header>

        <div className="modal-body">
        {summary.wins.map((w, i) => (
          <div className="win-block" key={i} aria-label={`${seatName(w.seat, mySeat)} 화료`}>
            <h3>
              {seatName(w.seat, mySeat)} {w.from === null ? "츠모" : `론 (${seatName(w.from, mySeat)}이 방총)`}
              {w.limit ? ` - ${w.limit}` : ""}
            </h3>
            <div className="result-hand">
              <Tiles tiles={w.hand} label="화료 손패" />
              {w.melds.map((m, j) => (
                <MeldView key={j} meld={m} size="sm" />
              ))}
              <span className="winning-tile">
                <TileView tile={w.winningTile} size="sm" highlight />
              </span>
            </div>
            <ul className="yaku-list">
              {w.yaku.map((y, j) => (
                <li key={j}>
                  <span>{y.name}</span>
                  <span>{y.yakuman > 0 ? yakumanLabel(y.yakuman) : `${y.han}판`}</span>
                </li>
              ))}
              {(
                [
                  ["도라", w.doraCount],
                  ["적도라", w.redDora],
                  ["뒷도라", w.uraDora],
                ] as const
              ).map(
                ([name, n]) =>
                  n > 0 && (
                    <li key={name}>
                      <span>{name}</span>
                      <span>{n}판</span>
                    </li>
                  ),
              )}
            </ul>
            <p className="win-total">
              {w.yakumanMultiple > 0
                ? `${w.limit} (기본점 ${w.basePoints})`
                : `${w.han}판 ${w.fu}부${w.limit ? ` ${w.limit}` : ""} (기본점 ${w.basePoints})`}
            </p>
            <p className="win-points" aria-label="점수 내역">
              화료 점수 {w.handPoints}
              {w.honbaPoints > 0 && ` + 본장 ${w.honbaPoints}`}
              {w.riichiPoints > 0 && ` + 리치봉 ${w.riichiPoints}`}
              {" = "}수령 합계 {w.total}점
            </p>
          </div>
        ))}

        {summary.kind === "draw" && (summary.nagashiMangan?.length ?? 0) > 0 && (
          <p className="draw-info" aria-label="유국만관">
            유국만관: {summary.nagashiMangan!.map((seat) => `${seatName(seat, mySeat)} (${summary.deltas[seat]! > 0 ? "+" : ""}${summary.deltas[seat]}점)`).join(", ")}
          </p>
        )}

        {summary.kind === "draw" && summary.tenpai && (
          <p className="draw-info">
            텐파이:{" "}
            {summary.tenpai
              .map((t, seat) => (t ? seatName(seat, mySeat) : null))
              .filter(Boolean)
              .join(", ") || "없음"}
            {(summary.nagashiMangan?.length ?? 0) > 0 ? " (유국만관이 있어 노텐 벌부 없음)" : " (노텐 벌부 총 3000점)"}
          </p>
        )}

        <div className="dora-row">
          <span>도라 표시패</span>
          <Tiles tiles={summary.doraIndicators} label="도라 표시패" />
          {summary.uraDoraIndicators.length > 0 && (
            <>
              <span>뒷도라</span>
              <Tiles tiles={summary.uraDoraIndicators} label="뒷도라 표시패" />
            </>
          )}
        </div>

        <ScoreTable summary={summary} mySeat={mySeat} />
        </div>

        <footer className="modal-footer">
          {auto ? (
            <div className="auto-next-row">
              <AutoNextNote autoNext={auto} />
              {/* 다음 국 view가 오지 않아도 헤더의 나가기에 닿을 수 있게 모달을 닫을 수 있다 */}
              <button type="button" onClick={onNext}>
                {NEXT_ROUND_TEXT.close}
              </button>
            </div>
          ) : (
            <button type="button" className="primary" onClick={onNext}>
              {summary.gameOver ? "최종 결과" : "다음 국"}
            </button>
          )}
        </footer>
      </div>
    </div>
  );
}

export interface GameEndProps {
  scores: readonly number[];
  onNewGame: () => void;
  mySeat?: Seat;
  /** 버튼 문구 (기본 '새 게임'). 서버 모드는 나가기로 대체한다 */
  actionLabel?: string;
  /** 순위 아래 안내 문구 */
  note?: string;
}

export function GameEndScreen({ scores, onNewGame, mySeat = 0, actionLabel = "새 게임", note }: GameEndProps) {
  const ranking = finalRanking(scores);
  return (
    <div className="modal-backdrop">
      <div className="modal" role="dialog" aria-modal="true" aria-label="게임 종료">
        <header className="modal-header">
          <h2>게임 종료</h2>
        </header>
        <div className="modal-body">
        <ol className="ranking">
          {ranking.map((r) => (
            <li key={r.seat} className={r.seat === mySeat ? "ranking-me" : undefined}>
              <span>
                {r.rank}위 {seatName(r.seat, mySeat)}
              </span>
              <span>{r.score}</span>
            </li>
          ))}
        </ol>
        {note && <p className="modal-note">{note}</p>}
        </div>
        <footer className="modal-footer">
          <button type="button" className="primary" onClick={onNewGame}>
            {actionLabel}
          </button>
        </footer>
      </div>
    </div>
  );
}
