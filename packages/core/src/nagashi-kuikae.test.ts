/**
 * 17-2: 유국만관(나가시만관)과 쿠이가에시.
 * 기대값은 규칙에서 손으로 계산한다 (구현 출력을 베끼지 않음).
 */
import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import { isSameTileType } from "./tiles.js";
import type { CalledMeld } from "./call.js";
import type { Action, GameState } from "./game.js";
import { IllegalActionError, createGame, dispatch, legalActions, startNextRound } from "./game.js";
import { calculateNagashiManganDeltas, isNagashiMangan, resolveExhaustiveDraw } from "./ryuukyoku.js";
import { decideAction } from "./bot.js";

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HONORS: Tile[] = [
  { kind: "wind", wind: "east" },
  { kind: "wind", wind: "south" },
  { kind: "wind", wind: "west" },
  { kind: "wind", wind: "north" },
  { kind: "dragon", dragon: "white" },
  { kind: "dragon", dragon: "green" },
  { kind: "dragon", dragon: "red" },
];

/** "123m456p0s1z" 표기법 (0 = 적5, z: 1~4 동남서북, 5~7 백발중) */
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
      else {
        const suit = ch === "m" ? "man" : ch === "p" ? "pin" : "sou";
        out.push({ kind: "number", suit, rank: (d === "0" ? 5 : Number(d)) as 1, isRedFive: d === "0" });
      }
    }
    digits = [];
  }
  return out;
}

const JUNK = "1379m1379p1379s2z"; // 13장, 텐파이/부로/화료 없음
const TENPAI_5P = "234m567m234p678s5p"; // 5p 단기 (13장)
const DEAD = "5s6s7s8s" + "7z".repeat(10);

interface BuildOptions {
  drawn?: string;
  live?: string;
  melds?: Record<number, CalledMeld[]>;
  /** 좌석별 기존 버림패 표기 (calledBy는 아래 called로 지정) */
  discards?: Record<number, string>;
  called?: Record<number, number[]>;
  patch?: Partial<GameState>;
}

/** 친(좌석 0)의 턴 상태. hands[0]에 drawn을 붙여 14장으로 만든다. */
function build(hands: string[], opts: BuildOptions = {}): GameState {
  const base = createGame(seeded(1));
  const drawn = opts.drawn ? T(opts.drawn)[0]! : null;
  return {
    ...base,
    players: base.players.map((p, i) => ({
      hand: i === 0 && drawn ? [...T(hands[0]!), drawn] : T(hands[i]!),
      melds: opts.melds?.[i] ?? [],
      discards: T(opts.discards?.[i] ?? "").map((tile, k) => ({
        tile,
        riichi: false,
        tsumogiri: false,
        calledBy: opts.called?.[i]?.[k] ?? null,
      })),
      riichi: false,
    })),
    liveWall: T(opts.live ?? "2z".repeat(5)),
    deadWall: T(DEAD),
    doraCount: 1,
    drawnTile: drawn,
    turn: 0,
    anyCalls: true,
    ...opts.patch,
  };
}

const discardOf = (state: GameState, seat: number, notation: string): GameState =>
  dispatch(state, { type: "discard", seat, tile: T(notation)[0]! });

const sum = (xs: readonly number[]) => xs.reduce((a, b) => a + b, 0);

// ---------------------------------------------------------------------------
// 유국만관
// ---------------------------------------------------------------------------

describe("isNagashiMangan (순수 판정)", () => {
  const d = (n: string, calledBy: number | null = null) => ({ tile: T(n)[0]!, calledBy });

  it("모든 버림패가 요구패이고 부로되지 않으면 성립 (리치/츠모기리 무관)", () => {
    expect(isNagashiMangan([d("1m"), d("9p"), d("1s"), d("1z"), d("7z")])).toBe(true);
  });
  it("수패 2~8이 한 장이라도 있으면 불성립", () => {
    expect(isNagashiMangan([d("1m"), d("2m"), d("9s")])).toBe(false);
    expect(isNagashiMangan([d("9s"), d("0p")])).toBe(false); // 적5도 수패
  });
  it("한 장이라도 부로되면 불성립", () => {
    expect(isNagashiMangan([d("1m"), d("9p", 2), d("1z")])).toBe(false);
  });
  it("버림패가 0장이면 불성립", () => {
    expect(isNagashiMangan([])).toBe(false);
  });
});

