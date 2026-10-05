import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { awaitingSeats, createGame, decideAction, dispatch } from "@mahjong/core";
import { App } from "../App";
import { createRng } from "../controller";
import { viewFor } from "../model/seatView";
import { ROOM_ID_HINT, entryPlan, errorText, normalizeRoomId, seatLabel, validateName, validateRoomId, validateServerUrl } from "./entry";
import { createLocalPrefsStore, createMemoryPrefsStore } from "./prefs";
import type { PrefsStore } from "./prefs";
import { createMemorySessionStore } from "./sessionStore";
import type { SessionStore } from "./sessionStore";
import { FakeTimers, MockSocket } from "./testkit";
import type { GameStatus } from "./types";

const URL_ = "ws://test:1";
const TOKEN = "SECRET-TOKEN-0123456789abcdef";

let sockets: MockSocket[];
let urls: string[];
let store: SessionStore;
let prefs: PrefsStore;
const last = (): MockSocket => sockets[sockets.length - 1]!;

function renderOnline(opts: { stored?: boolean; prefsStore?: PrefsStore } = {}) {
  if (opts.stored) store.save({ roomId: "ROOM1234", seatToken: TOKEN, seq: 3, serverUrl: URL_ });
  return render(
    <App
      online
      prefsStore={opts.prefsStore ?? prefs}
      serverOptions={{
        url: URL_,
        createSocket: (u: string) => {
          const s = new MockSocket();
          sockets.push(s);
          urls.push(u);
          return s;
        },
        store,
        timers: new FakeTimers(),
      }}
    />,
  );
}

const clickCreate = () => fireEvent.click(screen.getByRole("button", { name: "방 만들기" }));
const clickJoin = () => fireEvent.click(screen.getByRole("button", { name: "입장" }));
const setRoom = (v: string) => fireEvent.change(screen.getByLabelText("방 ID"), { target: { value: v } });
function joined(seat = 1, roomId = "ROOM1234") {
  act(() => last().open());
  act(() => last().receive({ type: "joined", roomId, seatToken: TOKEN, seat }));
}

beforeEach(() => {
  sockets = [];
  urls = [];
  store = createMemorySessionStore();
  prefs = createMemoryPrefsStore();
});
afterEach(cleanup);

describe("입력 검증 함수", () => {
  it("이름 1~32자 (앞뒤 공백 제거)", () => {
    expect(validateName("  park ")).toEqual({ ok: true, value: "park" });
    expect(validateName("   ").ok).toBe(false);
    expect(validateName("a".repeat(32)).ok).toBe(true);
    expect(validateName("a".repeat(33)).ok).toBe(false);
  });
  it("서버 주소는 ws:// 또는 wss://", () => {
    expect(validateServerUrl("ws://localhost:8080").ok).toBe(true);
    expect(validateServerUrl(" wss://example.com/x ")).toEqual({ ok: true, value: "wss://example.com/x" });
    expect(validateServerUrl("http://localhost").ok).toBe(false);
    expect(validateServerUrl("localhost:8080").ok).toBe(false);
    expect(validateServerUrl("ws://").ok).toBe(false);
  });
  it("방 ID 정규화: 공백 제거 + 대문자", () => {
    expect(normalizeRoomId(" ab cd\t2345 ")).toBe("ABCD2345");
    expect(validateRoomId("abcd 2345")).toEqual({ ok: true, value: "ABCD2345" });
    expect(validateRoomId("  ").ok).toBe(false);
    expect(validateRoomId("ab-cd").ok).toBe(false);
  });
  it("좌석 표기", () => {
    expect(seatLabel(0)).toBe("좌석 1 (동가)");
    expect(seatLabel(3)).toBe("좌석 4 (북가)");
  });
  it("저장소 접근이 실패해도 예외 없이 빈 값/무시로 동작한다", () => {
    const throwing = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
      removeItem: () => {
        throw new Error("denied");
      },
    };
    const p = createLocalPrefsStore(throwing);
    expect(p.load()).toEqual({});
    expect(() => p.save({ name: "a" })).not.toThrow();
  });
});

