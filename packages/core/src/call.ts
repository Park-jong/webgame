/**
 * 부로(副露: 치/펑/깡) 판정 및 처리
 *
 * 모든 함수는 순수 함수이며 입력(손패/멜드 배열)을 변경하지 않는다.
 *
 * [좌석 규약]
 * - 좌석(Seat)은 0~3의 정수이며, 턴 순서는 0 → 1 → 2 → 3 → 0 이다.
 * - 상가(上家, left) = 바로 앞 순서 = (내 좌석 + 3) % 4  → 치는 이 플레이어의 버림패만 가능
 * - 대면(across) = (내 좌석 + 2) % 4
 * - 하가(下家, right) = 바로 다음 순서 = (내 좌석 + 1) % 4
 *
 * [적5 선택 설계]
 * - 종류 판정은 항상 적5를 일반 5와 동일하게 취급한다(isSameTileType).
 * - 다만 손패에서 실제로 어떤 패를 쓸지는 결과가 달라지므로(적도라 보유 여부),
 *   canChi/canPon은 "실제 손패의 Tile 객체"로 이루어진 선택지 배열을 반환한다.
 *   적5 사용 여부만 다른 선택지는 별도 항목으로 나뉜다(적5를 쓰지 않는 선택지가 먼저 온다).
 * - apply* 함수의 `use` 인자로 선택지 중 하나(손패에서 쓸 패)를 지정한다.
 *   생략하면 선택지가 정확히 하나일 때만 자동 선택하고, 여러 개면 에러를 던진다(모호성 방지)
 *   단, 펑은 생략 시 첫 번째 선택지(적5를 쓰지 않는 쪽)를 사용한다.
 *
 * [범위 밖 - 후속 연동 포인트]
 * - score/yaku/agari/dora는 멜드(CalledMeld)를 WinContext.melds / isAgari·countDora의 melds 인자로 반영한다
 *   (멘젠 한정 역, 부수, 산안커, 도라 계산에 멜드 패 포함).
 * - 깡 후 영상패 뽑기, 깡도라 공개, 창깡/치쿠, 유국, 4깡 유국, 쿠이가에시 등은 미구현.
 *   (깡 처리 후 손패는 13장 - 영상패 1장을 뽑아야 하는 상태로 남는다.)
 */

import type { Tile } from "./tiles.js";
import { isSameTileType } from "./tiles.js";
import { tileToIndex } from "./meld.js";

/** 좌석 번호 (0~3) */
export type Seat = number;

/** 나 기준으로 패를 가져온 상대의 위치 */
export type RelativeSeat = "left" | "across" | "right";

/** 치: 상가의 버림패로 순자 완성 */
export interface ChiMeld {
  type: "chi";
  /** 오름차순으로 정렬된 순자 3장 (calledTile 포함) */
  tiles: [Tile, Tile, Tile];
  calledTile: Tile;
  fromSeat: Seat;
  from: "left";
}

/** 펑: 누군가의 버림패로 각자 완성 */
export interface PonMeld {
  type: "pon";
  tiles: [Tile, Tile, Tile];
  calledTile: Tile;
  fromSeat: Seat;
  from: RelativeSeat;
}

/** 다이민깡(대명깡): 남의 버림패 + 손패 3장 */
export interface DaiminkanMeld {
  type: "daiminkan";
  tiles: [Tile, Tile, Tile, Tile];
  calledTile: Tile;
  fromSeat: Seat;
  from: RelativeSeat;
}

/** 카칸(가깡): 기존 펑에 손패 1장을 추가 */
export interface ShouminkanMeld {
  type: "shouminkan";
  tiles: [Tile, Tile, Tile, Tile];
  /** 원래 펑에서 가져온 패 */
  calledTile: Tile;
  fromSeat: Seat;
  from: RelativeSeat;
  /** 나중에 손패에서 추가한 패 */
  addedTile: Tile;
}

