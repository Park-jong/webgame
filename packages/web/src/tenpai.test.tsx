import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { createFullTileSet, createGame } from "@mahjong/core";
import type { GameState, Tile } from "@mahjong/core";
import { Board } from "./components/Board";
import { TenpaiInfo } from "./components/TenpaiInfo";
import { createRng, humanTenpaiView } from "./controller";

const all = createFullTileSet(false);

/** "123m456p789s1z" 형식 파서 (z: 1~4 동남서북, 5~7 백발중) */
function parse(text: string): Tile[] {
  const tiles: Tile[] = [];
  let digits: number[] = [];
  const suits = { m: "man", p: "pin", s: "sou" } as const;
  const winds = ["east", "south", "west", "north"];
  const dragons = ["white", "green", "red"];
  for (const ch of text) {
    if (/\d/.test(ch)) {
      digits.push(Number(ch));
      continue;
    }
    for (const d of digits) {
      const tile =
        ch === "z"
          ? all.find((t) => (d <= 4 ? t.kind === "wind" && t.wind === winds[d - 1] : t.kind === "dragon" && t.dragon === dragons[d - 5]))
          : all.find((t) => t.kind === "number" && t.suit === suits[ch as "m"] && t.rank === d);
      tiles.push(tile!);
    }
    digits = [];
  }
  return tiles;
}
const entry = (tile: Tile) => ({ tile, riichi: false, tsumogiri: false, calledBy: null });
const noop = () => {};

/** 좌석 0의 손패/버림패를 지정한 상태 (mine=true면 내 차례, 마지막 패가 뽑은 패). 내가 친이라 자풍은 동, 장풍도 동. */
function stateWith(hand: string, discards = "", mine = false, riichi = false): GameState {
  const base = createGame(createRng(3));
  const tiles = parse(hand);
  return {
    ...base,
    players: base.players.map((pl, i) =>
      i === 0 ? { hand: tiles, melds: [], discards: parse(discards).map(entry), riichi } : pl,
    ),
    phase: "turn",
    turn: mine ? 0 : 1,
    drawnTile: mine ? tiles[tiles.length - 1]! : null,
    furitenTemp: [false, false, false, false],
  };
}

const RYANMEN = "23m456p55p234s789s"; // 1m/4m 양면 (핑후)
const KANCHAN = "13m456p55p234s789s"; // 2m 간짱 (역 없음)

describe("humanTenpaiView", () => {
  it("13장 텐파이: 대기패와 남은 장수, 역 유무", () => {
    const view = humanTenpaiView(stateWith(RYANMEN))!;
    expect(view.tenpai).toBe(true);
    expect(view.waits.map((w) => [w.tile.kind === "number" ? w.tile.rank : 0, w.hasYaku])).toEqual([
      [1, true],
      [4, true],
    ]);
    expect(view.waits.every((w) => w.remaining >= 0 && w.remaining <= 4)).toBe(true);
    expect(view.furiten).toBe(false);
  });

  it("역 없는 간짱은 hasYaku=false, 리치하면 true", () => {
    expect(humanTenpaiView(stateWith(KANCHAN))!.waits.map((w) => w.hasYaku)).toEqual([false]);
    expect(humanTenpaiView(stateWith(KANCHAN, "", false, true))!.waits.map((w) => w.hasYaku)).toEqual([true]);
  });

  it("버림패에 대기패가 있으면 후리텐", () => {
    expect(humanTenpaiView(stateWith(RYANMEN, "4m"))!.furiten).toBe(true);
    expect(humanTenpaiView(stateWith(RYANMEN, "9m"))!.furiten).toBe(false);
  });

  it("furitenTemp가 켜져 있으면 텐파이일 때 후리텐 (버림패와 무관)", () => {
    const base = stateWith(RYANMEN);
    expect(humanTenpaiView(base)!.furiten).toBe(false);
    const temp = humanTenpaiView({ ...base, furitenTemp: [true, false, false, false] })!;
    expect(temp.tenpai).toBe(true);
    expect(temp.waits.length).toBeGreaterThan(0);
    expect(temp.furiten).toBe(true);
    // 다른 좌석의 일시 후리텐은 영향이 없다
    expect(humanTenpaiView({ ...base, furitenTemp: [false, true, true, true] })!.furiten).toBe(false);
    // 텐파이가 아니면 후리텐 표시도 없다
    const noten = humanTenpaiView({ ...stateWith("1m3m7m1p3p7p1s3s7s1z3z9m9p"), furitenTemp: [true, false, false, false] })!;
    expect(noten.furiten).toBe(false);
  });

  it("남은 장수는 타인 버림패, 타인 멜드, 도라 표시패를 반영하고 부로된 버림패는 이중 계산하지 않는다", () => {
    const base = stateWith(RYANMEN); // 대기 1m, 4m (손패에는 없음)
    const [one] = parse("1m");
    const fourPon = parse("444m") as [Tile, Tile, Tile];
    const deadWall = [...base.deadWall];
    deadWall[4] = one!; // 도라 표시패 1m
    const state: GameState = {
      ...base,
      deadWall,
      doraCount: 1,
      players: base.players.map((pl, i) => {
        if (i === 1) {
          return {
            ...pl,
            discards: [entry(one!), { ...entry(one!), calledBy: 2 as const }],
            melds: [],
          };
        }
        if (i === 2) {
          return {
            ...pl,
            melds: [{ type: "pon" as const, tiles: fourPon, calledTile: fourPon[0], fromSeat: 1 as const, from: "left" as const }],
          };
        }
        return pl;
      }),
    };
    const remaining = Object.fromEntries(
      humanTenpaiView(state)!.waits.map((w) => [w.tile.kind === "number" ? w.tile.rank : 0, w.remaining]),
    );
    // 1m: 4 - 타인 버림패 1 - 도라 표시패 1 = 2 / 4m: 4 - 타인 펑 3 = 1
    expect(remaining).toEqual({ 1: 2, 4: 1 });
  });

  it("텐파이가 아니면 비어 있다", () => {
    expect(humanTenpaiView(stateWith("1m3m7m1p3p7p1s3s7s1z3z9m9p"))).toEqual({
      tenpai: false,
      waits: [],
      furiten: false,
      discardHints: [],
    });
  });

  it("내 차례 14장: 버리면 텐파이가 되는 패", () => {
    const view = humanTenpaiView(stateWith(`${RYANMEN}4z`, "", true))!;
    expect(view.tenpai).toBe(false);
    expect(view.discardHints.map((h) => h.discard.kind)).toEqual(["wind"]);
    expect(view.discardHints[0]!.waits).toHaveLength(2);
  });

  it("쿠이가에시로 금지된 패는 버리면 텐파이 힌트에서 제외된다", () => {
    const base = stateWith(`${RYANMEN}4z`, "", true);
    expect(humanTenpaiView(base)!.discardHints).toHaveLength(1);
    const forbidden = humanTenpaiView({ ...base, kuikae: parse("4z") })!;
    expect(forbidden.discardHints).toEqual([]);
    // 금지 패와 무관한 kuikae는 힌트를 지우지 않는다
    expect(humanTenpaiView({ ...base, kuikae: parse("1z") })!.discardHints).toHaveLength(1);
  });

  it("리치 중 내 차례는 뽑은 패를 뺀 13장의 대기패", () => {
    const view = humanTenpaiView(stateWith(`${RYANMEN}4z`, "", true, true))!;
    expect(view.tenpai).toBe(true);
    expect(view.waits).toHaveLength(2);
    expect(view.discardHints).toEqual([]);
  });

  it("국이 끝났으면 null", () => {
    expect(humanTenpaiView({ ...stateWith(RYANMEN), phase: "roundEnd" })).toBeNull();
  });
});

