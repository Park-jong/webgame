/**
 * 단순 봇
 *
 * 항상 `legalActions`가 돌려준 합법 행동 중에서만 고른다.
 *
 * 전략:
 * 1. 론/츠모 화료가 가능하면 무조건 화료.
 * 2. 응답 단계에서는 화료 외에는 전부 패스 (치/펑/깡 등 부로는 하지 않음, 안깡/가깡도 하지 않음).
 * 3. 멘젠 텐파이가 되면 리치 (여러 후보면 대기패 잔여 매수가 가장 많은 타패).
 * 4. 그 외에는 타패 후 샹텐 수가 최소인 패를 버린다. 동률이면 손패에서 가장 쓸모없어 보이는 패
 *    (고립/자패/요구패 우선)를 버리고, 그래도 같으면 rng로 고른다.
 * 5. 구종구패는 선언하지 않는다. 위험패 회피 같은 방어 로직은 없다.
 */

import type { Tile } from "./tiles.js";
import { isSameTileType } from "./tiles.js";
import type { RandomFn } from "./wall.js";
import type { Seat } from "./call.js";
import type { Action, GameState } from "./game.js";
import { legalActions, sameExactTile, seatWindOf, shantenWithMelds, waitingTileTypes } from "./game.js";

type DiscardAction = Extract<Action, { type: "discard" }>;

/** 손패 안에서 이 패를 남겨둘 가치 (낮을수록 먼저 버린다). */
function keepValue(tile: Tile, hand: readonly Tile[], state: GameState, seat: Seat): number {
  const same = hand.filter((t) => isSameTileType(t, tile)).length;
  if (tile.kind !== "number") {
    const yakuhai =
      tile.kind === "dragon" || tile.wind === seatWindOf(state, seat) || tile.wind === state.roundWind;
    return same * 3 + (yakuhai ? 2 : 0);
  }
  let value = same * 3;
  for (const offset of [-2, -1, 1, 2]) {
    const rank = tile.rank + offset;
    const n = hand.filter((t) => t.kind === "number" && t.suit === tile.suit && t.rank === rank).length;
    value += n * (Math.abs(offset) === 1 ? 2 : 1);
  }
  if (tile.rank === 1 || tile.rank === 9) value -= 1;
  return value;
}

function pickRandom<T>(items: readonly T[], rng: RandomFn): T {
  return items[Math.floor(rng() * items.length)]!;
}

/** 리치 후보 중 남은 대기패 매수가 가장 많은 타패를 고른다. */
function chooseRiichi(state: GameState, seat: Seat, options: DiscardAction[], rng: RandomFn): DiscardAction {
  const p = state.players[seat]!;
  const visible = [
    ...p.hand,
    ...state.players.flatMap((pl) => [...pl.melds.flatMap((m) => m.tiles as readonly Tile[]), ...pl.discards.map((d) => d.tile)]),
  ];
  let best: DiscardAction[] = [];
  let bestCount = -1;
  for (const option of options) {
    const rest = removeOne(p.hand, option.tile);
    const waits = waitingTileTypes(rest, p.melds);
    // 잔여 매수는 근사값: 내 손패와 모든 공개 패(버림패/멜드)를 본 것으로 계산
    const count = waits.reduce(
      (sum, w) => sum + Math.max(0, 4 - visible.filter((t) => isSameTileType(t, w)).length),
      0,
    );
    if (count > bestCount) {
      best = [option];
      bestCount = count;
    } else if (count === bestCount) {
      best.push(option);
    }
  }
  return pickRandom(best, rng);
}

function removeOne(hand: readonly Tile[], tile: Tile): Tile[] {
  const i = hand.findIndex((t) => sameExactTile(t, tile));
  const result = [...hand];
  result.splice(i, 1);
  return result;
}

/**
 * 봇의 다음 행동을 결정한다.
 * @throws 좌석이 지금 행동할 수 없으면(합법 행동이 없으면) 에러
 */
export function decideAction(state: GameState, seat: Seat, rng: RandomFn = Math.random): Action {
  const legal = legalActions(state, seat);
  if (legal.length === 0) throw new Error(`좌석 ${seat}은(는) 지금 행동할 수 없습니다.`);

  const win = legal.find((a) => a.type === "ron" || a.type === "tsumo");
  if (win) return win;

  if (state.phase === "response") {
    const pass = legal.find((a) => a.type === "pass");
    if (!pass) throw new Error("응답 단계에 패스가 없습니다.");
    return pass;
  }

  const discards = legal.filter((a): a is DiscardAction => a.type === "discard");
  const riichi = discards.filter((a) => a.riichi === true);
  if (riichi.length > 0) return chooseRiichi(state, seat, riichi, rng);

  const p = state.players[seat]!;
  const plain = discards.filter((a) => a.riichi !== true);
  const scored = plain.map((action) => {
    const rest = removeOne(p.hand, action.tile);
    return {
      action,
      shanten: shantenWithMelds(rest, p.melds),
      keep: keepValue(action.tile, p.hand, state, seat),
    };
  });
  const bestShanten = Math.min(...scored.map((s) => s.shanten));
  const atBest = scored.filter((s) => s.shanten === bestShanten);
  const lowestKeep = Math.min(...atBest.map((s) => s.keep));
  return pickRandom(
    atBest.filter((s) => s.keep === lowestKeep).map((s) => s.action),
    rng,
  );
}

