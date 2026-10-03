import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import { createFullTileSet, createGame, dispatch } from "@mahjong/core";
import type { CalledMeld, GameState, Tile } from "@mahjong/core";
import { Board } from "./components/Board";
import { ResultModal } from "./components/ResultModal";
import {
  applyAction,
  autoPending,
  createRng,
  humanActions,
  humanMustAct,
  stepAuto,
  summarizeRound,
} from "./controller";
import type { Session } from "./controller";

const all = createFullTileSet(false);
/** 종류별 첫 패 (적5 아님) */
function tile(suit: "man" | "pin" | "sou", rank: number): Tile {
  return all.find((t) => t.kind === "number" && t.suit === suit && t.rank === rank)!;
}
const tiles = (spec: [("man" | "pin" | "sou"), number[]][]): Tile[] =>
  spec.flatMap(([suit, ranks]) => ranks.map((r) => tile(suit, r)));

const noop = () => {};

/**
 * 하가(좌석 1)가 5삭 펑 + 5삭을 뽑아 가깡을 선언하는 상태를 만든다.
 * 사람(좌석 0, 친)은 234m 567m 234p 46s 55p (5삭 간짱 대기, 전부 중장패)로 창깡 론이 가능하다.
 */
function chankanState(): GameState {
  const base = createGame(createRng(1));
  const s5 = tile("sou", 5);
  const pon: CalledMeld = { type: "pon", tiles: [s5, s5, s5], calledTile: s5, fromSeat: 2, from: "across" };
  const human = tiles([["man", [2, 3, 4, 5, 6, 7]], ["pin", [2, 3, 4, 5, 5]], ["sou", [4, 6]]]);
  const botHand = tiles([["man", [1, 3, 7, 9]], ["pin", [1, 3, 7, 9]], ["sou", [1, 9]]]); // 10장
  const drawn = s5;
  const state: GameState = {
    ...base,
    players: base.players.map((p, i) => {
      if (i === 0) return { ...p, hand: human, melds: [], discards: [], riichi: false };
      if (i === 1) return { ...p, hand: [...botHand, drawn], melds: [pon], discards: [], riichi: false };
      return p;
    }),
    phase: "turn",
    turn: 1,
    drawnTile: drawn,
    pending: null,
    anyCalls: true,
  };
  return dispatch(state, { type: "shouminkan", seat: 1, tile: drawn });
}

function session(state: GameState): Session {
  return { seed: 1, rng: createRng(1), state, log: [] };
}

describe("창깡 응답 단계 (웹)", () => {
  it("사람이 창깡 론을 할 수 있으면 사람에게 정지하고 론/패스 버튼만 보인다", () => {
    const state = chankanState();
    expect(state.phase).toBe("response");
    expect(state.pending!.chankan).toBe("shouminkan");
    expect(humanMustAct(state)).toBe(true);
    expect(autoPending(state)).toBe(false);
    expect(stepAuto(session(state))).toBeNull();
    expect(humanActions(state).map((a) => a.type)).toEqual(["ron", "pass"]);

    render(<Board state={state} actions={humanActions(state)} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />);
    const bar = screen.getByRole("group", { name: "행동" });
    expect(within(bar).getAllByRole("button").map((b) => b.textContent)).toEqual(["론", "패스"]);
  });

  it("안내 문구는 가깡 패와 창깡 응답임을 표시하고, 버림패 강조는 하지 않는다", () => {
    const state = chankanState();
    render(<Board state={state} actions={humanActions(state)} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />);
    const note = screen.getByRole("status");
    expect(note.textContent).toBe("하가의 가깡 패 5삭에 대한 응답 (창깡)");
    expect(document.querySelectorAll("[data-response-target]")).toHaveLength(0);
  });

  it("론 버튼은 론 행동을 전달한다", () => {
    const state = chankanState();
    const onAction = vi.fn();
    render(<Board state={state} actions={humanActions(state)} riichiMode={false} onToggleRiichi={noop} onAction={onAction} log={[]} />);
    fireEvent.click(screen.getByRole("button", { name: "론" }));
    expect(onAction).toHaveBeenCalledWith({ type: "ron", seat: 0 });
  });

  it("사람이 론하면 결과 요약에 창깡/탕야오가 표시되고 깡 선언자가 지불한다 (친 론 2판 40부 = 3900)", () => {
    const state = chankanState();
    const next = applyAction(session(state), { type: "ron", seat: 0 });
    expect(next.state.phase).toBe("roundEnd");
    const summary = summarizeRound(next.state);
    const win = summary.wins[0]!;
    expect(win.from).toBe(1);
    expect(win.yaku.map((y) => y.name).sort()).toEqual(["창깡", "탕야오"]);
    expect(win.han).toBe(2);
    expect(win.fu).toBe(40);
    expect(win.handPoints).toBe(3900); // 40 x 2^4 = 640, 친 론 x 6 = 3840 -> 3900
    expect(summary.deltas).toEqual([3900, -3900, 0, 0]);

    render(<ResultModal summary={summary} onNext={noop} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("창깡")).toBeTruthy();
    expect(within(dialog).getByText("탕야오")).toBeTruthy();
  });

  it("사람이 패스하면 깡이 진행되고 봇이 영상패 뒤 이어서 진행한다", () => {
    const state = chankanState();
    const next = applyAction(session(state), { type: "pass", seat: 0 });
    expect(next.state.kanSeats).toEqual([1]);
    expect(next.state.phase).toBe("turn");
    expect(next.state.turn).toBe(1);
    // 봇(좌석 1)이 이어서 진행한다 (사람의 선택이 필요하지 않다)
    expect(autoPending(next.state)).toBe(true);
  });

  it("새 역은 YAKU_NAMES 표기로 결과 모달에 표시된다 (천화 = 역만)", () => {
    const base = createGame(createRng(1));
    // 234m 567m 2345p 678s (13장) + 5p 츠모 = 234m 567m 234p 55p 678s, 친의 첫 츠모
    const waiting = tiles([["man", [2, 3, 4, 5, 6, 7]], ["pin", [2, 3, 4, 5]], ["sou", [6, 7, 8]]]);
    const state: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === 0 ? { ...p, hand: [...waiting, tile("pin", 5)], melds: [], discards: [] } : p)),
      drawnTile: tile("pin", 5),
      phase: "turn",
      turn: 0,
      anyCalls: false,
    };
    const summary = summarizeRound(dispatch(state, { type: "tsumo", seat: 0 }));
    expect(summary.wins[0]!.yaku.map((y) => y.name)).toEqual(["천화"]);
    expect(summary.wins[0]!.limit).toBe("역만");
    render(<ResultModal summary={summary} onNext={noop} />);
    expect(within(screen.getByRole("dialog")).getByText("천화")).toBeTruthy();
  });
});