describe("TenpaiInfo / Board 렌더", () => {
  it("텐파이 배지와 대기패 타일을 표시한다", () => {
    render(<TenpaiInfo view={humanTenpaiView(stateWith(RYANMEN))} />);
    const row = screen.getByTestId("tenpai-waits");
    expect(within(row).getByText("텐파이")).toBeTruthy();
    expect(within(row).getByLabelText("1만")).toBeTruthy();
    expect(within(row).getByLabelText("4만")).toBeTruthy();
    expect(within(row).queryByText("후리텐")).toBeNull();
  });

  it("후리텐이면 후리텐 배지를 표시한다", () => {
    render(<TenpaiInfo view={humanTenpaiView(stateWith(RYANMEN, "1m"))} />);
    expect(screen.getByText("후리텐")).toBeTruthy();
  });

  it("역 없는 대기패는 흐리게 + 역없음 표시", () => {
    render(<TenpaiInfo view={humanTenpaiView(stateWith(KANCHAN))} />);
    expect(screen.getByTestId("wait-tile-noyaku")).toBeTruthy();
    expect(screen.getByText("기본 역 없음")).toBeTruthy();
    expect(screen.getByLabelText("2만").className).toContain("tile-dimmed");
  });

  it("텐파이가 아니면 아무것도 표시하지 않는다", () => {
    render(<TenpaiInfo view={humanTenpaiView(stateWith("1m3m7m1p3p7p1s3s7s1z3z9m9p"))} />);
    expect(screen.queryByText("텐파이")).toBeNull();
    expect(screen.queryByTestId("tenpai-hints")).toBeNull();
  });

  it("내 차례에는 버리면 텐파이가 되는 패를 표시한다", () => {
    render(<TenpaiInfo view={humanTenpaiView(stateWith(`${RYANMEN}4z`, "", true))} />);
    const row = screen.getByTestId("tenpai-hints");
    expect(within(row).getByText("버리면 텐파이")).toBeTruthy();
    expect(within(row).getAllByTestId("discard-hint")).toHaveLength(1);
    // 터치로도 볼 수 있게 대기패를 텍스트로 함께 표시
    const text = within(row).getByTestId("discard-hint-waits").textContent ?? "";
    expect(text).toContain("→");
    expect(text).toContain("1만");
    expect(text).toContain("4만");
  });

  it("Board에 텐파이 영역이 포함되고 대기패가 보인다", () => {
    render(
      <Board state={stateWith(RYANMEN)} actions={[]} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />,
    );
    expect(screen.getByLabelText("텐파이 정보")).toBeTruthy();
    expect(screen.getByTestId("tenpai-waits")).toBeTruthy();
  });
});
