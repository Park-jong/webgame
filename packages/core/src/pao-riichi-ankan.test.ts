/**
 * 패오(책임지불)와 리치 후 안깡의 동작 테스트. 기대값은 규칙에서 손으로 계산한다.
 */
import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import type { CalledMeld } from "./call.js";
import type { GameState } from "./game.js";
import { createGame, dispatch, legalActions } from "./game.js";
import { findPao, paoLiability } from "./pao.js";

const HONORS: Tile[] = [
  { kind: "wind", wind: "east" },
  { kind: "wind", wind: "south" },
  { kind: "wind", wind: "west" },
  { kind: "wind", wind: "north" },
  { kind: "dragon", dragon: "white" },
  { kind: "dragon", dragon: "green" },
  { kind: "dragon", dragon: "red" },
];

/** "123m456p5s1z" 표기법 파서 (z: 1~4 동남서북, 5~7 백발중) */
function T(notation: string): Tile[] {
  const out: Tile[] = [];
  let digits: string[] = [];
  for (const ch of notation) {
    if (/[0-9]/.test(ch)) {
      digits.push(ch);
      continue;
    }
    for (const d of digits) {
      if (ch === "z") out.push(HONORS[Number(d) - 1]!);
      else out.push({ kind: "number", suit: ch === "m" ? "man" : ch === "p" ? "pin" : "sou", rank: Number(d) as 1, isRedFive: false });
    }
    digits = [];
  }
  return out;
}

const ponOf = (notation: string, fromSeat: number, from: "left" | "across" | "right"): CalledMeld => {
  const t = T(notation)[0]!;
  return { type: "pon", tiles: [t, t, t], calledTile: t, fromSeat, from };
};
const ankanOf = (notation: string): CalledMeld => {
  const t = T(notation)[0]!;
  return { type: "ankan", tiles: [t, t, t, t] };
};

const JUNK = "1379m1379p1379s2z"; // 13장, 텐파이/부로/화료 없음
const DEAD = "5s6s7s8s" + "3z".repeat(10); // 도라 표시패가 모두 3z(서) -> 도라는 북, 손패와 무관
const LIVE = "2z".repeat(5) + "3z".repeat(5) + "4z".repeat(5);

interface Setup {
  /** 행동할 좌석 */
  seat: number;
  /** 그 좌석의 손패(드로 전) */
  hand: string;
  drawn?: string;
  melds?: CalledMeld[];
  riichi?: boolean;
  patch?: Partial<GameState>;
}

/** 지정 좌석의 턴 상태. 나머지 좌석은 JUNK 손패. */
function build(s: Setup): GameState {
  const base = createGame(() => 0.5);
  const drawn = s.drawn ? T(s.drawn)[0]! : null;
  return {
    ...base,
    players: base.players.map((_, i) => ({
      hand: i === s.seat ? (drawn ? [...T(s.hand), drawn] : T(s.hand)) : T(JUNK),
      melds: i === s.seat ? (s.melds ?? []) : [],
      discards: [],
      riichi: i === s.seat ? (s.riichi ?? false) : false,
    })),
    liveWall: T(LIVE),
    deadWall: T(DEAD),
    doraCount: 1,
    drawnTile: drawn,
    turn: s.seat,
    anyCalls: true,
    ...s.patch,
  };
}

