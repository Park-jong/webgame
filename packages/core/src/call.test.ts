import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import { isSameTileType } from "./tiles.js";
import {
  applyAnkan,
  applyChi,
  applyDaiminkan,
  applyPon,
  applyShouminkan,
  canAnkan,
  canChi,
  canDaiminkan,
  canPon,
  canShouminkan,
  isMenzen,
  type CalledMeld,
  type CallState,
} from "./call.js";

type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
function num(rank: Rank, suit: "man" | "pin" | "sou" = "man"): Tile {
  return { kind: "number", suit, rank, isRedFive: false };
}
function red(suit: "man" | "pin" | "sou" = "man"): Tile {
  return { kind: "number", suit, rank: 5, isRedFive: true };
}
function wind(w: "east" | "south" | "west" | "north"): Tile {
  return { kind: "wind", wind: w };
}

/** 13장 손패를 만든다 (앞부분 지정, 나머지는 서로 다른 무관한 패로 채움) */
function pad(tiles: Tile[], total = 13): Tile[] {
  const filler: Tile[] = [
    num(1, "pin"), num(4, "pin"), num(7, "pin"), num(9, "pin"), num(2, "sou"), num(8, "sou"),
    wind("east"), wind("south"), wind("west"), wind("north"), num(9, "sou"), num(1, "sou"),
    num(3, "sou"), num(6, "sou"),
  ];
  return [...tiles, ...filler.slice(0, total - tiles.length)];
}

// 좌석: 내 좌석 1, 상가 0, 대면 3, 하가 2
const ME = 1;
const KAMICHA = 0;

describe("canChi", () => {
  it("양면/간짱/변짱 조합을 모두 찾는다", () => {
    const hand = [num(3), num(4), num(6), num(7), num(8)];
    const options = canChi(hand, num(5), KAMICHA, ME);
    const ranks = options.map((o) => o.use.map((t) => (t as { rank: number }).rank).join(","));
    expect(ranks.sort()).toEqual(["3,4", "4,6", "6,7"]);
    const seqs = options.map((o) => o.sequence.map((t) => (t as { rank: number }).rank));
    expect(seqs).toContainEqual([4, 5, 6]);
  });

  it("변짱(1-2 + 3, 8-9 + 7)도 가능하다", () => {
    expect(canChi([num(1), num(2)], num(3), KAMICHA, ME)).toHaveLength(1);
    expect(canChi([num(8), num(9)], num(7), KAMICHA, ME)).toHaveLength(1);
  });

  it("슈트가 다르면 불가", () => {
    expect(canChi([num(4, "pin"), num(6, "pin")], num(5), KAMICHA, ME)).toEqual([]);
  });

  it("자패는 불가", () => {
    expect(canChi([wind("east"), wind("south")], wind("west"), KAMICHA, ME)).toEqual([]);
  });

  it("상가가 아니면 불가 (대면/하가)", () => {
    const hand = [num(4), num(6)];
    expect(canChi(hand, num(5), 3, ME)).toEqual([]);
    expect(canChi(hand, num(5), 2, ME)).toEqual([]);
  });

  it("좌석 순환: 내 좌석 0의 상가는 3", () => {
    expect(canChi([num(4), num(6)], num(5), 3, 0)).toHaveLength(1);
  });

  it("적5는 선택지가 별도로 나뉜다", () => {
    const hand = [num(4), num(5), red(), num(6)];
    const options = canChi(hand, num(3), KAMICHA, ME);
    // 3 + 4,5 → 적5 사용 여부 2가지
    const with45 = options.filter((o) => o.use[0].kind === "number" && o.use[0].rank === 4 && o.use[1].kind === "number" && o.use[1].rank === 5);
    expect(with45).toHaveLength(2);
    expect(with45.map((o) => (o.use[1] as { isRedFive: boolean }).isRedFive).sort()).toEqual([false, true]);
  });

  it("적5를 버림패로 치할 수 있다 (종류 기준 동일 취급)", () => {
    const options = canChi([num(3), num(4)], red(), KAMICHA, ME);
    expect(options).toHaveLength(1);
    expect(options[0]!.sequence).toEqual([num(3), red(), num(4)].sort((a, b) => (a as any).rank - (b as any).rank));
  });
});

