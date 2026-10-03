import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, within } from "@testing-library/react";
import type { Action, Tile } from "@mahjong/core";
import { TileView } from "./TileView";
import { Hand } from "./Hand";
import { ActionBar } from "./ActionBar";
import { GameEndScreen, ResultModal } from "./ResultModal";
import { MeldView, Pond } from "./SeatPanel";
import { Board } from "./Board";
import { App } from "../App";
import { awaitingSeats, decideAction, legalActions } from "@mahjong/core";
import type { GameState } from "@mahjong/core";
import {
  advance,
  applyAction,
  beginNextRound,
  humanActions,
  humanMustAct,
  isRoundOver,
  newSession,
  summarizeRound,
} from "../controller";
import type { RoundSummary, Session } from "../controller";

const num = (suit: "man" | "pin" | "sou", rank: number, isRedFive = false): Tile => ({
  kind: "number",
  suit,
  rank: rank as 1,
  isRedFive,
});
const east: Tile = { kind: "wind", wind: "east" };
const red: Tile = { kind: "dragon", dragon: "red" };

describe("TileView", () => {
  it("적5는 별도 클래스와 라벨로 구분된다", () => {
    render(
      <>
        <TileView tile={num("man", 5, true)} />
        <TileView tile={num("man", 5)} />
        <TileView tile={null} />
      </>,
    );
    expect(screen.getByLabelText("5만(적)").className).toContain("tile-red-five");
    expect(screen.getByLabelText("5만").className).not.toContain("tile-red-five");
    expect(screen.getByLabelText("뒷면").className).toContain("tile-back");
  });

  it("안깡은 양끝 뒷면, 나머지는 앞면", () => {
    const tile = num("pin", 3);
    render(<MeldView meld={{ type: "ankan", tiles: [tile, tile, tile, tile] }} />);
    const meld = screen.getByLabelText("안깡");
    const labels = within(meld)
      .getAllByRole("img")
      .map((e) => e.getAttribute("aria-label"));
    expect(labels).toEqual(["뒷면", "3통", "3통", "뒷면"]);
  });
});

describe("MeldView 출처 표시", () => {
  it("펑: 가져온 패는 눕혀 표시하고 출처(대면)를 라벨로 보여준다", () => {
    const t = num("pin", 7);
    render(<MeldView meld={{ type: "pon", tiles: [t, t, t], calledTile: t, fromSeat: 2, from: "across" }} />);
    const meld = screen.getByLabelText("펑");
    expect(meld.getAttribute("data-from")).toBe("across");
    expect(within(meld).getByText("대면")).toBeTruthy();
    const sideways = within(meld)
      .getAllByRole("img")
      .filter((e) => e.className.includes("tile-sideways"));
    expect(sideways).toHaveLength(1);
  });

  it("치는 상가, 안깡은 출처 라벨과 눕힌 패가 없다", () => {
    const a = num("man", 3);
    const b = num("man", 4);
    const c = num("man", 5);
    const { unmount } = render(
      <MeldView meld={{ type: "chi", tiles: [a, b, c], calledTile: b, fromSeat: 3, from: "left" }} />,
    );
    const chi = screen.getByLabelText("치");
    expect(within(chi).getByText("상가")).toBeTruthy();
    const imgs = within(chi).getAllByRole("img");
    expect(imgs.map((e) => e.className.includes("tile-sideways"))).toEqual([false, true, false]);
    unmount();
    render(<MeldView meld={{ type: "ankan", tiles: [a, a, a, a] }} />);
    const ankan = screen.getByLabelText("안깡");
    expect(ankan.querySelector(".meld-from")).toBeNull();
    expect(ankan.querySelector(".tile-sideways")).toBeNull();
  });
});

/** 사람 자리를 첫 합법 타패로 진행해 사람이 응답해야 하는 정지 시점을 찾는다. */
function findHumanResponse(): Session {
  for (let seed = 1; seed <= 200; seed++) {
    let session = advance(newSession(seed));
    for (let i = 0; i < 400 && !isRoundOver(session.state); i++) {
      const { state } = session;
      if (!humanMustAct(state)) break;
      if (state.phase === "response") return session;
      const discard = humanActions(state).find((a) => a.type === "discard" && a.riichi !== true);
      if (!discard) break;
      session = advance(applyAction(session, discard));
    }
  }
  throw new Error("응답 단계를 찾지 못했습니다");
}

