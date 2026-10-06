import { beforeEach, describe, expect, it } from "vitest";
import { act, fireEvent, render, renderHook, screen, within } from "@testing-library/react";
import { awaitingSeats, createGame, decideAction, dispatch, legalActions } from "@mahjong/core";
import type { Action, GameState, Seat } from "@mahjong/core";
import { App } from "../App";
import { BoardView } from "../components/BoardView";
import { ResultModal } from "../components/ResultModal";
import { createRng } from "../controller";
import { summarizeFromView } from "../model/fromView";
import { viewFor } from "../model/seatView";
import type { SeatView } from "../model/seatView";
import { createMemorySessionStore, type SessionStore } from "./sessionStore";
import { FakeTimers, MockSocket } from "./testkit";
import { useServerGame } from "./useServerGame";
import type { UseServerGameOptions } from "./useServerGame";

const URL_ = "ws://test:1";
const TOKEN = "SECRET-TOKEN-0123456789abcdef";
const noop = () => {};

/** 지정 좌석이 행동해야 하는 상태까지 봇 AI로 진행한다 */
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
const sentTypes = (s: MockSocket) => s.sent.map((m) => m.type);

/** 입장(create) -> joined(seat) 까지 */
function enter(hook: ReturnType<typeof setup>, seat: Seat) {
  act(() => hook.result.current.create("park"));
  act(() => last().open());
  send(last(), { type: "joined", roomId: "ROOM1234", seat, seatToken: TOKEN });
}

beforeEach(() => {
  sockets = [];
  timers = new FakeTimers();
  store = createMemorySessionStore();
});

describe("useServerGame: 입장 -> 시작 -> view -> act -> ack", () => {
  it("전체 흐름과 응답 구간 중복 응답 방지", () => {
    const state = stateAwaiting(2);
    const view = viewFor(state, 2);
    const hook = setup();
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.mode).toBe("server");

    act(() => hook.result.current.create("park"));
    expect(hook.result.current.status).toBe("connecting");
    act(() => last().open());
    expect(last().sent).toEqual([{ type: "join", name: "park" }]);
    send(last(), { type: "joined", roomId: "ROOM1234", seat: 2, seatToken: TOKEN });
    expect(hook.result.current.status).toBe("waiting");
    expect(hook.result.current.roomId).toBe("ROOM1234");
    expect(hook.result.current.mySeat).toBe(2);
    expect(hook.result.current.view).toBeNull();

    act(() => hook.result.current.start());
    expect(sentTypes(last())).toEqual(["join", "start"]);

    send(last(), { type: "view", view, deadlineMs: 5000 });
    const c = hook.result.current;
    expect(c.status).toBe("playing");
    expect(c.mySeat).toBe(2);
    expect(c.view).toEqual(view);
    expect(c.actions).toEqual(view.legalActions);
    expect(c.deadlineAt).toBe(timers.now() + 5000);

    const chosen = c.actions[0]!;
    act(() => {
      c.act(chosen);
      c.act(chosen); // 같은 tick의 중복 호출
    });
    const actionsSent = last().sent.filter((m) => m.type === "action");
    expect(actionsSent).toHaveLength(1);
    expect(actionsSent[0]!.seq).toBe(1);
    // seat는 보내지 않는다 (서버가 소켓 좌석을 쓴다)
    expect(actionsSent[0]!.action).not.toHaveProperty("seat");
    expect(hook.result.current.waitingAck).toBe(true);
    expect(hook.result.current.actions).toEqual([]);
    expect(hook.result.current.deadlineAt).toBeNull();

    // ack 이후에도 새 view 전까지는 같은 구간에서 다시 응답하지 않는다
    send(last(), { type: "ack", seq: 1 });
    expect(hook.result.current.waitingAck).toBe(true);
    act(() => hook.result.current.act(chosen));
    expect(last().sent.filter((m) => m.type === "action")).toHaveLength(1);

    // 다음 view가 오면 다시 행동할 수 있다
    send(last(), { type: "view", view });
    expect(hook.result.current.waitingAck).toBe(false);
    expect(hook.result.current.actions).toEqual(view.legalActions);
    act(() => hook.result.current.act(chosen));
    expect(last().sent.filter((m) => m.type === "action").map((m) => m.seq)).toEqual([1, 2]);
  });

  it("view.legalActions에 없는 행동은 전송하지 않고 오류를 표시한다 (clientActionFromView 검증)", () => {
    const view = viewFor(stateAwaiting(2), 2);
    const hook = setup();
    enter(hook, 2);
    send(last(), { type: "view", view });
    const bogus: Action = { seat: 2, type: "tsumo" };
    expect(view.legalActions.some((a) => a.type === "tsumo")).toBe(false);
    act(() => hook.result.current.act(bogus));
    expect(last().sent.some((m) => m.type === "action")).toBe(false);
    expect(hook.result.current.error).not.toBeNull();
    expect(hook.result.current.errorCode).toBe("illegal_action");
    expect(hook.result.current.waitingAck).toBe(false);
  });

  it("내 차례가 아니면 전송하지 않고 actions가 비어 있다", () => {
    const state = stateAwaiting(2);
    const other = viewFor(state, 3); // 좌석 3은 대기 중이 아니다
    expect(other.awaitingYou).toBe(false);
    const hook = setup();
    enter(hook, 3);
    send(last(), { type: "view", view: other });
    expect(hook.result.current.actions).toEqual([]);
    act(() => hook.result.current.act(viewFor(state, 2).legalActions[0]!));
    expect(last().sent.some((m) => m.type === "action")).toBe(false);
  });
});

