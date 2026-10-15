import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { TutorialPage } from "./TutorialPage";
import { App } from "../App";

const click = (name: string | RegExp) => fireEvent.click(screen.getByRole("button", { name }));
const progress = () => screen.getByTestId("tutorial-progress").textContent;
const status = () => screen.getByRole("status").textContent;

describe("TutorialPage", () => {
  it("전 단계를 처음부터 끝까지 진행하고 마치면 종료 콜백을 부른다", () => {
    const onExit = vi.fn();
    render(<TutorialPage onExit={onExit} />);
    expect(progress()).toContain("1 / 7");
    expect(screen.getByLabelText("패의 종류")).toBeTruthy();
    click("다음");

    // 2단계: 다른 패는 안내만
    expect(screen.getByRole("button", { name: "1만" }).getAttribute("aria-disabled")).toBe("true");
    click("1만");
    expect(status()).toContain("북");
    expect(progress()).toContain("2 / 7");
    click("다음");
    expect(status()).toContain("먼저");
    expect(progress()).toContain("2 / 7");
    click("북");
    expect(status()).toContain("잘했어요");
    click("다음");

    // 3단계: 실제 보드. 상가 버림패는 5통 한 장뿐이고 상대 손패는 없다
    expect(screen.getByLabelText("국 정보")).toBeTruthy();
    const pondTiles = Array.from(document.querySelectorAll(".pond .tile"));
    expect(pondTiles).toHaveLength(1);
    expect(document.querySelector('[data-seat="3"] .pond-entry')).not.toBeNull();
    expect(document.querySelector(".opponent-hand")).toBeNull();
    click("패스");
    expect(progress()).toContain("3 / 7");
    click("다음");
    expect(progress()).toContain("3 / 7");
    click("펑");
    expect(status()).toContain("펑!");
    expect(status()).toContain("리치를 할 수 없습니다");
    expect(screen.getByLabelText("펑").children.length).toBeGreaterThanOrEqual(3);
    expect(document.querySelectorAll(".pond .tile")).toHaveLength(0);
    click("다음");

    // 4단계
    expect(screen.queryByTestId("tenpai-waits")).toBeNull();
    click("대기패 보기");
    expect(screen.getByTestId("tenpai-waits").textContent).toContain("텐파이");
    expect(screen.getByTestId("wait-tile")).toBeTruthy();
    click("다음");

    // 5단계
    click("9삭");
    expect(status()).toContain("리치");
    expect(progress()).toContain("5 / 7");
    click("리치");
    expect(screen.getByRole("button", { name: "리치 취소" }).getAttribute("aria-pressed")).toBe("true");
    click("9삭");
    expect(status()).toContain("리치 선언");
    click("다음");

    // 6단계
    click("1만");
    expect(progress()).toContain("6 / 7");
    click("츠모");
    expect(status()).toContain("화료");
    click("다음");

    // 7단계
    expect(progress()).toContain("7 / 7");
    expect(screen.getByRole("group", { name: "화료 결과" }).textContent).toContain("리치");
    expect(screen.queryByRole("button", { name: "다음" })).toBeNull();
    click("마치고 처음으로");
    expect(onExit).toHaveBeenCalledTimes(1);
  });

  it("이전 버튼과 튜토리얼 종료 버튼", () => {
    const onExit = vi.fn();
    render(<TutorialPage onExit={onExit} />);
    expect((screen.getByRole("button", { name: "이전" }) as HTMLButtonElement).disabled).toBe(true);
    click("다음");
    click("이전");
    expect(progress()).toContain("1 / 7");
    click("튜토리얼 종료");
    expect(onExit).toHaveBeenCalled();
  });
});

describe("TutorialPage 3단계 치", () => {
  it("치를 누르면 4-5-6통 몸통이 생기고 남은 손패에 5통 한 쌍이 남는다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    click("다음");
    click("북");
    click("다음");
    click("치");
    expect(status()).toContain("치!");
    expect(screen.getByLabelText("치").querySelectorAll(".tile")).toHaveLength(3);
    expect(screen.getAllByLabelText("5통").length).toBeGreaterThanOrEqual(2);
    click("다음");
    expect(progress()).toContain("4 / 7");
  });
});

describe("TutorialPage 보드 화면", () => {
  it("실제 대국 화면의 4좌석 레이아웃과 중앙 정보를 쓰고 상대 손패를 그리지 않는다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    expect(document.querySelector(".board")).not.toBeNull();
    for (const s of ["0", "1", "2", "3"]) expect(document.querySelector(`.seat-panel[data-seat="${s}"]`)).not.toBeNull();
    expect(screen.getByLabelText("국 정보").textContent).toContain("동 1국 0본장");
    expect(document.querySelector(".opponent-hand")).toBeNull();
    expect(document.querySelector(".hand-count")).toBeNull();
    expect(document.querySelectorAll(".pond .tile")).toHaveLength(0);
  });

  it("리치 선언 후 내 좌석에 리치 표시와 리치 버림패가 보인다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    click("다음");
    click("북");
    click("다음");
    click("펑");
    click("다음");
    click("대기패 보기");
    click("다음");
    expect(document.querySelector(".seat-0 .badge-riichi")).toBeNull();
    click("리치");
    click("9삭");
    expect(document.querySelector(".seat-0 .badge-riichi")).not.toBeNull();
    expect(document.querySelector('.seat-0 [data-riichi="true"]')).not.toBeNull();
  });
});

describe("App 튜토리얼 모드", () => {
  it("모드 선택에서 튜토리얼로 들어가고 종료하면 모드 선택으로 돌아온다", () => {
    render(<App />);
    expect(screen.getByRole("button", { name: "혼자 연습 (로컬 봇 대전)" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "온라인 대전" })).toBeTruthy();
    click(/튜토리얼/);
    expect(screen.getByRole("heading", { name: "튜토리얼" })).toBeTruthy();
    click("튜토리얼 종료");
    expect(screen.getByRole("region", { name: "모드 선택" })).toBeTruthy();
  });
});
