import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createFullTileSet, createGame, dispatch, legalActions } from "@mahjong/core";
import type { GameState, Tile } from "@mahjong/core";
import { Board } from "./components/Board";
import { ResultModal } from "./components/ResultModal";
import { createRng, summarizeRound } from "./controller";

const all = createFullTileSet(false);
function num(suit: "man" | "pin" | "sou", rank: number): Tile {
  return all.find((t) => t.kind === "number" && t.suit === suit && t.rank === rank)!;
}
const east: Tile = all.find((t) => t.kind === "wind" && t.wind === "east")!;
const south: Tile = all.find((t) => t.kind === "wind" && t.wind === "south")!;
const noop = () => {};

/** 화료/텐파이가 없는 13장 */
const junk = (): Tile[] => [
  num("man", 1), num("man", 3), num("man", 7), num("man", 9),
  num("pin", 1), num("pin", 3), num("pin", 7), num("pin", 9),
  num("sou", 1), num("sou", 3), num("sou", 7), num("sou", 9),
  south,
];

function entry(tile: Tile) {
  return { tile, riichi: false, tsumogiri: false, calledBy: null };
}

/** 좌석 0(친)이 마지막 산패 이후 east 를 버리면 황패평국. 좌석 0의 기존 버림패는 모두 요구패. */
function exhaustiveState(withNagashi: boolean): GameState {
  const base = createGame(createRng(1));
  return {
    ...base,
    players: base.players.map((p, i) => ({
      hand: i === 0 ? [...junk(), east] : junk(),
      melds: [],
      discards: i === 0 ? [entry(num("man", withNagashi ? 1 : 5))] : [],
      riichi: false,
    })),
    liveWall: [],
    drawnTile: east,
    phase: "turn",
    turn: 0,
    anyCalls: true,
  };
}

describe("유국만관 결과 모달 (웹)", () => {
  it("summarizeRound: 달성 좌석과 점수 변동", () => {
    const done = dispatch(exhaustiveState(true), { type: "discard", seat: 0, tile: east });
    const summary = summarizeRound(done);
    expect(summary.kind).toBe("draw");
    expect(summary.nagashiMangan).toEqual([0]);
    expect(summary.deltas).toEqual([12000, -4000, -4000, -4000]);
  });

  it("ResultModal: 유국만관 달성 좌석과 점수 변동을 표시하고 노텐 벌부 문구는 없다", () => {
    const done = dispatch(exhaustiveState(true), { type: "discard", seat: 0, tile: east });
    render(<ResultModal summary={summarizeRound(done)} onNext={noop} />);
    const dialog = screen.getByRole("dialog");
    const info = within(dialog).getByLabelText("유국만관");
    expect(info.textContent).toContain("유국만관");
    expect(info.textContent).toContain("+12000");
    expect(dialog.textContent).toContain("유국만관이 있어 노텐 벌부 없음");
    expect(dialog.textContent).not.toContain("노텐 벌부 총 3000점");
  });

  it("달성자가 없으면 기존 표시 그대로", () => {
    const done = dispatch(exhaustiveState(false), { type: "discard", seat: 0, tile: east });
    const summary = summarizeRound(done);
    expect(summary.nagashiMangan ?? []).toEqual([]);
    render(<ResultModal summary={summary} onNext={noop} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).queryByLabelText("유국만관")).toBeNull();
    expect(dialog.textContent).toContain("노텐 벌부 총 3000점");
  });
});

describe("쿠이가에시 (웹)", () => {
  /** 좌석 3(상가가 아님)... 사람은 좌석 0. 좌석 3이 3m 을 버리고 사람(좌석 0)이 4m5m 으로 치한 직후. */
  function afterChi(): GameState {
    const base = createGame(createRng(1));
    const hand0 = [num("man", 4), num("man", 5), num("man", 6), num("pin", 1), num("pin", 3), num("pin", 7), num("pin", 9), num("sou", 1), num("sou", 3), num("sou", 7), num("sou", 9), south, east];
    const s: GameState = {
      ...base,
      players: base.players.map((p, i) => ({
        hand: i === 0 ? hand0 : i === 3 ? [...junk(), num("man", 3)] : junk(),
        melds: [],
        discards: [],
        riichi: false,
      })),
      liveWall: Array.from({ length: 10 }, () => num("sou", 2)),
      drawnTile: num("man", 3),
      phase: "turn",
      turn: 3,
      anyCalls: true,
    };
    let st = dispatch(s, { type: "discard", seat: 3, tile: num("man", 3) });
    const chi = legalActions(st, 0).find(
      (a) => a.type === "chi" && a.use.every((t) => t.kind === "number" && (t.rank === 4 || t.rank === 5)),
    )!;
    st = dispatch(st, chi);
    return st;
  }

  it("치 직후 금지된 패는 타패 버튼이 비활성이고 안내 문구가 보인다", () => {
    const state = afterChi();
    expect(state.turn).toBe(0);
    const actions = legalActions(state, 0);
    render(<Board state={state} actions={actions} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />);
    expect(screen.getByRole("status").textContent).toContain("쿠이가에시: 3만, 6만 버릴 수 없음");
    const hand = screen.getByLabelText("내 손패");
    const buttons = within(hand).getAllByRole("button") as HTMLButtonElement[];
    const disabled = buttons.filter((b) => b.disabled);
    // 손패에는 6m 1장과 3m 은 없으므로(가져온 3m 은 멜드) 금지로 비활성인 것은 6m 1장
    expect(disabled).toHaveLength(1);
    expect(disabled[0]!.getAttribute("aria-label")).toContain("6만");
  });

  it("금지가 없으면 안내 문구가 없다", () => {
    const base = createGame(createRng(1));
    render(<Board state={base} actions={legalActions(base, 0)} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />);
    expect(screen.queryByText(/쿠이가에시/)).toBeNull();
  });
});