describe("상태별 버튼 규칙 (entryPlan)", () => {
  // [status, roomId, joining, screen, [create/join, start, leave, showConnecting]]
  type Row = [GameStatus, string | null, boolean, string, [boolean, boolean, boolean, boolean]];
  const table: Row[] = [
    ["idle", null, false, "entry", [true, false, false, false]],
    ["idle", null, true, "entry", [false, false, true, true]],
    ["connecting", null, false, "entry", [false, false, true, true]],
    ["connecting", null, true, "entry", [false, false, true, true]],
    ["waiting", "R", false, "lobby", [false, true, true, false]],
    ["playing", "R", false, "game", [false, false, true, false]],
    ["ended", "R", false, "game", [false, false, true, false]],
    ["reconnecting", "R", false, "reconnecting", [false, false, true, false]],
    ["reconnecting", null, false, "entry", [false, false, true, true]],
    ["closed", null, false, "entry", [true, false, false, false]],
    ["closed", "R", false, "disconnected", [false, false, true, false]],
  ];
  it.each(table)("%s roomId=%s joining=%s", (status, roomId, joining, screen, [create, start, leave, connecting]) => {
    const p = entryPlan(status, roomId, joining);
    expect(p.screen).toBe(screen);
    expect(p.canCreate).toBe(create);
    expect(p.canJoin).toBe(create);
    expect(p.canStart).toBe(start);
    expect(p.canLeave).toBe(leave);
    expect(p.showConnecting).toBe(connecting);
  });

  it("불변식: 대기 표시(showConnecting)이면 취소(canLeave)가 가능하다", () => {
    const statuses: GameStatus[] = ["idle", "connecting", "waiting", "playing", "ended", "reconnecting", "closed"];
    for (const status of statuses) {
      for (const roomId of [null, "R"]) {
        for (const joining of [false, true]) {
          const p = entryPlan(status, roomId, joining);
          if (p.showConnecting) expect(p.canLeave, `${status}/${roomId}/${joining}`).toBe(true);
        }
      }
    }
  });
});

describe("방 ID 안내와 오류 문구", () => {
  it("밑줄이 든 방 ID를 허용하고 안내 문구에도 밑줄이 있다", () => {
    expect(validateRoomId("ab_12cd")).toEqual({ ok: true, value: "AB_12CD" });
    expect(ROOM_ID_HINT).toContain("_");
    const bad = validateRoomId("ab-cd");
    expect(bad.ok === false && bad.message).toContain("_");
  });
  it("매핑 없는 서버 오류 코드는 원문 대신 코드가 든 한국어 문구를 쓴다", () => {
    expect(errorText("unknown_room", "raw")).toContain("방을 찾을 수 없습니다");
    expect(errorText("seq_too_far" as never, "raw english")).toBe("요청을 처리하지 못했습니다 (코드: seq_too_far)");
    expect(errorText(null, "로컬 문구")).toBe("로컬 문구");
    expect(errorText("unknown_room", null)).toBeNull();
  });
});

describe("모드 선택", () => {
  it("시작 화면에서 로컬을 고르면 기존 로컬 화면, 처음으로로 돌아온다", () => {
    render(<App prefsStore={prefs} />);
    expect(screen.getByRole("button", { name: "온라인 대전" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: /혼자 연습/ }));
    expect(screen.getByLabelText("시드")).toBeTruthy();
    expect(screen.getByRole("button", { name: "새 게임" })).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "처음으로" }));
    expect(screen.getByRole("button", { name: /혼자 연습/ })).toBeTruthy();
  });

  it("온라인을 고르면 입장 폼이 보이고 로컬 요소는 없다", () => {
    render(
      <App
        prefsStore={prefs}
        serverOptions={{ url: URL_, createSocket: () => new MockSocket(), store, timers: new FakeTimers() }}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: "온라인 대전" }));
    expect(screen.getByRole("button", { name: "방 만들기" })).toBeTruthy();
    expect(screen.queryByLabelText("시드")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "처음으로" }));
    expect(screen.getByRole("button", { name: /혼자 연습/ })).toBeTruthy();
  });
});

