/**
 * 상황 역(일발/더블리치/창깡/영상개화/해저로월/하저로어/천화/지화)의 실제 dispatch 경로 테스트.
 * 기대값은 규칙에서 손으로 계산한다 (각 테스트 주석 참고).
 */
import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import type { CalledMeld } from "./call.js";
import type { Action, GameState } from "./game.js";
import { IllegalActionError, awaitingSeats, createGame, dispatch, legalActions } from "./game.js";
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

/** "123m456p0s1z" 표기법 파서 (0 = 적5, z: 1~4 동남서북, 5~7 백발중) */
function T(notation: string): Tile[] {
  const out: Tile[] = [];
  let digits: string[] = [];
  for (const ch of notation) {
    if (/[0-9]/.test(ch)) {
      digits.push(ch);
      continue;
    }
    for (const d of digits) {
      if (ch === "z") {
        out.push(HONORS[Number(d) - 1]!);
      } else {
        const suit = ch === "m" ? "man" : ch === "p" ? "pin" : "sou";
        const rank = (d === "0" ? 5 : Number(d)) as 1;
        out.push({ kind: "number", suit, rank, isRedFive: d === "0" });
      }
    }
    digits = [];
  }
  return out;
}

const JUNK = "1379m1379p1379s2z"; // 13장, 텐파이/부로/화료 없음
/** 5p 단기 대기, 전부 중장패 (13장). 리치/츠모/탕야오가 붙는다. */
const TENPAI_5P = "234m567m234p678s5p";
/** 5s 간짱 대기, 전부 중장패 (13장): 234m 567m 234p 46s 55p. 론이면 탕야오 */
const WAIT_5S = "234m567m234p46s55p";
// 왕패: 영상패 4장(5s 6s 7s 8s) + 표시패/뒷표시패 전부 7z(중) -> 도라는 백(5z)
const DEAD = "5s6s7s8s" + "7z".repeat(10);
const PAD = "4z".repeat(6);

interface BuildOptions {
  drawn?: string;
  live?: string;
  melds?: Record<number, CalledMeld[]>;
  riichi?: number[];
  patch?: Partial<GameState>;
}

/**
 * 친(좌석 0)의 턴 상태. hands[0]에 drawn을 붙여 14장으로 만든다.
 * 기본은 anyCalls: true (첫 순이 아닌 상태 - 천화/더블리치가 끼지 않게). 첫 순 테스트는 patch로 anyCalls: false.
 */
function build(hands: string[], opts: BuildOptions = {}): GameState {
  const base = createGame(seeded(1));
  const drawn = opts.drawn ? T(opts.drawn)[0]! : null;
  return {
    ...base,
    players: base.players.map((p, i) => ({
      hand: i === 0 && drawn ? [...T(hands[0]!), drawn] : T(hands[i]!),
      melds: opts.melds?.[i] ?? [],
      discards: [],
      riichi: opts.riichi?.includes(i) ?? false,
    })),
    liveWall: T(opts.live ?? "2z".repeat(5) + "3z".repeat(5) + "4z".repeat(5)),
    deadWall: T(DEAD),
    doraCount: 1,
    drawnTile: drawn,
    turn: 0,
    anyCalls: true,
    ...opts.patch,
  };
}

function discard(state: GameState, seat: number, notation: string, riichi = false): GameState {
  const tile = T(notation)[0]!;
  return dispatch(state, riichi ? { type: "discard", seat, tile, riichi: true } : { type: "discard", seat, tile });
}

function act(state: GameState, seat: number, type: "ron" | "pass" | "tsumo" | "daiminkan"): GameState {
  return dispatch(state, { type, seat });
}

function ankan(state: GameState, seat: number, notation: string): GameState {
  return dispatch(state, { type: "ankan", seat, tile: T(notation)[0]! });
}

function shouminkan(state: GameState, seat: number, notation: string): GameState {
  return dispatch(state, { type: "shouminkan", seat, tile: T(notation)[0]! });
}

const ponOf = (notation: string, fromSeat: number, from: "left" | "across" | "right"): CalledMeld => {
  const t = T(notation)[0]!;
  return { type: "pon", tiles: [t, t, t], calledTile: t, fromSeat, from };
};

const types = (actions: Action[]): string[] => actions.map((a) => a.type);

const sorted = (ids: readonly string[]): string[] => [...ids].sort();

function win(state: GameState, index = 0) {
  const w = state.result!.wins[index]!;
  return { ...w, ids: w.score.yaku.map((y) => y.id) };
}

// ---------------------------------------------------------------------------
// 일발
// ---------------------------------------------------------------------------

