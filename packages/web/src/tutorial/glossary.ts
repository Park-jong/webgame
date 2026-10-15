// 튜토리얼 용어 사전. 안내 문구에 실제로 나오는 용어만 담고, 처음 나오는 지점에서 한 번만 주석을 붙인다.
import type { TutorialScene } from "./scenes";

export interface GlossaryEntry {
  id: string;
  /** 문구에서 찾을 표기(여러 표기 허용) */
  names: readonly string[];
  title: string;
  text: string;
}

export const GLOSSARY: readonly GlossaryEntry[] = [
  { id: "mentsu", names: ["몸통"], title: "몸통", text: "같은 패 3장, 또는 같은 종류의 연속된 숫자 3장 묶음입니다." },
  { id: "atama", names: ["머리"], title: "머리", text: "같은 패 2장 묶음입니다. 완성하려면 몸통 4개와 머리 1개가 필요해요." },
  { id: "tsumogiri", names: ["쯔모기리"], title: "쯔모기리", text: "방금 뽑은 패를 그대로 버리는 것입니다." },
  { id: "tedashi", names: ["테다시"], title: "테다시", text: "손패에 있던 패를 골라 버리는 것입니다." },
  { id: "chi", names: ["치"], title: "치", text: "왼쪽 사람이 버린 패를 가져와 연속된 숫자 3장 몸통을 만드는 것입니다." },
  { id: "pon", names: ["퐁"], title: "퐁", text: "같은 패 3장 몸통을 만드는 것입니다. 누가 버린 패든 가져올 수 있어요." },
  { id: "furo", names: ["후로"], title: "후로", text: "치·퐁·깡으로 남이 버린 패를 가져와 몸통을 공개하는 것입니다." },
  { id: "menzen", names: ["멘젠"], title: "멘젠", text: "후로를 하지 않고 스스로 패를 모은 상태입니다. 후로를 하면 깨져서 리치를 할 수 없어요." },
  { id: "riichi", names: ["리치"], title: "리치", text: "텐파이일 때 선언하는 것입니다. 선언하면 손패를 바꾸지 않는 대신 역이 생겨요." },
  { id: "tenpai", names: ["텐파이"], title: "텐파이", text: "패 한 장만 더 오면 완성되는 상태입니다." },
  { id: "machi", names: ["대기패"], title: "대기패", text: "텐파이일 때 완성을 위해 기다리는 패입니다." },
  { id: "yaku", names: ["역"], title: "역", text: "화료에 필요한 조건입니다. 역이 하나도 없으면 화료할 수 없어요." },
  { id: "agari", names: ["화료"], title: "화료", text: "패를 완성해 이기는 것입니다. 쯔모 또는 론으로 이길 수 있어요." },
  { id: "tsumo", names: ["쯔모"], title: "쯔모", text: "내가 뽑은 패로 완성해 이기는 것입니다." },
  { id: "ron", names: ["론"], title: "론", text: "남이 버린 패로 완성해 이기는 것입니다." },
];

const NAME_TO_ID = new Map<string, string>();
for (const g of GLOSSARY) for (const n of g.names) NAME_TO_ID.set(n, g.id);
// 긴 표기를 먼저 맞추고, 한글 글자 바로 뒤에 붙은 경우(다른 낱말의 일부)는 제외한다
const PATTERN = new RegExp(
  `(?<![가-힣A-Za-z0-9])(${[...NAME_TO_ID.keys()].sort((a, b) => b.length - a.length).join("|")})`,
  "g",
);

export function glossaryEntry(id: string): GlossaryEntry | undefined {
  return GLOSSARY.find((g) => g.id === id);
}

export type TextPart = string | { termId: string; label: string };

/** 문구를 일반 글자와 용어 조각으로 나눈다. allowed(id) 가 true 인 용어의 첫 등장만 용어 조각이 된다. */
export function splitTerms(text: string, takeTerm: (id: string) => boolean): TextPart[] {
  const parts: TextPart[] = [];
  let at = 0;
  for (const m of text.matchAll(PATTERN)) {
    const id = NAME_TO_ID.get(m[1]!)!;
    if (!takeTerm(id)) continue;
    if (m.index! > at) parts.push(text.slice(at, m.index));
    parts.push({ termId: id, label: m[1]! });
    at = m.index! + m[1]!.length;
  }
  if (at < text.length) parts.push(text.slice(at));
  return parts;
}

/** 장면의 안내 문구를 화면에 나오는 순서대로 모은다 (말풍선, 보조 설명, 완료 문구) */
export function sceneTexts(scene: TutorialScene): string[] {
  const out = [...scene.bubble];
  if (scene.caption) out.push(scene.caption);
  if (scene.doneText) out.push(scene.doneText);
  for (const r of Object.values(scene.callResults ?? {})) if (r) out.push(r.text);
  return out;
}

/** 용어 id -> 처음 등장하는 단계(0부터). 단계 순서와 문구 순서로 고정된다. */
export function firstTermSteps(scenes: readonly TutorialScene[]): Map<string, number> {
  const first = new Map<string, number>();
  scenes.forEach((scene, step) => {
    for (const text of sceneTexts(scene)) {
      for (const m of text.matchAll(PATTERN)) {
        const id = NAME_TO_ID.get(m[1]!)!;
        if (!first.has(id)) first.set(id, step);
      }
    }
  });
  return first;
}