describe("온라인 입장 폼", () => {
  it("이름/서버 주소가 잘못되면 오류를 보이고 입력을 유지하며 전송하지 않는다", () => {
    renderOnline();
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "   " } });
    fireEvent.change(screen.getByLabelText("서버 주소"), { target: { value: "http://bad" } });
    clickCreate();
    expect(screen.getByText(/이름을 입력해 주세요/)).toBeTruthy();
    expect(screen.getByText(/ws:\/\/ 또는 wss:\/\/ 로 시작해야/)).toBeTruthy();
    expect((screen.getByLabelText("서버 주소") as HTMLInputElement).value).toBe("http://bad");
    expect(sockets).toHaveLength(0);
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: "a".repeat(33) } });
    clickCreate();
    expect(screen.getByText(/32자 이하/)).toBeTruthy();
  });

  it("검증을 통과하면 이름·서버 주소를 저장하고 join name으로 전송한다", () => {
    renderOnline();
    fireEvent.change(screen.getByLabelText("이름"), { target: { value: " 박 " } });
    clickCreate();
    expect(prefs.load()).toEqual({ name: "박", serverUrl: URL_ });
    act(() => last().open());
    expect(last().sent[0]).toEqual({ type: "join", name: "박" });
  });

  it("저장된 이름·서버 주소를 입력칸에 복원한다", () => {
    renderOnline({ prefsStore: createMemoryPrefsStore({ name: "박", serverUrl: "ws://saved:9" }) });
    expect((screen.getByLabelText("이름") as HTMLInputElement).value).toBe("박");
    // 훅 옵션으로 준 url이 우선한다
    expect((screen.getByLabelText("서버 주소") as HTMLInputElement).value).toBe(URL_);
  });

  it("서버 주소를 바꿔 제출하면 새 주소로 새 연결을 만들고 입장 요청을 보낸다", () => {
    renderOnline();
    fireEvent.change(screen.getByLabelText("서버 주소"), { target: { value: "ws://other:2" } });
    clickCreate();
    expect(urls).toEqual(["ws://other:2"]);
    act(() => last().open());
    expect(last().sent[0]).toMatchObject({ type: "join" });
    joined(2);
    expect(screen.getByTestId("room-id").textContent).toBe("ROOM1234");
  });

  it("Enter(폼 제출)로 방 만들기가 실행된다", () => {
    renderOnline();
    fireEvent.submit(screen.getByLabelText("이름"));
    expect(sockets).toHaveLength(1);
  });
});

describe("방 만들기 -> 대기실 -> 시작", () => {
  it("방 ID·좌석·안내를 보이고 시작/나가기가 있다 (착석 현황은 표시하지 않는다)", () => {
    renderOnline();
    clickCreate();
    joined(1);
    expect(screen.getByTestId("room-id").textContent).toBe("ROOM1234");
    expect(screen.getByTestId("my-seat").textContent).toBe("좌석 2 (남가)");
    expect(screen.getByText(/비어 있는 좌석은 봇이 채웁니다/)).toBeTruthy();
    expect(screen.getByText(/확인할 수 없습니다/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "방 만들기" })).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "시작" }));
    expect(last().sent.at(-1)).toEqual({ type: "start" });
  });

  it("클립보드 API가 없거나 실패하면 선택 가능한 텍스트 폴백을 보인다", async () => {
    renderOnline();
    clickCreate();
    joined();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "방 ID 복사" }));
    });
    const input = screen.getByDisplayValue("ROOM1234") as HTMLInputElement;
    expect(input.readOnly).toBe(true);
    expect(screen.getByText(/직접 선택해 복사/)).toBeTruthy();
  });

  it("클립보드 복사 성공 시 안내만 보인다", async () => {
    const written: string[] = [];
    Object.defineProperty(navigator, "clipboard", {
      configurable: true,
      value: { writeText: async (t: string) => void written.push(t) },
    });
    try {
      renderOnline();
      clickCreate();
      joined();
      await act(async () => {
        fireEvent.click(screen.getByRole("button", { name: "방 ID 복사" }));
      });
      expect(written).toEqual(["ROOM1234"]);
      expect(screen.getByText("복사했습니다")).toBeTruthy();
      expect(screen.queryByDisplayValue("ROOM1234")).toBeNull();
    } finally {
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: undefined });
    }
  });

  it("대기실에서 나가기: 저장 세션을 지우고 입장 화면으로 돌아온다", () => {
    renderOnline();
    clickCreate();
    joined();
    expect(store.load()).not.toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "나가기" }));
    expect(last().closed).toBe(true);
    expect(store.load()).toBeNull();
    expect(screen.getByRole("button", { name: "방 만들기" })).toBeTruthy();
    expect(screen.getByTestId("server-status").textContent).toContain("입장 전");
  });
});