/** 안깡(暗槓): 손패 4장. 남의 패를 가져오지 않으므로 멘젠이 유지된다. */
export interface AnkanMeld {
  type: "ankan";
  tiles: [Tile, Tile, Tile, Tile];
}

export type CalledMeld = ChiMeld | PonMeld | DaiminkanMeld | ShouminkanMeld | AnkanMeld;

/** 손패 + 부로 상태 */
export interface CallState {
  hand: readonly Tile[];
  melds: readonly CalledMeld[];
}

/** 치 선택지: 손패에서 쓸 두 장과 완성되는 순자 */
export interface ChiOption {
  /** 손패에서 꺼낼 실제 패 2장 (오름차순) */
  use: [Tile, Tile];
  /** 완성되는 순자 (버림패 포함, 오름차순) */
  sequence: [Tile, Tile, Tile];
}

/** 펑 선택지: 손패에서 쓸 실제 패 2장 */
export interface PonOption {
  use: [Tile, Tile];
}

/** 카칸 선택지 */
export interface ShouminkanOption {
  /** 확장 대상 펑의 melds 내 인덱스 */
  meldIndex: number;
  /** 추가할 손패의 패 */
  tile: Tile;
}

// ---------------------------------------------------------------------------
// 내부 유틸
// ---------------------------------------------------------------------------

function assertSeat(seat: Seat, name: string): void {
  if (!Number.isInteger(seat) || seat < 0 || seat > 3) {
    throw new Error(`${name}는 0~3의 정수여야 합니다: ${seat}`);
  }
}

/** 상가(바로 앞 순서) 좌석 */
function kamichaOf(seat: Seat): Seat {
  return (seat + 3) % 4;
}

/** 상대 좌석이 나 기준으로 어느 위치인지 (자기 자신이면 에러) */
function relativeSeat(mySeat: Seat, fromSeat: Seat): RelativeSeat {
  assertSeat(mySeat, "내 좌석");
  assertSeat(fromSeat, "버린 사람 좌석");
  const diff = (fromSeat - mySeat + 4) % 4;
  if (diff === 0) {
    throw new Error("자신의 버림패는 부로할 수 없습니다.");
  }
  return diff === 1 ? "right" : diff === 2 ? "across" : "left";
}

/**
 * 손패 장수 정합 검증: 손패 + 멜드 1개당 3장 = expected.
 * (깡도 3장으로 계산 - 4번째 패는 영상패로 보충되는 개념)
 */
function assertHandSize(state: CallState, expected: 13 | 14): void {
  const total = state.hand.length + state.melds.length * 3;
  if (total !== expected) {
    throw new Error(
      `손패 장수가 맞지 않습니다: 손패 ${state.hand.length}장 + 멜드 ${state.melds.length}개 (기대 합계 ${expected}, 실제 ${total})`,
    );
  }
}

function sameExact(a: Tile, b: Tile): boolean {
  return isSameTileType(a, b) && (a.kind !== "number" || (b.kind === "number" && a.isRedFive === b.isRedFive));
}

/**
 * pool(같은 종류의 실제 패들)에서 count장을 고르는 선택지를 적5 사용 여부별로 나열한다.
 * 적5를 적게 쓰는 선택지가 먼저 온다. 일반 패(적5 아님)만 있거나 적5만 있으면 선택지는 하나.
 */
function pickVariants(pool: readonly Tile[], count: number): Tile[][] {
  const reds = pool.filter((t) => t.kind === "number" && t.isRedFive);
  const normals = pool.filter((t) => !(t.kind === "number" && t.isRedFive));
  const variants: Tile[][] = [];
  const minReds = Math.max(0, count - normals.length);
  const maxReds = Math.min(reds.length, count);
  for (let r = minReds; r <= maxReds; r++) {
    variants.push([...normals.slice(0, count - r), ...reds.slice(0, r)]);
  }
  return variants;
}

function tilesOfType(hand: readonly Tile[], tile: Tile): Tile[] {
  return hand.filter((t) => isSameTileType(t, tile));
}

