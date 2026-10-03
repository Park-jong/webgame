import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import { createFullTileSet } from "./tiles.js";
import type { CalledMeld } from "./call.js";
import type { Action, GameState } from "./game.js";
import {
  IllegalActionError,
  awaitingSeats,
  createGame,
  dispatch,
  doraIndicatorsOf,
  isFuriten,
  legalActions,
  sameExactTile,
  startNextRound,
  uraDoraIndicatorsOf,
} from "./game.js";
import { decideAction } from "./bot.js";

// ---------------------------------------------------------------------------
// 테스트 헬퍼
// ---------------------------------------------------------------------------

/** 결정적 난수 (mulberry32) */
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
const TENPAI_5P = "234m567m234p678s5p"; // 5p 단기 대기 (13장)
// 왕패: 영상패 4장(5s 6s 7s 8s) + 표시패/뒷표시패 전부 7z(중) -> 도라는 백(5z)
const DEAD = "5s6s7s8s" + "7z".repeat(10);

interface BuildOptions {
  drawn?: string;
  live?: string;
  melds?: Record<number, CalledMeld[]>;
  riichi?: number[];
  patch?: Partial<GameState>;
}

/** 친(좌석 0)의 턴 상태를 만든다. hands[0]에 drawn을 붙여 14장으로 만든다. */
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
    // 기본 픽스처는 첫 순이 아닌 상태로 둔다 (친 첫 츠모가 천화가 되지 않게). 첫 순 테스트는 patch로 anyCalls: false를 준다.
    anyCalls: true,
    ...opts.patch,
  };
}

function discard(state: GameState, seat: number, notation: string, riichi = false): GameState {
  const tile = T(notation)[0]!;
  return dispatch(state, riichi ? { type: "discard", seat, tile, riichi: true } : { type: "discard", seat, tile });
}

function act(state: GameState, seat: number, type: "ron" | "pass"): GameState {
  return dispatch(state, { type, seat });
}

const ponOf = (notation: string, fromSeat: number, from: "left" | "across" | "right"): CalledMeld => {
  const t = T(notation)[0]!;
  return { type: "pon", tiles: [t, t, t], calledTile: t, fromSeat, from };
};

function typesOf(actions: Action[]): string[] {
  return actions.map((a) => a.type);
}

// ---------------------------------------------------------------------------
// 시작 / 기본
// ---------------------------------------------------------------------------

describe("createGame", () => {
  it("친 14장/나머지 13장, 점수 25000, 136장 보존, 동 1국 0본장", () => {
    const s = createGame(seeded(7));
    expect(s.players.map((p) => p.hand.length)).toEqual([14, 13, 13, 13]);
    expect(s.scores).toEqual([25000, 25000, 25000, 25000]);
    const total = s.players.reduce((n, p) => n + p.hand.length, 0) + s.liveWall.length + s.deadWall.length;
    expect(total).toBe(136);
    expect(s.deadWall.length).toBe(14);
    expect(s.phase).toBe("turn");
    expect(s.turn).toBe(0);
    expect(s.drawnTile).not.toBeNull();
    expect([s.kyoku, s.honba, s.riichiSticks, s.roundWind]).toEqual([1, 0, 0, "east"]);
    expect(doraIndicatorsOf(s)).toHaveLength(1);
  });

  it("같은 시드는 같은 상태, 다른 시드는 다른 상태", () => {
    expect(createGame(seeded(3))).toEqual(createGame(seeded(3)));
    expect(createGame(seeded(3)).players[1]!.hand).not.toEqual(createGame(seeded(4)).players[1]!.hand);
  });

  it("행동 차례가 아닌 좌석은 합법 행동이 없고 일반 dispatch는 IllegalActionError", () => {
    const s = createGame(seeded(3));
    expect(legalActions(s, 1)).toEqual([]);
    expect(awaitingSeats(s)).toEqual([0]);
    expect(() => dispatch(s, { type: "pass", seat: 1 })).toThrow(IllegalActionError);
  });
});

// ---------------------------------------------------------------------------
// 리치
// ---------------------------------------------------------------------------

describe("리치", () => {
  const hands = [TENPAI_5P, JUNK, JUNK, JUNK];

  it("텐파이가 유지되는 타패만 리치 후보", () => {
    const s = build(hands, { drawn: "6z" });
    const riichiTiles = legalActions(s, 0)
      .filter((a) => a.type === "discard" && a.riichi)
      .map((a) => (a as Extract<Action, { type: "discard" }>).tile);
    expect(riichiTiles).toEqual(expect.arrayContaining(T("2p5p6z")));
    expect(riichiTiles).toHaveLength(3); // 2p를 버려도 345p + 6z 단기
  });

  it("점수 1000 미만 / 산패 3장 이하 / 부로 손패는 리치 불가", () => {
    const hasRiichi = (s: GameState) => legalActions(s, 0).some((a) => a.type === "discard" && a.riichi);
    expect(hasRiichi(build(hands, { drawn: "6z", patch: { scores: [900, 25000, 25000, 25000] } }))).toBe(false);
    expect(hasRiichi(build(hands, { drawn: "6z", live: "2z3z4z" }))).toBe(false);
    expect(hasRiichi(build(hands, { drawn: "6z" }))).toBe(true);
    // 부로 손패: 9m 펑 + 손패 11장 (8s 단기 텐파이 가능)
    const open = build(["234p567p345s8s", JUNK, JUNK, JUNK], {
      drawn: "4z",
      melds: { 0: [ponOf("9m", 1, "right")] },
    });
    expect(legalActions(open, 0).some((a) => a.type === "discard" && a.riichi)).toBe(false);
  });

  it("리치 선언 타패가 통과되면 리치봉 1000점 지불, 론당하면 미지불", () => {
    const passed = discard(build(hands, { drawn: "6z" }), 0, "6z", true);
    expect(passed.players[0]!.riichi).toBe(true);
    expect(passed.scores[0]).toBe(24000);
    expect(passed.riichiSticks).toBe(1);
    expect(passed.turn).toBe(1); // 모두 통과 -> 다음 좌석이 뽑음

    // 좌석 1이 6z 단기 대기(역: 리치)로 론
    const ronHand = "234m567m234p678s6z";
    const s = discard(build([TENPAI_5P, ronHand, JUNK, JUNK], { drawn: "6z", riichi: [1] }), 0, "6z", true);
    expect(s.phase).toBe("response");
    const done = act(s, 1, "ron");
    expect(done.phase).toBe("roundEnd");
    expect(done.riichiSticks).toBe(0);
    // 리치 1판 40부 -> 기본점 320, 론 4배 = 1280 -> 1300. 좌석 0의 리치봉은 지불되지 않았다.
    expect(done.scores).toEqual([25000 - 1300, 25000 + 1300, 25000, 25000]);
  });

  it("리치 후에는 츠모기리만 가능하고 안깡도 금지", () => {
    const s = build(["1111m234p567s99s1p", JUNK, JUNK, JUNK], { drawn: "2z", riichi: [0] });
    const actions = legalActions(s, 0);
    expect(actions).toEqual([{ type: "discard", seat: 0, tile: T("2z")[0]! }]);
    // 같은 손패라도 리치 전이면 안깡 가능
    const before = build(["1111m234p567s99s1p", JUNK, JUNK, JUNK], { drawn: "2z" });
    expect(typesOf(legalActions(before, 0))).toContain("ankan");
  });
});