describe("canPon / canDaiminkan / canAnkan / canShouminkan", () => {
  it("같은 종류 2장 이상이면 펑 가능, 1장이면 불가", () => {
    expect(canPon([num(5), num(5), num(1)], num(5))).toHaveLength(1);
    expect(canPon([num(5), num(1)], num(5))).toEqual([]);
  });

  it("적5 보유 시 적5 사용/미사용 선택지를 제공한다 (미사용이 먼저)", () => {
    const options = canPon([red(), num(5), num(5)], num(5));
    expect(options).toHaveLength(2);
    expect(options[0]!.use.some((t) => t.kind === "number" && t.isRedFive)).toBe(false);
    expect(options[1]!.use.some((t) => t.kind === "number" && t.isRedFive)).toBe(true);
  });

  it("적5와 일반5 한 장씩만 있으면 선택지는 하나(둘 다 사용)", () => {
    expect(canPon([red(), num(5)], num(5))).toHaveLength(1);
  });

  it("다이민깡: 3장 보유 시만 가능", () => {
    expect(canDaiminkan([num(2), num(2), num(2)], num(2))).toBe(true);
    expect(canDaiminkan([num(2), num(2)], num(2))).toBe(false);
  });

  it("안깡: 4장 모은 종류 목록", () => {
    const hand = [num(1), num(1), num(1), num(1), wind("east"), wind("east"), wind("east"), wind("east"), num(5), num(5), num(5)];
    const result = canAnkan(hand);
    expect(result).toHaveLength(2);
    expect(isSameTileType(result[0]!, num(1))).toBe(true);
    expect(isSameTileType(result[1]!, wind("east"))).toBe(true);
    expect(canAnkan([num(1), num(1), num(1)])).toEqual([]);
  });

  it("카칸: 기존 펑과 같은 종류 1장이 손에 있어야 한다", () => {
    const pon = applyPon({ hand: pad([num(7), num(7)]), melds: [] }, num(7), KAMICHA, ME);
    expect(canShouminkan([num(7), num(1)], pon.melds)).toEqual([{ meldIndex: 0, tile: num(7) }]);
    expect(canShouminkan([num(1)], pon.melds)).toEqual([]);
    expect(canShouminkan([num(7)], [])).toEqual([]);
  });
});

describe("applyChi", () => {
  it("손패 2장을 제거하고 치 멜드를 추가한다", () => {
    const hand = pad([num(4), num(6)]);
    const state: CallState = { hand, melds: [] };
    const next = applyChi(state, num(5), KAMICHA, ME);
    expect(next.hand).toHaveLength(11);
    expect(next.melds).toHaveLength(1);
    const meld = next.melds[0]!;
    expect(meld.type).toBe("chi");
    if (meld.type === "chi") {
      expect(meld.tiles).toEqual([num(4), num(5), num(6)]);
      expect(meld.calledTile).toEqual(num(5));
      expect(meld.fromSeat).toBe(KAMICHA);
      expect(meld.from).toBe("left");
    }
    expect(isMenzen(next.melds)).toBe(false);
  });

  it("조합이 여러 개인데 use를 생략하면 에러, 지정하면 그 조합을 사용", () => {
    const state: CallState = { hand: pad([num(4), num(6), num(3), num(7)]), melds: [] };
    expect(() => applyChi(state, num(5), KAMICHA, ME)).toThrow(/use/);
    const next = applyChi(state, num(5), KAMICHA, ME, [num(3), num(4)]);
    expect(next.melds[0]!.tiles).toEqual([num(3), num(4), num(5)]);
  });

  it("use로 적5를 지정하면 적5가 멜드에 들어가고 손패에서 빠진다", () => {
    const state: CallState = { hand: pad([num(5), red(), num(4)]), melds: [] };
    const next = applyChi(state, num(3), KAMICHA, ME, [num(4), red()]);
    expect(next.melds[0]!.tiles).toEqual([num(3), num(4), red()]);
    expect(next.hand.filter((t) => t.kind === "number" && t.rank === 5 && t.isRedFive)).toHaveLength(0);
    expect(next.hand.filter((t) => t.kind === "number" && t.rank === 5)).toHaveLength(1);
  });

  it("에러: 상가 아님 / 자패 / 조합 없음 / 잘못된 use / 장수 불일치", () => {
    const state: CallState = { hand: pad([num(4), num(6)]), melds: [] };
    expect(() => applyChi(state, num(5), 2, ME)).toThrow("상가");
    expect(() => applyChi(state, wind("east"), KAMICHA, ME)).toThrow("자패");
    expect(() => applyChi(state, num(9), KAMICHA, ME)).toThrow("조합");
    expect(() => applyChi(state, num(5), KAMICHA, ME, [num(4), num(9, "pin")])).toThrow("지정한 패");
    expect(() => applyChi({ hand: pad([num(4), num(6)], 12), melds: [] }, num(5), KAMICHA, ME)).toThrow("장수");
  });
});

