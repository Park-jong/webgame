// 21-1 마감·결과·종료 UI: 마감 카운트다운, 국 종료 자동 진행 카운트다운, 응답 진행 표시, 재접속 카운트다운
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { awaitingSeats, createGame, decideAction, dispatch, legalActions } from "@mahjong/core";
import type { GameState, Seat } from "@mahjong/core";
import { App } from "../App";
import { TurnClock } from "../components/TurnClock";
import { StatusStack } from "../components/StatusStack";
import { createRng } from "../controller";
import { viewFor } from "../model/seatView";
import type { SeatView } from "../model/seatView";
import { ACK_TEXT, NEXT_ROUND_ESTIMATE_MS, buildConnectionBanner } from "./messages";
import { createMemoryPrefsStore } from "./prefs";
import { createMemorySessionStore } from "./sessionStore";
import type { SessionStore } from "./sessionStore";
import { FakeTimers, MockSocket } from "./testkit";
import { secondsUntil, useSecondsLeft } from "./useCountdown";
import { useServerGame } from "./useServerGame";
import type { UseServerGameOptions } from "./useServerGame";

const URL_ = "ws://test:1";
const TOKEN = "SECRET-TOKEN-0123456789abcdef";

function stateAwaiting(seat: Seat, seed = 5): GameState {
  const rng = createRng(seed);
  let state = createGame(rng);
  for (let i = 0; i < 400; i++) {
    const awaiting = awaitingSeats(state);
    if (awaiting.includes(seat) && legalActions(state, seat).length > 0) return state;
    const who = awaiting[0];
    if (who === undefined) break;
    state = dispatch(state, decideAction(state, who, rng));
  }
  throw new Error("대기 상태를 만들지 못했습니다");
}

function roundEndView(seat: Seat): SeatView {
  const rng = createRng(11);
  let state = createGame(rng);
  for (let i = 0; i < 5000 && state.phase !== "roundEnd" && state.phase !== "gameEnd"; i++) {
    const who = awaitingSeats(state)[0]!;
    state = dispatch(state, decideAction(state, who, rng));
  }
  return viewFor(state, seat);
}

let sockets: MockSocket[];
let timers: FakeTimers;
let store: SessionStore;

function setup(extra: Partial<UseServerGameOptions> = {}) {
  return renderHook(() =>
    useServerGame({
      url: URL_,
      createSocket: () => {
        const s = new MockSocket();
        sockets.push(s);
        return s;
      },
      store,
      timers,
      ...extra,
    }),
  );
}
const last = (): MockSocket => sockets[sockets.length - 1]!;
const send = (s: MockSocket, msg: unknown) => act(() => s.receive(msg));
const joinedMsg = (seat: Seat) => ({ type: "joined", roomId: "ROOM1234", seat, seatToken: TOKEN });

function enter(hook: ReturnType<typeof setup>, seat: Seat) {
  act(() => hook.result.current.create("park"));
  act(() => last().open());
  send(last(), joinedMsg(seat));
}

beforeEach(() => {
  sockets = [];
  timers = new FakeTimers();
  store = createMemorySessionStore();
});
afterEach(cleanup);

/**
 * 타이머·플래그 해제 조건 표 (agent-summaries/21-1 문서와 같다). 조건마다 아래에 테스트가 있다.
 * | 대상 | 해제 조건 |
 * | useSecondsLeft 타이머 | at 변경, at=null, 0초 도달, 언마운트 |
 * | deadlineAt 노출 | 행동 전송(waitingAck), 새 view(마감 없는 view 포함), 연결 끊김(connected 아님) / 서버 오류·응답 타임아웃으로 대기가 풀리면 다시 노출 |
 * | nextRoundAt 노출 | roundEnd가 아닌 view, 연결 끊김 / 같은 국 종료 view 재수신은 처음 추정 유지 |
 * | ackState | 새 view, 서버 오류, 응답 타임아웃, 연결 변경, leave |
 */