/** 손패에서 wanted 각 패(종류+적5 여부 일치)를 한 장씩 제거한 새 배열을 반환한다. */
function removeExact(hand: readonly Tile[], wanted: readonly Tile[]): Tile[] {
  const result = [...hand];
  for (const w of wanted) {
    const idx = result.findIndex((t) => sameExact(t, w));
    if (idx === -1) {
      throw new Error("지정한 패가 손패에 없습니다.");
    }
    result.splice(idx, 1);
  }
  return result;
}

// ---------------------------------------------------------------------------
// 멘젠
// ---------------------------------------------------------------------------

/** 멘젠 여부: 멜드가 없거나 안깡만 있으면 true (치/펑/대명깡/가깡이 있으면 false). */
export function isMenzen(melds: readonly CalledMeld[]): boolean {
  return melds.every((m) => m.type === "ankan");
}

// ---------------------------------------------------------------------------
// 판정
// ---------------------------------------------------------------------------

/**
 * 치 가능한 모든 조합을 반환한다 (불가능하면 빈 배열).
 * - 상가(mySeat의 바로 앞 순서)의 버림패에 대해서만 가능하고, 자패는 불가.
 * - 양면/간짱/변짱 모두 각각 하나의 선택지. 적5 사용 여부가 다르면 별도 선택지.
 */
export function canChi(
  hand: readonly Tile[],
  discard: Tile,
  discarderSeat: Seat,
  mySeat: Seat,
): ChiOption[] {
  assertSeat(discarderSeat, "버린 사람 좌석");
  assertSeat(mySeat, "내 좌석");
  if (discarderSeat !== kamichaOf(mySeat)) return [];
  if (discard.kind !== "number") return [];

  const rank = discard.rank;
  // 버림패 기준 상대 오프셋 조합: [-2,-1](변/양면), [-1,+1](간짱), [+1,+2]
  const offsetPairs: [number, number][] = [
    [-2, -1],
    [-1, 1],
    [1, 2],
  ];

  const options: ChiOption[] = [];
  for (const [o1, o2] of offsetPairs) {
    const r1 = rank + o1;
    const r2 = rank + o2;
    if (r1 < 1 || r2 > 9) continue;
    const pool1 = hand.filter((t) => t.kind === "number" && t.suit === discard.suit && t.rank === r1);
    const pool2 = hand.filter((t) => t.kind === "number" && t.suit === discard.suit && t.rank === r2);
    if (pool1.length === 0 || pool2.length === 0) continue;
    for (const [a] of pickVariants(pool1, 1)) {
      for (const [b] of pickVariants(pool2, 1)) {
        const seq = [a!, discard, b!].sort((x, y) => tileToIndex(x) - tileToIndex(y)) as [Tile, Tile, Tile];
        options.push({ use: [a!, b!], sequence: seq });
      }
    }
  }
  return options;
}

/**
 * 펑 가능한 선택지를 반환한다 (같은 종류 2장 이상 보유 시. 불가능하면 빈 배열).
 * 선택지는 적5 사용 개수 오름차순(적5를 쓰지 않는 쪽이 먼저).
 */
export function canPon(hand: readonly Tile[], discard: Tile): PonOption[] {
  const pool = tilesOfType(hand, discard);
  if (pool.length < 2) return [];
  return pickVariants(pool, 2).map((v) => ({ use: [v[0]!, v[1]!] as [Tile, Tile] }));
}

/** 다이민깡 가능 여부: 같은 종류 3장 이상 보유. */
export function canDaiminkan(hand: readonly Tile[], discard: Tile): boolean {
  return tilesOfType(hand, discard).length >= 3;
}

/** 안깡 가능한 패 종류 목록 (손패에서 4장 모은 종류마다 대표 패 1장, 손패 등장 순). */
export function canAnkan(hand: readonly Tile[]): Tile[] {
  const seen = new Set<number>();
  const result: Tile[] = [];
  for (const t of hand) {
    const idx = tileToIndex(t);
    if (seen.has(idx)) continue;
    seen.add(idx);
    if (tilesOfType(hand, t).length >= 4) result.push(t);
  }
  return result;
}