// ---------------------------------------------------------------------------
// 화료 / 점수
// ---------------------------------------------------------------------------

describe("화료", () => {
  it("역 없는 츠모/론은 불가 액션 (noYaku)", () => {
    const open = ponOf("9m", 1, "right");
    // 9m 펑 + 234p 567p 345s 8s 8s (역 없음)
    const s = build(["234p567p345s8s", JUNK, JUNK, JUNK], { drawn: "8s", melds: { 0: [open] } });
    expect(typesOf(legalActions(s, 0))).not.toContain("tsumo");
    expect(() => dispatch(s, { type: "tsumo", seat: 0 })).toThrowError(
      expect.objectContaining({ reason: "noYaku" }),
    );

    // 론도 마찬가지: 좌석 1(9m 펑, 234p 567p 67s 88s)은 8s로 화료 형태지만 역이 없다 (치는 가능해서 응답 대기)
    const r = build([JUNK, "234p567p67s88s", JUNK, JUNK], {
      drawn: "8s",
      melds: { 1: [ponOf("9m", 2, "right")] },
    });
    const responding = discard(r, 0, "8s");
    expect(responding.pending!.awaiting).toEqual([1]);
    expect(typesOf(legalActions(responding, 1))).not.toContain("ron");
    expect(() => act(responding, 1, "ron")).toThrowError(expect.objectContaining({ reason: "noYaku" }));
  });

  it("친 리치 핑후 츠모: 7800 (2600 올), 렌짱", () => {
    // 234m 567m 234p 678s 55p, 4p 츠모. 리치+멘젠쯔모+핑후+탕야오 = 4판 20부 -> 1280 -> 올 2600
    const s = build(["234m567m23p678s55p", JUNK, JUNK, JUNK], { drawn: "4p", riichi: [0] });
    expect(typesOf(legalActions(s, 0))).toContain("tsumo");
    const done = dispatch(s, { type: "tsumo", seat: 0 });
    expect(done.phase).toBe("roundEnd");
    expect(done.result!.deltas).toEqual([7800, -2600, -2600, -2600]);
    expect(done.scores).toEqual([32800, 22400, 22400, 22400]);
    expect(done.result!.dealerContinues).toBe(true);
    const next = startNextRound(done, seeded(9));
    expect([next.dealer, next.honba, next.kyoku]).toEqual([0, 1, 1]);
  });

  it("론: 본장 2 + 리치봉 1 반영, 코 화료는 친 교대 + 본장 0", () => {
    // 좌석 1: 234m 567m 23p 678s 55p 리치. 4p 론: 리치+핑후+탕야오 3판 30부 = 960 -> 3900, 본장 2 = +600
    const s = build([JUNK, "234m567m23p678s55p", JUNK, JUNK], {
      drawn: "4p",
      riichi: [1],
      patch: { honba: 2, riichiSticks: 1 },
    });
    const responding = discard(s, 0, "4p");
    expect(responding.phase).toBe("response");
    expect(responding.pending!.awaiting).toEqual([1]);
    const done = act(responding, 1, "ron");
    expect(done.result!.deltas).toEqual([-4500, 5500, 0, 0]);
    expect(done.riichiSticks).toBe(0);
    expect(done.result!.dealerContinues).toBe(false);
    const next = startNextRound(done, seeded(9));
    expect([next.dealer, next.honba, next.kyoku]).toEqual([1, 0, 2]);
  });

  it("더블론 허용: 첫 화료자(버린 사람 기준 순서)만 본장/리치봉 수령, 응답이 다 모여야 진행", () => {
    const winner = "234m567m23p678s55p";
    const s = build([JUNK, winner, winner, JUNK], {
      drawn: "4p",
      riichi: [1, 2],
      patch: { honba: 1, riichiSticks: 2 },
    });
    const responding = discard(s, 0, "4p");
    expect(responding.pending!.awaiting).toEqual([1, 2]);
    const half = act(responding, 1, "ron");
    expect(half.phase).toBe("response");
    const done = act(half, 2, "ron");
    // 각 3900. 좌석 1: +3900 +300(본장) +2000(리치봉), 좌석 2: +3900
    expect(done.result!.wins.map((w) => w.seat)).toEqual([1, 2]);
    expect(done.result!.deltas).toEqual([-8100, 6200, 3900, 0]);
    expect(done.riichiSticks).toBe(0);
  });

  it("삼가화는 기본 유국, allow 옵션이면 3명 모두 화료", () => {
    const winner = "234m567m23p678s55p";
    const hands = [JUNK, winner, winner, winner];
    const abort = act(act(act(discard(build(hands, { drawn: "4p", riichi: [1, 2, 3] }), 0, "4p"), 1, "ron"), 2, "ron"), 3, "ron");
    expect(abort.result).toMatchObject({ type: "abortive", reason: "sanchaHou", dealerContinues: true });
    expect(abort.scores).toEqual([25000, 25000, 25000, 25000]);

    const allowState = build(hands, { drawn: "4p", riichi: [1, 2, 3] });
    const allowed = act(
      act(act(discard({ ...allowState, options: { ...allowState.options, tripleRon: "allow" } }, 0, "4p"), 1, "ron"), 2, "ron"),
      3,
      "ron",
    );
    expect(allowed.result!.wins).toHaveLength(3);
    expect(allowed.result!.deltas[0]).toBe(-3 * 3900);
  });

  it("도라 표시패/적도라/뒷도라가 점수에 반영된다", () => {
    // 표시패 7z(중) -> 도라 백(5z) 없음. 표시패를 4p로 바꾸면 도라 5p: 55p 중 적5 1장 = 도라 2 + 적도라 1
    const s = build(["234m567m23p678s50p", JUNK, JUNK, JUNK], {
      drawn: "4p",
      riichi: [0],
      patch: { deadWall: T("5s6s7s8s" + "4p" + "7z".repeat(4) + "7z".repeat(5)) },
    });
    // 5p 2장 = 도라 2 + 적5 1 = 3. 리치 멘젠쯔모 핑후 탕야오 4 + 3 = 7판 -> 하네만 3000 -> 친 올 6000
    const done = dispatch(s, { type: "tsumo", seat: 0 });
    expect(done.result!.wins[0]!.score.dora).toBe(3);
    expect(done.result!.deltas).toEqual([18000, -6000, -6000, -6000]);
  });
});