describe("findPao / paoLiability", () => {
  it("삼원패 3종 멜드를 완성한 펑의 출처가 대삼원 책임자다", () => {
    const melds = [ponOf("5z", 1, "left"), ponOf("6z", 2, "across"), ponOf("7z", 3, "right")];
    expect(findPao(melds)).toEqual({ dragon: 3, wind: null });
    expect(paoLiability(melds, ["daisangen", "toitoi"])).toEqual({ liable: 3, multiplier: 1 });
  });

  it("안깡으로 완성했거나 2종뿐이면 책임자가 없다", () => {
    expect(findPao([ponOf("5z", 1, "left"), ponOf("6z", 2, "across"), ankanOf("7z")]).dragon).toBeNull();
    expect(findPao([ponOf("5z", 1, "left"), ponOf("6z", 2, "across")]).dragon).toBeNull();
  });

  it("먼저 안깡한 멜드가 있어도 마지막에 가져온 펑이 책임자를 만든다", () => {
    expect(findPao([ankanOf("5z"), ponOf("6z", 1, "left"), ponOf("7z", 2, "across")]).dragon).toBe(2);
  });

  it("바람패 4종 멜드를 완성한 출처가 대사희 책임자이고 3종(소사희)은 책임자가 없다", () => {
    const three = [ponOf("1z", 1, "left"), ponOf("2z", 2, "across"), ponOf("3z", 3, "right")];
    expect(findPao(three).wind).toBeNull();
    const four = [...three, ponOf("4z", 2, "across")];
    expect(findPao(four).wind).toBe(2);
    expect(paoLiability(four, ["daisuushii"])).toEqual({ liable: 2, multiplier: 2 });
    expect(paoLiability(three, ["shousuushii"])).toBeNull();
  });

  it("책임 대상 역만이 성립하지 않았으면 책임이 없다", () => {
    const melds = [ponOf("5z", 1, "left"), ponOf("6z", 2, "across"), ponOf("7z", 3, "right")];
    expect(paoLiability(melds, ["toitoi"])).toBeNull();
  });
});

describe("패오 정산", () => {
  const DRAGON_MELDS = [ponOf("5z", 1, "left"), ponOf("6z", 2, "across"), ponOf("7z", 3, "right")];

  it("대삼원 친 츠모: 책임자(3)가 세 사람 몫 48000을 모두 낸다", () => {
    let s = build({ seat: 0, hand: "2m3m4m5p", drawn: "5p", melds: DRAGON_MELDS });
    s = dispatch(s, { type: "tsumo", seat: 0 });
    expect(s.result!.deltas).toEqual([48000, 0, 0, -48000]);
    expect(s.result!.wins[0]!.pao).toEqual({ liable: 3, amount: 48000 });
  });

  it("대삼원 자 츠모(2 본장): 책임자(3)가 친 16000 + 자 8000 x2 + 본장 600을 모두 낸다", () => {
    // 좌석 1은 자(친=0). 기본 32000 + 본장 2 x 300 = 32600
    let s = build({ seat: 1, hand: "2m3m4m5p", drawn: "5p", melds: DRAGON_MELDS, patch: { honba: 2 } });
    s = dispatch(s, { type: "tsumo", seat: 1 });
    expect(s.result!.deltas).toEqual([0, 32600, 0, -32600]);
  });

  it("대삼원 론: 책임자와 버린 사람이 역만 몫 32000의 절반씩, 본장은 버린 사람", () => {
    // 좌석 1이 5p 단기 대기. 좌석 2가 5p를 버리고 책임자는 3. 본장 1 -> 300
    let s = build({
      seat: 2,
      hand: JUNK,
      drawn: "5p",
      patch: { honba: 1 },
    });
    s = {
      ...s,
      players: s.players.map((p, i) => (i === 1 ? { ...p, hand: T("2m3m4m5p"), melds: DRAGON_MELDS } : p)),
    };
    s = dispatch(s, { type: "discard", seat: 2, tile: T("5p")[0]! });
    expect(s.phase).toBe("response");
    s = dispatch(s, { type: "ron", seat: 1 });
    expect(s.result!.deltas).toEqual([0, 32300, -16300, -16000]);
    expect(s.result!.wins[0]!.pao).toEqual({ liable: 3, amount: 16000 });
  });

  it("버린 사람이 곧 책임자이면 전액을 혼자 낸다", () => {
    let s = build({ seat: 3, hand: JUNK, drawn: "5p" });
    s = {
      ...s,
      players: s.players.map((p, i) => (i === 1 ? { ...p, hand: T("2m3m4m5p"), melds: DRAGON_MELDS } : p)),
    };
    s = dispatch(s, { type: "discard", seat: 3, tile: T("5p")[0]! });
    s = dispatch(s, { type: "ron", seat: 1 });
    expect(s.result!.deltas).toEqual([0, 32000, 0, -32000]);
  });

  it("대사희(더블 역만) 자 츠모: 책임자(3)가 64000을 낸다", () => {
    const winds = [ponOf("1z", 0, "right"), ponOf("2z", 1, "left"), ponOf("4z", 0, "across"), ponOf("3z", 3, "left")];
    // 좌석 2(서가)의 츠모. 4번째 바람(3z)을 좌석 3의 버림패에서 가져왔다
    let s = build({ seat: 2, hand: "5p", drawn: "5p", melds: winds });
    s = dispatch(s, { type: "tsumo", seat: 2 });
    expect(s.result!.deltas).toEqual([0, 0, 64000, -64000]);
    expect(s.result!.wins[0]!.pao).toEqual({ liable: 3, amount: 64000 });
  });

  it("안깡으로 삼원패를 완성했으면 책임지불 없이 보통 지불", () => {
    const melds = [ponOf("5z", 1, "left"), ponOf("6z", 2, "across"), ankanOf("7z")];
    let s = build({ seat: 0, hand: "2m3m4m5p", drawn: "5p", melds });
    s = dispatch(s, { type: "tsumo", seat: 0 });
    expect(s.result!.deltas).toEqual([48000, -16000, -16000, -16000]);
    expect(s.result!.wins[0]!.pao).toBeUndefined();
  });
});

