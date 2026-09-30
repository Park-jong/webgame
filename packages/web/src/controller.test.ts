import { describe, expect, it } from "vitest";
import { decideAction, sameExactTile } from "@mahjong/core";
import type { Action, GameState } from "@mahjong/core";
import {
  HUMAN_SEAT,
  advance,
  applyAction,
  autoPending,
  beginNextRound,
  createRng,
  finalRanking,
  humanActions,
  humanMustAct,
  isRoundOver,
  newSession,
  stepAuto,
  summarizeRound,
} from "./controller";
import type { RoundSummary, Session } from "./controller";

const TOTAL_POINTS = 100000;

type Policy = (state: GameState, actions: Action[]) => Action;

/** 항상 패스, 패스가 없으면 뽑은 패(없으면 마지막 패)를 그대로 버린다. */
const passTsumogiri: Policy = (state, actions) => {
  const pass = actions.find((a) => a.type === "pass");
  if (pass) return pass;
  const discards = actions.filter((a) => a.type === "discard" && a.riichi !== true);
  const drawn = state.drawnTile;
  const match = drawn ? discards.find((a) => a.type === "discard" && sameExactTile(a.tile, drawn)) : undefined;
  return match ?? discards[discards.length - 1]!;
};

function randomPolicy(seed: number): Policy {
  const rng = createRng(seed);
  return (_state, actions) => actions[Math.floor(rng() * actions.length)]!;
}

interface RunResult {
  session: Session;
  summaries: RoundSummary[];
  stops: number;
}

/** 게임이 끝날 때까지 사람 자리를 policy로 진행한다. 매 정지 시점의 불변식을 검사한다. */
function playToEnd(seed: number, policy: Policy): RunResult {
  let session = advance(newSession(seed));
  const summaries: RoundSummary[] = [];
  let stops = 0;
  for (let guard = 0; guard < 20000; guard++) {
    const { state } = session;
    // 점수 + 공탁 리치봉은 항상 보존된다
    expect(state.scores.reduce((a, b) => a + b, 0) + 1000 * state.riichiSticks).toBe(TOTAL_POINTS);
    if (isRoundOver(state)) {
      summaries.push(summarizeRound(state));
      if (state.phase === "gameEnd") return { session, summaries, stops };
      session = advance(beginNextRound(session));
      continue;
    }
    // 정지했다면 사람이 실제로 선택할 수 있어야 한다
    expect(humanMustAct(state)).toBe(true);
    stops++;
    const actions = humanActions(state);
    expect(actions.length).toBeGreaterThan(0);
    session = advance(applyAction(session, policy(state, actions)));
  }
  throw new Error("게임이 끝나지 않았습니다");
}

describe("createRng", () => {
  it("같은 시드는 같은 수열, 값은 [0, 1)", () => {
    const a = createRng(42);
    const b = createRng(42);
    const seqA = Array.from({ length: 20 }, () => a());
    expect(seqA).toEqual(Array.from({ length: 20 }, () => b()));
    expect(seqA.every((v) => v >= 0 && v < 1)).toBe(true);
    expect(createRng(43)()).not.toBe(seqA[0]);
  });
});

describe("세션 시작", () => {
  it("같은 시드는 같은 배패, 사람(친)이 첫 차례", () => {
    const a = newSession(7);
    const b = newSession(7);
    expect(a.state.players[0]!.hand).toEqual(b.state.players[0]!.hand);
    expect(a.state.phase).toBe("turn");
    expect(a.state.turn).toBe(HUMAN_SEAT);
    expect(humanMustAct(a.state)).toBe(true);
    expect(a.state.scores).toEqual([25000, 25000, 25000, 25000]);
  });

  it("사람 차례에는 봇이 진행하지 않는다 (stepAuto는 null)", () => {
    const s = newSession(7);
    expect(autoPending(s.state)).toBe(false);
    expect(stepAuto(s)).toBeNull();
    expect(advance(s).state).toBe(s.state);
  });
});

describe("advance", () => {
  it("사람이 타패하면 봇이 진행하고 사람 차례(또는 국 종료)에서 멈춘다", () => {
    let s = newSession(11);
    const first = humanActions(s.state).find((a) => a.type === "discard")!;
    s = applyAction(s, first);
    // 사람의 타패 직후에는 봇이 응답/진행해야 하는 상태거나 이미 사람 차례
    s = advance(s);
    expect(isRoundOver(s.state) || humanMustAct(s.state)).toBe(true);
    expect(s.log.length).toBeGreaterThan(1);
    expect(s.log[1]).toContain("나:");
  });
});

