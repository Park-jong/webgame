import { useReducer } from "react";
import { initialTutorialState, tutorialReducer } from "./tutorialReducer";
import type { TutorialAction, TutorialState } from "./tutorialReducer";
import { TUTORIAL_SCENES } from "./scenes";
import type { TutorialScene } from "./scenes";

/** 튜토리얼 진행 상태. 게임 컨트롤러(useLocalGame/useServerGame)와는 독립이다. */
export function useTutorial(scenes: readonly TutorialScene[] = TUTORIAL_SCENES) {
  const [state, dispatch] = useReducer(
    (s: TutorialState, a: TutorialAction) => tutorialReducer(s, a, scenes),
    scenes,
    initialTutorialState,
  );
  return { state, dispatch, scene: scenes[state.step]!, scenes };
}
