import { describe, expect, it } from "vitest";
import type { Tile, Wind } from "./tiles.js";
import { detectYaku, hasAnyYaku, type WinContext } from "./yaku.js";

function num(rank: 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9, suit: "man" | "pin" | "sou" = "man"): Tile {
  return { kind: "number", suit, rank, isRedFive: false };
}
function wind(w: Wind): Tile {
  return { kind: "wind", wind: w };
}
function dragon(d: "white" | "green" | "red"): Tile {
  return { kind: "dragon", dragon: d };
}
function repeat(tile: Tile, n: number): Tile[] {
  return Array.from({ length: n }, () => tile);
}

function baseCtx(overrides: Partial<WinContext> & Pick<WinContext, "hand" | "winningTile">): WinContext {
  return {
    isConcealed: true,
    winType: "ron",
    isRiichi: false,
    seatWind: "south",
    roundWind: "east",
    ...overrides,
  };
}

function ids(ctx: WinContext): string[] {
  return detectYaku(ctx).map((y) => y.id);
}

// 모든 멘츠가 순자이고, 대자는 역패가 아니며, man4로 양짱 완성되는 핑후형 손패
const pinfuHand: Tile[] = [
  num(2, "man"), num(3, "man"), num(4, "man"),
  num(3, "pin"), num(4, "pin"), num(5, "pin"),
  num(5, "sou"), num(6, "sou"), num(7, "sou"),
  num(2, "sou"), num(3, "sou"), num(4, "sou"),
  num(8, "pin"), num(8, "pin"),
];

// 순자 3개 + 삼원패(백) 각자 + 대자로 이루어진, 역패(삼원패)가 있는 화료 손패
const dragonYakuhaiHand: Tile[] = [
  num(1, "man"), num(2, "man"), num(3, "man"),
  num(4, "pin"), num(5, "pin"), num(6, "pin"),
  num(7, "sou"), num(8, "sou"), num(9, "sou"),
  ...repeat(dragon("white"), 3),
  ...repeat(num(9, "man"), 2),
];

describe("detectYaku - 입력 검증", () => {
  it("hand가 14장이 아니면 에러를 던진다", () => {
    expect(() =>
      detectYaku(baseCtx({ hand: pinfuHand.slice(0, 13), winningTile: num(4, "man") })),
    ).toThrow();
  });

  it("화료 형태가 아닌 손패는 에러를 던진다", () => {
    const notAgari: Tile[] = [
      num(1, "man"), num(4, "man"), num(7, "man"),
      num(1, "pin"), num(4, "pin"), num(7, "pin"),
      num(1, "sou"), num(4, "sou"), num(7, "sou"),
      wind("east"), wind("south"), wind("west"), wind("north"),
      dragon("white"),
    ];
    expect(() => detectYaku(baseCtx({ hand: notAgari, winningTile: dragon("white") }))).toThrow();
  });

  it("winningTile이 hand에 포함되지 않은 패면 에러를 던진다", () => {
    // pinfuHand에는 dragon("red")가 전혀 없음 - 불변조건(winningTile ∈ hand) 위반
    expect(() => detectYaku(baseCtx({ hand: pinfuHand, winningTile: dragon("red") }))).toThrow();
  });
});

describe("리치", () => {
  it("리치를 선언하고 멘젠 상태로 화료하면 성립한다", () => {
    const ctx = baseCtx({ hand: pinfuHand, winningTile: num(4, "man"), isRiichi: true });
    expect(ids(ctx)).toContain("riichi");
  });

  it("리치 선언이 없으면 성립하지 않는다", () => {
    const ctx = baseCtx({ hand: pinfuHand, winningTile: num(4, "man"), isRiichi: false });
    expect(ids(ctx)).not.toContain("riichi");
  });

  it("리치 플래그가 있어도 멘젠이 아니면 성립하지 않는다", () => {
    const ctx = baseCtx({
      hand: pinfuHand,
      winningTile: num(4, "man"),
      isRiichi: true,
      isConcealed: false,
    });
    expect(ids(ctx)).not.toContain("riichi");
  });
});