describe("일발", () => {
  it("리치 직후 자신의 첫 츠모: 리치 + 일발 + 멘젠쯔모 + 탕야오 = 4판 30부, 친 츠모 3900 올", () => {
    let s = build([TENPAI_5P, JUNK, JUNK, JUNK], { drawn: "6z", live: "2z3z4z5p" + PAD });
    s = discard(s, 0, "6z", true);
    expect(s.ippatsu).toEqual([true, false, false, false]);
    expect(s.doubleRiichi[0]).toBe(false); // 부로/깡이 있었던 상태(anyCalls)이므로 일반 리치
    s = discard(s, 1, "2z");
    s = discard(s, 2, "3z");
    s = discard(s, 3, "4z");
    expect(s.turn).toBe(0);
    expect(s.ippatsu[0]).toBe(true);
    s = act(s, 0, "tsumo");
    const w = win(s);
    expect(w.ids).toEqual(["riichi", "ippatsu", "menzenTsumo", "tanyao"]);
    expect(w.score.han).toBe(4);
    expect(w.score.fu).toBe(30); // 20 + 츠모 2 + 단기 2 = 24 -> 30
    expect(w.score.basePoints).toBe(1920); // 30 x 2^6
    expect(w.score.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 3900 }); // 3840 -> 3900
    // 수령: 3900 x 3 + 리치봉 1개
    expect(s.result!.deltas).toEqual([12700, -3900, -3900, -3900]);
  });

  it("리치 후 자신의 다음 타패(한 바퀴)가 지나면 일발은 소멸한다: 리치 + 멘젠쯔모 + 탕야오 = 3판", () => {
    let s = build([TENPAI_5P, JUNK, JUNK, JUNK], { drawn: "6z", live: "2z3z4z6z2z3z4z5p" + PAD });
    s = discard(s, 0, "6z", true);
    s = discard(s, 1, "2z");
    s = discard(s, 2, "3z");
    s = discard(s, 3, "4z");
    expect(s.drawnTile).toEqual(T("6z")[0]);
    expect(types(legalActions(s, 0))).toEqual(["discard"]);
    s = discard(s, 0, "6z"); // 자신의 다음 타패
    expect(s.ippatsu[0]).toBe(false);
    s = discard(s, 1, "2z");
    s = discard(s, 2, "3z");
    s = discard(s, 3, "4z");
    s = act(s, 0, "tsumo");
    const w = win(s);
    expect(w.ids).toEqual(["riichi", "menzenTsumo", "tanyao"]);
    expect(w.score.han).toBe(3);
    // 3판 30부: 960 -> 친 츠모 올 1920 -> 2000
    expect(w.score.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 2000 });
  });

  it("리치 후 타인의 버림패에 론: 리치 + 일발 + 탕야오 = 3판 40부, 친 론 7700", () => {
    let s = build([TENPAI_5P, JUNK, JUNK, JUNK], { drawn: "6z", live: "5p" + PAD });
    s = discard(s, 0, "6z", true);
    s = discard(s, 1, "5p");
    expect(awaitingSeats(s)).toEqual([0]);
    s = act(s, 0, "ron");
    const w = win(s);
    expect(w.ids).toEqual(["riichi", "ippatsu", "tanyao"]);
    expect(w.score.fu).toBe(40); // 20 + 멘젠론 10 + 단기 2 = 32 -> 40
    expect(w.score.basePoints).toBe(1280); // 40 x 2^5
    expect(w.score.payment).toEqual({ type: "ron", fromDiscarder: 7700 }); // 1280 x 6 = 7680 -> 7700
    expect(s.result!.deltas).toEqual([7700 + 1000, -7700, 0, 0]);
  });

  it("다른 좌석의 펑이 나오면 일발이 소멸한다", () => {
    const seat2 = "1379m1379p139s33z";
    let s = build([TENPAI_5P, JUNK, seat2, JUNK], { drawn: "6z", live: "3z4z5p" + PAD });
    s = discard(s, 0, "6z", true);
    s = discard(s, 1, "3z");
    expect(awaitingSeats(s)).toEqual([2]);
    const pon = legalActions(s, 2).find((a) => a.type === "pon")!;
    s = dispatch(s, pon);
    expect(s.ippatsu).toEqual([false, false, false, false]);
    s = discard(s, 2, "1m");
    s = discard(s, 3, "4z");
    s = act(s, 0, "tsumo");
    expect(win(s).ids).toEqual(["riichi", "menzenTsumo", "tanyao"]);
  });

  it("다른 좌석의 안깡(창깡 응답 없음)도 일발을 소멸시킨다", () => {
    const hands1 = "1111m1379p1379s2z3z"; // 14장 (3z를 뽑은 상태)
    const s0 = build([TENPAI_5P, hands1, JUNK, JUNK], {
      riichi: [0],
      patch: { turn: 1, drawnTile: T("3z")[0]!, ippatsu: [true, false, false, false] },
    });
    const s = ankan(s0, 1, "1m");
    expect(s.phase).toBe("turn");
    expect(s.kanSeats).toEqual([1]);
    expect(s.ippatsu).toEqual([false, false, false, false]);
  });

  it("리치 선언 타패가 론되면 리치가 성립하지 않아 리치봉을 내지 않는다", () => {
    // 좌석 1은 백/발 샤보 대기: 66z 55z 에서 6z로 론 (삼원패 발)
    const seat1 = "123m456p789s66z55z";
    let s = build([TENPAI_5P, seat1, JUNK, JUNK], { drawn: "6z" });
    s = discard(s, 0, "6z", true);
    expect(awaitingSeats(s)).toEqual([1]);
    s = act(s, 1, "ron");
    const w = win(s);
    expect(w.seat).toBe(1);
    expect(w.ids).toEqual(["yakuhaiDragon"]); // 론한 쪽은 리치/일발 없음
    expect(s.riichiSticks).toBe(0);
    expect(s.scores.reduce((a, b) => a + b, 0)).toBe(100000);
    // 버린 사람은 론 점수만 지불하고 리치봉 1000점은 내지 않았다
    expect(s.scores[0]).toBe(25000 - w.score.total);
    expect(s.result!.deltas[0]).toBe(-w.score.total);
  });
});

