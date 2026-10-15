// 보드 DOM 요소 -> 화면 설명 id 매핑. 공용 컴포넌트(BoardView/SeatPanel)는 건드리지 않고
// 튜토리얼 쪽에서 선택자로 대상을 찾아 접근성 속성을 붙인다. 위에 있을수록 우선한다.
import type { InfoId } from "./infoTexts";

interface Rule {
  id: InfoId;
  selector: string;
  /** 설명 보기 버튼 이름 */
  label: string;
}

export const INFO_RULES: readonly Rule[] = [
  { id: "riichiDiscard", selector: ".pond-riichi .riichi-mark", label: "리치 선언패 설명 보기" },
  { id: "dealer", selector: ".badge-dealer", label: "친 표시 설명 보기" },
  { id: "riichiBadge", selector: ".badge-riichi", label: "리치 표시 설명 보기" },
  { id: "seatWind", selector: ".seat-header .badge", label: "자풍 설명 보기" },
  { id: "score", selector: ".seat-score", label: "점수 설명 보기" },
  { id: "opponentHand", selector: ".opponent-hand", label: "상대 손패 설명 보기" },
  { id: "ownMelds", selector: ".melds-own:not(:empty)", label: "내 후로 설명 보기" },
  { id: "tsumogiri", selector: ".pond-entry.pond-tsumogiri", label: "쯔모기리 패 설명 보기" },
  { id: "tedashi", selector: ".pond-entry:not(.pond-tsumogiri)", label: "테다시 패 설명 보기" },
  { id: "pond", selector: ".pond:not(:empty)", label: "버림패 설명 보기" },
  { id: "dora", selector: ".dora-indicators", label: "도라 표시패 설명 보기" },
  { id: "round", selector: ".round-label", label: "국과 본장 설명 보기" },
  { id: "riichiSticks", selector: ".info-row > span:first-child", label: "리치봉 설명 보기" },
  { id: "wall", selector: ".info-row > span:nth-child(2)", label: "산패 설명 보기" },
];

/**
 * root 안의 설명 대상에 role/tabIndex/aria-label/data-info를 붙인다.
 * 같은 종류가 여러 개면 Tab 순서에는 첫 번째만 넣는다(나머지는 클릭 전용).
 */
export function markInfoTargets(root: HTMLElement): void {
  // 이전 렌더에서 붙인 속성 정리 (요소가 비었거나 재사용된 경우)
  root.querySelectorAll("[data-info]").forEach((el) => {
    el.removeAttribute("data-info");
    el.removeAttribute("role");
    el.removeAttribute("aria-label");
    el.removeAttribute("tabindex");
  });
  const claimed = new Set<Element>();
  for (const rule of INFO_RULES) {
    let first = true;
    root.querySelectorAll<HTMLElement>(rule.selector).forEach((el) => {
      if (claimed.has(el)) return;
      claimed.add(el);
      el.setAttribute("data-info", rule.id);
      el.setAttribute("role", "button");
      el.setAttribute("aria-label", rule.label);
      el.setAttribute("tabindex", first ? "0" : "-1");
      first = false;
    });
  }
}

/** 클릭/키 이벤트 대상에서 가장 가까운 설명 대상 id */
export function infoIdOf(target: EventTarget | null): InfoId | null {
  if (!(target instanceof Element)) return null;
  const el = target.closest("[data-info]");
  return (el?.getAttribute("data-info") as InfoId | null) ?? null;
}
