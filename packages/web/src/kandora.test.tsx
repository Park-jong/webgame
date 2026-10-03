import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createFullTileSet, createGame, dispatch } from "@mahjong/core";
import type { CalledMeld, GameState, Tile } from "@mahjong/core";
import { Board } from "./components/Board";
import { ResultModal } from "./components/ResultModal";
import { createRng, summarizeRound } from "./controller";

const all = createFullTileSet(false);
function num(suit: "man" | "pin" | "sou", rank: number): Tile {
  return all.find((t) => t.kind === "number" && t.suit === suit && t.rank === rank)!;
}
const white: Tile = all.find((t) => t.kind === "dragon" && t.dragon === "white")!;
const red: Tile = all.find((t) => t.kind === "dragon" && t.dragon === "red")!;
const noop = () => {};

/**
 * 좌석 0(친): 안깡(1m x4) 1회 후 리치한 상태에서 5z 단기 대기를 츠모한다.
 * 손패 234p 567p 789s + 5z 츠모. 표시패는 겉 [9m, 4p], 뒷 [6s, 6p] 이므로
 * 도라: 1m x4(깡 멜드) + 5p 1 (겉깡) + 7s 1 (뒷) + 7p 1 (뒷깡) = 7.
 */
function kanRiichiState(): GameState {
  const base = createGame(createRng(1));
  const m1 = num("man", 1);
  const ankan: CalledMeld = { type: "ankan", tiles: [m1, m1, m1, m1] };
  const hand = [num("pin", 2), num("pin", 3), num("pin", 4), num("pin", 5), num("pin", 6), num("pin", 7), num("sou", 7), num("sou", 8), num("sou", 9)];
  const drawn = white;
  const deadWall: Tile[] = [
    red, red, red, red, // 영상패
    num("man", 9), num("pin", 4), red, red, red, // 겉도라 표시패 자리
    num("sou", 6), num("pin", 6), red, red, red, // 뒷도라 표시패 자리
  ];
  // 멜드 1개이므로 손패는 14 - 3 = 11장: 234p 567p 789s + 백 단기 + 뽑은 백
  return {
    ...base,
    players: base.players.map((p, i) =>
      i === 0 ? { ...p, hand: [...hand, white, drawn], melds: [ankan], discards: [], riichi: true } : p,
    ),
    deadWall,
    doraCount: 2,
    drawnTile: drawn,
    phase: "turn",
    turn: 0,
    anyCalls: true,
  };
}

describe("깡도라 표시 (웹)", () => {
  it("summarizeRound: 겉/깡/뒷/뒷깡 도라가 합산되고 표시패는 겉 2장, 뒷 2장이다", () => {
    const state = dispatch(kanRiichiState(), { type: "tsumo", seat: 0 });
    const summary = summarizeRound(state);
    const win = summary.wins[0]!;
    expect(summary.doraIndicators).toEqual([num("man", 9), num("pin", 4)]);
    expect(summary.uraDoraIndicators).toEqual([num("sou", 6), num("pin", 6)]);
    // 겉+깡: 1m 4장 + 5p 1장 = 5, 뒷+뒷깡: 7s 1장 + 7p 1장 = 2
    expect(win.doraCount).toBe(5);
    expect(win.uraDora).toBe(2);
    expect(win.redDora).toBe(0);
    expect(win.dora).toBe(7);
    expect(win.doraCount + win.redDora + win.uraDora).toBe(win.dora);

    render(<ResultModal summary={summary} onNext={noop} />);
    const dialog = screen.getByRole("dialog");
    expect(within(within(dialog).getByLabelText("도라 표시패")).getAllByRole("img")).toHaveLength(2);
    expect(within(within(dialog).getByLabelText("뒷도라 표시패")).getAllByRole("img")).toHaveLength(2);
  });

  it("Board: 공개된 도라 표시패 수만큼만 앞면, 나머지는 뒷면 (깡 후 2장 공개 = 앞 2 + 뒤 3)", () => {
    const state = kanRiichiState();
    render(<Board state={state} actions={[]} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />);
    const row = screen.getByLabelText("도라 표시패");
    expect(row.children).toHaveLength(5);
    expect(within(row).getAllByLabelText("뒷면")).toHaveLength(3);
  });

  it("Board: 대명깡 직후 타패 전(pendingKanDora 1)에는 깡도라가 공개되지 않는다", () => {
    const state: GameState = { ...kanRiichiState(), doraCount: 1, pendingKanDora: 1 };
    render(<Board state={state} actions={[]} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />);
    expect(within(screen.getByLabelText("도라 표시패")).getAllByLabelText("뒷면")).toHaveLength(4);
  });
});
