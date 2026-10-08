import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import type { CalledMeld } from "./call.js";
import type { GameState } from "./game.js";
import { createGame, dispatch, doraIndicatorsOf, legalActions, uraDoraIndicatorsOf } from "./game.js";
import { decideAction } from "./bot.js";

// 깡도라/뒷깡도라(로드맵 16) dispatch 경로 테스트.
// 기대값은 모두 규칙에서 손으로 계산한다 (주석에 계산식).
// 이미 다른 파일이 검증하는 것: 대명깡/가깡 pendingKanDora 증가와 타패 후 공개, 안깡 즉시 공개,
// 왕패 14장 유지와 기존 표시패 불변(game.test.ts "깡"), 가깡 pendingKanDora/창깡 취소(situational-game.test.ts).

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

/** 왕패 14장: 영상패 4 + 겉도라 표시패 5 + 뒷도라 표시패 5 */
function dead(rinshan: string, omote: string, ura: string): Tile[] {
  const d = [...T(rinshan), ...T(omote), ...T(ura)];
  if (d.length !== 14) throw new Error(`왕패는 14장이어야 합니다: ${d.length}`);
  return d;
}

/** 공통 표시패: 겉 8s(도라 9s), 깡 3p(도라 4p), 뒷 7z(도라 백), 뒷깡 3p(도라 4p) */
const COMMON_OMOTE = "8s3p7z7z7z";
const COMMON_URA = "7z3p7z7z7z";

interface BuildOptions {
  drawn?: string;
  live?: string;
  melds?: Record<number, CalledMeld[]>;
  riichi?: number[];
  deadWall?: Tile[];
  patch?: Partial<GameState>;
}

/** 친(좌석 0)의 턴 상태. hands[0]에 drawn을 붙여 14장(멜드 있으면 14 - 3 x 멜드)으로 만든다. */
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
    liveWall: T(opts.live ?? "7z".repeat(15)),
    deadWall: opts.deadWall ?? dead("5s6s7s8s", COMMON_OMOTE, COMMON_URA),
    doraCount: 1,
    drawnTile: drawn,
    turn: 0,
    anyCalls: true, // 첫 순이 아닌 상태 (천화/지화 방지)
    ...opts.patch,
  };
}

function discard(state: GameState, seat: number, notation: string, riichi = false): GameState {
  const tile = T(notation)[0]!;
  return dispatch(state, riichi ? { type: "discard", seat, tile, riichi: true } : { type: "discard", seat, tile });
}