describe("useServerGame: notice / error", () => {
  it("notice를 표시하고 행동하면 지운다", () => {
    const view = viewFor(stateAwaiting(2), 2);
    const hook = setup();
    enter(hook, 2);
    send(last(), { type: "view", view });
    send(last(), { type: "notice", code: "timeout" });
    expect(hook.result.current.notice).toBe("timeout");
    send(last(), { type: "notice", code: "auto_mode" });
    expect(hook.result.current.notice).toBe("auto_mode");
    act(() => hook.result.current.act(view.legalActions[0]!));
    expect(hook.result.current.notice).toBeNull();
  });

  it("서버 오류는 메시지/코드를 노출하고 응답 대기를 풀어 다시 행동할 수 있게 한다", () => {
    const view = viewFor(stateAwaiting(2), 2);
    const hook = setup();
    enter(hook, 2);
    send(last(), { type: "view", view });
    act(() => hook.result.current.act(view.legalActions[0]!));
    expect(hook.result.current.waitingAck).toBe(true);
    send(last(), { type: "error", code: "not_your_turn", message: "지금은 행동할 수 없습니다", seq: 1 });
    expect(hook.result.current.error).toBe("지금은 행동할 수 없습니다");
    expect(hook.result.current.errorCode).toBe("not_your_turn");
    expect(hook.result.current.waitingAck).toBe(false);
    expect(hook.result.current.actions).toEqual(view.legalActions);
    act(() => hook.result.current.dismissError());
    expect(hook.result.current.error).toBeNull();
  });

  it("없는 방 입장 오류는 연결을 유지하고 오류를 보여 준다", () => {
    const hook = setup();
    act(() => hook.result.current.join("NOROOM"));
    act(() => last().open());
    expect(last().sent).toEqual([{ type: "join", roomId: "NOROOM" }]);
    send(last(), { type: "error", code: "unknown_room", message: "방이 없습니다" });
    expect(hook.result.current.error).toBe("방이 없습니다");
    expect(hook.result.current.status).toBe("idle");
    expect(last().closed).toBe(false);
  });
});

