import { describe, expect, it } from "vitest";
import { awaitingSeats, createGame, decideAction, dispatch, legalActions, startNextRound } from "@mahjong/core";
import type { Action, GameState, Seat } from "@mahjong/core";
import { createRng, humanTenpaiView, isRoundOver, summarizeRound } from "../controller";
import {
  clientActionFromView,
  seatLayout,
  seatName,
  seatPosition,
  summarizeFromView,
  tenpaiViewFromSeatView,
  toClientAction,
} from "./fromView";
import { viewFor } from "./seatView";

const SEATS: Seat[] = [0, 1, 2, 3];

interface Stats {
  states: number;
  tenpaiStates: number;
  riichi14: number;
  hints: number;
  summaries: number;
  wins: number;
  kuikaeStates: number;
  tempFuriten: number;
}

/** 봇 4명으로 반장전을 끝까지 진행하며 매 상태를 visit에 넘긴다. */
function simulate(seed: number, visit: (state: GameState) => void): void {
  const rng = createRng(seed);
  let state = createGame(rng);
  for (let guard = 0; guard < 20000; guard++) {
    visit(state);
    if (state.phase === "gameEnd") return;
    if (isRoundOver(state)) {
      state = startNextRound(state, rng);
      continue;
    }
    const seat = awaitingSeats(state)[0];
    if (seat === undefined) throw new Error("진행 불가");
    // 론은 절반 확률로 넘겨 동순/리치 후 임시 후리텐 상태를 만든다
    const legal = legalActions(state, seat);
    const pass = legal.find((a) => a.type === "pass");
    if (pass && legal.some((a) => a.type === "ron") && rng() < 0.5) {
      state = dispatch(state, pass);
      continue;
    }
    // 부로(치/펑/대명깡)를 절반 확률로 우선해 쿠이가에시 상태를 자주 만든다
    const calls = legal.filter((a) => a.type === "chi" || a.type === "pon" || a.type === "daiminkan");
    const action = calls.length > 0 && rng() < 0.5 ? calls[Math.floor(rng() * calls.length)]! : decideAction(state, seat, rng);
    state = dispatch(state, action);
  }
  throw new Error("게임이 끝나지 않았습니다");
}

function compareAll(seeds: number[], seats: Seat[]): Stats {
  const st: Stats = { states: 0, tenpaiStates: 0, riichi14: 0, hints: 0, summaries: 0, wins: 0, kuikaeStates: 0, tempFuriten: 0 };
  for (const seed of seeds) {
    simulate(seed, (state) => {
      for (const seat of seats) {
        const view = viewFor(state, seat);
        if (isRoundOver(state)) {
          expect(tenpaiViewFromSeatView(view)).toBeNull();
          expect(humanTenpaiView(state, seat)).toBeNull();
          if (state.result !== null) {
            const expected = summarizeRound(state);
            expect(summarizeFromView(view)).toEqual(expected);
            if (seat === seats[0]) {
              st.summaries++;
              st.wins += expected.wins.length;
            }
          }
          continue;
        }
        const expected = humanTenpaiView(state, seat);
        const actual = tenpaiViewFromSeatView(view);
        if (JSON.stringify(actual) !== JSON.stringify(expected)) {
          throw new Error(`불일치 seed=${seed} seat=${seat} phase=${state.phase}\n${JSON.stringify({ expected, actual })}`);
        }
        expect(actual).toEqual(expected);
        st.states++;
        if (actual!.tenpai) st.tenpaiStates++;
        if (actual!.discardHints.length > 0) st.hints++;
        const p = state.players[seat]!;
        if (p.riichi && state.phase === "turn" && state.turn === seat) st.riichi14++;
        if (view.kuikae.length > 0) st.kuikaeStates++;
        if (actual!.tenpai && state.furitenTemp[seat]) st.tempFuriten++;
      }
    });
  }
  return st;
}

describe("동치: humanTenpaiView(state, seat) vs tenpaiViewFromSeatView(viewFor(state, seat))", () => {
  it("좌석 0 기준, 봇 4명 반장전 다수 시드의 모든 상태와 결과", () => {
    const st = compareAll([1, 2, 3, 4, 5, 6, 7, 8], [0]);
    expect(st.states).toBeGreaterThan(2000);
    expect(st.tenpaiStates).toBeGreaterThan(50);
    expect(st.riichi14).toBeGreaterThan(5);
    expect(st.hints).toBeGreaterThan(10);
    expect(st.summaries).toBeGreaterThan(8);
    expect(st.wins).toBeGreaterThan(5);
  });

  it("좌석 0~3 모두 같은 동치 (사람 좌석이 0이 아니어도 성립)", () => {
    const st = compareAll([21, 22, 23], SEATS);
    expect(st.states).toBeGreaterThan(2000);
    expect(st.kuikaeStates).toBeGreaterThan(0);
    expect(st.tempFuriten).toBeGreaterThan(0);
  });
});

describe("toClientAction / clientActionFromView", () => {
  it("seat를 제거하고 나머지 필드는 유지", () => {
    const tile = { kind: "number", suit: "man", rank: 5, isRedFive: false } as const;
    expect(toClientAction({ type: "discard", seat: 2, tile, riichi: true })).toEqual({ type: "discard", tile, riichi: true });
    expect(toClientAction({ type: "pass", seat: 3 })).toEqual({ type: "pass" });
    expect("seat" in toClientAction({ type: "tsumo", seat: 1 })).toBe(false);
  });

  it("view.legalActions에서 고른 행동은 그대로 전달, 합법이 아니면 null", () => {
    const state = createGame(createRng(5));
    const view = viewFor(state, state.turn);
    expect(view.legalActions.length).toBeGreaterThan(0);
    for (const a of view.legalActions) {
      const sent = clientActionFromView(view, a);
      expect(sent).toEqual(toClientAction(a));
      // 서버가 seat를 붙여 합법 행동으로 인식할 수 있다
      expect(legalActions(state, view.seat)).toContainEqual({ ...sent, seat: view.seat } as Action);
    }
    const illegal: Action = { type: "ron", seat: view.seat };
    expect(clientActionFromView(view, illegal)).toBeNull();
  });
});

describe("좌석 회전", () => {
  it("Board 고정 배치와 일치 (내 좌석 0: 2=위, 3=왼쪽, 1=오른쪽)", () => {
    expect(seatPosition(0, 0)).toBe("self");
    expect(seatPosition(1, 0)).toBe("right");
    expect(seatPosition(2, 0)).toBe("across");
    expect(seatPosition(3, 0)).toBe("left");
    expect(seatLayout(0)).toEqual({ top: 2, left: 3, right: 1, bottom: 0 });
  });
  it("내 좌석 2이면 3=오른쪽, 0=위, 1=왼쪽", () => {
    expect(seatPosition(2, 2)).toBe("self");
    expect(seatPosition(3, 2)).toBe("right");
    expect(seatPosition(0, 2)).toBe("across");
    expect(seatPosition(1, 2)).toBe("left");
    expect(seatLayout(2)).toEqual({ top: 0, left: 1, right: 3, bottom: 2 });
  });
  it("표시 이름은 상대 위치 기준 (SEAT_NAMES 대응)", () => {
    expect(SEATS.map((s) => seatName(s, 0))).toEqual(["나", "하가", "대면", "상가"]);
    expect(SEATS.map((s) => seatName(s, 3))).toEqual(["하가", "대면", "상가", "나"]);
    for (const my of SEATS) expect(seatName(my, my)).toBe("나");
  });
});
