import type { Tile, Wind } from "@mahjong/core";

const SUIT_LABEL = { man: "만", pin: "통", sou: "삭" } as const;
const SUIT_KANJI = { man: "萬", pin: "筒", sou: "索" } as const;
export const WIND_LABEL: Record<Wind, string> = { east: "동", south: "남", west: "서", north: "북" };
const WIND_KANJI: Record<Wind, string> = { east: "東", south: "南", west: "西", north: "北" };
const DRAGON_LABEL = { white: "백", green: "발", red: "중" } as const;
const DRAGON_KANJI = { white: "白", green: "發", red: "中" } as const;

/** 접근성/로그용 한글 패 이름. 예: "5만", "5만(적)", "동", "백" */
export function tileLabel(tile: Tile): string {
  if (tile.kind === "number") return `${tile.rank}${SUIT_LABEL[tile.suit]}${tile.isRedFive ? "(적)" : ""}`;
  if (tile.kind === "wind") return WIND_LABEL[tile.wind];
  return DRAGON_LABEL[tile.dragon];
}

export interface TileGlyph {
  /** 큰 글자 (수패는 숫자, 자패는 한자) */
  main: string;
  /** 작은 글자 (수패의 종류 한자) */
  sub: string | null;
  /** CSS 색상 클래스 */
  color: "man" | "pin" | "sou" | "wind" | "white" | "green" | "red";
}

export function tileGlyph(tile: Tile): TileGlyph {
  if (tile.kind === "number") return { main: String(tile.rank), sub: SUIT_KANJI[tile.suit], color: tile.suit };
  if (tile.kind === "wind") return { main: WIND_KANJI[tile.wind], sub: null, color: "wind" };
  return { main: DRAGON_KANJI[tile.dragon], sub: null, color: tile.dragon };
}