describe("깡도라: 안깡 후 리치 화료의 뒷깡도라", () => {
  it("안깡 1회 후 리치 일발 츠모: 표시패 겉 2장/뒷 2장, 도라 4(깡 멜드 4장) + 1 + 뒷 1 + 뒷깡 1 = 7, 10판 배만", () => {
    // 좌석 0(친): 1111m 234p 567p 789s + 5z 를 뽑음 -> 1m 안깡 -> 영상패 2z -> 2z 리치(5z 단기 텐파이)
    // 영상패 2z(0번), 겉 표시패: 9m(도라 1m), 깡 표시패 4p(도라 5p), 뒷 6s(도라 7s), 뒷깡 6p(도라 7p)
    const s0 = build(["1111m234p567p789s", JUNK, JUNK, JUNK], {
      drawn: "5z",
      live: "3z4z6z5z" + "7z".repeat(8),
      deadWall: dead("2z3z4z6z", "9m4p7z7z7z", "6s6p7z7z7z"),
    });
    const afterKan = dispatch(s0, { type: "ankan", seat: 0, tile: T("1m")[0]! });
    expect(afterKan.doraCount).toBe(2); // 안깡은 즉시 공개
    expect(afterKan.pendingKanDora).toBe(0);
    expect(doraIndicatorsOf(afterKan)).toEqual(T("9m4p"));
    expect(afterKan.drawnTile).toEqual(T("2z")[0]);

    // 리치 선언 (영상패 2z 츠모기리)
    const riichi = discard(afterKan, 0, "2z", true);
    expect(riichi.players[0]!.riichi).toBe(true);
    expect(uraDoraIndicatorsOf(riichi)).toEqual(T("6s6p")); // 겉도라 표시패 수(2)와 같다
    expect(uraDoraIndicatorsOf(riichi)).toHaveLength(doraIndicatorsOf(riichi).length);

    // 하가/대면/상가가 3z, 4z, 6z를 뽑아 버리고 (부로 없음) 친이 5z를 뽑는다
    let s = discard(riichi, 1, "3z");
    s = discard(s, 2, "4z");
    s = discard(s, 3, "6z");
    expect(s.turn).toBe(0);
    expect(s.drawnTile).toEqual(T("5z")[0]);

    const done = dispatch(s, { type: "tsumo", seat: 0 });
    const score = done.result!.wins[0]!.score;
    expect(score.yaku.map((y) => y.id).sort()).toEqual(["ippatsu", "menzenTsumo", "riichi"]);
    expect(score.dora).toBe(7);
    expect(score.han).toBe(10); // 리치 1 + 일발 1 + 멘젠츠모 1 + 도라 7
    expect(score.limit).toBe("baiman");
    // 친 배만 24000 = 자 8000 x 3, 리치봉(내 1000 = 선언 시 지불) 1개 수령
    expect(done.result!.deltas).toEqual([24000 + 1000, -8000, -8000, -8000]);
    expect(done.scores).toEqual([25000 - 1000 + 25000, 17000, 17000, 17000]);
    expect(done.scores.reduce((a, b) => a + b, 0) + done.riichiSticks * 1000).toBe(100000);
  });
});

describe("깡도라: 대명깡 후 공개 타이밍", () => {
  // 좌석 2: 444p 를 가지고 좌석 0이 버린 4p를 대명깡. 영상패 5z로 영상개화(5z 단기 대기, 234m 567m 789s)
  const daiminkanState = (rinshan: string) =>
    build([JUNK, JUNK, "444p234m567m789s5z", JUNK], {
      drawn: "4p",
      deadWall: dead(rinshan + "3z4z6z", COMMON_OMOTE, COMMON_URA),
    });

  it("대명깡 직후 영상개화 츠모에는 새 깡도라가 반영되지 않는다 (겉도라 9s만: 1판)", () => {
    const responding = discard(daiminkanState("5z"), 0, "4p");
    const kan = legalActions(responding, 2).find((a) => a.type === "daiminkan")!;
    const afterKan = dispatch(responding, kan);
    expect(afterKan.doraCount).toBe(1);
    expect(afterKan.pendingKanDora).toBe(1);
    expect(doraIndicatorsOf(afterKan)).toEqual(T("8s")); // 깡도라(3p)는 아직 비공개
    expect(legalActions(afterKan, 2).map((a) => a.type)).toContain("tsumo");

    const done = dispatch(afterKan, { type: "tsumo", seat: 2 });
    const score = done.result!.wins[0]!.score;
    expect(score.yaku.map((y) => y.id)).toEqual(["rinshanKaihou"]);
    // 도라: 겉 8s -> 9s (789s에 1장) = 1. 깡도라 3p -> 4p 였다면 깡 멜드 4장이 더해져 5가 되었을 것
    expect(score.dora).toBe(1);
    expect(score.han).toBe(2); // 영상개화 1 + 도라 1
    // 20 + 명깡(탕야오패) 8 + 츠모 2 + 5z 단기 2 + 백 머리 2 = 34 -> 40부. 40 x 2^(2+2) = 640
    expect(score.fu).toBe(40);
    expect(score.basePoints).toBe(640);
    // 자 츠모: 친 1280 -> 1300, 자 640 -> 700 x 2
    expect(done.result!.deltas).toEqual([-1300, -700, 2700, -700]);
  });

  it("대명깡 후 타패하면 깡도라가 공개되고, 그 타패에 대한 론에 반영된다 (깡도라 1 + 뒷깡도라 1)", () => {
    // 좌석 3은 리치 중 234m 567m 234p 678s + 2z 단기. 영상패 2z를 좌석 2가 그대로 버린다.
    const s = build(
      [JUNK, JUNK, "444p234m567m789s5z", "234m567m234p678s2z"],
      { drawn: "4p", riichi: [3], deadWall: dead("2z3z4z6z", COMMON_OMOTE, COMMON_URA) },
    );
    const responding = discard(s, 0, "4p");
    const afterKan = dispatch(responding, legalActions(responding, 2).find((a) => a.type === "daiminkan")!);
    expect(doraIndicatorsOf(afterKan)).toEqual(T("8s"));
    const afterDiscard = discard(afterKan, 2, "2z");
    expect(afterDiscard.pendingKanDora).toBe(0);
    expect(doraIndicatorsOf(afterDiscard)).toEqual(T("8s3p"));
    expect(uraDoraIndicatorsOf(afterDiscard)).toEqual(T("7z3p")); // 뒷깡도라 3p -> 4p도 공개 (이 손패의 234p에 1장)

    const done = dispatch(afterDiscard, { type: "ron", seat: 3 });
    const score = done.result!.wins[0]!.score;
    // 겉 8s->9s: 0, 깡 3p->4p: 1, 뒷 7z->백: 0, 뒷깡 3p->4p: 1 => 도라 2
    expect(score.dora).toBe(2);
    expect(score.han).toBe(3); // 리치 1 + 도라 2
    // 20 + 멘젠론 10 + 단기 2 = 32 -> 40부, 40 x 2^5 = 1280, 론 x4 = 5120 -> 5200
    expect(score.fu).toBe(40);
    expect(done.result!.deltas).toEqual([0, 0, -5200, 5200]);
  });
});

