import { describe, expect, it } from "vitest";
import type { GameState } from "./game.js";
import { awaitingSeats, createGame, dispatch, legalActions, startNextRound } from "./game.js";
import { decideAction } from "./bot.js";

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

/** 전체 패 수: 손패 + 멜드 + (가져가지 않은) 버림패 + 산패 + 왕패 */
function countTiles(state: GameState): number {
  let total = state.liveWall.length + state.deadWall.length;
  for (const p of state.players) {
    total += p.hand.length;
    total += p.melds.reduce((n, m) => n + m.tiles.length, 0);
    total += p.discards.filter((d) => d.calledBy === null).length;
  }
  return total;
}

/** 점수 + 공탁 + (아직 지불하지 않은 리치 선언 1000점) 총합 */
function totalPoints(state: GameState): number {
  return state.scores.reduce((a, b) => a + b, 0) + 1000 * state.riichiSticks;
}

const STEP_LIMIT_PER_ROUND = 2000;

interface Stats {
  rounds: number;
  tsumo: number;
  ron: number;
  exhaustive: number;
  abortive: number;
  doubleRon: number;
  riichiWins: number;
  meldWins: number;
}

function playRound(start: GameState, rng: () => number, stats: Stats): GameState {
  let state = start;
  let steps = 0;
  while (state.phase === "turn" || state.phase === "response") {
    if (++steps > STEP_LIMIT_PER_ROUND) throw new Error("스텝 상한 초과 (무한루프 의심)");
    for (const seat of awaitingSeats(state)) {
      state = dispatch(state, decideAction(state, seat, rng));
      // (d) 패 136장 보존, (b) 점수 보존은 매 스텝 확인 (지불 전 리치 선언 1000점은 아직 점수에 반영되지 않았을 뿐)
      expect(countTiles(state)).toBe(136);
      expect(totalPoints(state)).toBe(100000);
      if (state.phase !== "turn" && state.phase !== "response") break;
    }
  }

  const result = state.result!;
  stats.rounds++;
  if (result.type === "tsumo" || result.type === "ron") {
    // (e) 화료 국: 점수 계산이 유효하고, 화료자가 받은 금액이 점수 결과와 일치
    for (const win of result.wins) {
      expect(win.score.kind).toBe("scored");
      expect(win.score.han).toBeGreaterThanOrEqual(1);
      expect(win.score.yaku.length).toBeGreaterThan(0);
      expect(win.score.total).toBeGreaterThan(0);
    }
    // 화료자의 점수 증감은 calculateScore 결과의 총 수령액과 같다 (본장/리치봉 포함)
    for (const win of result.wins) expect(result.deltas[win.seat]).toBe(win.score.total);
    const head = result.wins[0]!;
    const p = state.players[head.seat]!;
    if (result.type === "tsumo") stats.tsumo++;
    else stats.ron++;
    if (result.wins.length === 2) stats.doubleRon++;
    if (p.riichi) stats.riichiWins++;
    if (p.melds.length > 0) stats.meldWins++;
    expect(result.dealerContinues).toBe(result.wins.some((w) => w.seat === state.dealer));
  } else if (result.type === "exhaustive") {
    stats.exhaustive++;
    expect(state.liveWall.length).toBe(0);
  } else {
    stats.abortive++;
  }
  return state;
}

describe("봇 4명 시뮬레이션", () => {
  it("여러 게임을 끝까지 진행해도 예외/무한루프 없이 종료하고 점수·패 수가 보존된다", () => {
    const stats: Stats = { rounds: 0, tsumo: 0, ron: 0, exhaustive: 0, abortive: 0, doubleRon: 0, riichiWins: 0, meldWins: 0 };
    const finalScores: number[][] = [];
    const GAMES = 30;

    for (let g = 0; g < GAMES; g++) {
      const rng = seeded(1000 + g);
      let state = createGame(rng);
      let roundsInGame = 0;
      for (;;) {
        state = playRound(state, rng, stats);
        // 국 종료 시점: 점수 + 공탁 = 100000
        expect(totalPoints(state)).toBe(100000);
        if (++roundsInGame > 200) throw new Error("게임이 끝나지 않음");
        if (state.phase === "gameEnd") break;
        state = startNextRound(state, rng);
      }
      finalScores.push([...state.scores]);
    }

    expect(stats.rounds).toBeGreaterThanOrEqual(100);
    // 화료/유국 분포가 모두 나타나야 한다
    expect(stats.tsumo).toBeGreaterThan(0);
    expect(stats.ron).toBeGreaterThan(0);
    expect(stats.exhaustive).toBeGreaterThan(0);
    expect(stats.riichiWins).toBeGreaterThan(0);
    expect(stats.tsumo + stats.ron).toBeGreaterThan(0);
    expect(finalScores).toHaveLength(GAMES);
  }, 180_000);

  it("무작위 합법 행동 퍼즈: 치/펑/깡 포함 (구종구패는 희귀해 game.test.ts에서 검증), 불변식 유지 (deadWall 14장, 136장, 점수 보존)", () => {
    const counts: Record<string, number> = {};
    const SPECIAL = new Set(["chi", "pon", "daiminkan", "ankan", "shouminkan", "kyuushu"]);
    const GAMES = 24;
    const ROUNDS_PER_GAME = 4;
    const STEP_LIMIT = 3000;

    for (let g = 0; g < GAMES; g++) {
      const rng = seeded(5000 + g);
      let state = createGame(rng);
      let steps = 0;
      for (let round = 0; round < ROUNDS_PER_GAME; round++) {
        while (state.phase === "turn" || state.phase === "response") {
          if (++steps > STEP_LIMIT) throw new Error("스텝 상한 초과 (무한루프 의심)");
          const seat = awaitingSeats(state)[0]!;
          const actions = legalActions(state, seat);
          expect(actions.length).toBeGreaterThan(0);
          // 일정 스텝마다 모든 합법 행동이 dispatch에 성공하는지 확인 (입력 상태는 불변)
          if (steps % 7 === 0) for (const a of actions) dispatch(state, a);
          const specials = actions.filter((a) => SPECIAL.has(a.type));
          const pool = specials.length > 0 && rng() < 0.7 ? specials : actions;
          const chosen = pool[Math.floor(rng() * pool.length)]!;
          counts[chosen.type] = (counts[chosen.type] ?? 0) + 1;
          state = dispatch(state, chosen);
          expect(countTiles(state)).toBe(136);
          expect(state.deadWall.length).toBe(14);
          expect(new Set(state.deadWall).size).toBe(14);
          expect(totalPoints(state)).toBe(100000);
        }
        if (state.phase === "gameEnd") break;
        state = startNextRound(state, rng);
      }
    }

    for (const type of ["chi", "pon", "daiminkan", "ankan"]) {
      expect(counts[type] ?? 0, `${type} 행동이 퍼즈에서 한 번도 선택되지 않음`).toBeGreaterThan(0);
    }
  }, 180_000);

  it("같은 시드의 시뮬레이션은 같은 결과", () => {
    const run = () => {
      const rng = seeded(99);
      const stats: Stats = { rounds: 0, tsumo: 0, ron: 0, exhaustive: 0, abortive: 0, doubleRon: 0, riichiWins: 0, meldWins: 0 };
      const end = playRound(createGame(rng), rng, stats);
      return { scores: end.scores, result: end.result };
    };
    expect(run()).toEqual(run());
  });
});
