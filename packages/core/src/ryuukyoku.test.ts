import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import {
  abortiveDraw,
  calculateNotenPenalty,
  canDeclareKyuushuKyuuhai,
  countYaochuuKinds,
  isDealerRenchan,
  isSanchaHou,
  isSuuchaRiichi,
  isSuufonRenda,
  isSuukaikan,
  isTenpaiWithMelds,
  resolveExhaustiveDraw,
} from "./ryuukyoku.js";
import type { CalledMeld } from "./call.js";

type Rank = 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;
function num(rank: Rank, suit: "man" | "pin" | "sou" = "man"): Tile {
  return { kind: "number", suit, rank, isRedFive: false };
}
function wind(w: "east" | "south" | "west" | "north"): Tile {
  return { kind: "wind", wind: w };
}
function dragon(d: "white" | "green" | "red"): Tile {
  return { kind: "dragon", dragon: d };
}

// 123m 456m 789m 123p + 4p 단기 대기
const TENPAI: Tile[] = [
  num(1), num(2), num(3), num(4), num(5), num(6), num(7), num(8), num(9),
  num(1, "pin"), num(2, "pin"), num(3, "pin"), num(4, "pin"),
];
const NOTEN: Tile[] = [
  num(1), num(3), num(5), num(7), num(9), num(2, "pin"), num(4, "pin"), num(6, "pin"),
  num(8, "pin"), num(2, "sou"), num(4, "sou"), wind("east"), dragon("red"),
];

describe("노텐 벌부", () => {
  it("텐파이 1명: 수령 3000, 나머지 -1000", () => {
    expect(calculateNotenPenalty([true, false, false, false])).toEqual([3000, -1000, -1000, -1000]);
  });
  it("텐파이 2명: 수령 1500, 지불 -1500", () => {
    expect(calculateNotenPenalty([true, false, true, false])).toEqual([1500, -1500, 1500, -1500]);
  });
  it("텐파이 3명: 수령 1000, 지불 -3000", () => {
    expect(calculateNotenPenalty([true, true, false, true])).toEqual([1000, 1000, -3000, 1000]);
  });
  it("전원 텐파이/전원 노텐: 이동 없음", () => {
    expect(calculateNotenPenalty([true, true, true, true])).toEqual([0, 0, 0, 0]);
    expect(calculateNotenPenalty([false, false, false, false])).toEqual([0, 0, 0, 0]);
  });
  it("좌석 수가 4가 아니면 에러", () => {
    expect(() => calculateNotenPenalty([true])).toThrow();
  });
});

describe("텐파이 판정 / 황패평국", () => {
  it("13장 텐파이/노텐 판정", () => {
    expect(isTenpaiWithMelds(TENPAI)).toBe(true);
    expect(isTenpaiWithMelds(NOTEN)).toBe(false);
  });
  it("부로가 있는 텐파이", () => {
    const pon: CalledMeld = {
      type: "pon",
      tiles: [num(1), num(1), num(1)],
      calledTile: num(1),
      fromSeat: 1,
      from: "right",
    };
    // 멜드 1개 + 손패 10장: 456m 789m 123p + 4p 단기
    const hand = [
      num(4), num(5), num(6), num(7), num(8), num(9),
      num(1, "pin"), num(2, "pin"), num(3, "pin"), num(4, "pin"),
    ];
    expect(isTenpaiWithMelds(hand, [pon])).toBe(true);
  });
  it("장수가 맞지 않으면 에러", () => {
    expect(() => isTenpaiWithMelds(TENPAI.slice(0, 12))).toThrow();
  });
  it("친 텐파이면 렌짱, 노텐이면 아님", () => {
    const r1 = resolveExhaustiveDraw([TENPAI, NOTEN, NOTEN, NOTEN], 0);
    expect(r1.tenpai).toEqual([true, false, false, false]);
    expect(r1.scoreDeltas).toEqual([3000, -1000, -1000, -1000]);
    expect(r1.renchan).toBe(true);
    const r2 = resolveExhaustiveDraw([NOTEN, TENPAI, NOTEN, NOTEN], 0);
    expect(r2.renchan).toBe(false);
    expect(r2.scoreDeltas.reduce((a, b) => a + b, 0)).toBe(0);
  });
  it("isDealerRenchan", () => {
    expect(isDealerRenchan([false, true, false, false], 1)).toBe(true);
    expect(isDealerRenchan([false, true, false, false], 2)).toBe(false);
  });
});