describe("응답 대상 버림패 강조", () => {
  const noop = () => {};
  it("응답 단계에서는 버림패를 강조하고 안내 문구를 보여준다", () => {
    const { state } = findHumanResponse();
    const pending = state.pending!;
    render(
      <Board state={state} actions={humanActions(state)} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />,
    );
    const targets = document.querySelectorAll("[data-response-target]");
    expect(targets).toHaveLength(1);
    expect(targets[0]!.closest(".seat-panel")!.className).toContain(`seat-${pending.discarder}`);
    const note = screen.getByRole("status");
    expect(note.textContent).toMatch(/의 버림패 .+에 대한 응답/);
    expect(targets[0]!.querySelector("[role=img]")!.getAttribute("aria-label")).toBe(note.querySelector("b")!.textContent);
  });

  it("응답 단계가 아니면 강조와 안내가 없다", () => {
    const { state } = advance(newSession(21)); // 사람의 타패 차례
    expect(state.phase).toBe("turn");
    render(
      <Board state={state} actions={humanActions(state)} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />,
    );
    expect(document.querySelector("[data-response-target]")).toBeNull();
    expect(screen.queryByRole("status")).toBeNull();
  });
});

describe("Hand", () => {
  const tiles = [num("man", 1), num("man", 2), east];
  const drawn = red;
  const actions: Action[] = [
    { type: "discard", seat: 0, tile: num("man", 1) },
    { type: "discard", seat: 0, tile: red },
    { type: "discard", seat: 0, tile: east, riichi: true },
  ];

  it("합법 타패만 활성화되고 뽑은 패는 분리된다", () => {
    render(<Hand tiles={tiles} drawn={drawn} actions={actions} riichiMode={false} onAction={() => {}} />);
    expect((screen.getByLabelText("1만") as HTMLButtonElement).disabled).toBe(false);
    expect((screen.getByLabelText("2만") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("동") as HTMLButtonElement).disabled).toBe(true); // 리치 타패만 있음
    expect((screen.getByLabelText("중") as HTMLButtonElement).disabled).toBe(false);
    const drawnBox = document.querySelector(".hand-drawn")!;
    expect(within(drawnBox as HTMLElement).getByLabelText("중")).toBeTruthy();
  });

  it("패 클릭은 해당 타패 행동을 전달한다", () => {
    const onAction = vi.fn();
    render(<Hand tiles={tiles} drawn={drawn} actions={actions} riichiMode={false} onAction={onAction} />);
    fireEvent.click(screen.getByLabelText("1만"));
    expect(onAction).toHaveBeenCalledWith({ type: "discard", seat: 0, tile: num("man", 1) });
    fireEvent.click(screen.getByLabelText("2만")); // 비활성: 무시
    expect(onAction).toHaveBeenCalledTimes(1);
  });

  it("리치 모드에서는 리치 타패 가능한 패만 활성화되고 riichi: true로 전달된다", () => {
    const onAction = vi.fn();
    render(<Hand tiles={tiles} drawn={drawn} actions={actions} riichiMode onAction={onAction} />);
    expect((screen.getByLabelText("1만") as HTMLButtonElement).disabled).toBe(true);
    expect((screen.getByLabelText("동") as HTMLButtonElement).disabled).toBe(false);
    fireEvent.click(screen.getByLabelText("동"));
    expect(onAction).toHaveBeenCalledWith({ type: "discard", seat: 0, tile: east, riichi: true });
  });

  it("적5와 일반 5는 별개의 선택지로 취급된다", () => {
    const onAction = vi.fn();
    const acts: Action[] = [{ type: "discard", seat: 0, tile: num("sou", 5, true) }];
    render(
      <Hand tiles={[num("sou", 5), num("sou", 5, true)]} drawn={null} actions={acts} riichiMode={false} onAction={onAction} />,
    );
    expect((screen.getByLabelText("5삭") as HTMLButtonElement).disabled).toBe(true);
    fireEvent.click(screen.getByLabelText("5삭(적)"));
    expect(onAction).toHaveBeenCalledWith(acts[0]);
  });
});