/**
 * 사람 자리를 봇 AI(decideAction)로 진행하다가, 사람이 리치 중이고 츠모 가능한 정지 시점을 찾는다.
 * 시드를 바꿔가며 탐색한다. 찾지 못하면 null.
 */
function findRiichiTsumoStop(): Session | null {
  for (let seed = 1; seed <= 400; seed++) {
    let session = advance(newSession(seed));
    for (let guard = 0; guard < 3000; guard++) {
      const { state } = session;
      if (isRoundOver(state)) {
        if (state.phase === "gameEnd") break;
        session = advance(beginNextRound(session));
        continue;
      }
      const actions = humanActions(state);
      if (state.phase === "turn" && state.turn === HUMAN_SEAT && state.players[HUMAN_SEAT]!.riichi) {
        if (actions.some((a) => a.type === "tsumo")) return session;
      }
      session = advance(applyAction(session, decideAction(state, HUMAN_SEAT, session.rng)));
    }
  }
  return null;
}

describe("리치 후 자동 타패", () => {
  it("리치 중이라도 츠모 가능하면(츠모+타패 선택지) 자동 타패하지 않고 사람에게 선택지를 준다", () => {
    const session = findRiichiTsumoStop();
    expect(session).not.toBeNull();
    const { state } = session!;
    const actions = humanActions(state);

    // 규칙: 선택지는 츠모 1개 + 타패(리치 후에는 뽑은 패 츠모기리뿐) => 2개 이상
    expect(state.players[HUMAN_SEAT]!.riichi).toBe(true);
    expect(actions.filter((a) => a.type === "tsumo")).toHaveLength(1);
    expect(actions.filter((a) => a.type === "discard").length).toBeGreaterThanOrEqual(1);
    expect(actions.length).toBeGreaterThanOrEqual(2);

    // 자동 진행은 멈춰야 한다 (기본 옵션과 명시 옵션 모두)
    expect(humanMustAct(state)).toBe(true);
    expect(autoPending(state)).toBe(false);
    expect(stepAuto(session!)).toBeNull();
    expect(stepAuto(session!, { autoRiichiDiscard: true })).toBeNull();
    expect(advance(session!).state).toBe(state);

    // 사람이 츠모를 고르면 화료로 끝난다
    const after = applyAction(session!, actions.find((a) => a.type === "tsumo")!);
    expect(isRoundOver(after.state)).toBe(true);
    expect(summarizeRound(after.state).winType).toBe("tsumo");
  });

  it("리치 중 정지 시점은 항상 츠모기리 외 선택지(츠모/안깡)가 있다 (츠모기리뿐이면 자동 진행)", () => {
    let checkedRiichiStops = 0;
    for (let seed = 1; seed <= 60; seed++) {
      let session = advance(newSession(seed));
      for (let guard = 0; guard < 3000; guard++) {
        const { state } = session;
        if (isRoundOver(state)) break;
        if (state.phase === "turn" && state.turn === HUMAN_SEAT && state.players[HUMAN_SEAT]!.riichi) {
          const actions = humanActions(state);
          expect(actions.length).toBeGreaterThanOrEqual(2);
          expect(actions.some((a) => a.type !== "discard")).toBe(true);
          checkedRiichiStops++;
        }
        session = advance(applyAction(session, decideAction(state, HUMAN_SEAT, session.rng)));
      }
    }
    expect(checkedRiichiStops).toBeGreaterThan(0);
  }, 60000);
});

