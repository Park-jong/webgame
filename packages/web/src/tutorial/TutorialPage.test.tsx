import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
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

    // 3단계: 실제 보드. 좌석별 기본 버림패 4장 + 상가의 방금 버린 5통, 상대 손패는 뒷면 13장씩이다
    expect(screen.getByLabelText("국 정보")).toBeTruthy();
    const pondTiles = Array.from(document.querySelectorAll(".pond .tile"));
    expect(pondTiles).toHaveLength(17);
    for (const s of ["0", "1", "2"]) expect(document.querySelectorAll(`[data-seat="${s}"] .pond-entry`)).toHaveLength(4);
    expect(document.querySelectorAll('[data-seat="3"] .pond-entry')).toHaveLength(5);
    expect(document.querySelector('[data-seat="3"] .pond-entry:last-child')?.getAttribute("data-response-target")).toBe("true");
    expect(document.querySelectorAll(".opponent-hand")).toHaveLength(3);
    click("패스");
    expect(progress()).toContain("3 / 7");
    click("다음");
    expect(progress()).toContain("3 / 7");
    click("퐁");
    expect(status()).toContain("퐁!");
    expect(status()).toContain("리치를 할 수 없습니다");
    expect(screen.getByLabelText("퐁").children.length).toBeGreaterThanOrEqual(3);
    expect(document.querySelectorAll(".pond .tile")).toHaveLength(16);
    expect(document.querySelectorAll('[data-seat="3"] .pond-entry')).toHaveLength(4);
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
    click("쯔모");
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
  it("실제 대국 화면의 4좌석 레이아웃과 중앙 정보를 쓰고 상대 손패를 뒷면 13장씩 그린다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    expect(document.querySelector(".board")).not.toBeNull();
    for (const s of ["0", "1", "2", "3"]) expect(document.querySelector(`.seat-panel[data-seat="${s}"]`)).not.toBeNull();
    expect(screen.getByLabelText("국 정보").textContent).toContain("동 1국 0본장");
    const hands = Array.from(document.querySelectorAll(".opponent-hand"));
    expect(hands).toHaveLength(3);
    for (const h of hands) {
      expect(h.querySelectorAll(".tile")).toHaveLength(13);
      // 뒷면만: 모두 뒷면이라 실제 패 값이 없다
      expect(h.querySelectorAll('[aria-label="뒷면"]')).toHaveLength(13);
    }
    expect(document.querySelectorAll(".hand-count")).toHaveLength(3);
    expect(document.querySelectorAll(".pond .tile")).toHaveLength(16);
  });

  it("리치 선언 후 내 좌석에 리치 표시와 리치 버림패가 보인다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    click("다음");
    click("북");
    click("다음");
    click("퐁");
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

describe("화면 설명 팝오버", () => {
  const pop = () => screen.queryByRole("dialog");
  const popText = () => pop()?.textContent ?? "";
  const target = (name: string) => screen.getAllByRole("button", { name })[0]!;

  it("요소를 누르면 제목과 설명이 있는 창이 뜨고, 다른 요소를 누르면 교체된다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    expect(screen.getByTestId("tutorial-hint").textContent).toContain("각 부분을 눌러 보면");
    expect(pop()).toBeNull();
    const dora = target("도라 표시패 설명 보기");
    fireEvent.click(dora);
    expect(pop()).not.toBeNull();
    expect(pop()!.getAttribute("aria-labelledby")).toBe("tutorial-popover-title");
    expect(popText()).toContain("도라");
    expect(popText()).toContain("다음 패");
    expect(dora.getAttribute("aria-expanded")).toBe("true");
    expect(dora.getAttribute("aria-controls")).toBe("tutorial-popover");
    fireEvent.click(target("리치봉 설명 보기"));
    expect(screen.getAllByRole("dialog")).toHaveLength(1);
    expect(popText()).toContain("1000점");
    expect(dora.getAttribute("aria-expanded")).toBeNull();
    fireEvent.click(target("산패 설명 보기"));
    expect(popText()).toContain("유국");
    fireEvent.click(target("친 표시 설명 보기"));
    expect(popText()).toContain("1.5배");
    fireEvent.click(target("상대 손패 설명 보기"));
    expect(popText()).toContain("뒷면");
    fireEvent.click(target("점수 설명 보기"));
    expect(popText()).toContain("25000");
    fireEvent.click(target("국과 본장 설명 보기"));
    expect(popText()).toContain("본장");
  });

  it("같은 요소 재클릭, 닫기 버튼, Esc, 바깥 클릭으로 닫힌다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    const dora = target("도라 표시패 설명 보기");
    fireEvent.click(dora);
    fireEvent.click(dora);
    expect(pop()).toBeNull();
    fireEvent.click(dora);
    fireEvent.click(within(pop()!).getByRole("button", { name: "닫기" }));
    expect(pop()).toBeNull();
    fireEvent.click(dora);
    fireEvent.keyDown(document.body, { key: "Escape" });
    expect(pop()).toBeNull();
    fireEvent.click(dora);
    fireEvent.click(screen.getByRole("heading", { name: "튜토리얼" }));
    expect(pop()).toBeNull();
    // 창 안쪽 클릭은 닫지 않는다
    fireEvent.click(dora);
    fireEvent.click(within(pop()!).getByText("도라 표시패", { exact: false }));
    expect(pop()).not.toBeNull();
  });

  it("키보드(Enter/Space)로 열고 닫을 때 포커스가 팝오버와 원래 요소를 오간다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    const el = target("도라 표시패 설명 보기");
    expect(el.getAttribute("tabindex")).toBe("0");
    el.focus();
    fireEvent.keyDown(el, { key: "Enter" });
    expect(popText()).toContain("도라");
    expect(document.activeElement).toBe(within(pop()!).getByRole("button", { name: "닫기" }));
    fireEvent.keyDown(document.activeElement!, { key: "Escape" });
    expect(pop()).toBeNull();
    expect(document.activeElement).toBe(el);
    fireEvent.keyDown(target("산패 설명 보기"), { key: " " });
    expect(popText()).toContain("유국");
    // 같은 종류가 여럿이면 첫 번째만 Tab 순서에 들어간다
    const scores = screen.getAllByRole("button", { name: "점수 설명 보기" });
    expect(scores.map((e) => e.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
  });

  it("단계가 바뀌면 닫히고, 열려 있어도 연습과 완료 상태는 영향받지 않는다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    fireEvent.click(target("도라 표시패 설명 보기"));
    click("다음");
    expect(pop()).toBeNull();
    expect(progress()).toContain("2 / 7");
    fireEvent.click(target("점수 설명 보기"));
    expect(status()).not.toContain("잘했어요");
    // 바깥 클릭이 연습 클릭이기도 하면 연습은 정상 동작하고 창만 닫힌다
    click("북");
    expect(pop()).toBeNull();
    expect(status()).toContain("잘했어요");
    fireEvent.click(target("산패 설명 보기"));
    expect(status()).toContain("잘했어요");
    click("다음");
    expect(progress()).toContain("3 / 7");
    fireEvent.click(target("버림패 설명 보기"));
    expect(popText()).toContain("버림패");
    click("퐁");
    expect(status()).toContain("퐁!");
    expect(pop()).toBeNull();
    expect(screen.getAllByRole("button", { name: "내 후로 설명 보기" })).toHaveLength(1);
    click("다음");
    click("대기패 보기");
    click("다음");
    click("리치");
    click("9삭");
    fireEvent.click(target("리치 표시 설명 보기"));
    expect(popText()).toContain("리치를 선언한 상태");
    fireEvent.click(target("리치 선언패 설명 보기"));
    expect(popText()).toContain("눕혀");
  });
});