// ---------------------------------------------------------------------------
// 더블리치
// ---------------------------------------------------------------------------

describe("더블리치", () => {
  it("부로/깡 없이 자신의 첫 타패로 리치하면 더블리치: 더블리치 + 일발 + 멘젠쯔모 + 탕야오 = 5판 만관, 친 츠모 4000 올", () => {
    let s = build([TENPAI_5P, JUNK, JUNK, JUNK], { drawn: "6z", live: "2z3z4z5p" + PAD, patch: { anyCalls: false } });
    s = discard(s, 0, "6z", true);
    expect(s.doubleRiichi).toEqual([true, false, false, false]);
    expect(s.ippatsu[0]).toBe(true); // 더블리치도 일발 성립
    s = discard(s, 1, "2z");
    s = discard(s, 2, "3z");
    s = discard(s, 3, "4z");
    s = act(s, 0, "tsumo");
    const w = win(s);
    expect(w.ids).toEqual(["doubleRiichi", "ippatsu", "menzenTsumo", "tanyao"]); // 리치는 부여하지 않음
    expect(w.score.han).toBe(5);
    expect(w.score.limit).toBe("mangan");
    expect(w.score.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 4000 });
    expect(s.result!.deltas).toEqual([12000 + 1000, -4000, -4000, -4000]);
  });

  it("자신의 두 번째 타패 리치는 일반 리치", () => {
    const base = build([TENPAI_5P, JUNK, JUNK, JUNK], { drawn: "6z", patch: { anyCalls: false } });
    const s0: GameState = {
      ...base,
      players: base.players.map((p, i) =>
        i === 0 ? { ...p, discards: [{ tile: T("7z")[0]!, riichi: false, tsumogiri: false, calledBy: null }] } : p,
      ),
    };
    const s = discard(s0, 0, "6z", true);
    expect(s.doubleRiichi[0]).toBe(false);
    expect(s.ippatsu[0]).toBe(true);
  });

  it("누군가 부로한 뒤의 첫 타패 리치는 일반 리치 (anyCalls)", () => {
    const s = discard(build([TENPAI_5P, JUNK, JUNK, JUNK], { drawn: "6z", patch: { anyCalls: true } }), 0, "6z", true);
    expect(s.doubleRiichi[0]).toBe(false);
  });

  it("친이 아닌 좌석도 자신의 첫 타패(부로/깡 없음)로 리치하면 더블리치", () => {
    const base = build([JUNK, TENPAI_5P + "6z", JUNK, JUNK], {
      patch: { turn: 1, drawnTile: T("6z")[0]!, anyCalls: false },
    });
    const s = discard(base, 1, "6z", true);
    expect(s.doubleRiichi).toEqual([false, true, false, false]);
    expect(s.ippatsu).toEqual([false, true, false, false]);
  });
});

// ---------------------------------------------------------------------------
// 해저로월 / 하저로어
// ---------------------------------------------------------------------------