describe("calculateNagashiManganDeltas", () => {
  it("친 달성: 각자 4000, 합계 +12000", () => {
    expect(calculateNagashiManganDeltas([0], 0)).toEqual([12000, -4000, -4000, -4000]);
  });
  it("자 달성: 친 4000 + 나머지 각 2000, 합계 +8000", () => {
    expect(calculateNagashiManganDeltas([2], 0)).toEqual([-4000, -2000, 8000, -2000]);
    // 친이 1이면 좌석 3 달성자는 친(1)에게 4000, 좌석 0/2에게 2000씩
    expect(calculateNagashiManganDeltas([3], 1)).toEqual([-2000, -4000, -2000, 8000]);
  });
  it("여러 명이 달성하면 각각 따로 정산해 합산 (자 1, 2 / 친 0)", () => {
    // 좌석1: 0 -4000, 2 -2000, 3 -2000 / 좌석2: 0 -4000, 1 -2000, 3 -2000
    expect(calculateNagashiManganDeltas([1, 2], 0)).toEqual([-8000, 6000, 6000, -4000]);
  });
  it("친 포함 여러 명 달성: 친(0) + 자(1)", () => {
    // 좌석0: 1,2,3 각 -4000 -> +12000 / 좌석1: 0 -4000, 2 -2000, 3 -2000 -> +8000
    expect(calculateNagashiManganDeltas([0, 1], 0)).toEqual([8000, 4000, -6000, -6000]);
  });
});

describe("resolveExhaustiveDraw + 유국만관", () => {
  const hands = [T(TENPAI_5P), T(JUNK), T(JUNK), T(JUNK)];
  const entry = (n: string) => T(n).map((tile) => ({ tile, calledBy: null }));

  it("달성자가 없으면 기존 결과와 같고 nagashiMangan 필드가 없다", () => {
    const r = resolveExhaustiveDraw(hands, 0, undefined, [entry("1m5m"), [], [], []]);
    expect(r.scoreDeltas).toEqual([3000, -1000, -1000, -1000]);
    expect("nagashiMangan" in r).toBe(false);
  });
  it("달성자가 있으면 노텐 벌부를 정산하지 않는다 (친 텐파이라도)", () => {
    const r = resolveExhaustiveDraw(hands, 0, undefined, [entry("5m"), entry("1m9s"), [], []]);
    expect(r.nagashiMangan).toEqual([1]);
    expect(r.scoreDeltas).toEqual([-4000, 8000, -2000, -2000]);
    expect(r.renchan).toBe(true); // 친 텐파이
  });
});