// ---------------------------------------------------------------------------
// 부로 우선순위 / 깡
// ---------------------------------------------------------------------------

describe("응답 우선순위", () => {
  it("모두 통과하면 다음 좌석이 산패를 뽑는다", () => {
    const s = discard(build([JUNK, JUNK, JUNK, JUNK], { drawn: "2z" }), 0, "2z");
    expect(s.phase).toBe("turn");
    expect(s.turn).toBe(1);
    expect(s.drawnTile).toEqual(T("2z")[0]);
    expect(s.liveWall).toHaveLength(14);
  });

  it("펑이 치보다 우선한다 (치 좌석은 응답 대기)", () => {
    const s = build([JUNK, "23p1379m1379s2z1p8s", "44p1379m1379s2z1p8s", JUNK], { drawn: "4p" });
    const responding = discard(s, 0, "4p");
    expect(responding.pending!.awaiting).toEqual([1, 2]);
    const chiAction = legalActions(responding, 1).find((a) => a.type === "chi")!;
    const ponAction = legalActions(responding, 2).find((a) => a.type === "pon")!;
    const half = dispatch(responding, chiAction);
    expect(half.phase).toBe("response");
    const done = dispatch(half, ponAction);
    expect(done.phase).toBe("turn");
    expect(done.turn).toBe(2);
    expect(done.drawnTile).toBeNull();
    expect(done.players[2]!.melds[0]!.type).toBe("pon");
    expect(done.players[2]!.hand).toHaveLength(11);
    expect(done.players[0]!.discards[0]!.calledBy).toBe(2);
  });

  it("론이 펑보다 우선한다", () => {
    const winner = "234m567m23p678s55p";
    const s = build([JUNK, JUNK, "44p1379m1379s2z1p8s", winner], { drawn: "4p", riichi: [3] });
    const responding = discard(s, 0, "4p");
    expect(responding.pending!.awaiting).toEqual([2, 3]);
    const half = act(responding, 3, "ron");
    const pon = legalActions(half, 2).find((a) => a.type === "pon")!;
    const done = dispatch(half, pon);
    expect(done.result!.type).toBe("ron");
  });

  it("치는 상가(바로 앞 순서)의 버림패에만 가능", () => {
    const s = build([JUNK, JUNK, "23p1379m1379s2z1p8s", JUNK], { drawn: "4p" });
    const responding = discard(s, 0, "4p");
    expect(legalActions(responding, 2)).toEqual([]); // 좌석 2는 좌석 0의 하가가 아니다
  });

  it("해저 버림패에는 부로 불가", () => {
    const s = build([JUNK, "23p1379m1379s2z1p8s", JUNK, JUNK], { drawn: "4p", live: "" });
    const after = discard(s, 0, "4p");
    expect(after.phase).toBe("roundEnd"); // 응답할 수 없어 바로 황패평국
    expect(after.result!.type).toBe("exhaustive");
  });
});