describe("해저로월 / 하저로어", () => {
  it("마지막 산패를 뽑아 츠모: 멘젠쯔모 + 탕야오 + 해저로월 = 3판 30부, 친 올 2000", () => {
    // 좌석 3이 3z를 버리면 좌석 0이 마지막 산패 5p를 뽑는다
    let s = build([TENPAI_5P, JUNK, JUNK, JUNK + "3z"], {
      live: "5p",
      patch: { turn: 3, drawnTile: T("3z")[0]!, anyCalls: true },
    });
    s = discard(s, 3, "3z");
    expect(s.phase).toBe("turn");
    expect(s.liveWall).toHaveLength(0);
    s = act(s, 0, "tsumo");
    const w = win(s);
    expect(sorted(w.ids)).toEqual(sorted(["menzenTsumo", "tanyao", "haiteiRaoyue"]));
    expect(w.score.han).toBe(3);
    expect(w.score.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 2000 }); // 960 x 2 = 1920 -> 2000
  });

  it("산패가 남아 있으면 해저로월은 없다", () => {
    let s = build([TENPAI_5P, JUNK, JUNK, JUNK + "3z"], {
      live: "5p2z",
      patch: { turn: 3, drawnTile: T("3z")[0]!, anyCalls: true },
    });
    s = discard(s, 3, "3z");
    s = act(s, 0, "tsumo");
    expect(win(s).ids).toEqual(["menzenTsumo", "tanyao"]);
  });

  it("영상패로 츠모하면 산패가 0장이어도 해저로월이 아니다 (영상개화만)", () => {
    const s0 = build([TENPAI_5P, JUNK, JUNK, JUNK], {
      drawn: "5p",
      patch: { liveWall: [], rinshanDraw: true },
    });
    const s = act(s0, 0, "tsumo");
    expect(sorted(win(s).ids)).toEqual(sorted(["menzenTsumo", "tanyao", "rinshanKaihou"]));
  });

  it("마지막 산패를 뽑은 사람의 버림패에 론: 탕야오 + 하저로어 = 2판 40부, 코 론 2600", () => {
    let s = build([JUNK, TENPAI_5P, JUNK, JUNK], { drawn: "5p", live: "" });
    expect(s.liveWall).toHaveLength(0);
    s = discard(s, 0, "5p");
    expect(awaitingSeats(s)).toEqual([1]);
    s = act(s, 1, "ron");
    const w = win(s);
    expect(sorted(w.ids)).toEqual(sorted(["tanyao", "houteiRaoyui"]));
    expect(w.score.han).toBe(2);
    expect(w.score.fu).toBe(40);
    expect(w.score.payment).toEqual({ type: "ron", fromDiscarder: 2600 }); // 640 x 4 = 2560 -> 2600
  });

  it("산패가 남아 있는 버림패의 론에는 하저로어가 없다 (탕야오 1판 40부 = 1300)", () => {
    let s = build([JUNK, TENPAI_5P, JUNK, JUNK], { drawn: "5p", live: "2z" });
    s = discard(s, 0, "5p");
    s = act(s, 1, "ron");
    const w = win(s);
    expect(w.ids).toEqual(["tanyao"]);
    expect(w.score.payment).toEqual({ type: "ron", fromDiscarder: 1300 }); // 320 x 4 = 1280 -> 1300
  });
});

// ---------------------------------------------------------------------------
// 영상개화
// ---------------------------------------------------------------------------