describe("리치 후 안깡", () => {
  // 234m 567m 678s 555p + 1z 단기(대기 1z). 5p를 뽑으면 각자가 확정이라 대기가 변하지 않는다.
  const KEEP = "234m567m678s555p1z";
  // 234m 567m 678s 5556p (대기 4p/6p/7p). 5p를 뽑아 안깡하면 6p 단기로 대기가 변한다.
  const CHANGE = "234m567m678s5556p";

  it("대기가 변하지 않으면 뽑은 패로 안깡할 수 있고, 깡 후에도 리치가 유지된다", () => {
    let s = build({ seat: 0, hand: KEEP, drawn: "5p", riichi: true });
    const acts = legalActions(s, 0);
    expect(acts.filter((a) => a.type === "ankan")).toHaveLength(1);
    expect(acts.some((a) => a.type === "shouminkan")).toBe(false);
    s = dispatch(s, { type: "ankan", seat: 0, tile: T("5p")[0]! });
    expect(s.phase).toBe("turn");
    expect(s.players[0]!.melds.map((m) => m.type)).toEqual(["ankan"]);
    expect(s.players[0]!.riichi).toBe(true);
    expect(s.kanSeats).toEqual([0]);
    expect(s.doraCount).toBe(2);
    // 리치 중이므로 방금 뽑은 영상패만 버릴 수 있다
    const discards = legalActions(s, 0).filter((a) => a.type === "discard");
    expect(discards).toHaveLength(1);
  });

  it("대기가 변하면 안깡할 수 없다", () => {
    const s = build({ seat: 0, hand: CHANGE, drawn: "5p", riichi: true });
    expect(legalActions(s, 0).some((a) => a.type === "ankan")).toBe(false);
  });

  it("리치 전에는 같은 손패에서 안깡이 가능하다 (기존 동작 유지)", () => {
    const s = build({ seat: 0, hand: CHANGE, drawn: "5p", riichi: false });
    expect(legalActions(s, 0).some((a) => a.type === "ankan")).toBe(true);
  });

  it("뽑은 패가 4장째가 아니면 안깡할 수 없다", () => {
    // 5p 3장을 이미 쥐고 있고 뽑은 패는 다른 패
    const s = build({ seat: 0, hand: KEEP, drawn: "1z", riichi: true });
    expect(legalActions(s, 0).some((a) => a.type === "ankan")).toBe(false);
  });

  it("산패가 없으면 안깡할 수 없다", () => {
    const s = build({ seat: 0, hand: KEEP, drawn: "5p", riichi: true, patch: { liveWall: [] } });
    expect(legalActions(s, 0).some((a) => a.type === "ankan")).toBe(false);
  });
});
