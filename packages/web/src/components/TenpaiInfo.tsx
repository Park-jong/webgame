import type { TenpaiView } from "../controller";
import { tileLabel } from "../tileText";
import { TileView } from "./TileView";

export interface TenpaiInfoProps {
  view: TenpaiView | null;
}

/**
 * 텐파이 배지 + 대기패 (텐파이일 때), 또는 버리면 텐파이가 되는 패 목록 (내 차례 14장).
 * 높이는 항상 예약해 액션바가 움직이지 않게 한다. 역 없는 대기패는 흐리게 표시한다.
 */
export function TenpaiInfo({ view }: TenpaiInfoProps) {
  const waits = view?.waits ?? [];
  const hints = view?.discardHints ?? [];
  return (
    <div className="tenpai-slot" aria-label="텐파이 정보">
      {view && view.tenpai && (
        <div className="tenpai-row" data-testid="tenpai-waits">
          <span className="badge badge-tenpai">텐파이</span>
          {view.furiten && <span className="badge badge-furiten">후리텐</span>}
          <span className="tenpai-tiles">
            {waits.map((w) => (
              <span
                key={tileLabel(w.tile)}
                className={`wait-item${w.hasYaku ? "" : " wait-noyaku"}`}
                title={w.hasYaku ? undefined : "기본 역 없음 (하저로어·창깡 등 상황 역은 미반영)"}
                data-testid={w.hasYaku ? "wait-tile" : "wait-tile-noyaku"}
              >
                <TileView tile={w.tile} size="sm" dimmed={!w.hasYaku} />
                <span className="wait-count">{w.remaining}</span>
                {!w.hasYaku && <span className="wait-noyaku-label">기본 역 없음</span>}
              </span>
            ))}
          </span>
        </div>
      )}
      {view && !view.tenpai && hints.length > 0 && (
        <div className="tenpai-row tenpai-row-hints" data-testid="tenpai-hints">
          <span className="badge badge-hint">버리면 텐파이</span>
          <span className="tenpai-tiles tenpai-tiles-hints">
            {hints.map((h) => (
              <span
                key={tileLabel(h.discard)}
                className="wait-item"
                title={`대기: ${h.waits.map((w) => tileLabel(w.tile)).join(" ")}${h.furiten ? " (후리텐)" : ""}`}
                data-testid="discard-hint"
              >
                <TileView tile={h.discard} size="sm" highlight={!h.furiten} dimmed={h.furiten} />
                <span className="hint-waits" data-testid="discard-hint-waits">
                  → {h.waits.map((w) => tileLabel(w.tile)).join(" ")}
                  {h.furiten ? " (후리텐)" : ""}
                </span>
              </span>
            ))}
          </span>
        </div>
      )}
    </div>
  );
}
