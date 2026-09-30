import { sameExactTile } from "@mahjong/core";
import type { Action, Tile } from "@mahjong/core";

type DiscardAction = Extract<Action, { type: "discard" }>;

/** riichiMode에 맞는 타패 행동만 (리치 모드면 리치 선언 타패, 아니면 일반 타패) */
export function discardActions(actions: readonly Action[], riichiMode: boolean): DiscardAction[] {
  return actions.filter(
    (a): a is DiscardAction => a.type === "discard" && (a.riichi === true) === riichiMode,
  );
}

/** 이 패를 타패하는 합법 행동 (없으면 undefined = 선택 불가) */
export function findDiscard(actions: readonly Action[], tile: Tile, riichiMode: boolean): DiscardAction | undefined {
  return discardActions(actions, riichiMode).find((a) => sameExactTile(a.tile, tile));
}

export function canDeclareRiichi(actions: readonly Action[]): boolean {
  return actions.some((a) => a.type === "discard" && a.riichi === true);
}