describe("깡", () => {
  it("대명깡: 영상패 뽑기, 깡도라는 다음 타패 직후 공개, 왕패 14장 유지", () => {
    const s = build([JUNK, JUNK, "444p1379m1379s2z8s", JUNK], { drawn: "4p" });
    const responding = discard(s, 0, "4p");
    const kan = legalActions(responding, 2).find((a) => a.type === "daiminkan")!;
    const done = dispatch(responding, kan);
    expect(done.turn).toBe(2);
    expect(done.players[2]!.melds[0]!.type).toBe("daiminkan");
    expect(done.drawnTile).toEqual(T("5s")[0]); // deadWall[0]
    expect(done.players[2]!.hand).toHaveLength(11); // 13 - 3 + 영상패 1
    expect(done.kanSeats).toEqual([2]);
    expect(done.doraCount).toBe(1);
    expect(done.pendingKanDora).toBe(1);
    expect(done.liveWall).toHaveLength(15 - 1);
    expect(done.deadWall).toHaveLength(14);
    // 뽑힌 영상패 슬롯은 산패 마지막 장(4z)으로 제자리 교체되어 배열에 남지 않는다
    expect(done.deadWall.includes(s.deadWall[0]!)).toBe(false);
    expect(done.deadWall[0]).toBe(s.liveWall[s.liveWall.length - 1]);
    expect(done.deadWall.slice(1)).toEqual(s.deadWall.slice(1));
    const after = discard(done, 2, "2z");
    expect(after.doraCount).toBe(2);
    expect(after.pendingKanDora).toBe(0);
  });

  it("깡을 여러 번 해도 왕패 14장, 기존 도라/뒷도라 표시패 불변, 전체 136장 보존", () => {
    // 136장이 정확히 맞는 상태를 만든다: 좌석별 손패를 지정하고 나머지를 왕패 14장 + 산패로 배분
    const hands = ["1111m2222p567s99s", "3333m4444p8888s1z", "1111z3333z44z55z6z", "5z666z7777z222z44z"];
    const drawn = T("2z")[0]!;
    const remaining = createFullTileSet(true);
    for (const t of [...hands.flatMap((h) => T(h)), drawn]) {
      remaining.splice(remaining.findIndex((r) => sameExactTile(r, t)), 1);
    }
    const base = build(hands, { drawn: "2z" });
    const s: GameState = { ...base, deadWall: remaining.slice(0, 14), liveWall: remaining.slice(14) };
    const total = (st: GameState) =>
      st.players.reduce(
        (n, p) => n + p.hand.length + p.melds.reduce((m, x) => m + x.tiles.length, 0) + p.discards.filter((d) => d.calledBy === null).length,
        0,
      ) +
      st.liveWall.length +
      st.deadWall.length;
    expect(total(s)).toBe(136);

    const doraBefore = doraIndicatorsOf(s);
    const uraBefore = uraDoraIndicatorsOf(s);
    const rinshan0 = s.deadWall[0]!;
    const rinshan1 = s.deadWall[1]!;
    const liveLast = s.liveWall[s.liveWall.length - 1]!;
    const liveSecondLast = s.liveWall[s.liveWall.length - 2]!;

    const first = dispatch(s, { type: "ankan", seat: 0, tile: T("1m")[0]! });
    expect(first.drawnTile).toBe(rinshan0);
    const second = dispatch(first, { type: "ankan", seat: 0, tile: T("2p")[0]! });
    expect(second.drawnTile).toBe(rinshan1);

    for (const st of [first, second]) {
      expect(st.deadWall).toHaveLength(14);
      expect(total(st)).toBe(136);
      expect(new Set(st.deadWall).size).toBe(14);
    }
    // (a) 뽑힌 영상패는 왕패에 남지 않고 같은 슬롯에 산패 뒤쪽 장이 들어간다
    expect(second.deadWall.includes(rinshan0)).toBe(false);
    expect(second.deadWall.includes(rinshan1)).toBe(false);
    expect(second.deadWall[0]).toBe(liveLast);
    expect(second.deadWall[1]).toBe(liveSecondLast);
    // (b) 기존 표시패 불변, 깡도라만 추가 (안깡 2회 -> 즉시 공개)
    expect(second.doraCount).toBe(3);
    expect(doraIndicatorsOf(second).slice(0, 1)).toEqual(doraBefore);
    expect(uraDoraIndicatorsOf(second).slice(0, 1)).toEqual(uraBefore);
    expect(doraIndicatorsOf(second)).toHaveLength(3);
    expect(second.deadWall.slice(2)).toEqual(s.deadWall.slice(2));
  });

  it("가깡: 펑 + 손패 1장, 영상패 뽑기", () => {
    const s = build(["1379m1379p13s", JUNK, JUNK, JUNK], {
      drawn: "3z",
      melds: { 0: [ponOf("3z", 1, "right")] },
    });
    const kan = legalActions(s, 0).find((a) => a.type === "shouminkan");
    expect(kan).toBeDefined();
    const done = dispatch(s, kan!);
    expect(done.players[0]!.melds[0]!.type).toBe("shouminkan");
    expect(done.players[0]!.melds[0]!.tiles).toHaveLength(4);
    expect(done.drawnTile).toEqual(T("5s")[0]);
    expect(done.pendingKanDora).toBe(1);
  });

  it("안깡: 깡도라 즉시 공개", () => {
    const s = build(["1111m234p567p89s1s", JUNK, JUNK, JUNK], { drawn: "2z" });
    const kan = legalActions(s, 0).find((a) => a.type === "ankan")!;
    const done = dispatch(s, kan);
    expect(done.players[0]!.melds[0]!.type).toBe("ankan");
    expect(done.doraCount).toBe(2);
    expect(done.kanSeats).toEqual([0]);
    expect(done.players[0]!.hand).toHaveLength(11);
  });

  it("이미 4깡이면 더 깡할 수 없다", () => {
    const s = build(["1111m234p567p89s1s", JUNK, JUNK, JUNK], { drawn: "2z", patch: { kanSeats: [0, 0, 1, 2] } });
    expect(typesOf(legalActions(s, 0))).not.toContain("ankan");
  });
});

// ---------------------------------------------------------------------------
// 후리텐
// ---------------------------------------------------------------------------

describe("후리텐", () => {
  const winner = "234m567m23p678s55p"; // 1p/4p 대기

  it("자기 버림패에 대기패가 있으면 론 불가 (부로된 버림패 포함)", () => {
    const s = build([JUNK, winner, JUNK, JUNK], { drawn: "4p", riichi: [1] });
    const furiten: GameState = {
      ...s,
      players: s.players.map((p, i) =>
        i === 1 ? { ...p, discards: [{ tile: T("1p")[0]!, riichi: false, tsumogiri: false, calledBy: 3 }] } : p,
      ),
    };
    expect(isFuriten(furiten, 1)).toBe(true);
    const after = discard(furiten, 0, "4p");
    expect(typesOf(legalActions(after, 1))).not.toContain("ron");
    expect(() => act(after, 1, "ron")).toThrow(IllegalActionError);
  });

  it("론을 통과하면 자기 다음 버림패까지 동순 후리텐", () => {
    const s = build([JUNK, winner, JUNK, JUNK], { drawn: "4p", riichi: [1] });
    const responding = discard(s, 0, "4p");
    expect(typesOf(legalActions(responding, 1))).toContain("ron");
    const passed = act(responding, 1, "pass");
    expect(passed.furitenTemp[1]).toBe(true);
    expect(isFuriten(passed, 1)).toBe(true);
  });

  it("비리치 좌석은 자기 버림 후 동순 후리텐이 풀린다", () => {
    const s = build([JUNK, winner, JUNK, JUNK], { drawn: "2z" });
    const flagged: GameState = { ...s, furitenTemp: [false, true, false, false] };
    // 좌석 0이 버려도 좌석 1의 플래그는 유지, 좌석 1이 자기 패를 버리면 해제
    const after = discard(flagged, 0, "2z");
    expect(after.turn).toBe(1);
    expect(after.furitenTemp[1]).toBe(true);
    const cleared = discard(after, 1, "2z");
    expect(cleared.furitenTemp[1]).toBe(false);
  });
});