// ---------------------------------------------------------------------------
describe("useSecondsLeft / TurnClock: 카운트다운과 타이머 해제", () => {
  it("secondsUntil은 올림이고 음수는 0", () => {
    expect(secondsUntil(10_000, 0)).toBe(10);
    expect(secondsUntil(10_000, 9_001)).toBe(1);
    expect(secondsUntil(10_000, 10_000)).toBe(0);
    expect(secondsUntil(10_000, 12_000)).toBe(0);
  });

  it("deadlineAt이 null이면 숫자도 타이머도 없고 고정 영역만 남는다", () => {
    render(<TurnClock deadlineAt={null} clock={timers} />);
    expect(screen.queryByTestId("turn-clock")).toBeNull();
    expect(screen.getByTestId("turn-clock-slot")).toBeTruthy();
    expect(timers.pending()).toEqual([]);
  });

  it("남은 초를 1초 단위로 줄이고 0초에서 멈춘다 (타이머가 0개로 해제됨)", () => {
    render(<TurnClock deadlineAt={timers.now() + 3000} clock={timers} />);
    const text = () => screen.getByTestId("turn-clock").textContent ?? "";
    expect(text()).toContain("3");
    act(() => timers.advance(1000));
    expect(text()).toMatch(/남은 시간\s*2\s*초/);
    act(() => timers.advance(1000));
    expect(text()).toMatch(/남은 시간\s*1\s*초/);
    act(() => timers.advance(1000));
    expect(text()).toContain("시간 종료");
    expect(timers.pending()).toEqual([]);
  });

  it("갱신은 항상 1개의 타이머만 걸고, 초 경계(소수 초 포함)에 맞춘다", () => {
    render(<TurnClock deadlineAt={timers.now() + 2500} clock={timers} />);
    expect(timers.pending()).toEqual([500]); // 3초 -> 2초가 되는 시각
    act(() => timers.advance(500));
    expect(screen.getByTestId("turn-clock").textContent).toMatch(/2\s*초/);
    expect(timers.pending()).toEqual([1000]);
  });

  it("10초 초과는 일반, 10초 이하는 강조(아이콘+문구+클래스), 색만으로 구분하지 않는다", () => {
    render(<TurnClock deadlineAt={timers.now() + 12_000} clock={timers} />);
    const el = () => screen.getByTestId("turn-clock");
    expect(el().className).not.toContain("turn-clock-urgent");
    expect(el().textContent).not.toContain("곧 마감");
    expect(el().textContent).toContain("⏱");
    act(() => timers.advance(1000)); // 11초
    expect(el().className).not.toContain("turn-clock-urgent");
    act(() => timers.advance(1000)); // 10초
    expect(el().className).toContain("turn-clock-urgent");
    expect(el().textContent).toContain("곧 마감");
    expect(el().textContent).toContain("⚠");
  });

  it("deadlineAt이 바뀌면 이전 타이머를 지우고 새 값으로 센다", () => {
    const { rerender } = render(<TurnClock deadlineAt={timers.now() + 30_000} clock={timers} />);
    expect(timers.pending()).toHaveLength(1);
    rerender(<TurnClock deadlineAt={timers.now() + 15_000} clock={timers} />);
    expect(timers.pending()).toHaveLength(1);
    expect(screen.getByTestId("turn-clock").textContent).toMatch(/15\s*초/);
  });

  it("deadlineAt이 null이 되면(행동 후) 타이머가 해제되고 숫자가 사라진다", () => {
    const { rerender } = render(<TurnClock deadlineAt={timers.now() + 30_000} clock={timers} />);
    rerender(<TurnClock deadlineAt={null} clock={timers} />);
    expect(timers.pending()).toEqual([]);
    expect(screen.queryByTestId("turn-clock")).toBeNull();
  });

  it("언마운트하면 타이머가 해제된다", () => {
    const { unmount } = render(<TurnClock deadlineAt={timers.now() + 30_000} clock={timers} />);
    expect(timers.pending()).toHaveLength(1);
    unmount();
    expect(timers.pending()).toEqual([]);
  });

  it("훅은 at 변경 직후 렌더에서도 낡은 값을 돌려주지 않는다", () => {
    const { result, rerender } = renderHook(({ at }: { at: number | null }) => useSecondsLeft(at, timers), {
      initialProps: { at: timers.now() + 9000 as number | null },
    });
    expect(result.current).toBe(9);
    rerender({ at: timers.now() + 4000 });
    expect(result.current).toBe(4);
    rerender({ at: null });
    expect(result.current).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("컨트롤러: deadlineAt 노출", () => {
  it("view의 deadlineMs를 수신 시각 기준 절대 시각으로 노출한다 (내 턴 30초 / 응답 15초)", () => {
    for (const ms of [30_000, 15_000]) {
      const hook = setup();
      enter(hook, 2);
      send(last(), { type: "view", view: viewFor(stateAwaiting(2), 2), deadlineMs: ms });
      expect(hook.result.current.deadlineAt).toBe(timers.now() + ms);
      hook.unmount();
    }
  });

  it("deadlineMs가 없는 view(자동 모드·응답 구간·마감 없음)는 null", () => {
    const hook = setup();
    enter(hook, 2);
    send(last(), { type: "view", view: viewFor(stateAwaiting(2), 2), deadlineMs: 30_000 });
    send(last(), { type: "view", view: viewFor(stateAwaiting(2), 2) });
    expect(hook.result.current.deadlineAt).toBeNull();
  });

  it("행동을 보내면 숨고, 서버 오류로 대기가 풀리면 같은 마감이 다시 보인다", () => {
    const hook = setup();
    enter(hook, 2);
    const view = viewFor(stateAwaiting(2), 2);
    send(last(), { type: "view", view, deadlineMs: 30_000 });
    const at = hook.result.current.deadlineAt;
    act(() => hook.result.current.act(hook.result.current.actions[0]!));
    expect(hook.result.current.deadlineAt).toBeNull();
    send(last(), { type: "error", code: "illegal_action", message: "x" });
    expect(hook.result.current.deadlineAt).toBe(at);
  });

  it("연결이 끊기면 낡은 마감을 숨기고, 재접속 후 새 view의 마감만 보인다", () => {
    const hook = setup();
    enter(hook, 2);
    send(last(), { type: "view", view: viewFor(stateAwaiting(2), 2), deadlineMs: 30_000 });
    act(() => last().drop(1006));
    expect(hook.result.current.deadlineAt).toBeNull();
    act(() => timers.advance(1000));
    act(() => last().open());
    send(last(), joinedMsg(2));
    send(last(), { type: "view", view: viewFor(stateAwaiting(2), 2), deadlineMs: 20_000 });
    expect(hook.result.current.deadlineAt).toBe(timers.now() + 20_000);
  });
});

// ---------------------------------------------------------------------------
describe("컨트롤러: nextRoundAt (국 종료 후 자동 진행 추정)", () => {
  it("국 종료 view 수신 시각 + 추정 대기로 계산한다", () => {
    const hook = setup();
    enter(hook, 0);
    send(last(), { type: "view", view: roundEndView(0) });
    expect(hook.result.current.nextRoundAt).toBe(timers.now() + NEXT_ROUND_ESTIMATE_MS);
  });

  it("같은 국 종료 view가 다시 오면(재접속) 처음 추정을 유지한다", () => {
    const hook = setup();
    enter(hook, 0);
    const end = roundEndView(0);
    send(last(), { type: "view", view: end });
    const first = hook.result.current.nextRoundAt;
    act(() => timers.advance(3000));
    send(last(), { type: "view", view: end });
    expect(hook.result.current.nextRoundAt).toBe(first);
  });

  it("새 국 view(roundEnd가 아님)가 오면 null이고 결과 모달 상태가 닫힌다", () => {
    const hook = setup();
    enter(hook, 0);
    send(last(), { type: "view", view: roundEndView(0) });
    expect(hook.result.current.resultOpen).toBe(true);
    send(last(), { type: "view", view: viewFor(stateAwaiting(0), 0) });
    expect(hook.result.current.nextRoundAt).toBeNull();
    expect(hook.result.current.resultOpen).toBe(false);
  });

  it("결과 닫기 상태는 국마다 순환한다: 닫기 -> 같은 국 재수신은 닫힘 유지 -> 새 국 view에서 초기화 -> 다음 국 종료에서 다시 열림", () => {
    const hook = setup();
    enter(hook, 0);
    const end = roundEndView(0);
    send(last(), { type: "view", view: end });
    expect(hook.result.current.resultOpen).toBe(true);
    act(() => hook.result.current.advanceResult());
    expect(hook.result.current.resultOpen).toBe(false);
    // 같은 국 종료 view 재수신(재접속 등)은 닫힘을 유지
    send(last(), { type: "view", view: end });
    expect(hook.result.current.resultOpen).toBe(false);
    // 결과가 없는 새 국 view
    send(last(), { type: "view", view: viewFor(stateAwaiting(0), 0) });
    expect(hook.result.current.view?.result).toBeNull();
    expect(hook.result.current.resultOpen).toBe(false);
    // 다음 국 종료에서 다시 열린다
    send(last(), { type: "view", view: end });
    expect(hook.result.current.resultOpen).toBe(true);
    // 한 번 더 닫았다 열어도 같은 순환이 유지된다
    act(() => hook.result.current.advanceResult());
    expect(hook.result.current.resultOpen).toBe(false);
    send(last(), { type: "view", view: viewFor(stateAwaiting(0, 6), 0) });
    send(last(), { type: "view", view: end });
    expect(hook.result.current.resultOpen).toBe(true);
  });

  it("연결이 끊긴 동안은 null (카운트다운을 멈추고 끊김과 구분)", () => {
    const hook = setup();
    enter(hook, 0);
    send(last(), { type: "view", view: roundEndView(0) });
    act(() => last().drop(1006));
    expect(hook.result.current.nextRoundAt).toBeNull();
  });
});

// ---------------------------------------------------------------------------
describe("컨트롤러: ackState (내 행동의 진행 표시)", () => {
  it("none -> sending -> accepted -> (새 view) none", () => {
    const hook = setup();
    enter(hook, 2);
    send(last(), { type: "view", view: viewFor(stateAwaiting(2), 2), deadlineMs: 30_000 });
    expect(hook.result.current.ackState).toBe("none");
    act(() => hook.result.current.act(hook.result.current.actions[0]!));
    expect(hook.result.current.ackState).toBe("sending");
    send(last(), { type: "ack", seq: 1 });
    expect(hook.result.current.ackState).toBe("accepted");
    send(last(), { type: "view", view: viewFor(stateAwaiting(2, 6), 2) });
    expect(hook.result.current.ackState).toBe("none");
  });

  it("서버 오류와 응답 타임아웃, 재접속에서도 none으로 돌아온다", () => {
    const hook = setup();
    enter(hook, 2);
    send(last(), { type: "view", view: viewFor(stateAwaiting(2), 2) });
    act(() => hook.result.current.act(hook.result.current.actions[0]!));
    send(last(), { type: "error", code: "not_your_turn", message: "x" });
    expect(hook.result.current.ackState).toBe("none");
    act(() => hook.result.current.act(hook.result.current.actions[0]!));
    expect(hook.result.current.ackState).toBe("sending");
    act(() => timers.advance(10_000));
    expect(hook.result.current.ackState).toBe("none");
    act(() => hook.result.current.act(hook.result.current.actions[0]!));
    act(() => last().drop(1006));
    expect(hook.result.current.ackState).toBe("none");
  });
});

// ---------------------------------------------------------------------------
describe("재접속 카운트다운 (retry에 다음 시도 시각)", () => {
  it("retry 정보에 nextAt이 실려 배너가 시도 번호와 시각을 가진다", () => {
    const hook = setup();
    enter(hook, 1);
    act(() => last().drop(1006));
    expect(hook.result.current.connection?.retry).toEqual({ attempt: 1, max: 10, at: timers.now() + 1000 });
    act(() => timers.advance(1000));
    act(() => last().drop(1006));
    expect(hook.result.current.connection?.retry).toEqual({ attempt: 2, max: 10, at: timers.now() + 2000 });
  });

  it("nextAt이 없는 retry 정보는 정적 문구(detail)만 쓴다", () => {
    const b = buildConnectionBanner({
      status: "reconnecting",
      closeReason: null,
      inRoom: true,
      retry: { attempt: 1, max: 10, delayMs: 1000 },
      resumable: false,
    });
    expect(b?.retry).toBeNull();
    expect(b?.detail).toContain("약 1초");
  });

  it("배너가 남은 초를 줄여 가다가 0이 되면 '지금 다시 접속하는 중'으로 바뀐다", () => {
    const b = buildConnectionBanner({
      status: "reconnecting",
      closeReason: null,
      inRoom: true,
      retry: { attempt: 3, max: 10, delayMs: 4000, nextAt: timers.now() + 4000 },
      resumable: false,
    })!;
    render(<StatusStack clock={timers} connection={b} notice={null} onReconnect={() => {}} onDismissNotice={() => {}} />);
    const text = () => screen.getByTestId("retry-countdown").textContent ?? "";
    expect(text()).toContain("3/10회");
    expect(text()).toContain("다음 시도까지 4초");
    act(() => timers.advance(1000));
    expect(text()).toContain("다음 시도까지 3초");
    act(() => timers.advance(3000));
    expect(text()).toContain("지금 다시 접속하는 중");
    expect(timers.pending()).toEqual([]);
  });

  it("closed 배너와 재접속 복귀 후에는 카운트다운 타이머가 남지 않는다", () => {
    const hook = setup();
    enter(hook, 1);
    act(() => last().drop(1006));
    const b = hook.result.current.connection!;
    const view = render(<StatusStack clock={timers} connection={b} notice={null} onReconnect={() => {}} onDismissNotice={() => {}} />);
    const before = timers.pending().length;
    view.rerender(<StatusStack clock={timers} connection={null} notice={null} onReconnect={() => {}} onDismissNotice={() => {}} />);
    expect(timers.pending().length).toBe(before - 1);
  });
});

// ---------------------------------------------------------------------------
describe("App: 서버 모드 마감·결과·응답 표시", () => {
  let appSockets: MockSocket[];
  const lastApp = (): MockSocket => appSockets[appSockets.length - 1]!;

  function renderApp() {
    return render(
      <App
        online
        prefsStore={createMemoryPrefsStore()}
        serverOptions={{
          url: URL_,
          createSocket: () => {
            const s = new MockSocket();
            appSockets.push(s);
            return s;
          },
          store,
          timers,
        }}
      />,
    );
  }
  const enterRoom = (seat: Seat) => {
    fireEvent.click(screen.getByRole("button", { name: "방 만들기" }));
    act(() => lastApp().open());
    act(() => lastApp().receive(joinedMsg(seat)));
  };
  const receive = (msg: unknown) => act(() => lastApp().receive(msg));

  beforeEach(() => {
    appSockets = [];
  });

  it("내 차례 마감이 대국 화면의 고정 영역에 표시되고 헤더에는 없다", () => {
    renderApp();
    enterRoom(2);
    receive({ type: "view", view: viewFor(stateAwaiting(2), 2), deadlineMs: 30_000 });
    const clock = screen.getByTestId("turn-clock");
    expect(clock.textContent).toMatch(/남은 시간\s*30\s*초/);
    expect(clock.closest(".board")).not.toBeNull();
    expect(clock.closest("header")).toBeNull();
    act(() => timers.advance(21_000));
    expect(screen.getByTestId("turn-clock").textContent).toContain("곧 마감");
  });

  it("마감이 없는 view에서는 숫자가 없고 영역만 남으며, 행동하면 사라진다", () => {
    renderApp();
    enterRoom(2);
    receive({ type: "view", view: viewFor(stateAwaiting(2), 2) });
    expect(screen.queryByTestId("turn-clock")).toBeNull();
    expect(screen.getByTestId("turn-clock-slot")).toBeTruthy();
    receive({ type: "view", view: viewFor(stateAwaiting(2), 2), deadlineMs: 30_000 });
    expect(screen.getByTestId("turn-clock")).toBeTruthy();
  });

  it("행동을 보내면 '처리 중…', ack를 받으면 중립 문구를 보이고 다음 view에서 지운다", () => {
    renderApp();
    enterRoom(2);
    receive({ type: "view", view: viewFor(stateAwaiting(2), 2), deadlineMs: 30_000 });
    const hand = document.querySelector(".hand button:not(:disabled)") as HTMLElement;
    fireEvent.click(hand);
    // ack 전: 상수가 아닌 리터럴 '처리 중…'만 보이고, 접수 문구나 다른 좌석을 암시하는 문구는 없다
    expect(screen.getByTestId("ack-note").textContent).toBe("처리 중…");
    expect(screen.getByTestId("ack-note").textContent).toBe(ACK_TEXT.sending);
    expect(document.body.textContent).not.toContain("응답이 접수되었습니다");
    expect(document.body.textContent).not.toMatch(/다른 플레이어|상대.*(대기|응답)|누군가|확인 중/);
    expect(screen.queryByTestId("turn-clock")).toBeNull();
    receive({ type: "ack", seq: 1 });
    expect(screen.getByTestId("ack-note").textContent).toBe(ACK_TEXT.accepted);
    // 다른 좌석의 대기 여부를 암시하는 표현이 없다
    expect(document.body.textContent).not.toMatch(/다른 플레이어|상대.*(대기|응답)|누군가/);
    receive({ type: "view", view: viewFor(stateAwaiting(2, 6), 2) });
    expect(screen.queryByTestId("ack-note")).toBeNull();
  });

  it("국 종료: 다음 국 버튼 대신 카운트다운이 표시되고 0이 되면 '다음 국을 기다리는 중…'으로 바뀐다", () => {
    renderApp();
    enterRoom(1);
    receive({ type: "view", view: roundEndView(1) });
    const dialog = screen.getByRole("dialog", { name: "국 결과" });
    expect(within(dialog).queryByRole("button", { name: "다음 국" })).toBeNull();
    expect(within(dialog).getByTestId("auto-next").textContent).toBe("다음 국 약 5초 후 자동 시작");
    expect(dialog.querySelector(".modal-footer")?.contains(screen.getByTestId("auto-next"))).toBe(true);
    act(() => timers.advance(2000));
    expect(screen.getByTestId("auto-next").textContent).toBe("다음 국 약 3초 후 자동 시작");
    act(() => timers.advance(3000));
    expect(screen.getByTestId("auto-next").textContent).toBe("다음 국을 기다리는 중…");
    expect(timers.pending()).toEqual([]);
    // 아직 연결은 정상: 연결 배너는 없다
    expect(screen.queryByTestId("connection-banner")).toBeNull();
  });

  it("새 국 view가 오면 결과 모달이 자동으로 닫힌다", () => {
    renderApp();
    enterRoom(1);
    receive({ type: "view", view: roundEndView(1) });
    expect(screen.getByRole("dialog", { name: "국 결과" })).toBeTruthy();
    receive({ type: "view", view: viewFor(stateAwaiting(1), 1), deadlineMs: 30_000 });
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.queryByTestId("auto-next")).toBeNull();
  });

  it("결과 닫기로 모달을 닫을 수 있다 (다음 국 view가 늦어도 나가기에 닿는다)", () => {
    renderApp();
    enterRoom(1);
    receive({ type: "view", view: roundEndView(1) });
    fireEvent.click(screen.getByRole("button", { name: "결과 닫기" }));
    expect(screen.queryByRole("dialog")).toBeNull();
    expect(screen.getAllByRole("button", { name: "나가기" }).length).toBeGreaterThan(0);
  });

  it("카운트다운 중 연결이 끊기면 카운트다운을 멈추고 연결 확인 문구로 바꾼다", () => {
    renderApp();
    enterRoom(1);
    receive({ type: "view", view: roundEndView(1) });
    act(() => lastApp().drop(1006));
    expect(screen.getByTestId("auto-next").textContent).toContain("연결을 확인하는 중");
    expect(screen.getByTestId("connection-banner")).toBeTruthy();
  });

  it("게임 종료: 최종 결과 버튼 유지, 이어서 나가기만 있는 순위 화면 (회귀 없음)", () => {
    renderApp();
    enterRoom(2);
    const view = { ...roundEndView(2), phase: "gameEnd" as const };
    receive({ type: "view", view });
    const result = screen.getByRole("dialog", { name: "국 결과" });
    expect(within(result).queryByTestId("auto-next")).toBeNull();
    fireEvent.click(within(result).getByRole("button", { name: "최종 결과" }));
    const end = screen.getByRole("dialog", { name: "게임 종료" });
    expect(within(end).queryByRole("button", { name: "새 게임" })).toBeNull();
    expect(within(end).getByRole("button", { name: "나가기 (입장 화면으로)" })).toBeTruthy();
  });

  it("재접속 배너가 다음 시도까지 남은 초를 카운트다운한다", () => {
    renderApp();
    enterRoom(1);
    receive({ type: "view", view: viewFor(stateAwaiting(1), 1) });
    act(() => lastApp().drop(1006));
    expect(screen.getByTestId("retry-countdown").textContent).toContain("다음 시도까지 1초");
    act(() => timers.advance(1000));
    expect(screen.getByTestId("retry-countdown").textContent).toContain("지금 다시 접속하는 중");
  });
});

describe("로컬 모드 결과 모달은 그대로 '다음 국' 버튼", () => {
  it("autoNext 없이 렌더하면 다음 국 버튼이 있고 카운트다운이 없다", async () => {
    const { ResultModal } = await import("../components/ResultModal");
    const { summarizeFromView } = await import("../model/fromView");
    const summary = summarizeFromView(roundEndView(0));
    render(<ResultModal summary={{ ...summary, gameOver: false }} onNext={() => {}} />);
    expect(screen.getByRole("button", { name: "다음 국" })).toBeTruthy();
    expect(screen.queryByTestId("auto-next")).toBeNull();
  });
});
