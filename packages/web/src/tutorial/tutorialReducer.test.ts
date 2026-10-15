import { describe, expect, it } from "vitest";
import { TUTORIAL_SCENES } from "./scenes";
import { initialTutorialState, NEXT_BLOCKED_HINT, tutorialReducer } from "./tutorialReducer";
import type { TutorialAction, TutorialState } from "./tutorialReducer";

const run = (s: TutorialState, ...actions: TutorialAction[]) => actions.reduce((st, a) => tutorialReducer(st, a), s);
const N = TUTORIAL_SCENES.length;
const at = (step: number): TutorialState => ({ ...initialTutorialState(), step });

describe("tutorialReducer", () => {
  it("목표 없는 1단계는 바로 다음으로 갈 수 있다", () => {
    expect(run(initialTutorialState(), { type: "next" }).step).toBe(1);
  });

  it("2단계: 잘못된 패는 상태를 유지하고 안내만, 맞는 패는 완료", () => {
    const wrong = run(at(1), { type: "tile", index: 0 });
    expect(wrong.step).toBe(1);
    expect(wrong.cleared[1]).toBe(false);
    expect(wrong.hint).toBe(TUTORIAL_SCENES[1]!.wrongHint);
    const ok = run(wrong, { type: "tile", index: 13 });
    expect(ok.cleared[1]).toBe(true);
    expect(ok.hint).toBeNull();
  });

  it("완료 전 다음은 막히고 안내가 나온다", () => {
    const s = run(at(1), { type: "next" });
    expect(s.step).toBe(1);
    expect(s.hint).toBe(NEXT_BLOCKED_HINT);
  });

  it("3단계: 패스는 안내, 치/펑은 완료되고 선택이 기록된다", () => {
    const passed = run(at(2), { type: "call", call: "pass" });
    expect(passed.cleared[2]).toBe(false);
    expect(passed.hint).not.toBeNull();
    const s = run(at(2), { type: "call", call: "pon" });
    expect(s.cleared[2]).toBe(true);
    expect(s.choice).toBe("pon");
  });

  it("4단계: 대기패 보기로 완료, 다른 입력은 안내", () => {
    expect(run(at(3), { type: "tsumo" }).hint).not.toBeNull();
    expect(run(at(3), { type: "reveal" }).cleared[3]).toBe(true);
  });

  it("5단계: 리치 전에 패를 누르면 안내, 리치 후 맞는 패로 완료", () => {
    const early = run(at(4), { type: "tile", index: 13 });
    expect(early.cleared[4]).toBe(false);
    expect(early.hint).toContain("리치");
    const on = run(at(4), { type: "toggleRiichi" });
    expect(on.riichiMode).toBe(true);
    expect(run(on, { type: "tile", index: 0 }).cleared[4]).toBe(false);
    expect(run(on, { type: "tile", index: 13 }).cleared[4]).toBe(true);
    expect(run(on, { type: "toggleRiichi" }).riichiMode).toBe(false);
  });

  it("6단계 츠모 후 7단계로 가고 마지막 단계에서 다음은 무시된다", () => {
    const s = run(at(5), { type: "tsumo" }, { type: "next" });
    expect(s.step).toBe(N - 1);
    expect(run(s, { type: "next" }).step).toBe(N - 1);
  });

  it("완료한 단계의 입력은 무시하고, 이전으로 돌아가도 완료 상태 유지", () => {
    const done = run(at(3), { type: "reveal" });
    expect(run(done, { type: "tile", index: 0 })).toEqual(done);
    const back = run(done, { type: "prev" });
    expect(back.step).toBe(2);
    expect(run(back, { type: "call", call: "chi" }).step).toBe(2);
    expect(run(initialTutorialState(), { type: "prev" }).step).toBe(0);
  });

  it("이동하면 리치 모드와 안내가 초기화된다", () => {
    const s = run(at(4), { type: "toggleRiichi" }, { type: "prev" });
    expect(s.riichiMode).toBe(false);
    expect(s.hint).toBeNull();
  });
});