describe("구종구패", () => {
  const nine: Tile[] = [
    num(1), num(9), num(1, "pin"), num(9, "pin"), num(1, "sou"), num(9, "sou"),
    wind("east"), wind("south"), dragon("red"), num(2), num(3), num(4), num(5), num(6),
  ];
  it("요구패 종류 수를 센다 (중복 제외)", () => {
    expect(countYaochuuKinds(nine)).toBe(9);
    expect(countYaochuuKinds([num(1), num(1), num(1)])).toBe(1);
  });
  it("9종 이상 + 첫 순 + 부로 없음이면 가능", () => {
    expect(canDeclareKyuushuKyuuhai(nine, true)).toBe(true);
  });
  it("8종이면 불가", () => {
    const eight = [...nine];
    eight[8] = num(2, "sou");
    expect(canDeclareKyuushuKyuuhai(eight, true)).toBe(false);
  });
  it("첫 순이 아니거나 부로가 있으면 불가", () => {
    expect(canDeclareKyuushuKyuuhai(nine, false)).toBe(false);
    const pon: CalledMeld = {
      type: "pon", tiles: [num(2), num(2), num(2)], calledTile: num(2), fromSeat: 1, from: "right",
    };
    expect(canDeclareKyuushuKyuuhai(nine, true, [pon])).toBe(false);
  });
  it("14장이 아니면 불가", () => {
    expect(canDeclareKyuushuKyuuhai(nine.slice(0, 13), true)).toBe(false);
  });
});

describe("사풍연타", () => {
  const e = wind("east");
  it("같은 풍패 4장, 부로 없음", () => {
    expect(isSuufonRenda([e, e, e, e], false)).toBe(true);
  });
  it("부로가 있으면 불가", () => {
    expect(isSuufonRenda([e, e, e, e], true)).toBe(false);
  });
  it("다른 풍패/삼원패/4장 미만이면 불가", () => {
    expect(isSuufonRenda([e, e, e, wind("west")], false)).toBe(false);
    const d = dragon("red");
    expect(isSuufonRenda([d, d, d, d], false)).toBe(false);
    expect(isSuufonRenda([e, e, e], false)).toBe(false);
  });
});

describe("사개깡", () => {
  it("서로 다른 사람이 합계 4깡이면 유국", () => {
    expect(isSuukaikan([0, 0, 0, 1])).toBe(true);
  });
  it("한 명이 4깡이면 유국 아님", () => {
    expect(isSuukaikan([2, 2, 2, 2])).toBe(false);
  });
  it("3깡 이하는 아님", () => {
    expect(isSuukaikan([0, 1, 2])).toBe(false);
  });
});

describe("사가리치 / 삼가화", () => {
  it("전원 리치면 유국", () => {
    expect(isSuuchaRiichi([true, true, true, true])).toBe(true);
    expect(isSuuchaRiichi([true, true, true, false])).toBe(false);
  });
  it("삼가화: 기본은 유국, allow 옵션이면 유국 아님", () => {
    expect(isSanchaHou(3)).toBe(true);
    expect(isSanchaHou(2)).toBe(false);
    expect(isSanchaHou(3, { tripleRon: "allow" })).toBe(false);
  });
});

