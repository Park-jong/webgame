import { describe, expect, it } from "vitest";
import { computePopoverPosition } from "./popoverPosition";

const vp = { width: 1280, height: 390 };
const size = { width: 300, height: 100 };
const rect = (left: number, top: number, w = 40, h = 20) => ({ left, top, right: left + w, bottom: top + h });

describe("computePopoverPosition", () => {
  it("공간이 있으면 요소 아래에 놓고 꼬리는 요소 중심을 가리킨다", () => {
    const p = computePopoverPosition(rect(500, 50), vp, size);
    expect(p.placement).toBe("below");
    expect(p.top).toBe(80);
    expect(p.left).toBe(520 - 150);
    expect(p.arrowLeft).toBe(150);
  });
  it("아래 공간이 모자라면 위에 놓는다", () => {
    const p = computePopoverPosition(rect(500, 340), vp, size);
    expect(p.placement).toBe("above");
    expect(p.top).toBe(340 - 10 - 100);
  });
  it("좌우를 뷰포트 안으로 클램프하고 꼬리는 창 안에 머문다", () => {
    const l = computePopoverPosition(rect(0, 50), vp, size);
    expect(l.left).toBe(8);
    expect(l.arrowLeft).toBe(14);
    const r = computePopoverPosition(rect(1250, 50), vp, size);
    expect(r.left).toBe(1280 - 8 - 300);
    expect(r.arrowLeft).toBeLessThanOrEqual(286);
  });
  it("좁은 뷰포트와 양쪽 모두 모자란 경우에도 화면 밖으로 나가지 않는다", () => {
    const small = { width: 390, height: 200 };
    const p = computePopoverPosition(rect(10, 90), small, { width: 374, height: 150 });
    expect(p.left).toBeGreaterThanOrEqual(8);
    expect(p.left + 374).toBeLessThanOrEqual(390 - 8);
    expect(p.top).toBeGreaterThanOrEqual(8);
    expect(p.top + 150).toBeLessThanOrEqual(200 - 8);
  });
});