describe("방 ID로 입장", () => {
  it("대소문자·공백을 정규화해 전송한다", () => {
    renderOnline();
    setRoom("  ab cd 2345 ");
    clickJoin();
    act(() => last().open());
    expect(last().sent[0]).toEqual({ type: "join", name: "플레이어", roomId: "ABCD2345" });
  });

  it("unknown_room은 한글 오류로 보이고 입력과 입장 버튼이 유지된다", () => {
    renderOnline();
    setRoom("noroom");
    clickJoin();
    act(() => last().open());
    act(() => last().receive({ type: "error", code: "unknown_room", message: "unknown room" }));
    expect(screen.getByRole("alert").textContent).toContain("해당 방을 찾을 수 없습니다");
    expect(screen.queryByText("unknown room")).toBeNull();
    expect((screen.getByLabelText("방 ID") as HTMLInputElement).value).toBe("NOROOM");
    expect((screen.getByRole("button", { name: "입장" }) as HTMLButtonElement).disabled).toBe(false);
  });

  it("형식이 잘못된 방 ID는 전송하지 않는다", () => {
    renderOnline();
    setRoom("ab-cd");
    clickJoin();
    expect(screen.getByText(/방 ID 형식이 올바르지 않습니다/)).toBeTruthy();
    expect(sockets).toHaveLength(0);
  });
});

describe("연결 중 버튼 비활성", () => {
  const disabled = (name: string) => (screen.getByRole("button", { name }) as HTMLButtonElement).disabled;

  it("입장 요청 후 연결 중에는 방 만들기/입장이 비활성이다", () => {
    renderOnline();
    setRoom("ROOM1234");
    clickCreate();
    expect(screen.getByTestId("server-status").textContent).toContain("연결 중");
    expect(disabled("방 만들기")).toBe(true);
    expect(disabled("입장")).toBe(true);
    // 소켓이 열려도 joined 전까지는 다시 보낼 수 없다
    act(() => last().open());
    expect(disabled("방 만들기")).toBe(true);
    expect(disabled("입장")).toBe(true);
    expect(last().sent.filter((m) => m.type === "join")).toHaveLength(1);
  });

  it("저장된 세션 자동 복원 중에는 '이어서 접속 중…'과 취소가 보이고 입장은 비활성이다", () => {
    renderOnline({ stored: true });
    expect(screen.getByText(/이어서 접속 중/)).toBeTruthy();
    expect(disabled("방 만들기")).toBe(true);
    expect(disabled("입장")).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "취소(나가기)" }));
    expect(store.load()).toBeNull();
    expect(screen.queryByText(/이어서 접속 중/)).toBeNull();
    expect(disabled("방 만들기")).toBe(false);
  });

  it("복원이 성공하면 대기실로 들어간다", () => {
    renderOnline({ stored: true });
    act(() => last().open());
    expect(last().sent[0]).toMatchObject({ type: "rejoin", roomId: "ROOM1234" });
    act(() => last().receive({ type: "joined", roomId: "ROOM1234", seatToken: TOKEN, seat: 0 }));
    expect(screen.getByTestId("room-id").textContent).toBe("ROOM1234");
  });
});

describe("게임 종료 화면 (서버 모드)", () => {
  it("새 게임 대신 나가기(입장 화면으로)만 있고, 누르면 입장 화면으로 돌아간다", () => {
    renderOnline();
    clickCreate();
    joined(2);
    const rng = createRng(11);
    let state = createGame(rng);
    for (let i = 0; i < 5000 && state.phase !== "roundEnd" && state.phase !== "gameEnd"; i++) {
      const who = awaitingSeats(state)[0]!;
      state = dispatch(state, decideAction(state, who, rng));
    }
    const view = { ...viewFor(state, 2), phase: "gameEnd" as const };
    act(() => last().receive({ type: "view", view }));
    const result = screen.getByRole("dialog", { name: "국 결과" });
    fireEvent.click(within(result).getByRole("button", { name: /최종 결과|다음 국/ }));
    const end = screen.getByRole("dialog", { name: "게임 종료" });
    expect(within(end).queryByRole("button", { name: "새 게임" })).toBeNull();
    expect(within(end).getByText(/새 게임이 없습니다/)).toBeTruthy();
    expect(within(end).getByRole("button", { name: "나가기 (입장 화면으로)" })).toBeTruthy();
    fireEvent.click(within(end).getByRole("button", { name: "나가기 (입장 화면으로)" }));
    expect(store.load()).toBeNull();
    expect(screen.getByRole("button", { name: "방 만들기" })).toBeTruthy();
  });
});
