import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createFullTileSet, createGame, dispatch } from "@mahjong/core";
import type { CalledMeld, GameState, Tile } from "@mahjong/core";
import { ResultModal } from "./components/ResultModal";
import { createRng, summarizeRound } from "./controller";

const all = createFullTileSet(false);
function tile(suit: "man" | "pin" | "sou", rank: number): Tile {
  return all.find((t) => t.kind === "number" && t.suit === suit && t.rank === rank)!;
}
const tiles = (spec: [("man" | "pin" | "sou"), number[]][]): Tile[] =>
  spec.flatMap(([suit, ranks]) => ranks.map((r) => tile(suit, r)));

describe("쿠이사가리 결과 표시 (웹)", () => {
  it("치한 손패의 일기통관은 후로 판수 1판으로 요약/모달에 표시된다", () => {
    const base = createGame(createRng(1));
    const chi: CalledMeld = {
      type: "chi",
      tiles: [tile("man", 1), tile("man", 2), tile("man", 3)],
      calledTile: tile("man", 1),
      fromSeat: 3,
      from: "left",
    };
    // 치 123m + 456m 789m 234p 55s (3p 츠모) = 일기통관 후로 1판
    const hand = [...tiles([["man", [4, 5, 6, 7, 8, 9]], ["pin", [2, 4]], ["sou", [5, 5]]]), tile("pin", 3)];
    const state: GameState = {
      ...base,
      players: base.players.map((p, i) => (i === 0 ? { ...p, hand, melds: [chi], discards: [] } : p)),
      drawnTile: tile("pin", 3),
      phase: "turn",
      turn: 0,
      anyCalls: true,
    };
    const summary = summarizeRound(dispatch(state, { type: "tsumo", seat: 0 }));
    const win = summary.wins[0]!;
    expect(win.yaku).toEqual([{ name: "일기통관", han: 1, yakuman: 0 }]);
    expect(win.han).toBe(1);
    render(<ResultModal summary={summary} onNext={() => {}} />);
    const dialog = within(screen.getByRole("dialog"));
    expect(dialog.getByText("일기통관")).toBeTruthy();
    expect(dialog.getByText("1판")).toBeTruthy();
  });
});