/**
 * 카칸 가능한 선택지 목록: 기존 펑과 같은 종류의 패를 손에 들고 있는 경우.
 * 같은 펑(meldIndex)에 대해 적5 사용 여부가 다르면 선택지가 별도 항목으로 나뉜다
 * (같은 meldIndex에 최대 2개, 일반 패가 먼저 오고 적5가 나중).
 */
export function canShouminkan(hand: readonly Tile[], melds: readonly CalledMeld[]): ShouminkanOption[] {
  const result: ShouminkanOption[] = [];
  melds.forEach((m, meldIndex) => {
    if (m.type !== "pon") return;
    const pool = tilesOfType(hand, m.calledTile);
    if (pool.length === 0) return;
    for (const [tile] of pickVariants(pool, 1)) {
      result.push({ meldIndex, tile: tile! });
    }
  });
  return result;
}

// ---------------------------------------------------------------------------
// 처리
// ---------------------------------------------------------------------------

/**
 * 치를 처리한다. 손패에서 2장을 제거하고 치 멜드를 추가한 새 상태를 반환한다.
 * @param use 손패에서 쓸 두 장. 생략 시 선택지가 정확히 하나일 때만 자동 선택.
 * @throws 상가가 아님/자패/조합 불가/손패 장수 불일치 등
 */
export function applyChi(
  state: CallState,
  discard: Tile,
  discarderSeat: Seat,
  mySeat: Seat,
  use?: readonly [Tile, Tile],
): CallState {
  assertSeat(discarderSeat, "버린 사람 좌석");
  assertSeat(mySeat, "내 좌석");
  if (discarderSeat !== kamichaOf(mySeat)) {
    throw new Error("치는 바로 앞 순서(상가)의 버림패로만 가능합니다.");
  }
  if (discard.kind !== "number") {
    throw new Error("자패는 치할 수 없습니다.");
  }
  assertHandSize(state, 13);

  const options = canChi(state.hand, discard, discarderSeat, mySeat);
  if (options.length === 0) {
    throw new Error("치할 수 있는 조합이 손패에 없습니다.");
  }

  let chosen: ChiOption | undefined;
  if (use) {
    chosen = options.find(
      (o) =>
        (sameExact(o.use[0], use[0]) && sameExact(o.use[1], use[1])) ||
        (sameExact(o.use[0], use[1]) && sameExact(o.use[1], use[0])),
    );
    if (!chosen) {
      throw new Error("지정한 패로는 치할 수 없습니다 (순자가 성립하지 않거나 손패에 없음).");
    }
  } else {
    if (options.length > 1) {
      throw new Error(`치 조합이 ${options.length}개라 use로 사용할 패를 지정해야 합니다.`);
    }
    chosen = options[0]!;
  }

  const meld: ChiMeld = {
    type: "chi",
    tiles: chosen.sequence,
    calledTile: discard,
    fromSeat: discarderSeat,
    from: "left",
  };
  return { hand: removeExact(state.hand, chosen.use), melds: [...state.melds, meld] };
}

/**
 * 펑을 처리한다. 손패에서 2장을 제거하고 펑 멜드를 추가한 새 상태를 반환한다.
 * @param use 손패에서 쓸 두 장. 생략 시 첫 번째 선택지(적5를 쓰지 않는 쪽).
 */