describe("useServerGame: 끊김과 재접속", () => {
  it("끊기면 reconnecting(마지막 view 유지) -> rejoin -> 새 view로 복귀한다", () => {
    const view = viewFor(stateAwaiting(2), 2);
    const hook = setup();
    enter(hook, 2);
    send(last(), { type: "view", view });
    act(() => hook.result.current.act(view.legalActions[0]!));
    expect(hook.result.current.waitingAck).toBe(true);

    act(() => last().drop(1006));
    expect(hook.result.current.status).toBe("reconnecting");
    expect(hook.result.current.view).toEqual(view);
    // 연결이 없으므로 응답 대기는 풀리지만, 보낼 수는 없다
    expect(hook.result.current.waitingAck).toBe(false);

    act(() => timers.advance(1000));
    expect(sockets).toHaveLength(2);
    act(() => last().open());
    expect(last().sent[0]).toEqual({ type: "rejoin", roomId: "ROOM1234", seatToken: TOKEN });
    expect(hook.result.current.status).toBe("reconnecting");
    send(last(), { type: "joined", roomId: "ROOM1234", seat: 2, seatToken: TOKEN });
    expect(hook.result.current.status).toBe("playing");
    send(last(), { type: "view", view });
    expect(hook.result.current.actions).toEqual(view.legalActions);
    // seq는 이어진다
    act(() => hook.result.current.act(view.legalActions[0]!));
    expect(last().sent.find((m) => m.type === "action")!.seq).toBe(2);
  });

  it("재접속이 불가능하면(1008) closed 상태와 사유를 보여 준다", () => {
    const hook = setup();
    enter(hook, 1);
    act(() => last().drop(1008));
    expect(hook.result.current.status).toBe("closed");
    expect(hook.result.current.closeReason?.code).toBe("displaced");
    // 20-1: 닫힘 사유는 오류 문구가 아니라 연결 배너로 안내한다 (error와 중복 표시하지 않음)
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.connection?.kind).toBe("closed");
  });

  it("저장된 세션이 있으면 마운트 시 자동 rejoin을 시도한다", () => {
    store.save({ roomId: "ROOM1234", seatToken: TOKEN, seq: 7, serverUrl: URL_ });
    const hook = setup();
    expect(hook.result.current.status).toBe("connecting");
    act(() => last().open());
    expect(last().sent[0]).toEqual({ type: "rejoin", roomId: "ROOM1234", seatToken: TOKEN });
    send(last(), { type: "joined", roomId: "ROOM1234", seat: 3, seatToken: TOKEN });
    expect(hook.result.current.status).toBe("waiting");
    expect(hook.result.current.mySeat).toBe(3);
    const view = viewFor(stateAwaiting(3, 9), 3);
    send(last(), { type: "view", view });
    act(() => hook.result.current.act(view.legalActions[0]!));
    // 새로고침 복원: 저장 seq + 11부터
    expect(last().sent.find((m) => m.type === "action")!.seq).toBe(18);
  });

  it("resumeStored:false면 저장된 세션이 있어도 연결하지 않는다", () => {
    store.save({ roomId: "ROOM1234", seatToken: TOKEN, seq: 7, serverUrl: URL_ });
    const hook = setup({ resumeStored: false });
    expect(sockets).toHaveLength(0);
    expect(hook.result.current.status).toBe("idle");
  });

  it("rejoin 실패(unknown_room)면 방 상태를 비우고 closed로 보인다", () => {
    store.save({ roomId: "GONE", seatToken: TOKEN, seq: 0, serverUrl: URL_ });
    const hook = setup();
    act(() => last().open());
    send(last(), { type: "error", code: "unknown_room", message: "방이 없습니다" });
    expect(hook.result.current.status).toBe("closed");
    expect(hook.result.current.closeReason?.code).toBe("unknown_room");
    expect(hook.result.current.roomId).toBeNull();
    expect(store.load()).toBeNull();
  });
});

describe("useServerGame: 연결 상태와 actions", () => {
  it("내 차례 view 수신 후 1008로 closed가 되면 actions는 비어 있다", () => {
    const view = viewFor(stateAwaiting(2), 2);
    const hook = setup();
    enter(hook, 2);
    send(last(), { type: "view", view });
    expect(hook.result.current.actions).toEqual(view.legalActions);
    act(() => last().drop(1008));
    expect(hook.result.current.status).toBe("closed");
    expect(hook.result.current.view).toEqual(view);
    expect(hook.result.current.actions).toEqual([]);
  });

  it("재접속 횟수 초과(retries_exhausted)로 closed가 되면 actions는 비어 있다", () => {
    const view = viewFor(stateAwaiting(2), 2);
    const hook = setup({ clientOptions: { maxReconnectAttempts: 1 } });
    enter(hook, 2);
    send(last(), { type: "view", view });
    act(() => last().drop(1006));
    act(() => timers.advance(1000));
    act(() => last().drop(1006));
    expect(hook.result.current.status).toBe("closed");
    expect(hook.result.current.closeReason?.code).toBe("retries_exhausted");
    expect(hook.result.current.actions).toEqual([]);
  });

  it("reconnecting 중에는 actions가 비고 rejoin 후 새 view에서 복구된다", () => {
    const view = viewFor(stateAwaiting(2), 2);
    const hook = setup();
    enter(hook, 2);
    send(last(), { type: "view", view });
    act(() => last().drop(1006));
    expect(hook.result.current.status).toBe("reconnecting");
    expect(hook.result.current.view).toEqual(view);
    expect(hook.result.current.actions).toEqual([]);
    act(() => timers.advance(1000));
    act(() => last().open());
    send(last(), { type: "joined", roomId: "ROOM1234", seat: 2, seatToken: TOKEN });
    send(last(), { type: "view", view });
    expect(hook.result.current.status).toBe("playing");
    expect(hook.result.current.actions).toEqual(view.legalActions);
  });
});