describe("유국만관 dispatch 경로", () => {
  it("친 달성 + 친 노텐: 12000 수령, 노텐 벌부 없음, 친 교대, 본장 +1, 리치봉 이월", () => {
    // 좌석 1이 텐파이(5p 단기)여도 벌부는 없다. 좌석 0의 버림패는 모두 요구패(1m, 9p + 마지막 1z).
    const s = build([JUNK, TENPAI_5P, JUNK, JUNK], {
      drawn: "1z",
      live: "",
      discards: { 0: "1m9p" },
      patch: { riichiSticks: 2 },
    });
    const done = discardOf(s, 0, "1z");
    expect(done.phase).toBe("roundEnd");
    expect(done.result!.type).toBe("exhaustive");
    expect(done.result!.nagashiMangan).toEqual([0]);
    expect(done.result!.deltas).toEqual([12000, -4000, -4000, -4000]);
    expect(done.scores).toEqual([37000, 21000, 21000, 21000]);
    expect(sum(done.scores) + 1000 * done.riichiSticks).toBe(100000 + 2000);
    expect(done.result!.dealerContinues).toBe(false); // 친 노텐
    const next = startNextRound(done, seeded(3));
    expect([next.dealer, next.honba, next.kyoku, next.riichiSticks]).toEqual([1, 1, 2, 2]);
  });

  it("자 달성 + 친 텐파이: 친 4000 + 각 2000, 렌짱(본장 +1)", () => {
    const s = build([TENPAI_5P, JUNK, JUNK, JUNK], {
      drawn: "6z",
      live: "",
      discards: { 0: "5m", 1: "9m1z7z" },
    });
    const done = discardOf(s, 0, "6z");
    // 좌석 0의 버림패(5m 포함)는 불성립, 좌석 1(9m 1z 7z)만 달성
    expect(done.result!.nagashiMangan).toEqual([1]);
    expect(done.result!.deltas).toEqual([-4000, 8000, -2000, -2000]);
    expect(done.result!.dealerContinues).toBe(true); // 친 텐파이
    expect(sum(done.scores)).toBe(100000);
    const next = startNextRound(done, seeded(3));
    expect([next.dealer, next.honba, next.kyoku]).toEqual([0, 1, 1]);
  });

  it("여러 명 동시 달성: 각각 따로 정산 (좌석 1, 2 / 친 0 노텐)", () => {
    const s = build([JUNK, JUNK, JUNK, JUNK], {
      drawn: "2z",
      live: "",
      discards: { 0: "5p", 1: "1m9m", 2: "7z1s" },
    });
    const done = discardOf(s, 0, "2z");
    expect(done.result!.nagashiMangan).toEqual([1, 2]);
    expect(done.result!.deltas).toEqual([-8000, 6000, 6000, -4000]);
    expect(sum(done.result!.deltas)).toBe(0);
  });

  it("한 장이라도 부로된 좌석은 불성립 -> 노텐 벌부가 그대로 적용된다", () => {
    // 좌석 1의 버림패 1z 가 좌석 2에게 부로됨. 친 텐파이, 나머지 노텐.
    const s = build([TENPAI_5P, JUNK, JUNK, JUNK], {
      drawn: "6z",
      live: "",
      discards: { 0: "5m", 1: "1m1z" },
    });
    const players = s.players.map((p, i) =>
      i === 1 ? { ...p, discards: p.discards.map((d, k) => (k === 1 ? { ...d, calledBy: 2 } : d)) } : p,
    );
    const done = discardOf({ ...s, players }, 0, "6z");
    expect(done.result!.nagashiMangan).toBeUndefined();
    expect(done.result!.deltas).toEqual([3000, -1000, -1000, -1000]);
  });

  it("버림패 0장 좌석은 해당 없음 (좌석 0의 마지막 버림 1장만 요구패면 좌석 0만 달성)", () => {
    const s = build([JUNK, JUNK, JUNK, JUNK], { drawn: "1z", live: "" });
    const done = discardOf(s, 0, "1z");
    expect(done.result!.nagashiMangan).toEqual([0]); // 버림 0장인 1, 2, 3은 제외
    expect(done.result!.deltas).toEqual([12000, -4000, -4000, -4000]);
  });

  it("도중유국에는 적용하지 않는다 (구종구패)", () => {
    const s = build(["19m19p19s1234567z", JUNK, JUNK, JUNK], {
      drawn: "7z",
      patch: { anyCalls: false },
      discards: { 1: "1m" },
    });
    const done = dispatch(s, { type: "kyuushu", seat: 0 });
    expect(done.result!.type).toBe("abortive");
    expect(done.result!.nagashiMangan).toBeUndefined();
    expect(done.result!.deltas).toEqual([0, 0, 0, 0]);
  });

  it("실제 펑을 거친 흐름: 부로된 좌석 0은 불성립, 좌석 3만 달성 (자 달성, 친 노텐)", () => {
    // 좌석 0이 9m 을 버리고 좌석 2가 펑, 좌석 2가 3m 을 버리고(수패라 불성립) 좌석 3이 마지막 산패 4z 를 뽑아 버림
    const s = build([JUNK, JUNK, "99m1357m1357p135s", JUNK], { drawn: "9m", live: "4z" });
    let st = discardOf(s, 0, "9m");
    const pon = legalActions(st, 2).find((a) => a.type === "pon")!;
    st = dispatch(st, pon);
    expect(st.phase).toBe("turn");
    expect(st.turn).toBe(2);
    st = discardOf(st, 2, "3m");
    expect(st.turn).toBe(3);
    st = discardOf(st, 3, "4z");
    expect(st.result!.type).toBe("exhaustive");
    expect(st.players[0]!.discards[0]!.calledBy).toBe(2);
    expect(st.result!.nagashiMangan).toEqual([3]);
    expect(st.result!.deltas).toEqual([-4000, -2000, -2000, 8000]);
    expect(sum(st.scores)).toBe(100000);
  });
});

// ---------------------------------------------------------------------------
// 쿠이가에시
// ---------------------------------------------------------------------------

const FILL = "1379p1379s2z"; // 9장

