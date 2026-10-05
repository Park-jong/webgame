import { describe, expect, it } from "vitest";
import { act, render, renderHook, screen } from "@testing-library/react";
import { advance, humanActions, newSession } from "../controller";
import { viewFor } from "../model/seatView";
import { App } from "../App";
import { FakeTimers, MockSocket } from "./testkit";
import { createMemorySessionStore } from "./sessionStore";
import { useLocalGame } from "./useLocalGame";

describe("useLocalGame", () => {
  it("view = viewFor(state, 0), mySeat 0, 합법 행동은 기존 humanActions와 같다", () => {
    const session = advance(newSession(21));
    const { result } = renderHook(() => useLocalGame({ initialSession: session, botDelayMs: 0 }));
    const c = result.current;
    expect(c.mode).toBe("local");
    expect(c.mySeat).toBe(0);
    expect(c.view).toEqual(viewFor(session.state, 0));
    expect(c.actions).toEqual(humanActions(session.state));
    expect(c.status).toBe("playing");
    expect(c.deadlineAt).toBeNull();
    expect(c.notice).toBeNull();
    expect(c.seed).toBe(21);
    expect(c.log.length).toBeGreaterThan(0);
  });

  it("act 후 봇이 사람 차례까지 진행하고 리치 모드가 해제된다", () => {
    const session = advance(newSession(21));
    const { result } = renderHook(() => useLocalGame({ initialSession: session, botDelayMs: 0 }));
    act(() => result.current.toggleRiichi());
    expect(result.current.riichiMode).toBe(true);
    const discard = result.current.actions.find((a) => a.type === "discard" && a.riichi !== true)!;
    act(() => result.current.act(discard));
    expect(result.current.riichiMode).toBe(false);
    expect(result.current.view!.players[0]!.discards.length).toBeGreaterThanOrEqual(1);
    expect(result.current.log.some((l) => l.startsWith("나:"))).toBe(true);
  });

  it("newGame은 시드 입력을 사용하고 시드가 같으면 같은 판이 된다", () => {
    const { result } = renderHook(() => useLocalGame({ initialSeed: 5, botDelayMs: 0 }));
    const first = result.current.view;
    act(() => result.current.setSeedInput!("5"));
    act(() => result.current.newGame!());
    expect(result.current.seed).toBe(5);
    expect(result.current.view!.hand).toEqual(first!.hand);
  });
});

describe("App 모드 선택", () => {
  it("기본은 로컬 모드 (시드 입력/새 게임 버튼이 있다)", () => {
    render(<App initialSeed={21} botDelayMs={0} />);
    expect(screen.getByLabelText("시드")).toBeTruthy();
    expect(screen.queryByText("방 만들기")).toBeNull();
  });

  it("online 플래그면 서버 모드 최소 진입을 보여 준다 (기본 로컬 동작과 분리)", () => {
    const sockets: MockSocket[] = [];
    render(
      <App
        online
        serverOptions={{
          url: "ws://test:1",
          createSocket: () => {
            const s = new MockSocket();
            sockets.push(s);
            return s;
          },
          store: createMemorySessionStore(),
          timers: new FakeTimers(),
        }}
      />,
    );
    expect(screen.getByText("방 만들기")).toBeTruthy();
    expect(screen.queryByLabelText("시드")).toBeNull();
    expect(screen.getByTestId("server-status").textContent).toContain("입장 전");
  });
});