describe("텐파이 판정 보강", () => {
  const KOKUSHI13: Tile[] = [
    num(1), num(9), num(1, "pin"), num(9, "pin"), num(1, "sou"), num(9, "sou"),
    wind("east"), wind("south"), wind("west"), wind("north"),
    dragon("white"), dragon("green"), dragon("red"),
  ];
  const ponOf = (n: Rank, from = 1): CalledMeld => ({
    type: "pon", tiles: [num(n), num(n), num(n)], calledTile: num(n), fromSeat: from, from: "right",
  });
  const kanOf = (n: Rank): CalledMeld => ({
    type: "ankan", tiles: [num(n), num(n), num(n), num(n)],
  });
  // 456m 789m 123p + 4p 단기 (10장)
  const TEN10: Tile[] = [
    num(4), num(5), num(6), num(7), num(8), num(9),
    num(1, "pin"), num(2, "pin"), num(3, "pin"), num(4, "pin"),
  ];

  it("국사무쌍 13면 대기는 텐파이", () => {
    expect(isTenpaiWithMelds(KOKUSHI13)).toBe(true);
  });
  it("국사무쌍 12종+1장 중복은 텐파이", () => {
    const hand = [...KOKUSHI13];
    hand[12] = num(1); // 중 -> 1m 중복
    expect(isTenpaiWithMelds(hand)).toBe(true);
  });
  it("국사 11종 이하 또는 비요구패가 섞이면 노텐", () => {
    const eleven = [...KOKUSHI13];
    eleven[11] = num(1);
    eleven[12] = num(1);
    expect(isTenpaiWithMelds(eleven)).toBe(false);
    const mixed = [...KOKUSHI13];
    mixed[12] = num(5);
    expect(isTenpaiWithMelds(mixed)).toBe(false);
  });
  it("치토이츠 텐파이 (부로 없음)", () => {
    const hand = [
      num(1), num(1), num(3), num(3), num(5), num(5), num(7), num(7),
      num(2, "pin"), num(2, "pin"), num(4, "pin"), num(4, "pin"), num(9, "sou"),
    ];
    expect(isTenpaiWithMelds(hand)).toBe(true);
  });
  it("깡 멜드가 있는 손패 (10장 + 깡 1개)", () => {
    expect(isTenpaiWithMelds(TEN10, [kanOf(1)])).toBe(true);
    expect(isTenpaiWithMelds(NOTEN.slice(0, 10), [kanOf(1)])).toBe(false);
  });
  it("치 멜드가 있는 손패", () => {
    const chi: CalledMeld = {
      type: "chi", tiles: [num(1), num(2), num(3)], calledTile: num(1), fromSeat: 3, from: "left",
    };
    expect(isTenpaiWithMelds(TEN10, [chi])).toBe(true);
  });
  it("멜드 2개 + 손패 7장", () => {
    // 7장: 456m 789m + 1p 단기
    const hand = [num(4), num(5), num(6), num(7), num(8), num(9), num(1, "pin")];
    expect(isTenpaiWithMelds(hand, [ponOf(2), ponOf(3)])).toBe(true);
  });
  it("적5 포함 손패도 동일하게 판정", () => {
    const red: Tile = { kind: "number", suit: "man", rank: 5, isRedFive: true };
    const hand = TEN10.map((t) => (t.kind === "number" && t.rank === 5 ? red : t));
    expect(isTenpaiWithMelds(hand, [ponOf(1)])).toBe(true);
    const full = TENPAI.map((t) => (t.kind === "number" && t.rank === 5 ? red : t));
    expect(isTenpaiWithMelds(full)).toBe(true);
  });
});

