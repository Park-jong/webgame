// 설명 창(팝오버) 위치 계산. DOM에 의존하지 않는 순수 함수라 단위 테스트가 가능하다.
export interface RectLike {
  left: number;
  top: number;
  right: number;
  bottom: number;
}
export interface Size {
  width: number;
  height: number;
}
export interface PopoverPosition {
  /** 뷰포트(position: fixed) 기준 좌표 */
  left: number;
  top: number;
  /** 창이 요소의 아래(below) 또는 위(above)에 놓였는지 */
  placement: "below" | "above";
  /** 창 왼쪽 가장자리 기준 꼬리 중심 x (창 안쪽으로 클램프됨) */
  arrowLeft: number;
}

const ARROW_PAD = 14;

/**
 * 요소 rect 기준으로 창을 아래에 놓고, 아래 공간이 모자라고 위가 더 넉넉하면 위에 놓는다.
 * 좌우·상하는 뷰포트 안(margin)으로 클램프한다. 꼬리는 요소 가로 중심을 가리킨다.
 */
export function computePopoverPosition(
  rect: RectLike,
  viewport: Size,
  size: Size,
  gap = 10,
  margin = 8,
): PopoverPosition {
  const spaceBelow = viewport.height - margin - (rect.bottom + gap);
  const spaceAbove = rect.top - gap - margin;
  const placement: "below" | "above" =
    spaceBelow >= size.height || spaceBelow >= spaceAbove ? "below" : "above";
  const rawTop = placement === "below" ? rect.bottom + gap : rect.top - gap - size.height;
  const maxTop = Math.max(margin, viewport.height - margin - size.height);
  const top = Math.min(Math.max(rawTop, margin), maxTop);

  const centerX = (rect.left + rect.right) / 2;
  const maxLeft = Math.max(margin, viewport.width - margin - size.width);
  const left = Math.min(Math.max(centerX - size.width / 2, margin), maxLeft);
  const arrowMax = Math.max(ARROW_PAD, size.width - ARROW_PAD);
  const arrowLeft = Math.min(Math.max(centerX - left, ARROW_PAD), arrowMax);
  return { left, top, placement, arrowLeft };
}
