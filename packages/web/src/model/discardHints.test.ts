// discardHints 순서 고정: 손패에서 각 종류를 처음 만난 순서(정렬하지 않음). 기존 동작을 그대로 고정한다.
import { describe, expect, it } from "vitest";
import { createFullTileSet, createGame } from "@mahjong/core";
import type { GameState, Tile } from "@mahjong/core";
import { createRng, humanTenpaiView } from "../controller";
import { tenpaiViewFromSeatView } from "./fromView";
import { viewFor } from "./seatView";

const all = createFullTileSet(false);
const man = (rank: number): Tile => all.find((t) => t.kind === "number" && t.suit === "man" && t.rank === rank)!;

function stateWith(hand: Tile[]): GameState {
  const base = createGame(createRng(3));
  return {
    ...base,
    players: base.players.map((p, i) => (i === 0 ? { ...p, hand, melds: [], discards: [], riichi: false } : p)),
    phase: "turn",
    turn: 0,
    drawnTile: hand[hand.length - 1]!,
    furitenTemp: [false, false, false, false],
    kuikae: [],
  };
}

const ranks = (hints: { discard: Tile }[]): number[] => hints.map((h) => (h.discard as { rank: number }).rank);

describe("discardHints 순서", () => {
  // 구련보등 모양을 일부러 정렬하지 않은 순서로 둔다: 후보가 여러 개이고 정렬 순서와 손패 순서가 다르다
  const hand = [5, 9, 1, 3, 1, 2, 9, 4, 6, 1, 7, 8, 9, 2].map(man);
  const expected = [5, 9, 1, 3, 2, 4, 6, 7, 8];

  it("state 기반: 손패에서 처음 만난 순서", () => {
    expect(ranks(humanTenpaiView(stateWith(hand))!.discardHints)).toEqual(expected);
  });

  it("SeatView 기반: state 기반과 같은 순서", () => {
    const view = viewFor(stateWith(hand), 0);
    expect(ranks(tenpaiViewFromSeatView(view)!.discardHints)).toEqual(expected);
  });

  it("손패 순서가 바뀌면 힌트 순서도 따라 바뀐다 (정렬되지 않음)", () => {
    const reversed = [...hand].reverse();
    const got = ranks(humanTenpaiView(stateWith(reversed))!.discardHints);
    const firstSeen = [...new Set(reversed.map((t) => (t as { rank: number }).rank))].filter((r) => got.includes(r));
    expect(got).toEqual(firstSeen);
    expect(got).not.toEqual([...got].sort((a, b) => a - b));
  });
});