const useKey = (use: readonly Tile[]): string =>
  use
    .map((t) => (t.kind === "number" ? `${t.rank}${t.isRedFive ? "r" : ""}` : "h"))
    .sort()
    .join();

/** 좌석 0이 drawn을 버리고 부로 좌석이 지정한 부로를 한 직후의 상태 */
function afterCall(
  hand: string,
  drawn: string,
  kind: "chi" | "pon",
  usePick: string,
  opts: { melds?: CalledMeld[] } = {},
): GameState {
  const callSeat = kind === "chi" ? 1 : 2;
  const hands = [JUNK, JUNK, JUNK, JUNK];
  hands[callSeat] = hand;
  const s = build(hands, { drawn, melds: opts.melds ? { [callSeat]: opts.melds } : undefined });
  const st = discardOf(s, 0, drawn);
  const want = useKey(T(usePick));
  const action = legalActions(st, callSeat).find((a) => (a.type === "chi" || a.type === "pon") && a.type === kind && useKey(a.use) === want);
  if (!action) throw new Error("원하는 부로 선택지가 없음");
  const done = dispatch(st, action);
  expect(done.phase).toBe("turn");
  expect(done.turn).toBe(callSeat);
  return done;
}

const discardTiles = (state: GameState, seat: number): Tile[] =>
  legalActions(state, seat).flatMap((a) => (a.type === "discard" ? [a.tile] : []));
const canDiscard = (state: GameState, seat: number, n: string): boolean =>
  discardTiles(state, seat).some((t) => isSameTileType(t, T(n)[0]!));

const ponMelds = (names: string[], fromSeat: number): CalledMeld[] =>
  names.map((n) => {
    const t = T(n)[0]!;
    return { type: "pon", tiles: [t, t, t], calledTile: t, fromSeat, from: "across" } as CalledMeld;
  });

describe("쿠이가에시: 펑", () => {
  it("펑 직후 같은 종류는 금지 상태로 기록되고 다른 패는 가능", () => {
    const st = afterCall("55m77m" + FILL, "5m", "pon", "55m");
    expect(st.kuikae).toEqual(T("5m"));
    expect(canDiscard(st, 2, "7m")).toBe(true);
  });

  it("손패에 같은 종류(적5)가 남으면 합법 행동에서 빠지고 dispatch가 거부한다", () => {
    // 좌석 2: 5m 5m 0m(적) + 채움. 5m 버림 -> 일반 5m 두 장으로 펑하면 적5가 남는다
    const st = afterCall("550m" + FILL + "1m", "5m", "pon", "55m");
    expect(st.players[2]!.hand.some((t) => t.kind === "number" && t.isRedFive)).toBe(true);
    expect(canDiscard(st, 2, "5m")).toBe(false);
    expect(canDiscard(st, 2, "0m")).toBe(false);
    expect(canDiscard(st, 2, "1m")).toBe(true);
    expect(() => discardOf(st, 2, "0m")).toThrow(IllegalActionError);
    expect(() => discardOf(st, 2, "5m")).toThrow(IllegalActionError);
  });

  it("금지는 첫 타패에만 적용되고 타패 후 해제된다", () => {
    const st = afterCall("550m" + FILL + "1m", "5m", "pon", "55m");
    expect(discardOf(st, 2, "1m").kuikae).toEqual([]);
  });

  it("모든 패가 금지 대상이면 금지를 푼다 (멜드 3개 + 5m 4장에서 펑)", () => {
    const st = afterCall("5555m", "5m", "pon", "55m", { melds: ponMelds(["1p", "9p", "9s"], 1) });
    expect(st.players[2]!.hand).toHaveLength(2);
    expect(st.kuikae).toEqual([]);
    expect(canDiscard(st, 2, "5m")).toBe(true);
  });
});