describe("좌석별 기본 버림패와 쯔모기리/테다시 설명", () => {
  const pop = () => screen.queryByRole("dialog");
  const popText = () => pop()?.textContent ?? "";

  it("1단계부터 네 좌석 모두 버림패 4장씩이고 쯔모기리와 테다시가 섞여 있다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    for (const s of ["0", "1", "2", "3"]) {
      const entries = document.querySelectorAll(`[data-seat="${s}"] .pond-entry`);
      expect(entries, s).toHaveLength(4);
      const tsumo = document.querySelectorAll(`[data-seat="${s}"] .pond-entry[data-tsumogiri="true"]`).length;
      expect(tsumo, s).toBeGreaterThanOrEqual(1);
      expect(tsumo, s).toBeLessThan(4);
    }
  });

  it("2단계에서 북을 버리면 내 버림패가 5장이 되고 쯔모기리로 표시된다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    click("다음");
    click("북");
    const mine = document.querySelectorAll('[data-seat="0"] .pond-entry');
    expect(mine).toHaveLength(5);
    expect(mine[4]!.getAttribute("data-tsumogiri")).toBe("true");
  });

  it("쯔모기리 패와 테다시 패를 누르면 서로 다른 설명이 뜨고 Tab 순서는 종류별 첫 번째만 들어간다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    const tsumo = screen.getAllByRole("button", { name: "쯔모기리 패 설명 보기" });
    const tedashi = screen.getAllByRole("button", { name: "테다시 패 설명 보기" });
    expect(tsumo.length).toBe(4);
    expect(tedashi.length).toBe(12);
    expect(tsumo.map((e) => e.getAttribute("tabindex"))).toEqual(["0", "-1", "-1", "-1"]);
    expect(tedashi.filter((e) => e.getAttribute("tabindex") === "0")).toHaveLength(1);
    fireEvent.click(tsumo[0]!);
    expect(popText()).toContain("쯔모기리");
    expect(popText()).toContain("그대로 버린");
    fireEvent.click(tedashi[0]!);
    expect(popText()).toContain("테다시");
    expect(popText()).toContain("손패에서 골라");
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

describe("TutorialPage 용어 주석", () => {
  const terms = () => Array.from(document.querySelectorAll<HTMLElement>(".tutorial-term")).map((e) => e.dataset.term);

  it("용어는 처음 나오는 단계에서만 한 번 주석이 붙는다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    expect(terms()).toEqual(["mentsu", "atama"]);
    click("다음");
    expect(terms()).toEqual(["tsumogiri", "tedashi"]);
    click("북");
    click("다음");
    // 3단계: 치/퐁은 말풍선에서 한 번씩만
    expect(terms()).toEqual(["chi", "pon"]);
    click("퐁");
    // 완료 문구의 후로/멘젠/리치가 처음 나온다 (치/퐁은 이미 말풍선에서 사용)
    expect(terms()).toEqual(["chi", "pon", "furo", "menzen", "riichi"]);
    click("다음");
    // 4단계: 텐파이, 대기패. 5단계로 가면 이미 나온 리치는 일반 글자
    expect(terms()).toContain("tenpai");
    click("대기패 보기");
    click("다음");
    expect(terms()).not.toContain("riichi");
    expect(terms()).toContain("yaku");
    // 이전 단계로 돌아가면 그 단계의 첫 등장 용어가 다시 보인다
    click("이전");
    expect(terms()).toContain("tenpai");
  });

  it("누르면 뜻풀이 팝오버가 뜨고 닫기/Esc로 닫히며 연습 상태는 바뀌지 않는다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    fireEvent.click(screen.getByRole("button", { name: "'몸통' 뜻 보기" }));
    const pop = screen.getByTestId("tutorial-popover");
    expect(pop.getAttribute("role")).toBe("dialog");
    expect(pop.textContent).toContain("연속된 숫자 3장");
    expect(progress()).toContain("1 / 7");
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByTestId("tutorial-popover")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "'머리' 뜻 보기" }));
    expect(screen.getByTestId("tutorial-popover").textContent).toContain("2장");
    fireEvent.keyDown(document, { key: "Escape" });
    expect(screen.queryByTestId("tutorial-popover")).toBeNull();
  });

  it("2단계의 화면 설명과 용어 설명은 한 번에 하나만 열린다", () => {
    render(<TutorialPage onExit={vi.fn()} />);
    click("다음");
    fireEvent.click(screen.getByRole("button", { name: "'테다시' 뜻 보기" }));
    expect(screen.getAllByTestId("tutorial-popover")).toHaveLength(1);
    fireEvent.click(screen.getByRole("button", { name: "'쯔모기리' 뜻 보기" }));
    expect(screen.getAllByTestId("tutorial-popover")).toHaveLength(1);
    expect(screen.getByTestId("tutorial-popover").textContent).toContain("방금 뽑은 패");
    expect(status()).not.toContain("잘했어요");
  });
});
