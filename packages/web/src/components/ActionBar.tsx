import type { Action, Tile } from "@mahjong/core";
import { tileLabel } from "../tileText";
import { canDeclareRiichi } from "./actions";

export interface ActionBarProps {
  /** 사람의 합법 행동 */
  actions: readonly Action[];
  riichiMode: boolean;
  onToggleRiichi: () => void;
  onAction: (action: Action) => void;
}

interface ButtonSpec {
  key: string;
  label: string;
  action: Action;
  emphasis?: boolean;
}

const useLabel = (use: readonly Tile[]) => use.map(tileLabel).join(" ");

/** 종류별 버튼: 행동이 없으면 버튼 없음, 하나면 1개, 여러 개(조합/적5/여러 패)면 선택지별 버튼 */
function group(
  actions: readonly Action[],
  type: Action["type"],
  name: string,
  detail: (a: Action) => string,
  emphasis = false,
): ButtonSpec[] {
  const found = actions.filter((a) => a.type === type);
  if (found.length === 0) return [];
  return found.map((a, i) => ({
    key: `${type}-${i}`,
    label: found.length > 1 ? `${name} (${detail(a)})` : name,
    action: a,
    emphasis,
  }));
}

export function ActionBar({ actions, riichiMode, onToggleRiichi, onAction }: ActionBarProps) {
  const detailUse = (a: Action) => (a.type === "chi" || a.type === "pon" ? useLabel(a.use) : "");
  const detailTile = (a: Action) => (a.type === "ankan" || a.type === "shouminkan" ? tileLabel(a.tile) : "");
  const specs: ButtonSpec[] = [
    ...group(actions, "tsumo", "츠모", () => "", true),
    ...group(actions, "ron", "론", () => "", true),
    ...group(actions, "ankan", "안깡", detailTile),
    ...group(actions, "shouminkan", "가깡", detailTile),
    ...group(actions, "chi", "치", detailUse),
    ...group(actions, "pon", "펑", detailUse),
    ...group(actions, "daiminkan", "대명깡", () => ""),
    ...group(actions, "kyuushu", "구종구패", () => ""),
    ...group(actions, "pass", "패스", () => ""),
  ];
  const riichiAvailable = canDeclareRiichi(actions);

  return (
    <div className="action-bar" role="group" aria-label="행동">
      {(riichiAvailable || riichiMode) && (
        <button
          type="button"
          className={`action-btn${riichiMode ? " action-btn-active" : ""}`}
          onClick={onToggleRiichi}
          aria-pressed={riichiMode}
        >
          {riichiMode ? "리치 취소" : "리치"}
        </button>
      )}
      {specs.map((s) => (
        <button
          key={s.key}
          type="button"
          className={`action-btn${s.emphasis ? " action-btn-win" : ""}`}
          onClick={() => onAction(s.action)}
        >
          {s.label}
        </button>
      ))}
      {riichiMode && <span className="action-hint">리치 후 텐파이가 유지되는 패를 선택하세요</span>}
    </div>
  );
}