describe("applyPon", () => {
  it("손패 2장을 제거하고 펑 멜드를 추가한다 (from 위치 계산)", () => {
    const state: CallState = { hand: pad([num(9), num(9)]), melds: [] };
    const next = applyPon(state, num(9), 3, ME); // 3 → 1: 나 기준 하가(2)... diff=2 → across
    expect(next.hand).toHaveLength(11);
    const meld = next.melds[0]!;
    expect(meld.type).toBe("pon");
    if (meld.type === "pon") {
      expect(meld.from).toBe("across");
      expect(meld.fromSeat).toBe(3);
      expect(meld.tiles).toHaveLength(3);
    }
    expect(applyPon(state, num(9), 2, ME).melds[0]).toMatchObject({ from: "right" });
    expect(applyPon(state, num(9), 0, ME).melds[0]).toMatchObject({ from: "left" });
  });

  it("적5 기본 선택은 적5를 쓰지 않는 쪽, use로 적5 사용 지정 가능", () => {
    const state: CallState = { hand: pad([red(), num(5), num(5)]), melds: [] };
    const def = applyPon(state, num(5), 0, ME);
    expect(def.hand.some((t) => t.kind === "number" && t.isRedFive)).toBe(true);
    const withRed = applyPon(state, num(5), 0, ME, [red(), num(5)]);
    expect(withRed.hand.some((t) => t.kind === "number" && t.isRedFive)).toBe(false);
    expect(withRed.melds[0]!.tiles.some((t) => t.kind === "number" && t.isRedFive)).toBe(true);
  });

  it("에러: 패 부족 / 자기 자신 / 잘못된 좌석 / 잘못된 use", () => {
    const state: CallState = { hand: pad([num(9)]), melds: [] };
    expect(() => applyPon(state, num(9), 0, ME)).toThrow("2장");
    const ok: CallState = { hand: pad([num(9), num(9)]), melds: [] };
    expect(() => applyPon(ok, num(9), ME, ME)).toThrow("자신");
    expect(() => applyPon(ok, num(9), 4, ME)).toThrow("0~3");
    expect(() => applyPon(ok, num(9), 0, ME, [num(9), num(1, "pin")])).toThrow("지정한 패");
  });
});

describe("applyDaiminkan", () => {
  it("손패 3장을 제거하고 4장짜리 멜드를 추가한다", () => {
    const state: CallState = { hand: pad([num(2), num(2), num(2)]), melds: [] };
    const next = applyDaiminkan(state, num(2), 2, ME);
    expect(next.hand).toHaveLength(10);
    expect(next.melds[0]).toMatchObject({ type: "daiminkan", from: "right", fromSeat: 2 });
    expect(next.melds[0]!.tiles).toHaveLength(4);
    expect(isMenzen(next.melds)).toBe(false);
  });

  it("에러: 패 부족", () => {
    const state: CallState = { hand: pad([num(2), num(2)]), melds: [] };
    expect(() => applyDaiminkan(state, num(2), 2, ME)).toThrow("3장");
  });
});