describe("게임 끝까지 진행", () => {
  const seeds = [1, 2, 3, 4, 5, 6];

  it.each(seeds)("항상 패스+츠모기리, 시드 %i: 게임이 끝나고 점수가 보존된다", (seed) => {
    const { session, summaries } = playToEnd(seed, passTsumogiri);
    expect(session.state.phase).toBe("gameEnd");
    expect(summaries.length).toBeGreaterThanOrEqual(4);
    expect(summaries[summaries.length - 1]!.gameOver).toBe(true);
    expect(summaries.slice(0, -1).every((s) => !s.gameOver)).toBe(true);
    const ranking = finalRanking(session.state.scores);
    expect(ranking.map((r) => r.rank)).toEqual([1, 2, 3, 4]);
    for (let i = 1; i < 4; i++) expect(ranking[i - 1]!.score).toBeGreaterThanOrEqual(ranking[i]!.score);
  });

  it.each(seeds)("임의 합법 행동, 시드 %i: 게임이 끝나고 점수가 보존된다", (seed) => {
    const { session, stops } = playToEnd(seed, randomPolicy(seed * 101));
    expect(session.state.phase).toBe("gameEnd");
    expect(stops).toBeGreaterThan(0);
  });

  it("같은 시드/정책이면 결과가 완전히 같다", () => {
    const a = playToEnd(9, passTsumogiri);
    const b = playToEnd(9, passTsumogiri);
    expect(a.session.state.scores).toEqual(b.session.state.scores);
    expect(a.session.log).toEqual(b.session.log);
  });

  it("여러 시드에서 화료/유국 요약이 모두 나오고 데이터가 정합적이다", () => {
    const all: RoundSummary[] = [];
    for (let seed = 1; seed <= 12; seed++) all.push(...playToEnd(seed, randomPolicy(seed)).summaries);
    const wins = all.filter((s) => s.kind === "win");
    const draws = all.filter((s) => s.kind === "draw");
    expect(wins.length).toBeGreaterThan(0);
    expect(draws.length).toBeGreaterThan(0);

    for (const s of wins) {
      expect(s.drawName).toBeNull();
      expect(s.deltas.reduce((a, b) => a + b, 0)).toBeGreaterThanOrEqual(0); // 공탁 수령분만큼 증가
      for (const w of s.wins) {
        expect(w.yaku.length).toBeGreaterThan(0);
        expect(w.yaku.every((y) => y.name.length > 0 && y.han > 0)).toBe(true);
        // 총 판수 = 역 판수 합 + 도라 (역만은 판수 계산이 다를 수 있어 제외)
        if (!w.limit || w.limit !== "역만") {
          expect(w.han).toBe(w.yaku.reduce((a, y) => a + y.han, 0) + w.dora);
        }
        // 손패 장수: 13 - 3 x 멜드 수 (화료패 제외)
        expect(w.hand.length).toBe(13 - 3 * w.melds.length);
        expect(s.deltas[w.seat]).toBe(w.total);
        // 수령 합계 = 화료 점수 + 본장 + 리치봉 (분리 표시 신뢰성)
        expect(w.handPoints + w.honbaPoints + w.riichiPoints).toBe(w.total);
        expect(w.handPoints).toBeGreaterThan(0);
        expect(w.honbaPoints % 100).toBe(0);
        expect(w.riichiPoints % 1000).toBe(0);
        if (w.from === null) expect(s.winType).toBe("tsumo");
        else {
          expect(s.winType).toBe("ron");
          expect(s.deltas[w.from]).toBeLessThan(0);
        }
      }
      // 뒷도라는 리치 화료가 있을 때만 공개
      expect(s.uraDoraIndicators.length > 0).toBe(s.wins.some((w) => w.riichi));
      if (s.wins.some((w) => w.riichi)) expect(s.uraDoraIndicators.length).toBe(s.doraIndicators.length);
    }

    for (const s of draws) {
      expect(s.wins).toEqual([]);
      expect(s.drawName).not.toBeNull();
      expect(s.uraDoraIndicators).toEqual([]);
      if (s.drawName === "황패평국") {
        // 노텐 벌부: 전원 텐파이/노텐이면 변동 없음, 아니면 총 3000점 이동
        const tenpaiCount = s.tenpai!.filter(Boolean).length;
        const moved = s.deltas.filter((d) => d > 0).reduce((a, b) => a + b, 0);
        expect(moved).toBe(tenpaiCount === 0 || tenpaiCount === 4 ? 0 : 3000);
        expect(s.deltas.reduce((a, b) => a + b, 0)).toBe(0);
      } else {
        expect(s.deltas).toEqual([0, 0, 0, 0]);
      }
    }
  }, 60000);
});

describe("summarizeRound", () => {
  it("진행 중인 국에서는 에러", () => {
    expect(() => summarizeRound(newSession(1).state)).toThrow();
  });

  it("finalRanking: 동점은 좌석 번호 순", () => {
    expect(finalRanking([20000, 30000, 30000, 20000])).toEqual([
      { seat: 1, score: 30000, rank: 1 },
      { seat: 2, score: 30000, rank: 2 },
      { seat: 0, score: 20000, rank: 3 },
      { seat: 3, score: 20000, rank: 4 },
    ]);
  });
});