describe("영상개화", () => {
  /** 1m 깡 후 5s(첫 영상패)로 완성: 234p 567p 456s + 99p 대자 (간짱 4s6s) */
  const KAN_HAND = "234p567p99p4s6s";

  it("안깡 후 영상패 츠모: 멘젠쯔모 + 영상개화 = 2판 60부, 친 올 2000", () => {
    let s = build(["111m" + KAN_HAND, JUNK, JUNK, JUNK], { drawn: "1m", patch: { anyCalls: false } });
    s = ankan(s, 0, "1m");
    expect(s.anyCalls).toBe(true);
    expect(s.rinshanDraw).toBe(true);
    expect(s.drawnTile).toEqual(T("5s")[0]);
    s = act(s, 0, "tsumo");
    const w = win(s);
    expect(w.ids).toEqual(["menzenTsumo", "rinshanKaihou"]);
    // 20 + 츠모 2 + 안깡 요구패 32 + 간짱 2 = 56 -> 60부, 2판: 60 x 16 = 960, 친 올 1920 -> 2000
    expect(w.score.fu).toBe(60);
    expect(w.score.basePoints).toBe(960);
    expect(w.score.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 2000 });
  });

  it("마지막 산패가 영상패로 빠져 산패가 0장이 돼도 해저로월은 붙지 않는다", () => {
    let s = build(["111m" + KAN_HAND, JUNK, JUNK, JUNK], { drawn: "1m", live: "2z" });
    s = ankan(s, 0, "1m");
    expect(s.liveWall).toHaveLength(0);
    s = act(s, 0, "tsumo");
    expect(win(s).ids).toEqual(["menzenTsumo", "rinshanKaihou"]);
  });

  it("가깡 후 영상패 츠모: 영상개화 1판 40부 = 320, 친 츠모 700 올", () => {
    let s = build([KAN_HAND, JUNK, JUNK, JUNK], {
      drawn: "1m",
      melds: { 0: [ponOf("1m", 1, "left")] },
    });
    s = shouminkan(s, 0, "1m");
    expect(s.phase).toBe("turn");
    expect(s.drawnTile).toEqual(T("5s")[0]);
    s = act(s, 0, "tsumo");
    const w = win(s);
    expect(w.ids).toEqual(["rinshanKaihou"]); // 부로 손패라 멘젠쯔모 없음
    // 20 + 츠모 2 + 가깡(명깡) 요구패 16 + 간짱 2 = 40부
    expect(w.score.fu).toBe(40);
    expect(w.score.basePoints).toBe(320);
    expect(w.score.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 700 }); // 640 -> 700
  });

  it("대명깡 후 영상패 츠모: 영상개화 1판 40부, 친 츠모 700 올", () => {
    let s = build(["111m" + KAN_HAND, JUNK + "1m", JUNK, JUNK], {
      patch: { turn: 1, drawnTile: T("1m")[0]! },
    });
    s = discard(s, 1, "1m");
    expect(types(legalActions(s, 0))).toContain("daiminkan");
    s = act(s, 0, "daiminkan");
    expect(s.drawnTile).toEqual(T("5s")[0]);
    s = act(s, 0, "tsumo");
    const w = win(s);
    expect(w.ids).toEqual(["rinshanKaihou"]);
    expect(w.score.fu).toBe(40); // 20 + 2 + 대명깡 16 + 2
    expect(w.score.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 700 });
  });
});

// ---------------------------------------------------------------------------
// 창깡
// ---------------------------------------------------------------------------

