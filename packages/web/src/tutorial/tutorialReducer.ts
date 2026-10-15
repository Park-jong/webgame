// 튜토리얼 단계 진행 reducer (순수 함수). 장면 데이터와 현재 단계만으로 동작한다.
import { TUTORIAL_SCENES } from "./scenes";
import type { CallKind, TutorialScene } from "./scenes";

export interface TutorialState {
  step: number;
  /** 단계별 연습 완료 여부 (목표가 없는 단계는 처음부터 true) */
  cleared: boolean[];
  /** 5단계: 리치 버튼을 눌러 둔 상태 */
  riichiMode: boolean;
  /** 3단계에서 고른 치/펑 */
  choice: CallKind | null;
  /** 잘못 눌렀을 때의 안내 (없으면 null) */
  hint: string | null;
}

export type TutorialAction =
  | { type: "tile"; index: number }
  | { type: "call"; call: CallKind | "pass" }
  | { type: "toggleRiichi" }
  | { type: "reveal" }
  | { type: "tsumo" }
  | { type: "next" }
  | { type: "prev" }
  | { type: "restart" };

export const NEXT_BLOCKED_HINT = "먼저 이 단계의 연습을 해 보세요.";

export function initialTutorialState(scenes: readonly TutorialScene[] = TUTORIAL_SCENES): TutorialState {
  return {
    step: 0,
    cleared: scenes.map((s) => s.goal.type === "none"),
    riichiMode: false,
    choice: null,
    hint: null,
  };
}

export function isLastStep(state: TutorialState, scenes: readonly TutorialScene[] = TUTORIAL_SCENES): boolean {
  return state.step >= scenes.length - 1;
}

function clear(state: TutorialState, patch: Partial<TutorialState> = {}): TutorialState {
  const cleared = state.cleared.slice();
  cleared[state.step] = true;
  return { ...state, ...patch, cleared, hint: null };
}

export function tutorialReducer(
  state: TutorialState,
  action: TutorialAction,
  scenes: readonly TutorialScene[] = TUTORIAL_SCENES,
): TutorialState {
  if (action.type === "restart") return initialTutorialState(scenes);
  if (action.type === "next") {
    if (!state.cleared[state.step]) return { ...state, hint: NEXT_BLOCKED_HINT };
    if (state.step >= scenes.length - 1) return state;
    return { ...state, step: state.step + 1, riichiMode: false, hint: null };
  }
  if (action.type === "prev") {
    if (state.step <= 0) return state;
    return { ...state, step: state.step - 1, riichiMode: false, hint: null };
  }

  const scene = scenes[state.step];
  if (!scene) return state;
  // 이미 끝낸 단계의 연습 입력은 무시한다 (상태 유지)
  if (state.cleared[state.step]) return state;
  const goal = scene.goal;
  const wrong = (hint: string = scene.wrongHint): TutorialState => ({ ...state, hint });

  switch (action.type) {
    case "tile":
      if (goal.type === "tile") return action.index === goal.index ? clear(state) : wrong();
      if (goal.type === "riichi") {
        if (!state.riichiMode) return wrong("먼저 '리치' 버튼을 누른 뒤 반짝이는 패를 눌러 주세요.");
        return action.index === goal.index ? clear(state) : wrong();
      }
      return wrong();
    case "call":
      if (goal.type !== "call") return wrong();
      if (action.call === "pass") return wrong();
      return goal.calls.includes(action.call) ? clear(state, { choice: action.call }) : wrong();
    case "toggleRiichi":
      if (goal.type !== "riichi") return wrong();
      return { ...state, riichiMode: !state.riichiMode, hint: null };
    case "reveal":
      return goal.type === "reveal" ? clear(state) : wrong();
    case "tsumo":
      return goal.type === "tsumo" ? clear(state) : wrong();
  }
}
