import { describe, expect, it } from "vitest";
import { GLOSSARY, firstTermSteps, sceneTexts, splitTerms } from "./glossary";
import { TUTORIAL_SCENES as SCENES } from "./scenes";

const all = () => true;
const termsIn = (text: string) =>
  splitTerms(text, all)
    .filter((p) => typeof p !== "string")
    .map((p) => (p as { label: string }).label);

describe("용어 사전", () => {
  it("긴 표기를 우선 매칭하고 다른 낱말 일부는 제외한다", () => {
    expect(termsIn("신론이 맞다")).toEqual([]);
    expect(termsIn("위치와 가치")).toEqual([]);
    expect(termsIn("론이라고")).toEqual(["론"]);
    expect(termsIn("대기패 보기")).toEqual(["대기패"]);
    expect(termsIn("멘젠쯔모")).toEqual(["멘젠"]);
    expect(termsIn("쯔모 버튼")).toEqual(["쯔모"]);
  });

  it("필수 용어가 사전에 있다", () => {
    const names = GLOSSARY.flatMap((g) => g.names);
    for (const n of ["화료", "쯔모", "론", "치", "퐁", "후로", "텐파이", "리치", "멘젠", "역"]) expect(names).toContain(n);
  });

  it("모든 사전 항목이 튜토리얼 문구에서 첫 등장 단계를 가진다 (죽은 항목 없음)", () => {
    const first = firstTermSteps(SCENES);
    for (const g of GLOSSARY) expect(first.has(g.id), g.id).toBe(true);
  });

  it("문구 안의 매칭은 의도한 용어뿐이다", () => {
    const hits = new Set<string>();
    for (const s of SCENES) for (const t of sceneTexts(s)) for (const l of termsIn(t)) hits.add(l);
    expect([...hits].sort()).toEqual(
      ["대기패", "리치", "론", "머리", "멘젠", "몸통", "쯔모", "쯔모기리", "치", "테다시", "텐파이", "퐁", "화료", "후로", "역"].sort(),
    );
  });
});