describe("후리텐 (영구/츠모) 및 지불", () => {
  const winner = "234m567m23p678s55p"; // 1p/4p 대기, 리치 없이도 핑후 탕야오(4p) 역 있음

  /** 좌석의 손패를 교체한다 */
  function withHand(state: GameState, seat: number, notation: string): GameState {
    return { ...state, players: state.players.map((p, i) => (i === seat ? { ...p, hand: T(notation) } : p)) };
  }

  /** 응답이 남아 있으면 모두 패스하고, 턴이면 뽑은 패를 그대로 버린다 (다음 좌석 턴 또는 응답 단계가 될 때까지) */
  function settle(state: GameState): GameState {
    let s = state;
    while (s.phase === "response") s = act(s, s.pending!.awaiting[0]!, "pass");
    return s;
  }
  function tsumogiri(state: GameState): GameState {
    const seat = state.turn;
    return settle(dispatch(state, { type: "discard", seat, tile: state.drawnTile! }));
  }

  /** 좌석 1이 4p 론을 패스한 뒤 좌석 1,2,3 이 츠모기리하고, 좌석 0이 1p를 버린 직후 상태 */
  function afterPassedRon(riichi: boolean): GameState {
    const s = build([JUNK, winner, JUNK, JUNK], { drawn: "4p", riichi: riichi ? [1] : [] });
    let cur = settle(act(discard(s, 0, "4p"), 1, "pass"));
    expect(cur.phase).toBe("turn");
    expect(cur.turn).toBe(1);
    cur = tsumogiri(cur); // 좌석 1 (비리치면 여기서 동순 후리텐 해제)
    cur = tsumogiri(cur); // 좌석 2
    cur = tsumogiri(cur); // 좌석 3
    expect(cur.turn).toBe(0);
    return discard(cur, 0, "1p");
  }

  it("리치 후 론패를 놓치면 이후에도 영구 후리텐 (비리치는 자기 버림 후 해제되어 론 가능)", () => {
    const riichi = afterPassedRon(true);
    expect(riichi.furitenTemp[1]).toBe(true);
    expect(isFuriten(riichi, 1)).toBe(true);
    expect(riichi.phase).toBe("turn"); // 아무도 응답할 수 없어 바로 진행
    expect(typesOf(legalActions(riichi, 1))).not.toContain("ron");

    const plain = afterPassedRon(false);
    expect(plain.phase).toBe("response");
    expect(plain.furitenTemp[1]).toBe(false);
    expect(typesOf(legalActions(plain, 1))).toContain("ron");
  });

  it("후리텐이어도 츠모는 가능하다", () => {
    const s = build([winner, JUNK, JUNK, JUNK], { drawn: "4p", riichi: [0] });
    const flagged: GameState = { ...s, furitenTemp: [true, false, false, false] };
    expect(isFuriten(flagged, 0)).toBe(true);
    expect(typesOf(legalActions(flagged, 0))).toContain("tsumo");
    // 자기 버림패에 대기패(1p)가 있는 후리텐 (13장 상태로 판정)
    const discarded: GameState = {
      ...build([winner, JUNK, JUNK, JUNK], { riichi: [0] }),
      players: build([winner, JUNK, JUNK, JUNK], { riichi: [0] }).players.map((p, i) =>
        i === 0 ? { ...p, discards: [{ tile: T("1p")[0]!, riichi: false, tsumogiri: false, calledBy: null }] } : p,
      ),
    };
    expect(isFuriten(discarded, 0)).toBe(true);
    const withDraw = { ...withHand(discarded, 0, winner + "4p"), drawnTile: T("4p")[0]! };
    expect(typesOf(legalActions(withDraw, 0))).toContain("tsumo");
    expect(dispatch(withDraw, { type: "tsumo", seat: 0 }).result!.type).toBe("tsumo");
  });

  it("자(子) 츠모: 친 2배 지불, 본장 +100씩, 리치봉 수령, 친 교대", () => {
    // 리치 멘젠쯔모 핑후 탕야오 4판 20부 -> 기본점 1280. 친 2600, 자 1300. 본장 1: 각 +100. 리치봉 1: +1000
    const base = build([JUNK, winner, JUNK, JUNK], { riichi: [1], patch: { honba: 1, riichiSticks: 1, turn: 1 } });
    const s: GameState = { ...withHand(base, 1, winner + "4p"), drawnTile: T("4p")[0]! };
    const done = dispatch(s, { type: "tsumo", seat: 1 });
    expect(done.result!.deltas).toEqual([-2700, 5500 + 1000, -1400, -1400]);
    expect(done.scores).toEqual([25000 - 2700, 25000 + 6500, 25000 - 1400, 25000 - 1400]);
    expect(done.riichiSticks).toBe(0);
    expect(done.result!.dealerContinues).toBe(false);
    const next = startNextRound(done, seeded(9));
    expect([next.dealer, next.honba, next.kyoku]).toEqual([1, 0, 2]);
  });

  it("친 론: 렌짱 (본장 +1, 친 유지, 국 번호 유지)", () => {
    // 친 리치 핑후 탕야오 론 3판 30부: 960 x 6 = 5760 -> 5800, 본장 1 = +300
    const base = build([winner, JUNK, JUNK, JUNK], { riichi: [0], patch: { honba: 1, turn: 1 } });
    const s: GameState = { ...withHand(base, 1, JUNK + "4p"), drawnTile: T("4p")[0]! };
    const responding = discard(s, 1, "4p");
    expect(responding.pending!.awaiting).toEqual([0]);
    const done = act(responding, 0, "ron");
    expect(done.result!.deltas).toEqual([6100, -6100, 0, 0]);
    expect(done.result!.dealerContinues).toBe(true);
    const next = startNextRound(done, seeded(9));
    expect([next.dealer, next.honba, next.kyoku]).toEqual([0, 2, 1]);
  });
});