describe("황패평국 통합", () => {
  const pon: CalledMeld = {
    type: "pon", tiles: [num(1), num(1), num(1)], calledTile: num(1), fromSeat: 1, from: "right",
  };
  const TEN10: Tile[] = [
    num(4), num(5), num(6), num(7), num(8), num(9),
    num(1, "pin"), num(2, "pin"), num(3, "pin"), num(4, "pin"),
  ];
  it("meldsBySeat 경로: 부로 있는 텐파이 좌석 처리", () => {
    const r = resolveExhaustiveDraw([NOTEN, TEN10, NOTEN, NOTEN], 1, [[], [pon], [], []]);
    expect(r.tenpai).toEqual([false, true, false, false]);
    expect(r.scoreDeltas).toEqual([-1000, 3000, -1000, -1000]);
    expect(r.renchan).toBe(true);
  });
  it("텐파이 2명", () => {
    const r = resolveExhaustiveDraw([TENPAI, NOTEN, TEN10, NOTEN], 0, [[], [], [pon], []]);
    expect(r.tenpai).toEqual([true, false, true, false]);
    expect(r.scoreDeltas).toEqual([1500, -1500, 1500, -1500]);
    expect(r.renchan).toBe(true);
  });
  it("텐파이 3명", () => {
    const r = resolveExhaustiveDraw([TENPAI, TENPAI, NOTEN, TENPAI], 2, [[], [], [], []]);
    expect(r.tenpai).toEqual([true, true, false, true]);
    expect(r.scoreDeltas).toEqual([1000, 1000, -3000, 1000]);
    expect(r.renchan).toBe(false);
  });
  it("친이 0이 아닌 좌석: 렌짱/친 교대", () => {
    const stay = resolveExhaustiveDraw([NOTEN, NOTEN, NOTEN, TENPAI], 3);
    expect(stay.renchan).toBe(true);
    const rotate = resolveExhaustiveDraw([TENPAI, NOTEN, NOTEN, NOTEN], 3);
    expect(rotate.renchan).toBe(false);
  });
  it("국사 텐파이 좌석이 텐파이로 집계", () => {
    const kokushi: Tile[] = [
      num(1), num(9), num(1, "pin"), num(9, "pin"), num(1, "sou"), num(9, "sou"),
      wind("east"), wind("south"), wind("west"), wind("north"),
      dragon("white"), dragon("green"), dragon("red"),
    ];
    const r = resolveExhaustiveDraw([NOTEN, kokushi, NOTEN, NOTEN], 1);
    expect(r.tenpai[1]).toBe(true);
    expect(r.renchan).toBe(true);
  });
  it("입력 검증: 손패/부로 개수, 친 좌석", () => {
    expect(() => resolveExhaustiveDraw([TENPAI, TENPAI, TENPAI], 0)).toThrow();
    expect(() => resolveExhaustiveDraw([TENPAI, TENPAI, TENPAI, TENPAI], 0, [[], [], []])).toThrow();
    expect(() => resolveExhaustiveDraw([TENPAI, TENPAI, TENPAI, TENPAI], 4)).toThrow();
    expect(() => resolveExhaustiveDraw([TENPAI, TENPAI, TENPAI, TENPAI], -1)).toThrow();
    expect(() => resolveExhaustiveDraw([TENPAI, TENPAI, TENPAI, TENPAI], 1.5)).toThrow();
  });
});

describe("도중유국 경계값", () => {
  it("isSuukaikan 5회 이상은 항상 유국", () => {
    expect(isSuukaikan([0, 0, 0, 0, 0])).toBe(true);
    expect(isSuukaikan([1, 1, 1, 1, 2])).toBe(true);
  });
  it("사풍연타: 다른 풍패 섞임/빈 배열/5장 이상", () => {
    const e = wind("east");
    expect(isSuufonRenda([e, wind("south"), e, e], false)).toBe(false);
    expect(isSuufonRenda([], false)).toBe(false);
    expect(isSuufonRenda([e, e, e, e, e], false)).toBe(false);
  });
  it("isSanchaHou 비현실적 입력은 예외", () => {
    expect(() => isSanchaHou(4)).toThrow();
    expect(() => isSanchaHou(-1)).toThrow();
    expect(() => isSanchaHou(2.5)).toThrow();
    expect(isSanchaHou(0)).toBe(false);
  });
});

describe("유국 결과", () => {
  it("도중유국은 항상 렌짱", () => {
    expect(abortiveDraw("suukaikan")).toEqual({ type: "abortive", reason: "suukaikan", renchan: true });
  });
});