describe("깡도라: 4회 깡 (표시패 5장 / 뒷도라 5장)", () => {
  it("한 사람이 안깡 4회: 겉 5장 + 뒷 5장 공개, 기존 표시패 불변, 왕패 14장, 유국 아님", () => {
    // 손패 14장: 1111m 2222p 3333s 44z. 영상패 4z 4z 5z 6z 로 4z 4개째와 마지막 패 2장이 이어진다.
    const s0 = build(["1111m2222p3333s4z", JUNK, JUNK, JUNK], {
      drawn: "4z",
      deadWall: dead("4z4z5z6z", "1m2m3m4m5m", "6m7m8m9m1p"),
    });
    let s = s0;
    const kans: [string, number][] = [["1m", 2], ["2p", 3], ["3s", 4], ["4z", 5]];
    for (const [tile, revealed] of kans) {
      s = dispatch(s, { type: "ankan", seat: 0, tile: T(tile)[0]! });
      expect(s.doraCount).toBe(revealed);
      expect(s.pendingKanDora).toBe(0);
      expect(doraIndicatorsOf(s)).toEqual(T("1m2m3m4m5m").slice(0, revealed));
      expect(uraDoraIndicatorsOf(s)).toEqual(T("6m7m8m9m1p").slice(0, revealed));
    }
    expect(s.kanSeats).toEqual([0, 0, 0, 0]);
    expect(s.deadWall).toHaveLength(14);
    expect(s.deadWall.slice(4)).toEqual(s0.deadWall.slice(4)); // 표시패 자리는 영상패 교체에 영향 없음
    expect(s.players[0]!.hand).toEqual(T("5z6z")); // 14 - 3 x 4 = 2장
    const types = legalActions(s, 0).map((a) => a.type);
    expect(types).not.toContain("ankan");
    expect(types).not.toContain("shouminkan");

    // 같은 사람의 4깡은 스깡산료가 아니다
    const next = discard(s, 0, "6z");
    expect(next.phase).toBe("turn");
    expect(next.turn).toBe(1);
    expect(next.doraCount).toBe(5);
    expect(doraIndicatorsOf(next)).toHaveLength(5);
  });
});