describe("applyAnkan", () => {
  it("14장 상태에서 4장을 제거하고 안깡 멜드를 추가한다 (멘젠 유지)", () => {
    const state: CallState = { hand: pad([num(8), num(8), num(8), num(8)], 14), melds: [] };
    const next = applyAnkan(state, num(8));
    expect(next.hand).toHaveLength(10);
    expect(next.melds[0]).toMatchObject({ type: "ankan" });
    expect(next.melds[0]!.tiles).toHaveLength(4);
    expect(isMenzen(next.melds)).toBe(true);
  });

  it("에러: 4장 미만 / 장수 불일치", () => {
    const state: CallState = { hand: pad([num(8), num(8), num(8)], 14), melds: [] };
    expect(() => applyAnkan(state, num(8))).toThrow("4장");
    expect(() => applyAnkan({ hand: pad([num(8), num(8), num(8), num(8)], 13), melds: [] }, num(8))).toThrow("장수");
  });
});

describe("applyShouminkan", () => {
  function ponState(): CallState {
    return applyPon({ hand: pad([num(7), num(7)]), melds: [] }, num(7), 0, ME);
  }

  it("펑을 카칸으로 교체하고 손패 1장을 제거한다", () => {
    const afterPon = ponState(); // 손패 11장 (버리기 전)
    // 펑 후 1장 버리고(10장) 7을 쯔모(11장) → 11 + 3 = 14
    const state: CallState = { hand: [...afterPon.hand.slice(1), num(7)], melds: afterPon.melds };
    const next = applyShouminkan(state, num(7));
    expect(next.hand).toHaveLength(10);
    expect(next.melds).toHaveLength(1);
    expect(next.melds[0]).toMatchObject({ type: "shouminkan", fromSeat: 0, from: "left" });
    expect(next.melds[0]!.tiles).toHaveLength(4);
    expect(isMenzen(next.melds)).toBe(false);
  });

  it("에러: 펑이 없음 / 손패에 없음", () => {
    const afterPon = ponState();
    const noPon: CallState = { hand: pad([num(7)], 14), melds: [] };
    expect(() => applyShouminkan(noPon, num(7))).toThrow("펑");
    // 장수 정합(11장)을 맞추되 손패에 7이 없는 경우
    const noTile: CallState = { hand: [...afterPon.hand.slice(1), num(2, "man")], melds: afterPon.melds };
    expect(() => applyShouminkan(noTile, num(7))).toThrow("1장");
  });
});

describe("isMenzen", () => {
  const ankan: CalledMeld = { type: "ankan", tiles: [num(1), num(1), num(1), num(1)] };
  const chi: CalledMeld = { type: "chi", tiles: [num(1), num(2), num(3)], calledTile: num(2), fromSeat: 0, from: "left" };

  it("멜드가 없거나 안깡만 있으면 true", () => {
    expect(isMenzen([])).toBe(true);
    expect(isMenzen([ankan, ankan])).toBe(true);
  });

  it("치/펑/깡(대명깡/가깡)이 하나라도 있으면 false", () => {
    expect(isMenzen([ankan, chi])).toBe(false);
    expect(isMenzen([{ type: "pon", tiles: [num(1), num(1), num(1)], calledTile: num(1), fromSeat: 0, from: "left" }])).toBe(false);
  });
});