// ---------------------------------------------------------------------------
// 유국
// ---------------------------------------------------------------------------

describe("유국", () => {
  // 마지막 버림이 요구패 한 장뿐이면 유국만관이 되므로, 이 유국 테스트들은 수패(4m/8p)를 버려 유국만관을 피한다.
  it("황패평국: 친 텐파이 -> 노텐 벌부 3000, 렌짱(본장 +1)", () => {
    const s = build([TENPAI_5P, JUNK, JUNK, JUNK], { drawn: "4m", live: "" });
    const done = discard(s, 0, "4m");
    expect(done.result).toMatchObject({ type: "exhaustive", dealerContinues: true });
    expect(done.result!.deltas).toEqual([3000, -1000, -1000, -1000]);
    const next = startNextRound(done, seeded(2));
    expect([next.dealer, next.honba, next.kyoku]).toEqual([0, 1, 1]);
  });

  it("황패평국: 친 노텐 -> 친 교대, 본장 +1, 리치봉 유지", () => {
    const s = build([JUNK, TENPAI_5P, JUNK, JUNK], { drawn: "8p", live: "", patch: { riichiSticks: 1 } });
    const done = discard(s, 0, "8p");
    expect(done.result!.deltas).toEqual([-1000, 3000, -1000, -1000]);
    expect(done.result!.dealerContinues).toBe(false);
    const next = startNextRound(done, seeded(2));
    expect([next.dealer, next.honba, next.kyoku, next.riichiSticks]).toEqual([1, 1, 2, 1]);
  });

  it("동풍전 4국에서 친이 연장하지 못하면 게임 종료, 마이너스 점수도 종료", () => {
    // 4국에서 친(좌석 0)이 노텐이라 교대하게 되면 종료
    const s = build([JUNK, TENPAI_5P, JUNK, JUNK], { drawn: "8p", live: "", patch: { kyoku: 4 } });
    expect(discard(s, 0, "8p").phase).toBe("gameEnd");
    const broke = build([JUNK, JUNK, JUNK, JUNK], {
      drawn: "8p",
      live: "",
      patch: { scores: [25000, 500, 25000, 25000] },
    });
    // 좌석 1이 텐파이가 아니라 노텐 벌부 지불... 전원 노텐이면 점수 이동이 없어 종료하지 않는다
    expect(discard(broke, 0, "8p").phase).toBe("roundEnd");
    // 버림패가 요구패(자패)면 유국만관이 되어 노텐 벌부와 무관한 이유로 종료되므로, 수패(8p)를 버린다.
    const brokeTenpai = build([TENPAI_5P, JUNK, JUNK, JUNK], {
      drawn: "8p",
      live: "",
      patch: { scores: [25000, 500, 25000, 25000] },
    });
    const brokeEnd = discard(brokeTenpai, 0, "8p");
    expect(brokeEnd.result).not.toHaveProperty("nagashiMangan");
    expect(brokeEnd.phase).toBe("gameEnd"); // 500 - 1000 < 0 (노텐 벌부)
  });

  it("구종구패: 첫 순 요구패 9종 이상이면 선언 가능, 유국은 렌짱", () => {
    const s = build(["19m19p19s1234z5z6z2m", JUNK, JUNK, JUNK], { drawn: "1m", patch: { anyCalls: false } });
    expect(typesOf(legalActions(s, 0))).toContain("kyuushu");
    const done = dispatch(s, { type: "kyuushu", seat: 0 });
    expect(done.result).toMatchObject({ type: "abortive", reason: "kyuushuKyuuhai", dealerContinues: true });
    // 두 번째 순 이후에는 선언 불가
    const later = { ...s, players: s.players.map((p, i) => (i === 0 ? { ...p, discards: [{ tile: T("1m")[0]!, riichi: false, tsumogiri: false, calledBy: null }] } : p)) };
    expect(typesOf(legalActions(later, 0))).not.toContain("kyuushu");
  });

  it("사풍연타: 첫 순 4명이 같은 풍패를 버리면 유국", () => {
    const h = "1379m1379p1379s1z";
    let s = build([h, h, h, h], { drawn: "2z", live: "2z2z2z", patch: { anyCalls: false } });
    s = discard(s, 0, "1z");
    s = discard(s, 1, "1z");
    s = discard(s, 2, "1z");
    expect(s.phase).toBe("turn");
    s = discard(s, 3, "1z");
    expect(s.result).toMatchObject({ type: "abortive", reason: "suufonRenda" });
  });

  it("사가리치: 4번째 리치 선언이 통과되면 유국 (리치봉은 지불)", () => {
    const s = build([TENPAI_5P, JUNK, JUNK, JUNK], { drawn: "6z", riichi: [1, 2, 3] });
    const done = discard(s, 0, "6z", true);
    expect(done.result).toMatchObject({ type: "abortive", reason: "suuchaRiichi" });
    expect(done.scores[0]).toBe(24000);
    expect(done.riichiSticks).toBe(1);
  });

  it("사개깡: 서로 다른 좌석이 4번 깡한 뒤 통과된 타패에서 유국", () => {
    const s = build([JUNK, JUNK, JUNK, JUNK], { drawn: "2z", patch: { kanSeats: [0, 1, 2, 3] } });
    expect(discard(s, 0, "2z").result).toMatchObject({ type: "abortive", reason: "suukaikan" });
  });
});

// ---------------------------------------------------------------------------
// 봇
// ---------------------------------------------------------------------------