describe("멘젠쯔모", () => {
  it("멘젠 상태로 츠모 화료하면 성립한다", () => {
    const ctx = baseCtx({ hand: pinfuHand, winningTile: num(4, "man"), winType: "tsumo" });
    expect(ids(ctx)).toContain("menzenTsumo");
  });

  it("론으로 화료하면 성립하지 않는다", () => {
    const ctx = baseCtx({ hand: pinfuHand, winningTile: num(4, "man"), winType: "ron" });
    expect(ids(ctx)).not.toContain("menzenTsumo");
  });

  it("멘젠이 아니면 츠모여도 성립하지 않는다", () => {
    const ctx = baseCtx({
      hand: pinfuHand,
      winningTile: num(4, "man"),
      winType: "tsumo",
      isConcealed: false,
    });
    expect(ids(ctx)).not.toContain("menzenTsumo");
  });
});

describe("핑후", () => {
  it("멘츠 전부 순자 + 역패 아닌 대자 + 양짱 대기면 성립한다", () => {
    const ctx = baseCtx({ hand: pinfuHand, winningTile: num(4, "man") });
    expect(ids(ctx)).toContain("pinfu");
  });

  it("대자가 삼원패면 성립하지 않는다", () => {
    const hand: Tile[] = [
      num(2, "man"), num(3, "man"), num(4, "man"),
      num(3, "pin"), num(4, "pin"), num(5, "pin"),
      num(5, "sou"), num(6, "sou"), num(7, "sou"),
      num(2, "sou"), num(3, "sou"), num(4, "sou"),
      ...repeat(dragon("white"), 2),
    ];
    const ctx = baseCtx({ hand, winningTile: num(4, "man") });
    expect(ids(ctx)).not.toContain("pinfu");
  });

  it("대자가 자풍/장풍에 해당하는 풍패면 성립하지 않는다", () => {
    const hand: Tile[] = [
      num(2, "man"), num(3, "man"), num(4, "man"),
      num(3, "pin"), num(4, "pin"), num(5, "pin"),
      num(5, "sou"), num(6, "sou"), num(7, "sou"),
      num(2, "sou"), num(3, "sou"), num(4, "sou"),
      ...repeat(wind("south"), 2), // 자풍(south)과 일치
    ];
    const ctx = baseCtx({ hand, winningTile: num(4, "man"), seatWind: "south", roundWind: "east" });
    expect(ids(ctx)).not.toContain("pinfu");
  });

  it("변짱(펜찬) 대기로 완성되면 성립하지 않는다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"), // 1-2-3, 3으로 완성 = 변짱
      num(3, "pin"), num(4, "pin"), num(5, "pin"),
      num(5, "sou"), num(6, "sou"), num(7, "sou"),
      num(2, "sou"), num(3, "sou"), num(4, "sou"),
      num(8, "pin"), num(8, "pin"),
    ];
    const ctx = baseCtx({ hand, winningTile: num(3, "man") });
    expect(ids(ctx)).not.toContain("pinfu");
  });

  it("간짱(칸찬) 대기로 완성되면 성립하지 않는다", () => {
    const ctx = baseCtx({ hand: pinfuHand, winningTile: num(4, "pin") }); // 3-4-5 가운데 완성
    expect(ids(ctx)).not.toContain("pinfu");
  });

  it("멘츠 중 각자(커츠)가 있으면 성립하지 않는다", () => {
    const ctx = baseCtx({ hand: dragonYakuhaiHand, winningTile: num(9, "man") });
    expect(ids(ctx)).not.toContain("pinfu");
  });

  it("멘젠이 아니면 나머지 조건을 만족해도 성립하지 않는다", () => {
    const ctx = baseCtx({ hand: pinfuHand, winningTile: num(4, "man"), isConcealed: false });
    expect(ids(ctx)).not.toContain("pinfu");
  });
});

describe("탕야오", () => {
  it("전부 2~8 숫자패면 성립한다", () => {
    const ctx = baseCtx({ hand: pinfuHand, winningTile: num(4, "man") });
    expect(ids(ctx)).toContain("tanyao");
  });

  it("단패(1/9)나 자패가 하나라도 있으면 성립하지 않는다", () => {
    const ctx = baseCtx({ hand: dragonYakuhaiHand, winningTile: num(9, "man") });
    expect(ids(ctx)).not.toContain("tanyao");
  });
});