describe("창깡", () => {
  /** 좌석 0이 5s 펑 + 손패 5s를 뽑아 가깡 선언. 좌석 1은 5s 대기(WAIT_5S). */
  function scene(extra: BuildOptions = {}, hands: string[] = ["1379m1379p1z2z", WAIT_5S, JUNK, JUNK]): GameState {
    return build(hands, { drawn: "5s", melds: { 0: [ponOf("5s", 2, "across")] }, ...extra });
  }

  it("론 가능한 좌석이 있으면 응답 단계: 론/패스만 가능하고 가깡 패가 표시된다", () => {
    const s = shouminkan(scene(), 0, "5s");
    expect(s.phase).toBe("response");
    expect(s.pending).toMatchObject({ discarder: 0, awaiting: [1], chankan: "shouminkan" });
    expect(s.pending!.tile).toEqual(T("5s")[0]);
    expect(awaitingSeats(s)).toEqual([1]);
    expect(types(legalActions(s, 1))).toEqual(["ron", "pass"]);
    expect(legalActions(s, 0)).toEqual([]);
    expect(legalActions(s, 2)).toEqual([]);
    // 응답 중에는 깡이 적용되지 않았다
    expect(s.kanSeats).toEqual([]);
    expect(s.players[0]!.melds[0]!.type).toBe("pon");
    // 불법 행동
    expect(() => act(s, 2, "pass")).toThrow(IllegalActionError);
    expect(() => dispatch(s, { type: "discard", seat: 0, tile: T("1m")[0]! })).toThrow(IllegalActionError);
    expect(() => dispatch(s, { type: "chi", seat: 1, use: [T("4s")[0]!, T("6s")[0]!] })).toThrow(IllegalActionError);
  });

  it("창깡 론: 창깡 + 탕야오 = 2판 40부, 깡은 취소되고 깡 선언자(친)가 2600 지불", () => {
    const before = scene();
    let s = shouminkan(before, 0, "5s");
    s = act(s, 1, "ron");
    expect(s.phase).toBe("roundEnd");
    const w = win(s);
    expect(w.ids).toEqual(["chankan", "tanyao"]);
    expect(w.seat).toBe(1);
    expect(w.from).toBe(0);
    expect(w.score.han).toBe(2);
    expect(w.score.fu).toBe(40); // 20 + 멘젠론 10 + 간짱 2 = 32 -> 40
    expect(w.score.payment).toEqual({ type: "ron", fromDiscarder: 2600 }); // 640 x 4 = 2560 -> 2600
    expect(s.result!.deltas).toEqual([-2600, 2600, 0, 0]);
    // 깡 취소: 영상패/깡도라/깡 횟수 없음, 멜드는 펑 그대로, 왕패/산패 불변
    expect(s.kanSeats).toEqual([]);
    expect(s.doraCount).toBe(1);
    expect(s.pendingKanDora).toBe(0);
    expect(s.players[0]!.melds[0]!.type).toBe("pon");
    expect(s.players[0]!.melds[0]!.tiles).toHaveLength(3);
    expect(s.players[0]!.hand).toHaveLength(11); // 가깡 패는 아직 손에 있다
    expect(s.deadWall).toEqual(before.deadWall);
    expect(s.liveWall).toEqual(before.liveWall);
    expect(s.result!.dealerContinues).toBe(false); // 친이 아닌 좌석의 화료
  });

  it("창깡에는 일발이 유효하다: 리치 + 일발 + 창깡 + 탕야오 = 4판 만관 8000, 일발 소멸은 응답이 끝난 뒤", () => {
    const base = scene({ riichi: [1], patch: { ippatsu: [false, true, false, false] } });
    const pending = shouminkan(base, 0, "5s");
    expect(pending.ippatsu).toEqual([false, true, false, false]); // 응답 중에는 아직 유효
    const w = win(act(pending, 1, "ron"));
    expect(w.ids).toEqual(["riichi", "ippatsu", "chankan", "tanyao"]);
    expect(w.score.han).toBe(4);
    expect(w.score.limit).toBe("mangan");
    expect(w.score.payment).toEqual({ type: "ron", fromDiscarder: 8000 });
  });

  it("론을 패스하면 깡이 정상 진행된다: 영상패 뽑기, 깡도라 대기, 일발 소멸, 동순 후리텐", () => {
    const base = scene({ riichi: [1], patch: { ippatsu: [false, true, false, false] } });
    let s = shouminkan(base, 0, "5s");
    s = act(s, 1, "pass");
    expect(s.phase).toBe("turn");
    expect(s.turn).toBe(0);
    expect(s.pending).toBeNull();
    expect(s.kanSeats).toEqual([0]);
    expect(s.players[0]!.melds[0]!.type).toBe("shouminkan");
    expect(s.drawnTile).toEqual(T("5s")[0]); // 영상패 5s
    expect(s.players[0]!.hand).toHaveLength(11); // 10 + 영상패
    expect(s.pendingKanDora).toBe(1); // 가깡의 깡도라는 다음 타패 직후 공개
    expect(s.doraCount).toBe(1);
    expect(s.liveWall).toHaveLength(base.liveWall.length - 1);
    expect(s.deadWall).toHaveLength(14);
    expect(s.deadWall[0]).toEqual(base.liveWall[base.liveWall.length - 1]); // 영상패 슬롯을 산패 마지막 장으로 교체
    expect(s.ippatsu).toEqual([false, false, false, false]);
    expect(s.furitenTemp[1]).toBe(true);
    expect(s.rinshanDraw).toBe(true);
  });

  it("후리텐인 좌석은 창깡 론을 할 수 없어 응답 단계 없이 깡이 진행된다", () => {
    const s = shouminkan(scene({ patch: { furitenTemp: [false, true, false, false] } }), 0, "5s");
    expect(s.phase).toBe("turn");
    expect(s.kanSeats).toEqual([0]);
  });

  it("창깡은 그 자체로 역이다: 다른 역이 없는 손패도 창깡으로 론 (1판 40부 = 1300), 일반 버림패로는 론 불가", () => {
    const noYaku = "123m456p789s24s99m"; // 3s 간짱, 역 없음
    const base = scene({ melds: { 0: [ponOf("3s", 2, "across")] }, drawn: "3s" }, ["1379m1379p1z2z", noYaku, JUNK, JUNK]);
    let s = shouminkan(base, 0, "3s");
    expect(types(legalActions(s, 1))).toEqual(["ron", "pass"]);
    s = act(s, 1, "ron");
    const w = win(s);
    expect(w.ids).toEqual(["chankan"]);
    expect(w.score.payment).toEqual({ type: "ron", fromDiscarder: 1300 });
    // 같은 패가 일반 버림패로 나오면 역이 없어 론할 수 없다
    const plain = discard(
      build(["1379m1379p1z2z3z4z5z", noYaku, JUNK, JUNK], { drawn: "3s" }),
      0,
      "3s",
    );
    expect(types(legalActions(plain, 1))).not.toContain("ron"); // 치만 가능
  });

  it("더블론: 첫 화료자(깡 선언자 다음 순서)만 본장/리치봉을 수령한다", () => {
    const base = scene(
      { patch: { honba: 1, riichiSticks: 1 } },
      ["1379m1379p1z2z", WAIT_5S, WAIT_5S, JUNK],
    );
    let s = shouminkan(base, 0, "5s");
    expect(awaitingSeats(s)).toEqual([1, 2]);
    s = act(s, 2, "ron");
    expect(s.phase).toBe("response");
    s = act(s, 1, "ron");
    expect(s.result!.wins.map((w) => w.seat)).toEqual([1, 2]);
    expect(win(s, 0).score.total).toBe(2600 + 300 + 1000);
    expect(win(s, 1).score.total).toBe(2600);
    expect(s.result!.deltas).toEqual([-(2900 + 2600), 3900, 2600, 0]);
    expect(s.kanSeats).toEqual([]);
  });

  it("창깡 응답 이후 봇 진행으로 교착/예외 없이 국이 끝나고 점수가 보존된다 (론/패스 양쪽)", () => {
    for (const choice of ["ron", "pass"] as const) {
      const rng = seeded(7);
      let s = shouminkan(scene({ riichi: [1], patch: { ippatsu: [false, true, false, false] } }), 0, "5s");
      s = act(s, 1, choice);
      let steps = 0;
      while (s.phase === "turn" || s.phase === "response") {
        if (++steps > 300) throw new Error("진행 불가 (교착 의심)");
        const seat = awaitingSeats(s)[0]!;
        s = dispatch(s, decideAction(s, seat, rng));
      }
      expect(s.result).not.toBeNull();
      expect(s.scores.reduce((a, b) => a + b, 0) + 1000 * s.riichiSticks).toBe(100000);
    }
  });

  it("삼가화는 기존 옵션(기본 abort)을 따른다: 깡이 취소되고 유국", () => {
    const base = scene({}, ["1379m1379p1z2z", WAIT_5S, WAIT_5S, WAIT_5S]);
    let s = shouminkan(base, 0, "5s");
    for (const seat of [1, 2, 3]) s = act(s, seat, "ron");
    expect(s.result).toMatchObject({ type: "abortive", reason: "sanchaHou" });
    expect(s.kanSeats).toEqual([]);
    expect(s.players[0]!.melds[0]!.type).toBe("pon");
  });

  it("한 명이 론하고 한 명이 패스해도 론이 우선한다", () => {
    const base = scene({}, ["1379m1379p1z2z", WAIT_5S, WAIT_5S, JUNK]);
    let s = shouminkan(base, 0, "5s");
    s = act(s, 1, "pass");
    s = act(s, 2, "ron");
    expect(s.result!.wins.map((w) => w.seat)).toEqual([2]);
  });

  describe("안깡은 국사무쌍으로만 론할 수 있다", () => {
    it("국사무쌍 대기 좌석은 안깡에 론 가능: 역만 32000을 깡 선언자가 지불", () => {
      // 좌석 1: 요구패 12종 + 6z 대자, 7z 대기 / 좌석 0이 7z 안깡
      const kokushi = "19m19p19s1234566z";
      const base = build(["7777z2468m2468p1s", kokushi, JUNK, JUNK], { drawn: "3s" });
      let s = ankan(base, 0, "7z");
      expect(s.phase).toBe("response");
      expect(s.pending).toMatchObject({ chankan: "ankan", awaiting: [1] });
      expect(types(legalActions(s, 1))).toEqual(["ron", "pass"]);
      s = act(s, 1, "ron");
      const w = win(s);
      expect(w.ids).toEqual(["kokushiMusou"]);
      expect(w.score.limit).toBe("yakuman");
      expect(w.score.payment).toEqual({ type: "ron", fromDiscarder: 32000 });
      expect(s.result!.deltas).toEqual([-32000, 32000, 0, 0]);
      expect(s.kanSeats).toEqual([]);
      expect(s.players[0]!.melds).toHaveLength(0);
    });

    it("국사무쌍 대기 좌석이 패스하면 안깡이 진행된다", () => {
      const kokushi = "19m19p19s1234566z";
      let s = ankan(build(["7777z2468m2468p1s", kokushi, JUNK, JUNK], { drawn: "3s" }), 0, "7z");
      s = act(s, 1, "pass");
      expect(s.phase).toBe("turn");
      expect(s.kanSeats).toEqual([0]);
      expect(s.players[0]!.melds[0]!.type).toBe("ankan");
      expect(s.doraCount).toBe(2); // 안깡의 깡도라는 즉시 공개
    });

    it("일반 대기(역 있는 손패)는 안깡에 론할 수 없다: 응답 단계 없이 안깡 진행", () => {
      // 좌석 1은 4p/1p 양면 대기 멘젠 손패(론이면 평화 등 역이 있다)
      const s = ankan(build(["4444p1379m1379s2z", "123m456m789m23p99s", JUNK, JUNK], { drawn: "3z" }), 0, "4p");
      expect(s.phase).toBe("turn");
      expect(s.kanSeats).toEqual([0]);
      expect(s.players[0]!.melds[0]!.type).toBe("ankan");
    });
  });
});