describe("쿠이가에시: 치", () => {
  it("3m을 4m5m으로 치: 3m 과 6m 금지", () => {
    const st = afterCall("45m36m" + FILL, "3m", "chi", "45m");
    expect(st.kuikae).toEqual(T("3m6m"));
    expect(canDiscard(st, 1, "3m")).toBe(false);
    expect(canDiscard(st, 1, "6m")).toBe(false);
    expect(canDiscard(st, 1, "1p")).toBe(true);
    expect(() => discardOf(st, 1, "6m")).toThrow(IllegalActionError);
  });

  it("5m(적5)을 3m4m으로 치: 5m 과 2m 금지", () => {
    const st = afterCall("34m2m5m" + FILL, "0m", "chi", "34m");
    expect(st.kuikae).toEqual(T("5m2m"));
    expect(canDiscard(st, 1, "2m")).toBe(false);
    expect(canDiscard(st, 1, "5m")).toBe(false);
    expect(canDiscard(st, 1, "1p")).toBe(true);
  });

  it("간짱(4m을 3m5m으로 치): 4m만 금지, 6m 은 가능", () => {
    const st = afterCall("35m46m" + FILL, "4m", "chi", "35m");
    expect(st.kuikae).toEqual(T("4m"));
    expect(canDiscard(st, 1, "4m")).toBe(false);
    expect(canDiscard(st, 1, "6m")).toBe(true);
  });

  it("경계: 1m2m으로 3m 치 -> 3m만 금지 (0m 없음), 4m 은 가능", () => {
    const st = afterCall("12m47m" + FILL, "3m", "chi", "12m");
    expect(st.kuikae).toEqual(T("3m"));
    expect(canDiscard(st, 1, "4m")).toBe(true);
  });

  it("경계: 8m9m으로 7m 치 -> 7m만 금지 (10m 없음)", () => {
    const st = afterCall("89m71m5m" + "1379p1379s", "7m", "chi", "89m");
    expect(st.kuikae).toEqual(T("7m"));
    expect(canDiscard(st, 1, "7m")).toBe(false);
    expect(canDiscard(st, 1, "5m")).toBe(true);
  });

  it("7m8m으로 9m 치 -> 9m 과 6m 금지", () => {
    const st = afterCall("78m6m" + FILL + "7z", "9m", "chi", "78m");
    expect(st.kuikae).toEqual(T("9m6m"));
  });

  it("2m3m으로 1m 치 -> 1m 과 4m 금지", () => {
    const st = afterCall("23m4m" + FILL + "7z", "1m", "chi", "23m");
    expect(st.kuikae).toEqual(T("1m4m"));
  });

  it("모든 패가 금지 대상이면 금지를 푼다 (멜드 3개, 손패 3m4m5m6m 에서 3m 치)", () => {
    const st = afterCall("3456m", "3m", "chi", "45m", { melds: ponMelds(["1p", "9p", "9s"], 2) });
    // 손패에 3m 과 6m 만 남고 둘 다 금지 대상 -> 해제
    expect(st.players[1]!.hand).toHaveLength(2);
    expect(st.kuikae).toEqual([]);
    expect(canDiscard(st, 1, "3m")).toBe(true);
    expect(canDiscard(st, 1, "6m")).toBe(true);
  });
});

describe("쿠이가에시: 일관성/봇/대명깡", () => {
  const key = (a: Action) => JSON.stringify(a);

  it("봇은 합법 행동만 고르고 금지 패를 버리지 않는다", () => {
    const st = afterCall("45m36m" + FILL, "3m", "chi", "45m");
    for (let i = 0; i < 20; i++) {
      const a = decideAction(st, 1, seeded(i));
      expect(legalActions(st, 1).map(key)).toContain(key(a));
      if (a.type === "discard") expect(isSameTileType(a.tile, T("3m")[0]!)).toBe(false);
    }
  });

  it("legalActions 의 모든 타패는 dispatch 에 성공한다", () => {
    const st = afterCall("45m36m" + FILL, "3m", "chi", "45m");
    for (const a of legalActions(st, 1)) expect(() => dispatch(st, a)).not.toThrow();
  });

  it("대명깡에는 쿠이가에시가 없다", () => {
    const hands = [JUNK, JUNK, "999m" + FILL + "1z", JUNK];
    const s = build(hands, { drawn: "9m" });
    let st = discardOf(s, 0, "9m");
    const kan = legalActions(st, 2).find((a) => a.type === "daiminkan")!;
    st = dispatch(st, kan);
    expect(st.kuikae).toEqual([]);
    expect(st.drawnTile).not.toBeNull(); // 영상패를 뽑음
  });

  it("금지 상태는 JSON 직렬화 가능하다", () => {
    const st = afterCall("45m36m" + FILL, "3m", "chi", "45m");
    expect(JSON.parse(JSON.stringify(st.kuikae))).toEqual(st.kuikae);
  });
});
