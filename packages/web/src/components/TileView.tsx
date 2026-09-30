import type { Tile } from "@mahjong/core";
import { tileGlyph, tileLabel } from "../tileText";

export interface TileViewProps {
  /** null이면 뒷면 */
  tile: Tile | null;
  size?: "sm" | "md" | "lg";
  onClick?: () => void;
  disabled?: boolean;
  /** 가져온 패 (가로로 눕힘) */
  sideways?: boolean;
  /** 리치 선언패 표식 (눕히지 않고 테두리 색으로 구분) */
  riichi?: boolean;
  /** 부로되어 가져간 버림패 등 흐리게 */
  dimmed?: boolean;
  /** 강조 (뽑은 패/선택 가능 등) */
  highlight?: boolean;
}

export function TileView({ tile, size = "md", onClick, disabled, sideways, riichi, dimmed, highlight }: TileViewProps) {
  const classes = ["tile", `tile-${size}`];
  if (riichi) classes.push("tile-riichi");
  if (tile === null) classes.push("tile-back");
  if (sideways) classes.push("tile-sideways");
  if (dimmed) classes.push("tile-dimmed");
  if (highlight) classes.push("tile-highlight");
  const glyph = tile === null ? null : tileGlyph(tile);
  const isRed = tile !== null && tile.kind === "number" && tile.isRedFive;
  if (glyph) classes.push(`tile-${glyph.color}`);
  if (isRed) classes.push("tile-red-five");
  const label = tile === null ? "뒷면" : tileLabel(tile);

  const inner = glyph ? (
    <>
      <span className="tile-main">{glyph.main}</span>
      {glyph.sub && <span className="tile-sub">{glyph.sub}</span>}
    </>
  ) : null;

  if (onClick) {
    return (
      <button type="button" className={classes.join(" ")} onClick={onClick} disabled={disabled} aria-label={label}>
        {inner}
      </button>
    );
  }
  return (
    <span className={classes.join(" ")} role="img" aria-label={label}>
      {inner}
    </span>
  );
}