describe("decideAction", () => {
  it("화료 가능하면 화료한다 (츠모/론)", () => {
    const tsumo = build(["234m567m23p678s55p", JUNK, JUNK, JUNK], { drawn: "4p", riichi: [0] });
    expect(decideAction(tsumo, 0, seeded(1)).type).toBe("tsumo");
    const responding = discard(build([JUNK, "234m567m23p678s55p", JUNK, JUNK], { drawn: "4p", riichi: [1] }), 0, "4p");
    expect(decideAction(responding, 1, seeded(1)).type).toBe("ron");
  });

  it("텐파이가 되면 리치, 점수가 부족하면 샹텐 최소 타패", () => {
    const hand = "123m456m789m12p33s";
    const s = build([hand, JUNK, JUNK, JUNK], { drawn: "7z" });
    expect(decideAction(s, 0, seeded(1))).toMatchObject({ type: "discard", riichi: true, tile: T("7z")[0] });
    const poor = build([hand, JUNK, JUNK, JUNK], { drawn: "7z", patch: { scores: [900, 25000, 25000, 25000] } });
    const chosen = decideAction(poor, 0, seeded(1));
    expect(chosen).toMatchObject({ type: "discard", tile: T("7z")[0] });
    expect((chosen as { riichi?: boolean }).riichi).not.toBe(true);
  });

  it("응답에서는 화료가 아니면 패스, 구종구패/깡은 하지 않는다", () => {
    const responding = discard(build([JUNK, "23p1379m1379s2z1p8s", JUNK, JUNK], { drawn: "4p" }), 0, "4p");
    expect(decideAction(responding, 1, seeded(1)).type).toBe("pass");
    // 구종구패가 실제로 합법인 첫 순 상태(anyCalls: false)여야 "합법인데도 선언하지 않는다"를 검증한다.
    const kyuushu = build(["19m19p19s1234z5z6z2m", JUNK, JUNK, JUNK], { drawn: "1m", patch: { anyCalls: false } });
    expect(typesOf(legalActions(kyuushu, 0))).toContain("kyuushu");
    expect(decideAction(kyuushu, 0, seeded(1)).type).toBe("discard");
    const kan = build(["1111m234p567p89s1s", JUNK, JUNK, JUNK], { drawn: "2z" });
    expect(decideAction(kan, 0, seeded(1)).type).toBe("discard");
  });

  it("행동할 수 없는 좌석이면 에러", () => {
    expect(() => decideAction(createGame(seeded(1)), 2)).toThrow();
  });
});

// ---------------------------------------------------------------------------
// 국사무쌍 (화료/리치/론 연동)
// ---------------------------------------------------------------------------

describe("국사무쌍", () => {
  const KOKUSHI_13 = "19m19p19s1234z5z6z7z"; // 요구패 13종 1장씩 (13장)

  it("리치 사전 검사: 국사무쌍 텐파이를 유지하는 타패만 리치할 수 있다", () => {
    // 13종 + 2m + 뽑은 7z: 2m을 버려야 13면 텐파이 유지. 7z(요구패 중복)를 버리면 12종이라 텐파이가 아님.
    const s = build(["19m19p19s1234z5z6z2m", JUNK, JUNK, JUNK], { drawn: "7z" });
    const riichiActions = legalActions(s, 0).filter((a) => a.type === "discard" && a.riichi === true);
    expect(riichiActions).toEqual([{ type: "discard", seat: 0, tile: T("2m")[0], riichi: true }]);
  });

  it("국사무쌍이 완성되면 츠모할 수 있고 13면 대기라 친 더블역만 (올 32000, 합계 96000)", () => {
    // 뽑은 1m: 화료 직전 13장은 요구패 13종 1장씩 = 13면 대기
    const s = build([KOKUSHI_13, JUNK, JUNK, JUNK], { drawn: "1m" });
    expect(typesOf(legalActions(s, 0))).toContain("tsumo");
    const done = dispatch(s, { type: "tsumo", seat: 0 });
    const score = done.result!.wins[0]!.score;
    expect(score.yaku.map((y) => y.id)).toEqual(["kokushiMusou13"]);
    expect(score.limit).toBe("yakuman");
    expect(score.yakumanCount).toBe(2);
    expect(score.basePoints).toBe(16000);
    expect(score.total).toBe(96000);
    expect(done.scores).toEqual([121000, -7000, -7000, -7000]);
  });

  it("타가의 버림패로 론할 수 있다 (코 13면 대기 론 64000)", () => {
    const s = discard(build([JUNK, KOKUSHI_13, JUNK, JUNK], { drawn: "1m" }), 0, "1m");
    expect(typesOf(legalActions(s, 1))).toContain("ron");
    const done = act(s, 1, "ron");
    expect(done.result!.wins[0]!.score.total).toBe(64000);
    expect(done.scores[1]).toBe(25000 + 64000);
    expect(done.scores[0]).toBe(25000 - 64000);
  });

  it("국사무쌍 13면 대기에서 자기가 버린 요구패가 있으면 후리텐이라 론할 수 없다", () => {
    const base = build([JUNK, KOKUSHI_13, JUNK, JUNK], { drawn: "1m" });
    const entry = { tile: T("9s")[0]!, riichi: false, tsumogiri: false, calledBy: null };
    const furiten: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === 1 ? { ...p, discards: [entry] } : p)),
    };
    const s = discard(furiten, 0, "1m");
    expect(typesOf(legalActions(s, 1))).not.toContain("ron");
  });
});

// ---------------------------------------------------------------------------
// 리치 + 역만 (일반 역/도라/뒷도라/적도라는 점수에 반영되지 않는다)
// ---------------------------------------------------------------------------

