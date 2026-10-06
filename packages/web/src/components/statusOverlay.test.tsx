// 22-1 연결 배너가 모달 제목을 가리지 않도록 StatusStack이 --overlay-top을 알리는지
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, render } from "@testing-library/react";
import { StatusStack } from "./StatusStack";

const noop = (): void => {};
const overlayTop = (): string => document.documentElement.style.getPropertyValue("--overlay-top");

afterEach(() => {
  cleanup();
  document.documentElement.style.removeProperty("--overlay-top");
});

describe("StatusStack --overlay-top", () => {
  it("보이는 동안 설정하고, 사라지면 지운다", () => {
    const props = { connection: null, notice: null, onReconnect: noop, onDismissNotice: noop };
    const { rerender, unmount } = render(<StatusStack {...props} />);
    expect(overlayTop()).toBe("");
    rerender(<StatusStack {...props} notice="timeout" />);
    // jsdom은 레이아웃이 없어 0px이다. 값이 px 단위로 설정되는 것을 확인한다
    expect(overlayTop()).toMatch(/^\d+px$/);
    rerender(<StatusStack {...props} />);
    expect(overlayTop()).toBe("");
    rerender(<StatusStack {...props} switchNote />);
    expect(overlayTop()).toMatch(/^\d+px$/);
    unmount();
    expect(overlayTop()).toBe("");
  });
});