// ---------------------------------------------------------------------------
// 천화 / 지화
// ---------------------------------------------------------------------------

describe("천화 / 지화", () => {
  it("천화: 친이 첫 츠모로 화료 = 역만 48000 (올 16000)", () => {
    const s0 = build([TENPAI_5P, JUNK, JUNK, JUNK], { drawn: "5p", patch: { anyCalls: false } });
    expect(types(legalActions(s0, 0))).toContain("tsumo");
    const s = act(s0, 0, "tsumo");
    const w = win(s);
    expect(w.ids).toEqual(["tenhou"]);
    expect(w.score.limit).toBe("yakuman");
    expect(w.score.yakumanCount).toBe(1);
    expect(w.score.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 16000 });
    expect(s.result!.deltas).toEqual([48000, -16000, -16000, -16000]);
    expect(s.result!.dealerContinues).toBe(true);
  });

  it("친의 첫 츠모라도 누군가 부로/깡을 했으면 천화가 아니다 (멘젠쯔모 + 탕야오 = 2판 30부, 올 1000)", () => {
    const s = act(build([TENPAI_5P, JUNK, JUNK, JUNK], { drawn: "5p", patch: { anyCalls: true } }), 0, "tsumo");
    expect(win(s).ids).toEqual(["menzenTsumo", "tanyao"]);
    expect(win(s).score.payment).toEqual({ type: "tsumo", fromDealer: null, fromEachNonDealer: 1000 }); // 480 x 2 = 960 -> 1000
  });

  it("친이 이미 한 번 버린 뒤의 츠모는 천화가 아니다", () => {
    const base = build([TENPAI_5P, JUNK, JUNK, JUNK], { drawn: "5p", patch: { anyCalls: false } });
    const s0: GameState = {
      ...base,
      players: base.players.map((p, i) =>
        i === 0 ? { ...p, discards: [{ tile: T("7z")[0]!, riichi: false, tsumogiri: false, calledBy: null }] } : p,
      ),
    };
    expect(win(act(s0, 0, "tsumo")).ids).toEqual(["menzenTsumo", "tanyao"]);
  });

  it("지화: 자가 첫 츠모로 화료 = 역만 32000 (친 16000 + 자 8000 x 2)", () => {
    let s = build([JUNK, TENPAI_5P, JUNK, JUNK], { drawn: "6z", live: "5p" + PAD, patch: { anyCalls: false } });
    s = discard(s, 0, "6z");
    expect(s.turn).toBe(1);
    s = act(s, 1, "tsumo");
    const w = win(s);
    expect(w.ids).toEqual(["chiihou"]);
    expect(w.score.payment).toEqual({ type: "tsumo", fromDealer: 16000, fromEachNonDealer: 8000 });
    expect(s.result!.deltas).toEqual([-16000, 32000, -8000, -8000]);
    expect(s.result!.dealerContinues).toBe(false);
  });

  it("부로/깡이 있었으면 자의 첫 츠모도 지화가 아니다", () => {
    let s = build([JUNK, TENPAI_5P, JUNK, JUNK], { drawn: "6z", live: "5p" + PAD, patch: { anyCalls: true } });
    s = discard(s, 0, "6z");
    s = act(s, 1, "tsumo");
    expect(win(s).ids).toEqual(["menzenTsumo", "tanyao"]);
  });

  it("자의 두 번째 츠모는 지화가 아니다", () => {
    const base = build([JUNK, TENPAI_5P + "5p", JUNK, JUNK], {
      patch: { turn: 1, drawnTile: T("5p")[0]!, anyCalls: false },
    });
    const s0: GameState = {
      ...base,
      players: base.players.map((p, i) =>
        i === 1 ? { ...p, discards: [{ tile: T("7z")[0]!, riichi: false, tsumogiri: false, calledBy: null }] } : p,
      ),
    };
    expect(win(act(s0, 1, "tsumo")).ids).toEqual(["menzenTsumo", "tanyao"]);
  });
});