describe("리치 후 역만 화료", () => {
  const KOKUSHI_13 = "19m19p19s1234z5z6z7z";
  const KOKUSHI_WAIT_7Z = "19m19p19s1234z5z6z6z"; // 중 단일 대기 (13장)
  const SUUANKOU_SHANPON = "111m333p555s77m99p"; // 7m 츠모 -> 스안커 (샤보 완성)
  // 도라 표시패(4s -> 5s, 3장 보유)와 뒷도라 표시패(2p -> 3p, 3장 보유)를 일부러 붙여 둔다
  const DORA_DEAD = "5s6s7s8s" + "4s" + "7z".repeat(4) + "2p" + "7z".repeat(4);

  /** 좌석 seat의 손패를 hand + drawn(14장)으로 바꾸고 그 좌석의 츠모 턴으로 만든다 */
  function tsumoState(seat: number, hand: string, drawn: string, patch: Partial<GameState>): GameState {
    const hands = [JUNK, JUNK, JUNK, JUNK];
    hands[seat] = hand;
    const base = build(hands, { riichi: [seat], patch: { turn: seat, ...patch } });
    return {
      ...base,
      drawnTile: T(drawn)[0]!,
      players: base.players.map((p, i) => (i === seat ? { ...p, hand: [...T(hand), T(drawn)[0]!] } : p)),
    };
  }

  const conserved = (s: GameState): number => s.scores.reduce((a, b) => a + b, 0) + s.riichiSticks * 1000;

  it("친 국사무쌍 13면 리치 츠모: 더블역만 16000 기본점, 올 32000 + 본장 100씩 + 리치봉 2개, 도라/뒷도라 무시", () => {
    // 리치봉 2개 (좌석 0과 1이 지불). 도라 표시패 7z -> 백(5z), 뒷도라 표시패 7z -> 백: 손패에 백 1장이지만 무시된다.
    const s = tsumoState(0, KOKUSHI_13, "1m", { honba: 1, riichiSticks: 2, scores: [24000, 24000, 25000, 25000] });
    expect(typesOf(legalActions(s, 0))).toContain("tsumo");
    const done = dispatch(s, { type: "tsumo", seat: 0 });
    const score = done.result!.wins[0]!.score;
    expect(score.yaku.map((y) => y.id)).toEqual(["kokushiMusou13"]); // 리치/멘젠쯔모 등 일반 역은 없다
    expect(score.yakumanCount).toBe(2);
    expect(score.basePoints).toBe(16000);
    expect(score.han).toBe(0);
    expect(score.dora).toBe(0);
    // 32000 올 + 본장 1 (100씩) = 32100 x 3 = 96300, 리치봉 2개 = +2000
    expect(done.result!.deltas).toEqual([96300 + 2000, -32100, -32100, -32100]);
    expect(done.scores).toEqual([24000 + 98300, 24000 - 32100, 25000 - 32100, 25000 - 32100]);
    expect(done.riichiSticks).toBe(0);
    expect(conserved(done)).toBe(100000);
    expect(done.result!.dealerContinues).toBe(true);
  });

  it("자 국사무쌍 단일 대기 리치 츠모: 기본점 8000, 친 16000 + 자 8000 x 2 + 본장 2 + 리치봉 1, 뒷도라 무시", () => {
    const s = tsumoState(1, KOKUSHI_WAIT_7Z, "7z", { honba: 2, riichiSticks: 1, scores: [25000, 24000, 25000, 25000] });
    const done = dispatch(s, { type: "tsumo", seat: 1 });
    const score = done.result!.wins[0]!.score;
    expect(score.yaku.map((y) => y.id)).toEqual(["kokushiMusou"]);
    expect(score.yakumanCount).toBe(1);
    expect(score.basePoints).toBe(8000);
    expect(score.dora).toBe(0);
    // 친 16000 + 200, 자 8000 + 200 씩 = 16200 + 8200 + 8200 = 32600, 리치봉 +1000
    expect(done.result!.deltas).toEqual([-16200, 32600 + 1000, -8200, -8200]);
    expect(conserved(done)).toBe(100000);
    expect(done.result!.dealerContinues).toBe(false);
  });

  it("자 국사무쌍 13면 리치 론: 64000 + 본장 3 (900) + 리치봉 1 = 65900 수령, 버린 사람은 64900 지불", () => {
    const base = build([JUNK, KOKUSHI_13, JUNK, JUNK], {
      drawn: "1m",
      riichi: [1],
      patch: { honba: 3, riichiSticks: 1, scores: [25000, 24000, 25000, 25000] },
    });
    const responding = discard(base, 0, "1m");
    expect(typesOf(legalActions(responding, 1))).toContain("ron");
    const done = act(responding, 1, "ron");
    const score = done.result!.wins[0]!.score;
    expect(score.yaku.map((y) => y.id)).toEqual(["kokushiMusou13"]);
    expect(score.basePoints).toBe(16000);
    expect(score.dora).toBe(0);
    expect(done.result!.deltas).toEqual([-64900, 64900 + 1000, 0, 0]);
    expect(done.scores).toEqual([25000 - 64900, 24000 + 65900, 25000, 25000]);
    expect(done.riichiSticks).toBe(0);
    expect(conserved(done)).toBe(100000);
  });

  it("친 스안커 리치 츠모: 기본점 8000, 올 16000 + 리치봉 1, 도라 3 + 뒷도라 3이 있어도 무시", () => {
    // 도라 표시패 4s -> 5s(555s 3장), 뒷도라 표시패 2p -> 3p(333p 3장): 일반 화료라면 도라 6
    const s = tsumoState(0, SUUANKOU_SHANPON, "7m", {
      riichiSticks: 1,
      scores: [24000, 25000, 25000, 25000],
      deadWall: T(DORA_DEAD),
    });
    expect(uraDoraIndicatorsOf(s)).toEqual(T("2p"));
    const done = dispatch(s, { type: "tsumo", seat: 0 });
    const score = done.result!.wins[0]!.score;
    expect(score.yaku.map((y) => y.id)).toEqual(["suuankou"]);
    expect(score.yakumanCount).toBe(1);
    expect(score.basePoints).toBe(8000);
    expect(score.han).toBe(0);
    expect(score.dora).toBe(0);
    expect(done.result!.deltas).toEqual([48000 + 1000, -16000, -16000, -16000]);
    expect(conserved(done)).toBe(100000);
    expect(done.result!.dealerContinues).toBe(true);
  });

  it("자 스안커 리치 츠모: 친 16000 + 자 8000 x 2 = 32000, 뒷도라 무시", () => {
    const s = tsumoState(2, SUUANKOU_SHANPON, "7m", {
      riichiSticks: 1,
      scores: [25000, 25000, 24000, 25000],
      deadWall: T(DORA_DEAD),
    });
    const done = dispatch(s, { type: "tsumo", seat: 2 });
    expect(done.result!.wins[0]!.score.dora).toBe(0);
    expect(done.result!.deltas).toEqual([-16000, -8000, 32000 + 1000, -8000]);
    expect(conserved(done)).toBe(100000);
  });
});