export function applyPon(
  state: CallState,
  discard: Tile,
  discarderSeat: Seat,
  mySeat: Seat,
  use?: readonly [Tile, Tile],
): CallState {
  const from = relativeSeat(mySeat, discarderSeat);
  assertHandSize(state, 13);

  const options = canPon(state.hand, discard);
  if (options.length === 0) {
    throw new Error("펑하려면 같은 종류의 패가 손패에 2장 이상 필요합니다.");
  }

  let chosen: PonOption | undefined;
  if (use) {
    chosen = options.find(
      (o) =>
        (sameExact(o.use[0], use[0]) && sameExact(o.use[1], use[1])) ||
        (sameExact(o.use[0], use[1]) && sameExact(o.use[1], use[0])),
    );
    if (!chosen) {
      throw new Error("지정한 패로는 펑할 수 없습니다 (종류가 다르거나 손패에 없음).");
    }
  } else {
    chosen = options[0]!;
  }

  const meld: PonMeld = {
    type: "pon",
    tiles: [chosen.use[0], chosen.use[1], discard],
    calledTile: discard,
    fromSeat: discarderSeat,
    from,
  };
  return { hand: removeExact(state.hand, chosen.use), melds: [...state.melds, meld] };
}

/** 다이민깡을 처리한다. 손패에서 같은 종류 3장을 제거하고 멜드를 추가한다. */
export function applyDaiminkan(
  state: CallState,
  discard: Tile,
  discarderSeat: Seat,
  mySeat: Seat,
): CallState {
  const from = relativeSeat(mySeat, discarderSeat);
  assertHandSize(state, 13);
  if (!canDaiminkan(state.hand, discard)) {
    throw new Error("다이민깡하려면 같은 종류의 패가 손패에 3장 필요합니다.");
  }

  const used = tilesOfType(state.hand, discard).slice(0, 3);
  const meld: DaiminkanMeld = {
    type: "daiminkan",
    tiles: [used[0]!, used[1]!, used[2]!, discard],
    calledTile: discard,
    fromSeat: discarderSeat,
    from,
  };
  return { hand: removeExact(state.hand, used), melds: [...state.melds, meld] };
}

/** 안깡을 처리한다. 손패에서 같은 종류 4장을 제거하고 멜드를 추가한다 (멘젠 유지). */
export function applyAnkan(state: CallState, tile: Tile): CallState {
  assertHandSize(state, 14);
  const used = tilesOfType(state.hand, tile);
  if (used.length < 4) {
    throw new Error(`안깡하려면 같은 종류의 패가 손패에 4장 필요합니다: ${used.length}장 보유`);
  }
  const four = used.slice(0, 4);
  const meld: AnkanMeld = { type: "ankan", tiles: [four[0]!, four[1]!, four[2]!, four[3]!] };
  return { hand: removeExact(state.hand, four), melds: [...state.melds, meld] };
}

/**
 * 카칸을 처리한다. 손패의 패 1장을 제거하고 기존 펑을 카칸으로 교체한다.
 * @param tile 추가할 손패의 패. 적5 여부까지 일치하는 패가 손패에 있어야 하며, 없으면 에러(폴백 없음).
 * @throws 펑이 없음/지정한 패(적5 여부 포함)가 손패에 없음/손패 장수 불일치
 */
export function applyShouminkan(state: CallState, tile: Tile): CallState {
  assertHandSize(state, 14);
  const meldIndex = state.melds.findIndex((m) => m.type === "pon" && isSameTileType(m.calledTile, tile));
  if (meldIndex === -1) {
    throw new Error("카칸하려면 같은 종류의 펑이 이미 있어야 합니다.");
  }
  const candidates = tilesOfType(state.hand, tile);
  if (candidates.length === 0) {
    throw new Error("카칸하려면 같은 종류의 패가 손패에 1장 필요합니다.");
  }
  const added = candidates.find((t) => sameExact(t, tile));
  if (!added) {
    throw new Error("지정한 패(적5 여부 포함)가 손패에 없어 카칸할 수 없습니다.");
  }
  const pon = state.melds[meldIndex] as PonMeld;
  const meld: ShouminkanMeld = {
    type: "shouminkan",
    tiles: [pon.tiles[0], pon.tiles[1], pon.tiles[2], added],
    calledTile: pon.calledTile,
    fromSeat: pon.fromSeat,
    from: pon.from,
    addedTile: added,
  };
  const melds = state.melds.map((m, i) => (i === meldIndex ? meld : m));
  return { hand: removeExact(state.hand, [added]), melds };
}