describe("ActionBar", () => {
  const button = (name: string) => screen.getByRole("button", { name }) as HTMLButtonElement;

  const queryButton = (name: string) => screen.queryByRole("button", { name });

  it("legalActions에 없는 행동은 버튼 자체를 렌더하지 않는다", () => {
    const actions: Action[] = [{ type: "discard", seat: 0, tile: east }];
    render(<ActionBar actions={actions} riichiMode={false} onToggleRiichi={() => {}} onAction={() => {}} />);
    for (const name of ["츠모", "론", "리치", "안깡", "가깡", "치", "펑", "대명깡", "구종구패", "패스"]) {
      expect(queryButton(name)).toBeNull();
    }
    expect(screen.queryAllByRole("button")).toHaveLength(0);
  });

  it("츠모/리치/안깡이 가능하면 그 버튼만 활성화되고 클릭이 전달된다", () => {
    const onAction = vi.fn();
    const onToggle = vi.fn();
    const tsumo: Action = { type: "tsumo", seat: 0 };
    const ankan: Action = { type: "ankan", seat: 0, tile: east };
    const actions: Action[] = [tsumo, ankan, { type: "discard", seat: 0, tile: red, riichi: true }];
    render(<ActionBar actions={actions} riichiMode={false} onToggleRiichi={onToggle} onAction={onAction} />);
    expect(button("츠모").disabled).toBe(false);
    expect(button("츠모").className).toContain("action-btn-win");
    expect(button("리치").disabled).toBe(false);
    expect(button("안깡").disabled).toBe(false);
    expect(queryButton("론")).toBeNull();
    expect(queryButton("펑")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(3); // 리치, 츠모, 안깡
    fireEvent.click(button("츠모"));
    expect(onAction).toHaveBeenCalledWith(tsumo);
    fireEvent.click(button("안깡"));
    expect(onAction).toHaveBeenCalledWith(ankan);
    fireEvent.click(button("리치"));
    expect(onToggle).toHaveBeenCalledTimes(1);
  });

  it("론/패스 응답, 리치 모드 라벨", () => {
    const actions: Action[] = [
      { type: "ron", seat: 0 },
      { type: "pass", seat: 0 },
    ];
    const { rerender } = render(
      <ActionBar actions={actions} riichiMode={false} onToggleRiichi={() => {}} onAction={() => {}} />,
    );
    expect(button("론").className).toContain("action-btn-win");
    expect(button("패스").disabled).toBe(false);
    expect(queryButton("리치")).toBeNull();
    expect(screen.getAllByRole("button")).toHaveLength(2);
    rerender(<ActionBar actions={actions} riichiMode onToggleRiichi={() => {}} onAction={() => {}} />);
    expect(screen.getByRole("button", { name: "리치 취소" })).toBeTruthy();
  });

  it("펑 선택지가 여러 개(적5 사용 여부)면 선택지별 버튼을 보여준다", () => {
    const onAction = vi.fn();
    const plain: Action = { type: "pon", seat: 0, use: [num("pin", 5), num("pin", 5)] };
    const withRed: Action = { type: "pon", seat: 0, use: [num("pin", 5), num("pin", 5, true)] };
    const actions: Action[] = [plain, withRed, { type: "pass", seat: 0 }];
    render(<ActionBar actions={actions} riichiMode={false} onToggleRiichi={() => {}} onAction={onAction} />);
    fireEvent.click(button("펑 (5통 5통(적))"));
    expect(onAction).toHaveBeenCalledWith(withRed);
    fireEvent.click(button("펑 (5통 5통)"));
    expect(onAction).toHaveBeenLastCalledWith(plain);
  });

  it("치 조합이 여러 개면 조합별 버튼", () => {
    const a: Action = { type: "chi", seat: 0, use: [num("man", 3), num("man", 4)] };
    const b: Action = { type: "chi", seat: 0, use: [num("man", 4), num("man", 6)] };
    render(<ActionBar actions={[a, b, { type: "pass", seat: 0 }]} riichiMode={false} onToggleRiichi={() => {}} onAction={() => {}} />);
    expect(button("치 (3만 4만)").disabled).toBe(false);
    expect(button("치 (4만 6만)").disabled).toBe(false);
  });
});

const winSummary: RoundSummary = {
  kind: "win",
  gameOver: false,
  title: "론 화료",
  winType: "ron",
  wins: [
    {
      seat: 0,
      from: 2,
      winningTile: num("man", 5),
      hand: [num("man", 2), num("man", 3), num("man", 4)],
      melds: [],
      yaku: [
        { name: "리치", han: 1, yakuman: 0 },
        { name: "탕야오", han: 1, yakuman: 0 },
      ],
      dora: 1,
      doraCount: 0,
      redDora: 0,
      uraDora: 1,
      han: 3,
      fu: 30,
      limit: null,
      yakumanMultiple: 0,
      isDealer: true,
      total: 6800,
      handPoints: 5800,
      honbaPoints: 0,
      riichiPoints: 1000,
      basePoints: 960,
      riichi: true,
    },
  ],
  drawName: null,
  tenpai: null,
  deltas: [6800, 0, -5800, 0],
  scores: [31800, 25000, 19200, 25000],
  doraIndicators: [num("pin", 1)],
  uraDoraIndicators: [num("sou", 9)],
  dealerContinues: true,
};

describe("ResultModal", () => {
  it("화료: 역/판수/부수/점수 이동/도라/뒷도라를 표시하고 다음 국 버튼이 동작한다", () => {
    const onNext = vi.fn();
    render(<ResultModal summary={winSummary} onNext={onNext} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByText("론 화료")).toBeTruthy();
    expect(within(dialog).getByText("리치")).toBeTruthy();
    expect(within(dialog).getByText("탕야오")).toBeTruthy();
    // 도라 판수는 종류별로 분리 표시 (0인 항목은 숨김)
    const yakuList = within(dialog.querySelector(".yaku-list") as HTMLElement);
    expect(yakuList.getByText("뒷도라")).toBeTruthy();
    expect(yakuList.queryByText("도라")).toBeNull();
    expect(yakuList.queryByText("적도라")).toBeNull();
    expect(within(dialog).getByText("3판 30부 (기본점 960)")).toBeTruthy();
    expect(within(dialog).getByLabelText("점수 내역").textContent).toBe("화료 점수 5800 + 리치봉 1000 = 수령 합계 6800점");
    expect(within(dialog).getByText("+6800")).toBeTruthy();
    expect(within(dialog).getByText("-5800")).toBeTruthy();
    expect(within(dialog).getByLabelText("도라 표시패")).toBeTruthy();
    expect(within(dialog).getByLabelText("뒷도라 표시패")).toBeTruthy();
    fireEvent.click(within(dialog).getByRole("button", { name: "다음 국" }));
    expect(onNext).toHaveBeenCalled();
  });

  it("본장이 있으면 본장 항목을 분리해 표시하고, 없는 항목은 숨긴다", () => {
    const win = { ...winSummary.wins[0]!, total: 6100, handPoints: 5800, honbaPoints: 300, riichiPoints: 0 };
    render(<ResultModal summary={{ ...winSummary, wins: [win] }} onNext={() => {}} />);
    expect(screen.getByLabelText("점수 내역").textContent).toBe("화료 점수 5800 + 본장 300 = 수령 합계 6100점");
  });

  it("한도 화료는 한도 이름과 기본점을 표시한다", () => {
    const win = { ...winSummary.wins[0]!, limit: "만관", han: 5, fu: 30, basePoints: 2000, handPoints: 8000, total: 8000, riichiPoints: 0 };
    render(<ResultModal summary={{ ...winSummary, wins: [win] }} onNext={() => {}} />);
    expect(screen.getByText("5판 30부 만관 (기본점 2000)")).toBeTruthy();
  });

  it("역만: 판수 대신 역만 배수와 기본점 8000을 표시하고 도라 항목은 숨긴다", () => {
    const win = {
      ...winSummary.wins[0]!,
      yaku: [{ name: "대삼원", han: 0, yakuman: 1 }],
      dora: 0, doraCount: 0, redDora: 0, uraDora: 0,
      han: 0, fu: 0, limit: "역만", yakumanMultiple: 1,
      basePoints: 8000, handPoints: 32000, total: 33000, riichiPoints: 1000,
    };
    render(<ResultModal summary={{ ...winSummary, wins: [win] }} onNext={() => {}} />);
    const dialog = screen.getByRole("dialog");
    const yakuList = within(dialog.querySelector(".yaku-list") as HTMLElement);
    expect(yakuList.getByText("대삼원")).toBeTruthy();
    expect(yakuList.getByText("역만")).toBeTruthy();
    expect(yakuList.queryByText(/판$/)).toBeNull();
    expect(within(dialog).getByText("역만 (기본점 8000)")).toBeTruthy();
    expect(within(dialog).getByLabelText("나 화료").querySelector("h3")!.textContent).toMatch(/ - 역만$/);
    expect(within(dialog).getByLabelText("점수 내역").textContent).toBe("화료 점수 32000 + 리치봉 1000 = 수령 합계 33000점");
  });

  it("더블역만과 복합 역만: 더블역만 / N배 역만과 기본점 8000 x 배수를 표시한다", () => {
    const double = {
      ...winSummary.wins[0]!,
      yaku: [{ name: "국사무쌍 13면 대기", han: 0, yakuman: 2 }],
      dora: 0, doraCount: 0, redDora: 0, uraDora: 0,
      han: 0, fu: 0, limit: "더블역만", yakumanMultiple: 2,
      basePoints: 16000, handPoints: 64000, total: 64000, riichiPoints: 0,
    };
    const { unmount } = render(<ResultModal summary={{ ...winSummary, wins: [double] }} onNext={() => {}} />);
    const yakuList = within(screen.getByRole("dialog").querySelector(".yaku-list") as HTMLElement);
    expect(yakuList.getByText("국사무쌍 13면 대기")).toBeTruthy();
    expect(yakuList.getByText("더블역만")).toBeTruthy();
    expect(screen.getByText("더블역만 (기본점 16000)")).toBeTruthy();
    unmount();

    const triple = {
      ...double,
      yaku: [
        { name: "스안커 단기", han: 0, yakuman: 2 },
        { name: "자일색", han: 0, yakuman: 1 },
      ],
      limit: "3배 역만", yakumanMultiple: 3, basePoints: 24000, handPoints: 96000, total: 96000,
    };
    render(<ResultModal summary={{ ...winSummary, wins: [triple] }} onNext={() => {}} />);
    expect(screen.getByText("3배 역만 (기본점 24000)")).toBeTruthy();
    expect(screen.getByText("자일색")).toBeTruthy();
  });

  it("뒷도라 표시패는 비어 있으면 숨긴다", () => {
    render(<ResultModal summary={{ ...winSummary, uraDoraIndicators: [] }} onNext={() => {}} />);
    expect(screen.queryByLabelText("뒷도라 표시패")).toBeNull();
  });

  it("유국: 종류와 텐파이/점수 변동", () => {
    const draw: RoundSummary = {
      kind: "draw",
      gameOver: false,
      title: "황패평국",
      winType: null,
      wins: [],
      drawName: "황패평국",
      tenpai: [true, false, false, false],
      deltas: [3000, -1000, -1000, -1000],
      scores: [28000, 24000, 24000, 24000],
      doraIndicators: [east],
      uraDoraIndicators: [],
      dealerContinues: true,
    };
    render(<ResultModal summary={draw} onNext={() => {}} />);
    expect(screen.getByRole("heading", { name: "황패평국" })).toBeTruthy();
    expect(screen.getByText(/텐파이: 나/)).toBeTruthy();
    expect(screen.getByText("+3000")).toBeTruthy();
  });

  it("게임 종료 결과는 버튼이 '최종 결과', 최종 화면은 순위와 새 게임", () => {
    const onNew = vi.fn();
    render(<ResultModal summary={{ ...winSummary, gameOver: true }} onNext={() => {}} />);
    expect(screen.getByRole("button", { name: "최종 결과" })).toBeTruthy();
    render(<GameEndScreen scores={[20000, 40000, 25000, 15000]} onNewGame={onNew} />);
    const items = within(screen.getByRole("dialog", { name: "게임 종료" })).getAllByRole("listitem");
    expect(items.map((li) => li.textContent)).toEqual([
      "1위 하가40000",
      "2위 대면25000",
      "3위 나20000",
      "4위 상가15000",
    ]);
    fireEvent.click(screen.getByRole("button", { name: "새 게임" }));
    expect(onNew).toHaveBeenCalled();
  });
});

describe("결과 모달 구조 (주 액션은 스크롤 영역 밖 푸터)", () => {
  const drawSummary: RoundSummary = {
    ...winSummary,
    kind: "draw",
    title: "황패평국",
    winType: null,
    wins: [],
    drawName: "황패평국",
    tenpai: [true, false, false, false],
    uraDoraIndicators: [],
  };

  function expectFooterAction(dialog: HTMLElement, name: string) {
    const button = within(dialog).getByRole("button", { name });
    const footer = button.closest(".modal-footer");
    expect(footer).toBeTruthy();
    expect(footer!.parentElement).toBe(dialog);
    const body = dialog.querySelector(".modal-body")!;
    expect(body.contains(button)).toBe(false);
    expect(dialog.querySelector(".modal-header")).toBeTruthy();
  }

  it("화료 모달: 다음 국 버튼은 .modal-body 밖의 .modal-footer에 있다", () => {
    render(<ResultModal summary={winSummary} onNext={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expectFooterAction(dialog, "다음 국");
    expect(dialog.querySelector(".modal-body")!.contains(within(dialog).getByText("탕야오"))).toBe(true);
  });

  it("더블론(화료 2건): 두 화료자 정보와 주 액션이 모두 있다", () => {
    const second = { ...winSummary.wins[0]!, seat: 1, yaku: [{ name: "삼원패 중", han: 1, yakuman: 0 }] };
    const double: RoundSummary = { ...winSummary, wins: [winSummary.wins[0]!, second] };
    render(<ResultModal summary={double} onNext={() => {}} />);
    const dialog = screen.getByRole("dialog");
    expect(within(dialog).getByLabelText("나 화료")).toBeTruthy();
    expect(within(dialog).getByLabelText("하가 화료")).toBeTruthy();
    expect(within(dialog).getByText("삼원패 중")).toBeTruthy();
    expectFooterAction(dialog, "다음 국");
  });

  it("유국 모달과 게임 종료 화면도 같은 구조", () => {
    const { unmount } = render(<ResultModal summary={drawSummary} onNext={() => {}} />);
    expectFooterAction(screen.getByRole("dialog"), "다음 국");
    unmount();
    render(<GameEndScreen scores={[20000, 40000, 25000, 15000]} onNewGame={() => {}} />);
    expectFooterAction(screen.getByRole("dialog", { name: "게임 종료" }), "새 게임");
  });
});

describe("App (통합)", () => {
  it("시드 고정: 손패 버튼의 활성 여부가 legalActions와 일치하고 클릭하면 타패/로그로 이어진다", () => {
    const seed = 21;
    const session = advance(newSession(seed));
    const legal = humanActions(session.state);
    const legalDiscardCount = new Set(
      legal.filter((a) => a.type === "discard" && a.riichi !== true).map((a) => (a.type === "discard" ? JSON.stringify(a.tile) : "")),
    ).size;
    expect(legalDiscardCount).toBeGreaterThan(0);

    render(<App initialSeed={seed} botDelayMs={0} />);
    const hand = screen.getByLabelText("내 손패");
    const buttons = within(hand).getAllByRole("button") as HTMLButtonElement[];
    expect(buttons).toHaveLength(14); // 친의 첫 차례: 손패 13 + 뽑은 패 1
    const enabled = buttons.filter((b) => !b.disabled);
    expect(enabled.length).toBeGreaterThanOrEqual(1);
    // 텐파이가 아닌 손패는 일반 타패로 전부 선택 가능
    expect(enabled.length).toBe(14);

    expect(screen.getByText(/시작 \(시드 21\)/)).toBeTruthy();
    fireEvent.click(enabled[0]!);
    const log = screen.getByLabelText("행동 로그");
    expect(within(log).getAllByRole("listitem").some((li) => li.textContent!.startsWith("나:") && li.textContent!.includes("타패"))).toBe(true);
  });
});

/**
 * 사람 자리를 봇 AI로 진행하다가 pred를 만족하는 사람 정지 시점을 찾는다 (시드 탐색).
 * 행동을 적용하기 전에 매번 pred를 검사한다.
 */
function findHumanStop(pred: (state: GameState) => boolean, preferMelds = false): Session {
  for (let seed = 1; seed <= 150; seed++) {
    let session = advance(newSession(seed));
    for (let guard = 0; guard < 3000; guard++) {
      const { state } = session;
      if (isRoundOver(state)) {
        if (state.phase === "gameEnd") break;
        session = advance(beginNextRound(session));
        continue;
      }
      if (humanMustAct(state) && pred(state)) return session;
      // preferMelds: 치/펑/깡 기회가 있으면 항상 부로해서 멜드가 있는 상태를 만든다
      const meld = preferMelds
        ? humanActions(state).find((a) => a.type === "chi" || a.type === "pon" || a.type === "ankan")
        : undefined;
      session = advance(applyAction(session, meld ?? decideAction(state, 0, session.rng)));
    }
  }
  throw new Error("조건에 맞는 정지 시점을 찾지 못했습니다");
}

describe("사람이 직접 츠모/론 버튼으로 화료", () => {
  it("츠모 가능 상태에서 츠모 버튼을 누르면 츠모 화료 요약이 표시된다", () => {
    const session = findHumanStop(
      (s) => s.phase === "turn" && humanActions(s).some((a) => a.type === "tsumo"),
    );
    const tsumo = humanActions(session.state).find((a) => a.type === "tsumo")!;
    const expected = summarizeRound(applyAction(session, tsumo).state);

    render(<App initialSession={session} botDelayMs={0} />);
    expect(screen.queryByRole("dialog")).toBeNull();
    const bar = screen.getByRole("group", { name: "행동" });
    fireEvent.click(within(bar).getByRole("button", { name: "츠모" }));

    const dialog = screen.getByRole("dialog", { name: "국 결과" });
    expect(within(dialog).getByRole("heading", { name: "츠모 화료" })).toBeTruthy();
    const win = expected.wins[0]!;
    expect(win.seat).toBe(0);
    expect(win.from).toBeNull();
    // 규칙: 총 판수 = 역 판수 합 + 도라(겉+적+뒷), 화료자 증감 = 총점
    expect(win.dora).toBe(win.doraCount + win.redDora + win.uraDora);
    if (win.yakumanMultiple === 0) expect(win.han).toBe(win.yaku.reduce((a, y) => a + y.han, 0) + win.dora);
    expect(expected.deltas[0]).toBe(win.total);
    const summaryText =
      win.yakumanMultiple > 0
        ? `${win.limit} (기본점 ${win.basePoints})`
        : `${win.han}판 ${win.fu}부${win.limit ? ` ${win.limit}` : ""} (기본점 ${win.basePoints})`;
    expect(within(dialog).getByText(summaryText)).toBeTruthy();
    expect(within(dialog).getByText(`+${win.total}`)).toBeTruthy();
    for (const y of win.yaku) expect(within(dialog).getAllByText(y.name).length).toBeGreaterThan(0);
  });

  it("론 가능 상태(응답 단계)에서 론 버튼을 누르면 론 화료 요약이 표시된다", () => {
    // 삼가화(3인 동시 론)는 유국이므로, 사람 외 론 가능 좌석이 2명 미만인 상태를 고른다
    const otherRons = (s: GameState) =>
      awaitingSeats(s).filter((seat) => seat !== 0 && legalActions(s, seat).some((a) => a.type === "ron")).length;
    const session = findHumanStop(
      (s) => s.phase === "response" && humanActions(s).some((a) => a.type === "ron") && otherRons(s) < 2,
    );
    const discarder = session.state.pending!.discarder;
    const ron = humanActions(session.state).find((a) => a.type === "ron")!;
    // 다른 좌석의 응답이 남아 있을 수 있으므로 봇 진행까지 적용한 뒤 요약한다
    const expected = summarizeRound(advance(applyAction(session, ron)).state);

    render(<App initialSession={session} botDelayMs={0} />);
    const bar = screen.getByRole("group", { name: "행동" });
    // 응답 단계에서는 론과 패스가 항상 보인다
    expect(within(bar).getByRole("button", { name: "패스" })).toBeTruthy();
    fireEvent.click(within(bar).getByRole("button", { name: "론" }));

    const dialog = screen.getByRole("dialog", { name: "국 결과" });
    expect(within(dialog).getByRole("heading", { name: "론 화료" })).toBeTruthy();
    const win = expected.wins.find((w) => w.seat === 0)!;
    expect(win.from).toBe(discarder);
    expect(expected.deltas[discarder]).toBeLessThan(0);
    expect(win.dora).toBe(win.doraCount + win.redDora + win.uraDora);
    expect(within(dialog).getByLabelText("나 화료")).toBeTruthy();
    expect(within(dialog).getAllByText(`${win.han}판 ${win.fu}부${win.limit ? ` ${win.limit}` : ""} (기본점 ${win.basePoints})`).length).toBeGreaterThan(0);
  });
});

describe("화면 정리 (멜드 중복/액션바/리치 표식)", () => {
  const noop = () => {};

  it("내 멜드는 좌석 패널에서 한 번만 렌더된다", () => {
    const session = findHumanStop((s) => s.phase === "turn" && s.players[0]!.melds.length > 0, true);
    const { state } = session;
    render(
      <Board state={state} actions={humanActions(state)} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />,
    );
    const mine = screen.getByLabelText("나 영역");
    expect(mine.querySelectorAll("[data-meld]")).toHaveLength(state.players[0]!.melds.length);
    expect(mine.querySelectorAll(".melds")).toHaveLength(1);
    expect(mine.querySelector(".melds-own")).not.toBeNull();
    // 상대 멜드는 각자 좌석 패널에 그대로 표시
    for (const seat of [1, 2, 3]) {
      const panel = screen.getByLabelText(`${["나", "하가", "대면", "상가"][seat]} 영역`);
      expect(panel.querySelectorAll("[data-meld]")).toHaveLength(state.players[seat]!.melds.length);
    }
  });

  it("내 멜드 줄은 멜드가 없어도 자리가 예약되고, 상대 패널에는 손패 개수 배지가 있다", () => {
    const { state } = findHumanStop((s) => s.phase === "turn" && s.players[0]!.melds.length === 0);
    render(<Board state={state} actions={humanActions(state)} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />);
    const mine = screen.getByLabelText("나 영역");
    const slot = mine.querySelector(".melds-own");
    expect(slot).not.toBeNull();
    expect(slot!.querySelectorAll("[data-meld]")).toHaveLength(0);
    // 멜드 줄은 손패보다 앞에 위치
    expect(slot!.compareDocumentPosition(screen.getByLabelText("내 손패")) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    const badge = screen.getByLabelText("하가 영역").querySelector(".hand-count");
    expect(badge!.textContent).toBe(`손패 ${state.players[1]!.hand.length}`);
    expect(screen.getByLabelText("나 영역").querySelector(".hand-count")).toBeNull();
  });

  it("행동바에는 합법 행동의 버튼만 있고, 안내 영역은 응답 단계가 아니어도 예약된다", () => {
    const session = findHumanStop(
      (s) => s.phase === "turn" && humanActions(s).some((a) => a.type === "tsumo"),
    );
    const { state } = session;
    const actions = humanActions(state);
    render(<Board state={state} actions={actions} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />);
    const bar = screen.getByRole("group", { name: "행동" });
    const riichi = actions.some((a) => a.type === "discard" && a.riichi === true) ? 1 : 0;
    const others = actions.filter((a) => a.type !== "discard").length;
    const buttons = within(bar).queryAllByRole("button") as HTMLButtonElement[];
    expect(buttons).toHaveLength(riichi + others);
    expect(buttons.every((b) => !b.disabled)).toBe(true);
    expect(within(bar).queryByRole("button", { name: "론" })).toBeNull();
    const slot = document.querySelector(".response-slot");
    expect(slot).not.toBeNull();
    expect(slot!.textContent).toBe("");
    expect(screen.queryByRole("status")).toBeNull();
  });

  it("응답 단계의 안내 문구는 같은 예약 영역 안에 표시된다", () => {
    const { state } = findHumanStop((s) => s.phase === "response");
    render(<Board state={state} actions={humanActions(state)} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />);
    expect(document.querySelector(".response-slot")!.contains(screen.getByRole("status"))).toBe(true);
    expect(within(screen.getByRole("group", { name: "행동" })).getByRole("button", { name: "패스" })).toBeTruthy();
  });

  it("리치 선언패는 눕히지 않고 '리치' 표식으로 구분한다", () => {
    render(
      <Pond
        discards={[
          { tile: east, riichi: false, tsumogiri: false, calledBy: null },
          { tile: red, riichi: true, tsumogiri: false, calledBy: null },
        ]}
      />,
    );
    const marks = document.querySelectorAll(".riichi-mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]!.textContent).toBe("리치");
    const entry = marks[0]!.closest(".pond-entry")!;
    expect(entry.querySelector("[aria-label='중']")!.className).toContain("tile-riichi");
    expect(entry.querySelector(".tile-sideways")).toBeNull();
  });
});