describe("깡도라: 창깡으로 깡이 취소되면 도라 불변", () => {
  it("가깡이 창깡 론되면 깡도라/뒷깡도라 모두 공개되지 않고 점수에도 반영되지 않는다", () => {
    // 좌석 0: 3z 펑 + 손패 10장 + 3z 를 뽑아 가깡. 좌석 1은 리치 중 234m 567m 234p 678s + 3z 단기.
    const pon: CalledMeld = { type: "pon", tiles: T("3z3z3z") as [Tile, Tile, Tile], calledTile: T("3z")[0]!, fromSeat: 1, from: "right" };
    const s = build(["1379m1379p13s", "234m567m234p678s3z", JUNK, JUNK], {
      drawn: "3z",
      melds: { 0: [pon] },
      riichi: [1],
    });
    const kan = legalActions(s, 0).find((a) => a.type === "shouminkan")!;
    const responding = dispatch(s, kan);
    expect(responding.phase).toBe("response");
    const done = dispatch(responding, { type: "ron", seat: 1 });
    expect(done.kanSeats).toEqual([]);
    expect(done.doraCount).toBe(1);
    expect(done.pendingKanDora).toBe(0);
    expect(done.players[0]!.melds[0]!.type).toBe("pon"); // 깡 취소
    const score = done.result!.wins[0]!.score;
    expect(score.yaku.map((y) => y.id).sort()).toEqual(["chankan", "riichi"]);
    // 겉 8s->9s 0, 뒷 7z->백 0 (깡도라 3p->4p, 뒷깡도라 3p->4p 였다면 각 1장씩 더해졌을 것)
    expect(score.dora).toBe(0);
    expect(score.han).toBe(2);
    // 20 + 멘젠론 10 + 단기 2 = 32 -> 40부, 640 x 4 = 2560 -> 2600
    expect(score.fu).toBe(40);
    expect(done.result!.deltas).toEqual([-2600, 2600, 0, 0]);
  });
});

describe("깡도라: 깡 멜드 4장과 적도라 중복", () => {
  it("리치 안깡(0p555p) 츠모: 도라 5p x 4장 + 적5 1 = 5, 총 7판 = 친 하네만 6000 올", () => {
    // 멜드 4장 모두 도라(표시패 4p -> 5p), 적5p는 도라 + 적도라로 각각 센다 (4 + 1)
    const ankan: CalledMeld = { type: "ankan", tiles: T("0p5p5p5p") as [Tile, Tile, Tile, Tile] };
    const s = build(["234m567m789s6z", JUNK, JUNK, JUNK], {
      drawn: "6z",
      melds: { 0: [ankan] },
      riichi: [0],
      deadWall: dead("5s6s7s8s", "4p7z7z7z7z", "7z7z7z7z7z"),
    });
    const done = dispatch(s, { type: "tsumo", seat: 0 });
    const score = done.result!.wins[0]!.score;
    expect(score.yaku.map((y) => y.id).sort()).toEqual(["menzenTsumo", "riichi"]);
    expect(score.dora).toBe(5);
    expect(score.han).toBe(7); // 리치 1 + 멘젠츠모 1 + 도라 4 + 적도라 1
    expect(score.limit).toBe("haneman");
    expect(done.result!.deltas).toEqual([18000, -6000, -6000, -6000]);
  });
});