describe("삼원패/자풍패/장풍패", () => {
  it("삼원패 각자가 있으면 yakuhaiDragon이 성립한다", () => {
    const ctx = baseCtx({ hand: dragonYakuhaiHand, winningTile: num(9, "man") });
    const matchedIds = ids(ctx);
    expect(matchedIds).toContain("yakuhaiDragon");
    expect(matchedIds).not.toContain("yakuhaiSeatWind");
    expect(matchedIds).not.toContain("yakuhaiRoundWind");
  });

  it("자풍과 일치하는 풍패 각자만 있으면 yakuhaiSeatWind만 성립한다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"), num(9, "sou"),
      ...repeat(wind("south"), 3),
      ...repeat(num(9, "man"), 2),
    ];
    const ctx = baseCtx({ hand, winningTile: num(9, "man"), seatWind: "south", roundWind: "east" });
    const matchedIds = ids(ctx);
    expect(matchedIds).toContain("yakuhaiSeatWind");
    expect(matchedIds).not.toContain("yakuhaiRoundWind");
    expect(matchedIds).not.toContain("yakuhaiDragon");
  });

  it("자풍과 장풍이 같은 풍패(더블 동)면 양쪽 모두 성립한다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"), num(9, "sou"),
      ...repeat(wind("east"), 3),
      ...repeat(num(9, "man"), 2),
    ];
    const ctx = baseCtx({ hand, winningTile: num(9, "man"), seatWind: "east", roundWind: "east" });
    const matchedIds = ids(ctx);
    expect(matchedIds).toContain("yakuhaiSeatWind");
    expect(matchedIds).toContain("yakuhaiRoundWind");
  });

  it("역패가 대자(2장)로만 있고 각자(3장)가 아니면 성립하지 않는다", () => {
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"), num(9, "sou"),
      num(2, "sou"), num(3, "sou"), num(4, "sou"),
      ...repeat(dragon("white"), 2), // 백을 2장(대자)만 보유 - 역패 미성립
    ];
    const ctx = baseCtx({ hand, winningTile: num(4, "sou") });
    const matchedIds = ids(ctx);
    expect(matchedIds).not.toContain("yakuhaiDragon");
    expect(matchedIds).not.toContain("yakuhaiSeatWind");
    expect(matchedIds).not.toContain("yakuhaiRoundWind");
  });
});

describe("이페코", () => {
  it("동일한 순자(같은 슈트, 같은 시작 숫자) 두 벌이 있으면 성립한다", () => {
    const hand: Tile[] = [
      ...repeat(num(2, "man"), 1), num(3, "man"), num(4, "man"),
      num(2, "man"), num(3, "man"), num(4, "man"),
      num(5, "sou"), num(6, "sou"), num(7, "sou"),
      num(3, "pin"), num(4, "pin"), num(5, "pin"),
      ...repeat(num(9, "sou"), 2),
    ];
    const ctx = baseCtx({ hand, winningTile: num(9, "sou") });
    expect(ids(ctx)).toContain("iipeikou");
  });

  it("동일한 순자 두 벌이 없으면 성립하지 않는다", () => {
    const ctx = baseCtx({ hand: pinfuHand, winningTile: num(4, "man") });
    expect(ids(ctx)).not.toContain("iipeikou");
  });

  it("멘젠이 아니면 성립하지 않는다", () => {
    const hand: Tile[] = [
      num(2, "man"), num(3, "man"), num(4, "man"),
      num(2, "man"), num(3, "man"), num(4, "man"),
      num(5, "sou"), num(6, "sou"), num(7, "sou"),
      num(3, "pin"), num(4, "pin"), num(5, "pin"),
      ...repeat(num(9, "sou"), 2),
    ];
    const ctx = baseCtx({ hand, winningTile: num(9, "sou"), isConcealed: false });
    expect(ids(ctx)).not.toContain("iipeikou");
  });
});

