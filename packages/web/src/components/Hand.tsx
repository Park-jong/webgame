import { sameExactTile } from "@mahjong/core";
import type { Action, Tile } from "@mahjong/core";
import { TileView } from "./TileView";
import { findDiscard } from "./actions";

export interface HandProps {
  /** 정렬된 손패 (뽑은 패 제외) */
  tiles: readonly Tile[];
  /** 방금 뽑은 패 (오른쪽에 분리) */
  drawn: Tile | null;
  /** 사람의 합법 행동 */
  actions: readonly Action[];
  riichiMode: boolean;
  onAction: (action: Action) => void;
}

export function Hand({ tiles, drawn, actions, riichiMode, onAction }: HandProps) {
  const render = (tile: Tile, key: string, highlight = false) => {
    const action = findDiscard(actions, tile, riichiMode);
    return (
      <TileView
        key={key}
        tile={tile}
        size="lg"
        highlight={highlight || (riichiMode && action !== undefined)}
        disabled={action === undefined}
        onClick={() => action && onAction(action)}
      />
    );
  };
  return (
    <div className="hand" aria-label="내 손패">
      <div className="hand-tiles">{tiles.map((t, i) => render(t, `h${i}`))}</div>
      {drawn && <div className="hand-drawn">{render(drawn, "drawn", true)}</div>}
    </div>
  );
}

/** 손패에서 뽑은 패 1장을 분리한다 (뽑은 패는 손패 맨 뒤 규약). */
export function splitDrawn(hand: readonly Tile[], drawn: Tile | null): { rest: Tile[]; drawn: Tile | null } {
  if (drawn === null) return { rest: [...hand], drawn: null };
  const last = hand[hand.length - 1];
  if (last && sameExactTile(last, drawn)) return { rest: hand.slice(0, -1), drawn };
  return { rest: [...hand], drawn: null };
}