describe("App 서버 모드: closed 상태의 입장 UI", () => {
  function renderApp() {
    const sockets: MockSocket[] = [];
    render(
      <App
        online
        serverOptions={{
          url: URL_,
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
    return () => sockets[sockets.length - 1]!;
  }

  it("방에 남은 채 displaced로 closed면 입장 버튼을 숨기고 나가기와 안내만 보인다", () => {
    const sock = renderApp();
    fireEvent.click(screen.getByText("방 만들기"));
    act(() => sock().open());
    act(() => sock().receive({ type: "joined", roomId: "ROOM1234", seat: 1, seatToken: TOKEN }));
    act(() => sock().drop(1008));
    expect(screen.getByTestId("server-status").textContent).toContain("연결 끊김");
    expect(screen.queryByText("방 만들기")).toBeNull();
    expect(screen.queryByText("입장")).toBeNull();
    // 헤더와 배너 양쪽에 나가기가 있고, 인라인 안내 문구는 없다 (배너가 안내)
    expect(screen.getAllByText("나가기")).toHaveLength(2);
    expect(screen.queryByText("연결이 끊겼습니다. 나가기를 눌러 주세요")).toBeNull();

    // 나가기 후 idle이면 입장 버튼이 다시 보인다
    fireEvent.click(screen.getAllByText("나가기")[0]!);
    expect(screen.getByText("방 만들기")).toBeTruthy();
    expect(screen.getByText("입장")).toBeTruthy();
    expect(screen.queryByText("연결이 끊겼습니다. 나가기를 눌러 주세요")).toBeNull();
  });

  it("방 입장 전 unknown_room으로 closed면 입장 버튼이 보인다", () => {
    const sock = renderApp();
    fireEvent.change(screen.getByLabelText("방 ID"), { target: { value: "NOROOM" } });
    fireEvent.click(screen.getByText("입장"));
    act(() => sock().open());
    act(() => sock().receive({ type: "error", code: "unknown_room", message: "방이 없습니다" }));
    expect(screen.getByText("방 만들기")).toBeTruthy();
    expect(screen.getByText("입장")).toBeTruthy();
    expect(screen.queryByText("연결이 끊겼습니다. 나가기를 눌러 주세요")).toBeNull();
  });
});

describe("useServerGame: 종료/나가기", () => {
  it("언마운트하면 소켓을 닫고 재접속 타이머를 남기지 않는다", () => {
    const hook = setup();
    enter(hook, 0);
    const s = last();
    hook.unmount();
    expect(s.closed).toBe(true);
    expect(timers.pending()).toEqual([]);
  });

  it("재접속 대기 중 언마운트해도 새 소켓을 만들지 않는다", () => {
    const hook = setup();
    enter(hook, 0);
    act(() => last().drop(1006));
    hook.unmount();
    timers.advance(20_000);
    expect(sockets).toHaveLength(1);
  });

  it("leave는 소켓을 닫고 저장된 세션을 지운다", () => {
    const hook = setup();
    enter(hook, 0);
    send(last(), { type: "view", view: viewFor(stateAwaiting(0), 0) });
    expect(store.load()).not.toBeNull();
    act(() => hook.result.current.leave());
    expect(last().closed).toBe(true);
    expect(store.load()).toBeNull();
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.view).toBeNull();
    expect(hook.result.current.roomId).toBeNull();
  });

  it("국 종료 view에서 summary/roundOver를 제공하고 결과 모달 닫기/최종 결과를 처리한다", () => {
    const hook = setup();
    enter(hook, 0);
    const rng = createRng(11);
    let state = createGame(rng);
    for (let i = 0; i < 5000 && state.phase !== "roundEnd" && state.phase !== "gameEnd"; i++) {
      const who = awaitingSeats(state)[0]!;
      state = dispatch(state, decideAction(state, who, rng));
    }
    const endView = viewFor(state, 0);
    expect(endView.result).not.toBeNull();
    send(last(), { type: "view", view: endView });
    const c = hook.result.current;
    expect(c.roundOver).toBe(true);
    expect(c.summary).toEqual(summarizeFromView(endView));
    expect(c.resultOpen).toBe(true);
    act(() => c.advanceResult());
    expect(hook.result.current.resultOpen).toBe(false);
    // 다음 국 view가 오면 닫힘 상태가 초기화된다
    send(last(), { type: "view", view: viewFor(stateAwaiting(2), 0) });
    expect(hook.result.current.roundOver).toBe(false);
  });
});

describe("좌석 회전 렌더 (mySeat 비0)", () => {
  const order = (container: HTMLElement) =>
    [...container.querySelectorAll("section.seat-panel")].map((e) => Number(e.getAttribute("data-seat")));

  it.each([0, 1, 2, 3] as const)("mySeat=%i: 위/왼쪽/오른쪽/아래 좌석과 이름이 상대 위치로 배치된다", (mySeat) => {
    const view: SeatView = viewFor(stateAwaiting(mySeat, 5 + mySeat), mySeat);
    const { container } = render(
      <BoardView view={view} actions={view.legalActions} riichiMode={false} onToggleRiichi={noop} onAction={noop} log={[]} />,
    );
    const at = (rel: number) => (mySeat + rel) % 4;
    // DOM 순서 = 위, 왼쪽, 오른쪽, 아래
    expect(order(container)).toEqual([at(2), at(3), at(1), mySeat]);
    expect(screen.getByLabelText("나 영역").getAttribute("data-seat")).toBe(String(mySeat));
    expect(screen.getByLabelText("대면 영역").getAttribute("data-seat")).toBe(String(at(2)));
    expect(screen.getByLabelText("상가 영역").getAttribute("data-seat")).toBe(String(at(3)));
    expect(screen.getByLabelText("하가 영역").getAttribute("data-seat")).toBe(String(at(1)));
    // 내 손패만 앞면으로 보이고 상대는 뒷면 장수만 보인다
    const mine = screen.getByLabelText("내 손패");
    expect(within(mine).getAllByRole("button")).toHaveLength(view.hand.length);
    const opp = screen.getByLabelText(`대면 손패 ${view.players[at(2)]!.handCount}장`);
    expect(opp).toBeTruthy();
    // 점수/자풍은 해당 좌석 데이터
    expect(within(screen.getByLabelText("나 영역")).getByLabelText("나 점수").textContent).toBe(String(view.players[mySeat]!.score));
  });

  it("mySeat=2: 결과 모달은 seatName(seat, mySeat)로 이름을 붙인다", () => {
    const rng = createRng(11);
    let state = createGame(rng);
    for (let i = 0; i < 5000 && state.phase !== "roundEnd" && state.phase !== "gameEnd"; i++) {
      state = dispatch(state, decideAction(state, awaitingSeats(state)[0]!, rng));
    }
    const view = viewFor(state, 2);
    render(<ResultModal summary={summarizeFromView(view)} onNext={noop} mySeat={2} />);
    const rows = [...screen.getByRole("dialog").querySelectorAll(".score-table tbody tr")];
    // 점수표는 좌석 순서: 좌석 2가 "나", 3이 "하가", 0이 "대면", 1이 "상가"
    expect(rows.map((r) => r.querySelector("td")!.textContent)).toEqual(["대면", "상가", "나", "하가"]);
  });
});

describe("useServerGame: joining 해제 경로", () => {
  it("create 직후 joining이고, 소켓이 닫히면 joining 해제·roomId null·다시 만들 수 있다", () => {
    const hook = setup();
    act(() => hook.result.current.create("park"));
    expect(hook.result.current.joining).toBe(true);
    act(() => last().open());
    expect(hook.result.current.joining).toBe(true);
    act(() => last().drop(1008));
    expect(hook.result.current.joining).toBe(false);
    expect(hook.result.current.roomId).toBeNull();
    expect(hook.result.current.status).toBe("closed");
    // 다시 입장 요청을 보낼 수 있다
    act(() => hook.result.current.create("park"));
    expect(hook.result.current.joining).toBe(true);
  });

  it("connecting 중 create 후 곧바로 closed가 되면 이후 늦게 열려도 join을 보내지 않는다", () => {
    const hook = setup();
    act(() => hook.result.current.create("park"));
    const stale = last();
    expect(stale.sent).toEqual([]);
    act(() => stale.drop(1008));
    expect(hook.result.current.joining).toBe(false);
    act(() => stale.open());
    expect(stale.sent).toEqual([]);
    expect(hook.result.current.joining).toBe(false);
  });

  it("error 이벤트(unknown_room)가 오면 joining이 해제된다", () => {
    const hook = setup();
    act(() => hook.result.current.join("NOPE", "park"));
    act(() => last().open());
    expect(hook.result.current.joining).toBe(true);
    send(last(), { type: "error", code: "unknown_room", message: "unknown room" });
    expect(hook.result.current.joining).toBe(false);
    expect(hook.result.current.errorCode).toBe("unknown_room");
    expect(hook.result.current.roomId).toBeNull();
  });
});

describe("useServerGame: join 응답 타임아웃", () => {
  const JOIN_MS = 12_000;

  it("기본값은 12초이고 서버 참가 제한(10초)보다 길다", () => {
    const hook = setup();
    act(() => hook.result.current.create("park"));
    expect(timers.pending()).toContain(JOIN_MS);
    expect(JOIN_MS).toBeGreaterThan(10_000);
  });

  it("응답이 없으면 만료되어 소켓을 닫고 오류를 보이며 폼으로 돌아간다", () => {
    const hook = setup();
    act(() => hook.result.current.create("park"));
    act(() => last().open());
    act(() => timers.advance(JOIN_MS - 1));
    expect(hook.result.current.joining).toBe(true);
    expect(hook.result.current.error).toBeNull();
    act(() => timers.advance(1));
    expect(last().closed).toBe(true);
    expect(hook.result.current.joining).toBe(false);
    expect(hook.result.current.roomId).toBeNull();
    expect(hook.result.current.status).toBe("idle");
    expect(hook.result.current.error).toBe("서버 응답이 없습니다. 다시 시도해 주세요");
    // 폼 복귀 후 다시 시도할 수 있다
    act(() => hook.result.current.create("park"));
    expect(hook.result.current.joining).toBe(true);
    expect(hook.result.current.error).toBeNull();
  });

  it("joinTimeoutMs 옵션으로 바꿀 수 있다", () => {
    const hook = setup({ joinTimeoutMs: 500 });
    act(() => hook.result.current.create("park"));
    act(() => timers.advance(500));
    expect(hook.result.current.joining).toBe(false);
    expect(hook.result.current.error).toContain("서버 응답이 없습니다");
  });

  it("연결 중(open 전)에도 만료된다", () => {
    const hook = setup();
    act(() => hook.result.current.create("park"));
    act(() => timers.advance(JOIN_MS));
    expect(hook.result.current.joining).toBe(false);
    expect(last().closed).toBe(true);
    expect(hook.result.current.error).toContain("서버 응답이 없습니다");
  });

  it("joined가 먼저 오면 오류 없이 타이머가 해제된다", () => {
    const hook = setup();
    enter(hook, 1);
    expect(timers.pending()).not.toContain(JOIN_MS);
    act(() => timers.advance(JOIN_MS * 2));
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.roomId).toBe("ROOM1234");
    expect(hook.result.current.status).toBe("waiting");
    expect(last().closed).toBe(false);
  });

  it("error 응답이 먼저 오면 타이머가 해제되어 만료 오류로 덮이지 않는다", () => {
    const hook = setup();
    act(() => hook.result.current.join("NOPE", "park"));
    act(() => last().open());
    send(last(), { type: "error", code: "unknown_room", message: "unknown room" });
    act(() => timers.advance(JOIN_MS * 2));
    expect(hook.result.current.errorCode).toBe("unknown_room");
    expect(hook.result.current.error).toBe("unknown room");
  });

  it("leave(취소) 후 만료 시각이 지나도 상태가 바뀌지 않는다", () => {
    const hook = setup();
    act(() => hook.result.current.create("park"));
    act(() => hook.result.current.leave());
    expect(hook.result.current.joining).toBe(false);
    expect(hook.result.current.error).toBeNull();
    act(() => timers.advance(JOIN_MS * 2));
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.status).toBe("idle");
  });

  it("소켓이 닫혀도 타이머가 해제된다", () => {
    const hook = setup();
    act(() => hook.result.current.create("park"));
    act(() => last().open());
    act(() => last().drop(1008));
    act(() => timers.advance(JOIN_MS * 2));
    expect(hook.result.current.error).not.toBe("서버 응답이 없습니다. 다시 시도해 주세요");
  });

  it("언마운트하면 타이머가 해제된다", () => {
    const hook = setup();
    act(() => hook.result.current.create("park"));
    hook.unmount();
    expect(timers.pending()).toEqual([]);
  });
});