describe("또이또이 (모든 멘츠가 각자)", () => {
  it("멘츠 4개가 전부 각자면 성립한다", () => {
    const hand: Tile[] = [
      ...repeat(num(1, "man"), 3),
      ...repeat(num(5, "pin"), 3),
      ...repeat(num(9, "sou"), 3),
      ...repeat(wind("north"), 3),
      ...repeat(num(3, "man"), 2),
    ];
    // 론 1만으로 각자(샤보)를 완성: 안커는 3개뿐이라 스안커가 아니고 또이또이 + 산안커
    const ctx = baseCtx({
      hand,
      winningTile: num(1, "man"),
      seatWind: "east",
      roundWind: "east", // north 각자는 자풍/장풍과 무관하게 함
    });
    expect(ids(ctx)).toEqual(expect.arrayContaining(["toitoi", "sanankou"]));
  });

  it("멘츠 중 순자가 하나라도 있으면 성립하지 않는다", () => {
    const ctx = baseCtx({ hand: dragonYakuhaiHand, winningTile: num(9, "man") });
    expect(ids(ctx)).not.toContain("toitoi");
  });
});

describe("치또이쯔", () => {
  const chiitoitsuHand: Tile[] = [
    ...repeat(num(2, "man"), 2), ...repeat(num(4, "man"), 2), ...repeat(num(6, "pin"), 2),
    ...repeat(num(8, "pin"), 2), ...repeat(num(3, "sou"), 2), ...repeat(wind("east"), 2),
    ...repeat(dragon("red"), 2),
  ];

  it("치또이쯔 형태로 화료하면 성립한다", () => {
    const ctx = baseCtx({ hand: chiitoitsuHand, winningTile: dragon("red") });
    expect(ids(ctx)).toContain("chiitoitsu");
  });

  it("멘젠이 아니면 성립하지 않는다", () => {
    const ctx = baseCtx({ hand: chiitoitsuHand, winningTile: dragon("red"), isConcealed: false });
    expect(ids(ctx)).not.toContain("chiitoitsu");
  });

  it("전부 2~8 숫자패인 치또이쯔는 탕야오와 동시에 성립할 수 있다", () => {
    const allSimpleChiitoitsu: Tile[] = [
      ...repeat(num(2, "man"), 2), ...repeat(num(4, "man"), 2), ...repeat(num(6, "pin"), 2),
      ...repeat(num(8, "pin"), 2), ...repeat(num(3, "sou"), 2), ...repeat(num(5, "sou"), 2),
      ...repeat(num(7, "sou"), 2),
    ];
    const ctx = baseCtx({ hand: allSimpleChiitoitsu, winningTile: num(7, "sou") });
    const matchedIds = ids(ctx);
    expect(matchedIds).toContain("chiitoitsu");
    expect(matchedIds).toContain("tanyao");
  });
});

describe("hasAnyYaku", () => {
  it("역이 하나도 성립하지 않는 형식적 화료는 false를 반환한다 (역 없는 화료)", () => {
    // 오픈(멘젠 아님) + 론 + 리치 없음 + 단패 포함(탕야오 불가) + 역패 아닌 각자(man5) +
    // 이페코 없음 + 또이또이 아님(순자 섞임) + 치또이쯔 아님
    const hand: Tile[] = [
      num(1, "man"), num(2, "man"), num(3, "man"),
      num(4, "pin"), num(5, "pin"), num(6, "pin"),
      num(7, "sou"), num(8, "sou"), num(9, "sou"),
      ...repeat(num(5, "man"), 3),
      ...repeat(num(2, "sou"), 2),
    ];
    const ctx = baseCtx({
      hand,
      winningTile: num(9, "sou"),
      isConcealed: false,
      winType: "ron",
      isRiichi: false,
      seatWind: "south",
      roundWind: "west",
    });
    expect(hasAnyYaku(ctx)).toBe(false);
  });

  it("역이 하나라도 있으면 true를 반환한다", () => {
    const ctx = baseCtx({ hand: pinfuHand, winningTile: num(4, "man") });
    expect(hasAnyYaku(ctx)).toBe(true);
  });
});