describe("입력 불변성", () => {
  it("apply*/can* 함수는 입력 손패와 멜드를 변경하지 않는다", () => {
    const hand = pad([num(4), num(6), num(4), num(4)]);
    const melds: CalledMeld[] = [];
    const handCopy = JSON.parse(JSON.stringify(hand));
    const state: CallState = { hand, melds };

    canChi(hand, num(5), KAMICHA, ME);
    canPon(hand, num(4));
    canAnkan(hand);
    applyChi(state, num(5), KAMICHA, ME, [num(4), num(6)]);
    applyPon(state, num(4), 0, ME);
    applyDaiminkan(state, num(4), 0, ME);

    expect(hand).toEqual(handCopy);
    expect(melds).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
// 피드백 반영 추가 테스트
// ---------------------------------------------------------------------------

const ALL_MAN: Tile[] = [1, 2, 3, 4, 5, 6, 7, 8, 9].map((r) => num(r as Rank));
const rankPairs = (discard: Tile) =>
  canChi(ALL_MAN, discard, KAMICHA, ME)
    .map((o) => o.use.map((t) => (t as { rank: number }).rank))
    .sort((a, b) => a[0]! - b[0]! || a[1]! - b[1]!);

describe("canChi 경계 조합", () => {
  it("1m은 [2,3]만", () => {
    expect(rankPairs(num(1))).toEqual([[2, 3]]);
  });
  it("2m은 [1,3],[3,4]만", () => {
    expect(rankPairs(num(2))).toEqual([[1, 3], [3, 4]]);
  });
  it("8m은 [6,7],[7,9]만", () => {
    expect(rankPairs(num(8))).toEqual([[6, 7], [7, 9]]);
  });
  it("9m은 [7,8]만", () => {
    expect(rankPairs(num(9))).toEqual([[7, 8]]);
  });
  it("같은 패를 2장씩 들고 있어도 선택지가 중복되지 않는다", () => {
    const hand = [num(4), num(4), num(6), num(6)];
    expect(canChi(hand, num(5), KAMICHA, ME)).toHaveLength(1);
  });
});

describe("canShouminkan 적5 선택지", () => {
  const pon5 = (): CallState =>
    applyPon({ hand: pad([num(5), num(5)]), melds: [] }, num(5), 0, ME);

  it("일반5와 적5가 모두 있으면 옵션 2개 (일반 먼저)", () => {
    const { melds } = pon5();
    const options = canShouminkan([num(5), red(), num(1)], melds);
    expect(options).toHaveLength(2);
    expect(options.every((o) => o.meldIndex === 0)).toBe(true);
    expect(options[0]!.tile).toEqual(num(5));
    expect(options[1]!.tile).toEqual(red());
  });

  it("한 장뿐이면 옵션 1개", () => {
    const { melds } = pon5();
    expect(canShouminkan([red()], melds)).toEqual([{ meldIndex: 0, tile: red() }]);
    expect(canShouminkan([num(5)], melds)).toEqual([{ meldIndex: 0, tile: num(5) }]);
  });
});

describe("applyShouminkan 적5/재카칸", () => {
  it("적5 지정 시 addedTile이 적5이고 손패에서 적5가 제거된다", () => {
    const afterPon = applyPon({ hand: pad([red(), num(5), num(5)]), melds: [] }, num(5), 0, ME);
    const state: CallState = {
      hand: [...afterPon.hand.slice(0, -1), num(5)], // 적5 + 일반5 보유, 11장
      melds: afterPon.melds,
    };
    const next = applyShouminkan(state, red());
    const meld = next.melds[0]!;
    expect(meld.type).toBe("shouminkan");
    if (meld.type === "shouminkan") {
      expect(meld.addedTile).toEqual(red());
      expect(meld.tiles[3]).toEqual(red());
    }
    expect(next.hand.some((t) => t.kind === "number" && t.isRedFive)).toBe(false);
    expect(next.hand.filter((t) => t.kind === "number" && t.rank === 5 && t.suit === "man")).toHaveLength(1);
  });

  it("일반5만 있는데 적5를 지정하면 에러", () => {
    const afterPon = applyPon({ hand: pad([num(5), num(5), num(5)]), melds: [] }, num(5), 0, ME);
    // 손패: 일반5 1장 + 무관 패 10장 (11장 + 멜드 1개 = 14)
    expect(() => applyShouminkan(afterPon, red())).toThrow("지정한 패");
  });

  it("이미 카칸된 멜드는 재카칸할 수 없다", () => {
    const afterPon = applyPon({ hand: pad([num(7), num(7)]), melds: [] }, num(7), 0, ME);
    const s1: CallState = { hand: [...afterPon.hand.slice(1), num(7)], melds: afterPon.melds };
    const kan = applyShouminkan(s1, num(7)); // 손패 10장 + 멜드 1
    const s2: CallState = { hand: [...kan.hand, num(7)], melds: kan.melds }; // 11장 + 멜드 1 = 14
    expect(() => applyShouminkan(s2, num(7))).toThrow("펑");
  });
});

describe("안깡 멜드가 있는 상태에서의 부로", () => {
  const ankan: CalledMeld = { type: "ankan", tiles: [num(1), num(1), num(1), num(1)] };

  it("치: 멜드 순서 유지, 손패 10 → 8", () => {
    const state: CallState = { hand: pad([num(4), num(6)], 10), melds: [ankan] };
    const next = applyChi(state, num(5), KAMICHA, ME);
    expect(next.hand).toHaveLength(8);
    expect(next.melds.map((m) => m.type)).toEqual(["ankan", "chi"]);
    expect(isMenzen(next.melds)).toBe(false);
  });

  it("펑: 멜드 순서 유지, 손패 10 → 8", () => {
    const state: CallState = { hand: pad([num(9), num(9)], 10), melds: [ankan] };
    const next = applyPon(state, num(9), 0, ME);
    expect(next.hand).toHaveLength(8);
    expect(next.melds.map((m) => m.type)).toEqual(["ankan", "pon"]);
  });

  it("다이민깡: 멜드 순서 유지, 손패 10 → 7", () => {
    const state: CallState = { hand: pad([num(2), num(2), num(2)], 10), melds: [ankan] };
    const next = applyDaiminkan(state, num(2), 2, ME);
    expect(next.hand).toHaveLength(7);
    expect(next.melds.map((m) => m.type)).toEqual(["ankan", "daiminkan"]);
  });

  it("카칸: 안깡 뒤의 펑만 카칸으로 교체되고 순서 유지", () => {
    const afterPon = applyPon({ hand: pad([num(7), num(7)], 10), melds: [ankan] }, num(7), 0, ME);
    const state: CallState = { hand: [...afterPon.hand.slice(1), num(7)], melds: afterPon.melds }; // 8장 + 멜드 2
    const next = applyShouminkan(state, num(7));
    expect(next.hand).toHaveLength(7);
    expect(next.melds.map((m) => m.type)).toEqual(["ankan", "shouminkan"]);
    expect(canShouminkan(state.hand, state.melds)).toEqual([{ meldIndex: 1, tile: num(7) }]);
  });
});

describe("좌석 검증 (apply*)", () => {
  const chiState: CallState = { hand: pad([num(4), num(6)]), melds: [] };
  const ponState: CallState = { hand: pad([num(9), num(9)]), melds: [] };
  const kanState: CallState = { hand: pad([num(2), num(2), num(2)]), melds: [] };

  it("좌석 범위 밖(-1, 4)은 에러", () => {
    for (const bad of [-1, 4]) {
      expect(() => applyChi(chiState, num(5), bad, ME)).toThrow("0~3");
      expect(() => applyChi(chiState, num(5), KAMICHA, bad)).toThrow("0~3");
      expect(() => applyPon(ponState, num(9), bad, ME)).toThrow("0~3");
      expect(() => applyPon(ponState, num(9), 0, bad)).toThrow("0~3");
      expect(() => applyDaiminkan(kanState, num(2), bad, ME)).toThrow("0~3");
      expect(() => applyDaiminkan(kanState, num(2), 0, bad)).toThrow("0~3");
    }
  });

  it("자기 버림패 호출은 에러", () => {
    expect(() => applyChi(chiState, num(5), ME, ME)).toThrow("상가");
    expect(() => applyPon(ponState, num(9), ME, ME)).toThrow("자신");
    expect(() => applyDaiminkan(kanState, num(2), ME, ME)).toThrow("자신");
  });
});
