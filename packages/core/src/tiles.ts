/**
 * 마작 패(牌) 기본 타입 정의
 *
 * 표준 리치마작은 136패로 구성됨:
 * - 수패(숫자패) 3종 x 1~9 x 4장 = 108장 (만수/통수/삭수)
 * - 자패(글자패) 7종 x 4장 = 28장 (풍패 4종 + 삼원패 3종)
 */

export type NumberSuit = "man" | "pin" | "sou"; // 만수(萬), 통수(筒), 삭수(索)

export type Wind = "east" | "south" | "west" | "north";
export type Dragon = "white" | "green" | "red"; // 백(白), 발(發), 중(中)

export type HonorTile =
  | { kind: "wind"; wind: Wind }
  | { kind: "dragon"; dragon: Dragon };

export type NumberTile = {
  kind: "number";
  suit: NumberSuit;
  rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
  /** 적도라(赤ドラ) 여부 - 각 수패 5에 한 장씩 존재하는 룰이 흔함 */
  isRedFive: boolean;
};

export type Tile = NumberTile | HonorTile;

/** 패 하나를 사람이 읽을 수 있는 문자열로 변환 (디버깅/로그용) */
export function tileToString(tile: Tile): string {
  if (tile.kind === "number") {
    const suitChar = { man: "m", pin: "p", sou: "s" }[tile.suit];
    return `${tile.rank}${suitChar}${tile.isRedFive ? "(red)" : ""}`;
  }
  if (tile.kind === "wind") {
    const windChar = { east: "E", south: "S", west: "W", north: "N" }[tile.wind];
    return windChar;
  }
  const dragonChar = { white: "Wt", green: "Gr", red: "Rd" }[tile.dragon];
  return dragonChar;
}

/** 두 패가 (적도라 여부와 무관하게) 같은 종류인지 비교 */
export function isSameTileType(a: Tile, b: Tile): boolean {
  if (a.kind === "number" && b.kind === "number") {
    return a.suit === b.suit && a.rank === b.rank;
  }
  if (a.kind === "wind" && b.kind === "wind") {
    return a.wind === b.wind;
  }
  if (a.kind === "dragon" && b.kind === "dragon") {
    return a.dragon === b.dragon;
  }
  return false;
}

const NUMBER_SUITS: NumberSuit[] = ["man", "pin", "sou"];
const WINDS: Wind[] = ["east", "south", "west", "north"];
const DRAGONS: Dragon[] = ["white", "green", "red"];

/**
 * 표준 136패 세트를 생성한다 (셔플되지 않은 상태).
 * @param useRedFives 적도라 규칙 사용 여부 (기본 true, 수패 종류당 1장)
 */
export function createFullTileSet(useRedFives = true): Tile[] {
  const tiles: Tile[] = [];

  for (const suit of NUMBER_SUITS) {
    for (let rank = 1; rank <= 9; rank++) {
      for (let copy = 0; copy < 4; copy++) {
        const isRedFive = useRedFives && rank === 5 && copy === 0;
        tiles.push({
          kind: "number",
          suit,
          rank: rank as NumberTile["rank"],
          isRedFive,
        });
      }
    }
  }

  for (const wind of WINDS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({ kind: "wind", wind });
    }
  }

  for (const dragon of DRAGONS) {
    for (let copy = 0; copy < 4; copy++) {
      tiles.push({ kind: "dragon", dragon });
    }
  }

  return tiles;
}