describe("깡도라: 더블론에서 각자 계산", () => {
  it("리치 화료자는 뒷도라를 세고 비리치 화료자는 세지 않는다", () => {
    // 좌석 0이 5z를 버린다. 좌석 1(리치, 5z 단기): 겉 4m->5m 1 + 뒷 2m->3m 1, 좌석 2(비리치, 55z66z 샤보): 겉 1
    const s = build([JUNK, "234m567m234p678s5z", "234m567m234p55z66z", JUNK], {
      drawn: "5z",
      riichi: [1],
      deadWall: dead("5s6s7s8s", "4m7z7z7z7z", "2m7z7z7z7z"),
    });
    const responding = discard(s, 0, "5z");
    const half = dispatch(responding, { type: "ron", seat: 1 });
    const done = dispatch(half, { type: "ron", seat: 2 });
    expect(done.result!.type).toBe("ron");
    const [w1, w2] = done.result!.wins;
    expect(w1!.seat).toBe(1);
    expect(w1!.score.dora).toBe(2);
    expect(w1!.score.han).toBe(3); // 리치 1 + 도라 2
    // 20 + 멘젠론 10 + 단기 2 + 백 머리 2 = 34 -> 40부, 40 x 2^5 = 1280, 론 x4 = 5120 -> 5200
    expect(w1!.score.fu).toBe(40);
    expect(w2!.seat).toBe(2);
    expect(w2!.score.dora).toBe(1);
    expect(w2!.score.han).toBe(2); // 역패 백 1 + 도라 1
    // 20 + 멘젠론 10 + 백 명각(론 완성) 4 + 발 머리 2 = 36 -> 40부, 40 x 2^4 = 640 x 4 = 2560 -> 2600
    expect(w2!.score.fu).toBe(40);
    expect(done.result!.deltas).toEqual([-7800, 5200, 2600, 0]);
  });
});

describe("깡: 리치 후 깡 정책", () => {
  const ANKANABLE = "111m234p567p789s5z";

  it("리치 중에는 대기가 변하는 안깡이 합법 행동에 없고, 대기가 변하지 않으면 허용되며 봇은 하지 않는다", () => {
    // 111m + 1m 뽑음, 대기 5z 단기: 깡해도 대기가 같으므로 허용 (pao-riichi-ankan.test.ts에서 상세 검증)
    const riichi = build([ANKANABLE, JUNK, JUNK, JUNK], { drawn: "1m", riichi: [0] });
    expect(legalActions(riichi, 0).map((a) => a.type)).toContain("ankan");
    expect(decideAction(riichi, 0, seeded(3)).type).not.toBe("ankan");
    // 대기가 변하는 손패(1112m 계열)에서는 불허
    const changing = build(["111m2m234p567p789s", JUNK, JUNK, JUNK], { drawn: "1m", riichi: [0] });
    expect(legalActions(changing, 0).map((a) => a.type)).not.toContain("ankan");

    // 대조: 리치가 아니면 합법이지만 봇은 깡을 고르지 않는다 (봇은 부로/깡 안 함)
    const plain = build([ANKANABLE, JUNK, JUNK, JUNK], { drawn: "1m" });
    expect(legalActions(plain, 0).map((a) => a.type)).toContain("ankan");
    expect(decideAction(plain, 0, seeded(3)).type).not.toBe("ankan");
  });

  it("리치 중에는 대명깡/펑 응답이 없다", () => {
    const hand = "444p234m567m789s1z";
    const riichi = discard(build([JUNK, hand, JUNK, JUNK], { drawn: "4p", riichi: [1] }), 0, "4p");
    // 응답 대기 없이 곧바로 좌석 1의 다음 턴(뽑은 패 후 타패)으로 넘어간다
    expect(riichi.phase).toBe("turn");
    expect(riichi.turn).toBe(1);
    expect(riichi.players[1]!.melds).toEqual([]);
    expect(legalActions(riichi, 1).map((a) => a.type)).toEqual(["discard"]);
    const plain = discard(build([JUNK, hand, JUNK, JUNK], { drawn: "4p" }), 0, "4p");
    expect(legalActions(plain, 1).map((a) => a.type)).toContain("daiminkan");
  });
});
