// 20-1 연결 상태 UX: 문구 매핑, 연결 배너, 다시 연결, notice 소멸, 응답 타임아웃, 서버 주소 전환
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { act, cleanup, fireEvent, render, renderHook, screen } from "@testing-library/react";
import { ERROR_CODES } from "@mahjong/server-protocol";
import { awaitingSeats, createGame, decideAction, dispatch, legalActions } from "@mahjong/core";
import type { GameState, Seat } from "@mahjong/core";
import { App } from "../App";
import { createRng } from "../controller";
import { viewFor } from "../model/seatView";
import { entryPlan } from "./entry";
import { CLOSE_REASON_TEXT, ERROR_TEXT, INTENTIONAL_FALLBACK_CODES, LOCAL_TEXT, NOTICE_TEXT, SERVER_SWITCH_NOTE, buildConnectionBanner, errorText, fallbackErrorText } from "./messages";
import type { BannerInput } from "./messages";
import { createMemoryPrefsStore } from "./prefs";
import { createMemorySessionStore, isResumable } from "./sessionStore";
import type { SessionStore } from "./sessionStore";
import { FakeTimers, MockSocket } from "./testkit";
import type { GameStatus } from "./types";
import { NOTICE_TIMEOUT_MS, RESPONSE_TIMEOUT_MS, useServerGame } from "./useServerGame";
import type { UseServerGameOptions } from "./useServerGame";
import type { CloseReasonCode } from "./wsClient";

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

/** 내 차례 view를 받은 상태까지 */
function enterWithView(hook: ReturnType<typeof setup>, seat: Seat = 2) {
  const view = viewFor(stateAwaiting(seat), seat);
  enter(hook, seat);
  send(last(), { type: "view", view });
  return view;
}

/** 재접속 시도 상한 1회 + 두 번 끊김으로 retries_exhausted(closed)까지 */
function driveToExhausted(hook: ReturnType<typeof setup>) {
  act(() => last().drop(1006));
  act(() => timers.advance(1000));
  act(() => last().drop(1006));
}

beforeEach(() => {
  sockets = [];
  timers = new FakeTimers();
  store = createMemorySessionStore();
});
afterEach(cleanup);

// ---------------------------------------------------------------------------
describe("messages: 문구 매핑", () => {
  it("서버 protocol ERROR_CODES는 전부 한글 매핑이 있거나 의도된 폴백이다", () => {
    for (const code of ERROR_CODES) {
      const mapped = ERROR_TEXT[code] !== undefined;
      const intended = INTENTIONAL_FALLBACK_CODES.includes(code);
      expect(mapped || intended, `${code}: 매핑도 의도된 폴백도 아님`).toBe(true);
      expect(mapped && intended, `${code}: 매핑과 폴백이 동시에 선언됨`).toBe(false);
      // 어느 쪽이든 영문 서버 원문이 아니라 한글 문구가 나온다
      expect(errorText(code, "raw english")).toMatch(/[가-힣]/);
    }
  });

  it("의도된 폴백 코드는 코드가 든 문구를 쓰고, 매핑 항목은 불필요한 코드를 갖지 않는다", () => {
    for (const code of INTENTIONAL_FALLBACK_CODES) expect(errorText(code, "x")).toBe(fallbackErrorText(code));
    for (const code of Object.keys(ERROR_TEXT)) expect((ERROR_CODES as readonly string[]).includes(code)).toBe(true);
  });

  it("모든 close 사유와 notice에 한글 문구가 있다", () => {
    const reasons: CloseReasonCode[] = [
      "user",
      "displaced",
      "unknown_room",
      "bad_token",
      "room_full",
      "connection_failed",
      "retries_exhausted",
      "rejoin_timeout",
    ];
    expect(Object.keys(CLOSE_REASON_TEXT).sort()).toEqual([...reasons].sort());
    for (const r of reasons.filter((x) => x !== "user")) expect(CLOSE_REASON_TEXT[r].title).toMatch(/[가-힣]/);
    expect(Object.keys(NOTICE_TEXT).sort()).toEqual(["auto_mode", "timeout"]);
    expect(NOTICE_TEXT.auto_mode).toContain("아무 행동");
  });

  it("컨트롤러의 로컬 오류는 LOCAL_TEXT를 쓴다", () => {
    const hook = setup();
    act(() => hook.result.current.start());
    expect(hook.result.current.error).toBe(LOCAL_TEXT.startNotSent);
  });
});

// ---------------------------------------------------------------------------
describe("buildConnectionBanner: 상태 x 배너·버튼 표", () => {
  const closed = (code: CloseReasonCode) => ({ code, message: "m" });
  const base: BannerInput = { status: "playing", closeReason: null, inRoom: true, retry: null, resumable: true };
  // [설명, 입력, 기대 kind, 기대 버튼]
  type Row = [string, Partial<BannerInput>, "reconnecting" | "closed" | null, string | null];
  const table: Row[] = [
    ["idle", { status: "idle", inRoom: false }, null, null],
    ["connecting (방 없음: 입장 화면이 안내)", { status: "connecting", inRoom: false }, null, null],
    ["connecting (방 있음: 수동 다시 연결 중)", { status: "connecting" }, "reconnecting", null],
    ["reconnecting (방 있음)", { status: "reconnecting", retry: { attempt: 2, max: 10, delayMs: 2000 } }, "reconnecting", null],
    ["reconnecting (방 없음: 입장 화면이 안내)", { status: "reconnecting", inRoom: false }, null, null],
    ["waiting", { status: "waiting" }, null, null],
    ["playing", { status: "playing" }, null, null],
    ["ended", { status: "ended" }, null, null],
    ["closed user", { status: "closed", closeReason: closed("user"), inRoom: false }, null, null],
    ["closed unknown_room", { status: "closed", closeReason: closed("unknown_room"), inRoom: false }, null, null],
    ["closed bad_token", { status: "closed", closeReason: closed("bad_token"), inRoom: false }, null, null],
    ["closed room_full", { status: "closed", closeReason: closed("room_full"), inRoom: false }, null, null],
    ["closed displaced (저장 세션 있음)", { status: "closed", closeReason: closed("displaced") }, "closed", "여기서 다시 접속"],
    ["closed displaced (저장 세션 없음)", { status: "closed", closeReason: closed("displaced"), resumable: false }, "closed", null],
    ["closed retries_exhausted", { status: "closed", closeReason: closed("retries_exhausted") }, "closed", "다시 연결"],
    ["closed rejoin_timeout", { status: "closed", closeReason: closed("rejoin_timeout") }, "closed", "다시 연결"],
    ["closed connection_failed (저장 세션 있음)", { status: "closed", closeReason: closed("connection_failed"), inRoom: false }, "closed", "다시 연결"],
    ["closed connection_failed (저장 세션 없음)", { status: "closed", closeReason: closed("connection_failed"), inRoom: false, resumable: false }, "closed", null],
    ["closed retries_exhausted (저장 세션 없음)", { status: "closed", closeReason: closed("retries_exhausted"), resumable: false }, "closed", null],
  ];
  it.each(table)("%s", (_name, input, kind, button) => {
    const b = buildConnectionBanner({ ...base, ...input });
    expect(b?.kind ?? null).toBe(kind);
    expect(b?.action?.label ?? null).toBe(button);
  });

  it("reconnecting 배너에 시도 횟수와 다음 시도까지 대략의 시간을 알린다", () => {
    const b = buildConnectionBanner({ ...base, status: "reconnecting", retry: { attempt: 3, max: 10, delayMs: 4000 } });
    expect(b?.detail).toContain("3/10");
    expect(b?.detail).toContain("약 4초");
  });

  it("displaced 안내에 두 곳이 서로 밀어내는 위험을 명시한다", () => {
    const b = buildConnectionBanner({ ...base, status: "closed", closeReason: closed("displaced") });
    expect(b?.title).toContain("다른 곳에서 접속");
    expect(b?.detail).toContain("서로 계속 밀어내");
  });
});

describe("entryPlan.statusLabel: 헤더 상태 문구 표", () => {
  type Row = [GameStatus, string | null, string];
  const table: Row[] = [
    ["idle", null, "입장 전"],
    ["closed", null, "입장 전"],
    ["closed", "R", "연결 끊김"],
    ["connecting", null, "연결 중"],
    ["connecting", "R", "재접속 중"],
    ["reconnecting", "R", "재접속 중"],
    ["waiting", "R", "대기"],
    ["playing", "R", "진행 중"],
    ["ended", "R", "게임 종료"],
  ];
  it.each(table)("%s roomId=%s -> %s", (status, roomId, label) => {
    expect(entryPlan(status, roomId, false).statusLabel).toBe(label);
  });

  it("방에 앉은 채 수동 다시 연결 중(connecting+방)이면 대국 화면 위에 입장 폼을 띄우지 않는다", () => {
    const p = entryPlan("connecting", "R", false);
    expect(p.screen).toBe("reconnecting");
    expect(p.canCreate || p.canJoin).toBe(false);
    expect(p.canLeave).toBe(true);
  });
});

// ---------------------------------------------------------------------------
describe("재접속 안내 (retry 정보)", () => {
  it("reconnecting 동안 시도 번호가 갱신되고, 복귀하면 배너와 시도 정보가 사라진다", () => {
    const hook = setup();
    enter(hook, 1);
    expect(hook.result.current.connection).toBeNull();
    act(() => last().drop(1006));
    expect(hook.result.current.connection?.kind).toBe("reconnecting");
    expect(hook.result.current.connection?.detail).toContain("1/10");
    act(() => timers.advance(1000));
    act(() => last().drop(1006)); // 연결은 열리지 못하고 또 끊김
    expect(hook.result.current.connection?.detail).toContain("2/10");
    expect(hook.result.current.connection?.detail).toContain("약 2초");
    act(() => timers.advance(2000));
    act(() => last().open());
    send(last(), joinedMsg(1));
    expect(hook.result.current.connection).toBeNull();
  });

  it("retry 정보는 closed에서도 지워진다 (해제 조건)", () => {
    const hook = setup({ clientOptions: { maxReconnectAttempts: 1 } });
    enter(hook, 1);
    driveToExhausted(hook);
    expect(hook.result.current.status).toBe("closed");
    // 시도 횟수 문구가 아니라 closed 안내여야 한다
    expect(hook.result.current.connection?.kind).toBe("closed");
    expect(hook.result.current.connection?.detail).not.toContain("1/1");
  });
});

// ---------------------------------------------------------------------------
describe("다시 연결 / 여기서 다시 접속", () => {
  it("retries_exhausted: 다시 연결 버튼 정보가 있고, 누르면 저장 세션으로 rejoin을 처음부터 시도한다", () => {
    const view = viewFor(stateAwaiting(2), 2);
    const hook = setup({ clientOptions: { maxReconnectAttempts: 1 } });
    enter(hook, 2);
    send(last(), { type: "view", view });
    driveToExhausted(hook);
    expect(hook.result.current.status).toBe("closed");
    expect(hook.result.current.closeReason?.code).toBe("retries_exhausted");
    expect(hook.result.current.connection?.action?.kind).toBe("retry");
    expect(hook.result.current.actions).toEqual([]);
    const before = sockets.length;

    act(() => hook.result.current.reconnect());
    expect(sockets).toHaveLength(before + 1);
    expect(hook.result.current.status).toBe("connecting");
    // 방에 앉은 채 연결 중이므로 reconnecting 배너 (입장 폼으로 돌아가지 않는다)
    expect(hook.result.current.connection?.kind).toBe("reconnecting");
    expect(hook.result.current.view).toEqual(view);
    act(() => last().open());
    expect(last().sent[0]).toEqual({ type: "rejoin", roomId: "ROOM1234", seatToken: TOKEN });
    send(last(), joinedMsg(2));
    send(last(), { type: "view", view });
    expect(hook.result.current.status).toBe("playing");
    expect(hook.result.current.connection).toBeNull();
    expect(hook.result.current.actions).toEqual(view.legalActions);
  });

  it("다시 연결하면 백오프와 시도 횟수가 처음(1회, 1초)으로 초기화된다", () => {
    const hook = setup({ clientOptions: { maxReconnectAttempts: 2 } });
    enter(hook, 1);
    act(() => last().drop(1006));
    act(() => timers.advance(1000));
    act(() => last().drop(1006));
    act(() => timers.advance(2000));
    act(() => last().drop(1006));
    expect(hook.result.current.status).toBe("closed");

    act(() => hook.result.current.reconnect());
    act(() => last().drop(1006)); // 새 시도 중 끊김
    expect(hook.result.current.status).toBe("reconnecting");
    expect(hook.result.current.connection?.detail).toContain("1/2");
    const n = sockets.length;
    act(() => timers.advance(999));
    expect(sockets).toHaveLength(n);
    act(() => timers.advance(1));
    expect(sockets).toHaveLength(n + 1);
  });

  it("rejoin_timeout 사유도 다시 연결을 제공한다", () => {
    const hook = setup({ clientOptions: { maxReconnectAttempts: 1, rejoinTimeoutMs: 500 } });
    enter(hook, 1);
    act(() => last().drop(1006));
    act(() => timers.advance(1000));
    act(() => last().open());
    act(() => timers.advance(500)); // rejoin 응답 없음, 상한 초과
    expect(hook.result.current.closeReason?.code).toBe("rejoin_timeout");
    expect(hook.result.current.connection?.action?.label).toBe("다시 연결");
  });

  it("connection_failed는 저장 세션이 있을 때만 다시 연결을 제공한다", () => {
    // 저장 세션 없음: 입장 시도 중 연결 실패
    const a = setup();
    act(() => a.result.current.create("park"));
    act(() => last().drop(1006));
    expect(a.result.current.closeReason?.code).toBe("connection_failed");
    expect(a.result.current.connection?.kind).toBe("closed");
    expect(a.result.current.connection?.action).toBeNull();
    a.unmount();

    // 저장 세션 있음 (다른 방 입장 시도가 실패한 경우 등)
    store.save({ roomId: "ROOM1234", seatToken: TOKEN, seq: 1, serverUrl: URL_ });
    const b = setup({ resumeStored: false });
    act(() => b.result.current.create("park"));
    act(() => last().drop(1006));
    expect(b.result.current.closeReason?.code).toBe("connection_failed");
    expect(b.result.current.connection?.action?.kind).toBe("retry");
  });

  it("displaced(1008)는 자동 재시도하지 않고, 사용자가 누를 때만 rejoin한다", () => {
    const hook = setup();
    enter(hook, 1);
    const n = sockets.length;
    act(() => last().drop(1008));
    expect(hook.result.current.status).toBe("closed");
    act(() => timers.advance(120_000));
    expect(sockets).toHaveLength(n);
    expect(hook.result.current.connection?.action?.kind).toBe("takeover");
    expect(hook.result.current.connection?.action?.label).toBe("여기서 다시 접속");
    expect(hook.result.current.connection?.detail).toContain("서로 계속 밀어내");

    act(() => hook.result.current.reconnect());
    expect(sockets).toHaveLength(n + 1);
    act(() => last().open());
    expect(last().sent[0]).toEqual({ type: "rejoin", roomId: "ROOM1234", seatToken: TOKEN });
  });

  it("저장 세션이 사라졌으면 reconnect는 연결하지 않고 안내한다", () => {
    const hook = setup({ clientOptions: { maxReconnectAttempts: 1 } });
    enter(hook, 1);
    driveToExhausted(hook);
    store.clear();
    const n = sockets.length;
    act(() => hook.result.current.reconnect());
    expect(sockets).toHaveLength(n);
    expect(hook.result.current.error).toBe(LOCAL_TEXT.noSavedSession);
    expect(hook.result.current.connection?.action).toBeNull();
  });

  it("closed가 아니면 reconnect는 아무것도 하지 않는다 (이중 클릭 방지)", () => {
    const hook = setup();
    enter(hook, 1);
    const n = sockets.length;
    act(() => hook.result.current.reconnect());
    expect(sockets).toHaveLength(n);
    expect(hook.result.current.error).toBeNull(); // 연결 중에 눌러도 '저장된 정보 없음' 같은 오류를 띄우지 않는다
    act(() => last().drop(1008));
    act(() => hook.result.current.reconnect());
    act(() => hook.result.current.reconnect());
    expect(sockets).toHaveLength(n + 1);
  });

  it.each(["unknown_room", "bad_token"] as const)("rejoin 중 %s면 세션을 지우고 입장 화면 상태(배너 없음, 한글 오류)가 된다", (code) => {
    store.save({ roomId: "GONE", seatToken: TOKEN, seq: 0, serverUrl: URL_ });
    const hook = setup();
    act(() => last().open());
    send(last(), { type: "error", code, message: "raw english" });
    expect(store.load()).toBeNull();
    expect(hook.result.current.roomId).toBeNull();
    expect(hook.result.current.connection).toBeNull();
    expect(errorText(hook.result.current.errorCode, hook.result.current.error)).toMatch(/[가-힣]/);
    expect(entryPlan(hook.result.current.status, hook.result.current.roomId, false).statusLabel).toBe("입장 전");
  });
});

// ---------------------------------------------------------------------------
describe("notice 소멸 조건", () => {
  it("timeout은 기본 5초 뒤 사라진다", () => {
    expect(NOTICE_TIMEOUT_MS).toBe(5000);
    const hook = setup();
    enterWithView(hook);
    send(last(), { type: "notice", code: "timeout" });
    expect(hook.result.current.notice).toBe("timeout");
    act(() => timers.advance(4999));
    expect(hook.result.current.notice).toBe("timeout");
    act(() => timers.advance(1));
    expect(hook.result.current.notice).toBeNull();
  });

  it("noticeTimeoutMs 옵션으로 바꿀 수 있다", () => {
    const hook = setup({ noticeTimeoutMs: 1000 });
    enterWithView(hook);
    send(last(), { type: "notice", code: "timeout" });
    act(() => timers.advance(1000));
    expect(hook.result.current.notice).toBeNull();
  });

  it("새 timeout 알림은 소멸 시각을 다시 센다", () => {
    const hook = setup();
    enterWithView(hook);
    send(last(), { type: "notice", code: "timeout" });
    act(() => timers.advance(4000));
    send(last(), { type: "notice", code: "timeout" });
    act(() => timers.advance(4000));
    expect(hook.result.current.notice).toBe("timeout");
    act(() => timers.advance(1000));
    expect(hook.result.current.notice).toBeNull();
  });

  it("사용자가 행동하면 timeout 알림이 사라지고 남은 타이머가 없다", () => {
    const hook = setup();
    const view = enterWithView(hook);
    send(last(), { type: "notice", code: "timeout" });
    act(() => hook.result.current.act(view.legalActions[0]!));
    expect(hook.result.current.notice).toBeNull();
    // 소멸 타이머(5초)가 남아 있지 않다 (남은 건 응답 대기 타이머 10초뿐)
    expect(timers.pending()).toEqual([RESPONSE_TIMEOUT_MS]);
    // 이후 도착한 auto_mode가 낡은 timeout 타이머로 지워지지 않는다
    send(last(), { type: "notice", code: "auto_mode" });
    act(() => timers.advance(5000));
    expect(hook.result.current.notice).toBe("auto_mode");
  });

  it("닫기(dismissNotice)를 누르면 사라지고 타이머가 해제된다", () => {
    const hook = setup();
    enterWithView(hook);
    send(last(), { type: "notice", code: "timeout" });
    act(() => hook.result.current.dismissNotice());
    expect(hook.result.current.notice).toBeNull();
    expect(timers.pending().filter((ms) => ms === 5000)).toHaveLength(0);
  });

  it("auto_mode는 시간이 지나도 유지되고, 행동하면 해제된다", () => {
    const hook = setup();
    const view = enterWithView(hook);
    send(last(), { type: "notice", code: "auto_mode" });
    act(() => timers.advance(60_000));
    expect(hook.result.current.notice).toBe("auto_mode");
    act(() => hook.result.current.act(view.legalActions[0]!));
    expect(hook.result.current.notice).toBeNull();
  });

  it("auto_mode는 재접속(joined)하면 해제된다", () => {
    const hook = setup();
    enterWithView(hook);
    send(last(), { type: "notice", code: "auto_mode" });
    act(() => last().drop(1006));
    expect(hook.result.current.notice).toBe("auto_mode"); // 재접속 전에는 유지
    act(() => timers.advance(1000));
    act(() => last().open());
    send(last(), joinedMsg(2));
    expect(hook.result.current.notice).toBeNull();
  });

  it("연결이 닫히면(closed) 알림이 사라진다", () => {
    const hook = setup();
    enterWithView(hook);
    send(last(), { type: "notice", code: "auto_mode" });
    act(() => last().drop(1008));
    expect(hook.result.current.notice).toBeNull();
  });

  it("나가기(leave)와 언마운트에서 타이머가 남지 않는다", () => {
    const hook = setup();
    enterWithView(hook);
    send(last(), { type: "notice", code: "timeout" });
    act(() => hook.result.current.leave());
    expect(hook.result.current.notice).toBeNull();
    expect(timers.pending()).toEqual([]);
    const h2 = setup();
    enterWithView(h2);
    send(last(), { type: "notice", code: "timeout" });
    h2.unmount();
    expect(timers.pending()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("응답 대기 공통 타임아웃", () => {
  it("기본값은 10초다", () => {
    expect(RESPONSE_TIMEOUT_MS).toBe(10_000);
  });

  it("ack도 view도 없으면 만료되어 대기를 풀고 안내하며 다시 행동할 수 있다", () => {
    const hook = setup();
    const view = enterWithView(hook);
    act(() => hook.result.current.act(view.legalActions[0]!));
    expect(hook.result.current.waitingAck).toBe(true);
    expect(hook.result.current.actions).toEqual([]);
    act(() => timers.advance(9999));
    expect(hook.result.current.waitingAck).toBe(true);
    act(() => timers.advance(1));
    expect(hook.result.current.waitingAck).toBe(false);
    expect(hook.result.current.error).toBe(LOCAL_TEXT.responseTimeout);
    expect(hook.result.current.error).toContain("서버 응답이 없습니다");
    expect(hook.result.current.actions).toEqual(view.legalActions);
    // 중복 클릭 방지가 풀려 다시 보낼 수 있다
    const sent = last().sent.filter((m) => m.type === "action").length;
    act(() => hook.result.current.act(view.legalActions[0]!));
    expect(last().sent.filter((m) => m.type === "action")).toHaveLength(sent + 1);
  });

  it("responseTimeoutMs 옵션으로 바꿀 수 있다", () => {
    const hook = setup({ responseTimeoutMs: 2000 });
    const view = enterWithView(hook);
    act(() => hook.result.current.act(view.legalActions[0]!));
    act(() => timers.advance(2000));
    expect(hook.result.current.error).toBe(LOCAL_TEXT.responseTimeout);
  });

  it("ack 뒤 view가 오지 않아도 ack부터 다시 세어 만료된다 (acked 해제)", () => {
    const hook = setup();
    const view = enterWithView(hook);
    act(() => hook.result.current.act(view.legalActions[0]!));
    act(() => timers.advance(3000));
    send(last(), { type: "ack", seq: 1 });
    expect(hook.result.current.waitingAck).toBe(true);
    act(() => timers.advance(9999));
    expect(hook.result.current.waitingAck).toBe(true); // 처음 행동 기준이면 이미 만료됐을 시각
    act(() => timers.advance(1));
    expect(hook.result.current.waitingAck).toBe(false);
    expect(hook.result.current.error).toBe(LOCAL_TEXT.responseTimeout);
  });

  it("ack 뒤 만료되면 acked 가드도 풀려 다시 행동을 보낼 수 있다 (재전송 차단 잔존 없음)", () => {
    const hook = setup();
    const view = enterWithView(hook);
    act(() => hook.result.current.act(view.legalActions[0]!));
    send(last(), { type: "ack", seq: 1 });
    act(() => timers.advance(RESPONSE_TIMEOUT_MS));
    expect(hook.result.current.waitingAck).toBe(false);
    const sent = last().sent.filter((m) => m.type === "action").length;
    act(() => hook.result.current.act(view.legalActions[0]!));
    expect(last().sent.filter((m) => m.type === "action")).toHaveLength(sent + 1);
  });

  it("각 해제 경로(view/오류/연결 변경/closed) 뒤에는 응답 타이머가 남지 않는다", () => {
    const sendAct = (hook: ReturnType<typeof setup>, view: ReturnType<typeof viewFor>) =>
      act(() => hook.result.current.act(view.legalActions[0]!));
    // view
    let hook = setup();
    let view = enterWithView(hook);
    sendAct(hook, view);
    expect(timers.pending()).toEqual([RESPONSE_TIMEOUT_MS]);
    send(last(), { type: "view", view: viewFor(stateAwaiting(2, 9), 2) });
    expect(timers.pending()).toEqual([]);
    hook.unmount();
    // 서버 오류
    hook = setup();
    view = enterWithView(hook);
    sendAct(hook, view);
    send(last(), { type: "error", code: "illegal_action", message: "x", seq: 1 });
    expect(timers.pending()).toEqual([]);
    hook.unmount();
    // 연결 끊김(reconnecting): 남는 타이머는 재접속 백오프(1초)뿐
    hook = setup();
    view = enterWithView(hook);
    sendAct(hook, view);
    act(() => last().drop(1006));
    expect(timers.pending()).toEqual([1000]);
    hook.unmount();
    // closed
    hook = setup();
    view = enterWithView(hook);
    sendAct(hook, view);
    act(() => last().drop(1008));
    expect(timers.pending()).toEqual([]);
  });

  it("정상 흐름: 응답 구간 ack 후 느린 view가 와도 오류가 없다", () => {
    const hook = setup();
    const view = enterWithView(hook);
    act(() => hook.result.current.act(view.legalActions[0]!));
    act(() => timers.advance(100));
    send(last(), { type: "ack", seq: 1 });
    act(() => timers.advance(8000)); // 느린 봇
    expect(hook.result.current.error).toBeNull();
    send(last(), { type: "view", view: viewFor(stateAwaiting(2, 9), 2) });
    expect(hook.result.current.waitingAck).toBe(false);
    act(() => timers.advance(60_000));
    expect(hook.result.current.error).toBeNull();
  });

  it("view가 먼저 오면 타이머가 해제되어 만료 오류가 나지 않는다", () => {
    const hook = setup();
    const view = enterWithView(hook);
    act(() => hook.result.current.act(view.legalActions[0]!));
    send(last(), { type: "view", view: viewFor(stateAwaiting(2, 9), 2) });
    act(() => timers.advance(60_000));
    expect(hook.result.current.error).toBeNull();
  });

  it("서버 오류 응답이 오면 타이머가 해제되어 만료 오류로 덮이지 않는다", () => {
    const hook = setup();
    const view = enterWithView(hook);
    act(() => hook.result.current.act(view.legalActions[0]!));
    send(last(), { type: "error", code: "illegal_action", message: "x", seq: 1 });
    act(() => timers.advance(60_000));
    expect(hook.result.current.errorCode).toBe("illegal_action");
    expect(hook.result.current.error).toBe("x");
  });

  it("연결이 끊기면 타이머가 해제되어 재접속 중에는 만료 오류가 나지 않는다", () => {
    const hook = setup({ clientOptions: { maxReconnectAttempts: 1 } });
    const view = enterWithView(hook);
    act(() => hook.result.current.act(view.legalActions[0]!));
    act(() => last().drop(1006));
    act(() => timers.advance(9000));
    expect(hook.result.current.error).toBeNull();
    expect(hook.result.current.waitingAck).toBe(false);
  });

  it("closed가 되면 타이머가 해제된다 (ack를 받은 뒤 닫혀도 대기 상태가 남지 않는다)", () => {
    const hook = setup();
    const view = enterWithView(hook);
    act(() => hook.result.current.act(view.legalActions[0]!));
    send(last(), { type: "ack", seq: 1 });
    act(() => last().drop(1008));
    expect(hook.result.current.waitingAck).toBe(false);
    act(() => timers.advance(60_000));
    expect(hook.result.current.error).toBeNull();
  });

  it("leave와 언마운트에서 타이머가 남지 않는다", () => {
    const hook = setup();
    const view = enterWithView(hook);
    act(() => hook.result.current.act(view.legalActions[0]!));
    act(() => hook.result.current.leave());
    expect(timers.pending()).toEqual([]);
    const h2 = setup();
    const v2 = enterWithView(h2);
    act(() => h2.result.current.act(v2.legalActions[0]!));
    h2.unmount();
    expect(timers.pending()).toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe("서버 주소 전환: 이전 서버 세션 정리", () => {
  it("다른 서버의 저장 세션이면 지우고 true, 같은 서버면 유지하고 false", () => {
    store.save({ roomId: "OLD", seatToken: TOKEN, seq: 1, serverUrl: "ws://old:1" });
    const hook = setup({ resumeStored: false });
    expect(hook.result.current.discardOtherServerSession(URL_)).toBe(true);
    expect(store.load()).toBeNull();
    store.save({ roomId: "SAME", seatToken: TOKEN, seq: 1, serverUrl: URL_ });
    expect(hook.result.current.discardOtherServerSession(URL_)).toBe(false);
    expect(store.load()?.roomId).toBe("SAME");
    expect(hook.result.current.discardOtherServerSession("ws://none:1")).toBe(true);
  });

  it("방에 앉아 있으면 지우지 않는다", () => {
    const hook = setup();
    enter(hook, 1);
    expect(hook.result.current.discardOtherServerSession("ws://other:1")).toBe(false);
    expect(store.load()?.roomId).toBe("ROOM1234");
  });

  it("저장 세션이 없으면 false", () => {
    const hook = setup({ resumeStored: false });
    expect(hook.result.current.discardOtherServerSession("ws://other:1")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
describe("App: 연결 UX 화면", () => {
  let appSockets: MockSocket[];
  let appUrls: string[];
  const lastApp = (): MockSocket => appSockets[appSockets.length - 1]!;

  function renderApp(extra: Partial<UseServerGameOptions> = {}, prefs = createMemoryPrefsStore()) {
    return render(
      <App
        online
        prefsStore={prefs}
        serverOptions={{
          url: URL_,
          createSocket: (u: string) => {
            const s = new MockSocket();
            appSockets.push(s);
            appUrls.push(u);
            return s;
          },
          store,
          timers,
          ...extra,
        }}
      />,
    );
  }
  const enterRoom = () => {
    fireEvent.click(screen.getByRole("button", { name: "방 만들기" }));
    act(() => lastApp().open());
    act(() => lastApp().receive(joinedMsg(1)));
  };
  const banner = () => screen.queryByTestId("connection-banner");

  beforeEach(() => {
    appSockets = [];
    appUrls = [];
  });

  it("재접속 중: 배너에 시도 횟수가 보이고 헤더는 재접속 중, 복귀하면 배너가 사라진다", () => {
    renderApp();
    enterRoom();
    expect(banner()).toBeNull();
    act(() => lastApp().drop(1006));
    expect(banner()?.textContent).toContain("다시 접속하는 중");
    expect(banner()?.textContent).toContain("1/10");
    expect(screen.getByTestId("server-status").textContent).toContain("재접속 중");
    // 재접속 중에는 다시 연결 버튼이 없고 나가기만 있다
    expect(Array.from(banner()!.querySelectorAll("button")).map((b) => b.textContent)).toEqual(["나가기"]);
    act(() => timers.advance(1000));
    act(() => lastApp().open());
    act(() => lastApp().receive(joinedMsg(1)));
    expect(banner()).toBeNull();
  });

  it("재접속 횟수 초과: 안내와 다시 연결 버튼이 보이고, 누르면 새 소켓으로 rejoin한다", () => {
    renderApp({ clientOptions: { maxReconnectAttempts: 0 } });
    enterRoom();
    act(() => lastApp().drop(1006));
    expect(banner()?.textContent).toContain("다시 접속하지 못했습니다");
    const n = appSockets.length;
    fireEvent.click(screen.getByRole("button", { name: "다시 연결" }));
    expect(appSockets).toHaveLength(n + 1);
    act(() => lastApp().open());
    expect(lastApp().sent[0]).toMatchObject({ type: "rejoin", roomId: "ROOM1234" });
    // 연결 중에도 입장 폼이 나타나지 않는다
    expect(screen.queryByRole("button", { name: "방 만들기" })).toBeNull();
  });

  it("displaced: 안내와 여기서 다시 접속 버튼 (자동 재접속 없음)", () => {
    renderApp();
    enterRoom();
    const n = appSockets.length;
    act(() => lastApp().drop(1008));
    expect(banner()?.textContent).toContain("다른 곳에서 접속");
    expect(banner()?.textContent).toContain("서로 계속 밀어내");
    act(() => timers.advance(60_000));
    expect(appSockets).toHaveLength(n);
    fireEvent.click(screen.getByRole("button", { name: "여기서 다시 접속" }));
    expect(appSockets).toHaveLength(n + 1);
  });

  it("입장 전 연결 실패: 배너는 있지만 다시 연결은 없고, 헤더는 입장 전이다", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "방 만들기" }));
    act(() => lastApp().drop(1006));
    expect(banner()?.textContent).toContain("서버에 연결하지 못했습니다");
    expect(screen.queryByRole("button", { name: "다시 연결" })).toBeNull();
    expect(screen.getByTestId("server-status").textContent).toContain("입장 전");
    expect(screen.getByRole("button", { name: "방 만들기" })).toBeTruthy();
  });

  it("없는 방 입장 실패(unknown_room) 복귀 후 헤더는 연결 끊김이 아니라 입장 전이다", () => {
    renderApp();
    fireEvent.change(screen.getByLabelText("방 ID"), { target: { value: "NOROOM" } });
    fireEvent.click(screen.getByRole("button", { name: "입장" }));
    act(() => lastApp().open());
    act(() => lastApp().receive({ type: "error", code: "unknown_room", message: "raw" }));
    expect(screen.getByTestId("server-status").textContent).toContain("입장 전");
    expect(screen.getByTestId("server-status").textContent).not.toContain("연결 끊김");
    expect(screen.getByText(ERROR_TEXT.unknown_room!)).toBeTruthy();
    expect(banner()).toBeNull();
  });

  it("방에 남은 채 연결이 닫히면 헤더는 연결 끊김이다", () => {
    renderApp();
    enterRoom();
    act(() => lastApp().drop(1008));
    expect(screen.getByTestId("server-status").textContent).toContain("연결 끊김");
  });

  it("notice는 고정 영역에 뜨고, timeout은 닫기가 있고 auto_mode는 해제 방법을 안내하며 닫기가 없다", () => {
    renderApp();
    enterRoom();
    act(() => lastApp().receive({ type: "view", view: viewFor(stateAwaiting(1), 1) }));
    act(() => lastApp().receive({ type: "notice", code: "timeout" }));
    const n = screen.getByTestId("notice");
    expect(n.textContent).toContain(NOTICE_TEXT.timeout);
    expect(n.closest(".status-stack")).not.toBeNull();
    expect(n.closest(".app")?.contains(n)).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: "닫기" }));
    expect(screen.queryByTestId("notice")).toBeNull();
    act(() => lastApp().receive({ type: "notice", code: "auto_mode" }));
    expect(screen.getByTestId("notice").textContent).toContain("아무 행동이나 하면 해제");
    expect(screen.getByTestId("notice").querySelector("button")).toBeNull();
  });

  it("서버 주소를 바꿔 새로 입장하면 이전 서버의 저장 세션을 지우고 안내한다", () => {
    store.save({ roomId: "OLD", seatToken: TOKEN, seq: 1, serverUrl: "ws://old:1" });
    renderApp({ resumeStored: false });
    expect(screen.queryByTestId("server-switch-note")).toBeNull();
    fireEvent.change(screen.getByLabelText("서버 주소"), { target: { value: "ws://new:2" } });
    fireEvent.click(screen.getByRole("button", { name: "방 만들기" }));
    expect(store.load()).toBeNull();
    expect(screen.getByTestId("server-switch-note").textContent).toContain(SERVER_SWITCH_NOTE);
    // 토큰은 새 서버로 전송되지 않는다
    expect(appUrls[appUrls.length - 1]).toBe("ws://new:2");
    expect(JSON.stringify(lastApp().sent)).not.toContain(TOKEN);
  });

  it("같은 서버로 입장하면 저장 세션을 건드리지 않고 안내도 없다", () => {
    store.save({ roomId: "SAME", seatToken: TOKEN, seq: 1, serverUrl: URL_ });
    renderApp({ resumeStored: false });
    fireEvent.click(screen.getByRole("button", { name: "방 만들기" }));
    expect(store.load()?.roomId).toBe("SAME");
    expect(screen.queryByTestId("server-switch-note")).toBeNull();
  });

  it("서버 전환 안내는 방에 입장해도 남고, 닫기로 사라진다", () => {
    store.save({ roomId: "OLD", seatToken: TOKEN, seq: 1, serverUrl: "ws://old:1" });
    renderApp({ resumeStored: false });
    fireEvent.change(screen.getByLabelText("서버 주소"), { target: { value: "ws://new:2" } });
    fireEvent.click(screen.getByRole("button", { name: "방 만들기" }));
    expect(screen.getByTestId("server-switch-note")).toBeTruthy();
    act(() => lastApp().open());
    act(() => lastApp().receive(joinedMsg(1)));
    expect(screen.getByTestId("server-switch-note")).toBeTruthy();
    fireEvent.click(screen.getByTestId("server-switch-note").querySelector("button")!);
    expect(screen.queryByTestId("server-switch-note")).toBeNull();
  });

  it("서버 전환 안내는 나가기로도 사라진다", () => {
    store.save({ roomId: "OLD", seatToken: TOKEN, seq: 1, serverUrl: "ws://old:1" });
    renderApp({ resumeStored: false });
    fireEvent.change(screen.getByLabelText("서버 주소"), { target: { value: "ws://new:2" } });
    fireEvent.click(screen.getByRole("button", { name: "방 만들기" }));
    act(() => lastApp().open());
    act(() => lastApp().receive(joinedMsg(1)));
    fireEvent.click(screen.getByRole("button", { name: "나가기" }));
    expect(screen.queryByTestId("server-switch-note")).toBeNull();
  });

  it("재접속 중 배너 안에 나가기가 있고, 누르면 입장 화면으로 돌아간다", () => {
    renderApp();
    enterRoom();
    act(() => lastApp().drop(1006));
    const leave = screen.getByTestId("banner-leave");
    expect(screen.getByTestId("connection-banner").contains(leave)).toBe(true);
    fireEvent.click(leave);
    expect(screen.queryByTestId("connection-banner")).toBeNull();
    expect(screen.getByRole("button", { name: "방 만들기" })).toBeTruthy();
  });

  it("closed 배너에는 다시 연결과 나가기가 함께 있다", () => {
    renderApp({ clientOptions: { maxReconnectAttempts: 0 } });
    enterRoom();
    act(() => lastApp().drop(1006));
    const names = Array.from(screen.getByTestId("connection-banner").querySelectorAll("button")).map((b) => b.textContent);
    expect(names).toEqual(["다시 연결", "나가기"]);
  });

  it("방이 없으면(입장 전 연결 실패) 배너에 나가기를 두지 않는다", () => {
    renderApp();
    fireEvent.click(screen.getByRole("button", { name: "방 만들기" }));
    act(() => lastApp().drop(1006));
    expect(screen.getByTestId("connection-banner")).toBeTruthy();
    expect(screen.queryByTestId("banner-leave")).toBeNull();
  });

  it("재접속 중·닫힘 상태에서 인라인 안내 문구를 렌더링하지 않는다 (배너만)", () => {
    renderApp({ clientOptions: { maxReconnectAttempts: 1 } });
    enterRoom();
    act(() => lastApp().drop(1006));
    expect(screen.queryByText("연결이 끊겨 다시 접속하는 중입니다…")).toBeNull();
    expect(document.querySelectorAll("p.response-note")).toHaveLength(0);
    act(() => timers.advance(1000));
    act(() => lastApp().drop(1006));
    expect(screen.getByTestId("connection-banner")).toBeTruthy();
    expect(screen.queryByText("연결이 끊겼습니다. 나가기를 눌러 주세요")).toBeNull();
    expect(document.querySelectorAll("p.response-note")).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("20-2: isResumable 단일 함수 (다른 서버 세션은 이어서 접속 대상이 아니다)", () => {
  it("순수 함수: 같은 URL만 true", () => {
    const st = createMemorySessionStore({ roomId: "R", seatToken: TOKEN, seq: 1, serverUrl: "ws://a:1" });
    expect(isResumable(st, "ws://a:1")).toBe(true);
    expect(isResumable(st, "ws://b:1")).toBe(false);
    expect(isResumable(createMemorySessionStore(), "ws://a:1")).toBe(false);
  });

  it("다른 URL 세션이 저장된 채 연결이 실패하면 다시 연결 버튼이 없다", () => {
    store.save({ roomId: "ROOM1234", seatToken: TOKEN, seq: 1, serverUrl: "ws://other:9" });
    const hook = setup({ resumeStored: false });
    act(() => hook.result.current.create("park"));
    act(() => last().drop(1006));
    expect(hook.result.current.closeReason?.code).toBe("connection_failed");
    expect(hook.result.current.connection?.kind).toBe("closed");
    expect(hook.result.current.connection?.action).toBeNull();
  });

  it("같은 URL 세션이면 다시 연결 버튼이 있다", () => {
    store.save({ roomId: "ROOM1234", seatToken: TOKEN, seq: 1, serverUrl: URL_ });
    const hook = setup({ resumeStored: false });
    act(() => hook.result.current.create("park"));
    act(() => last().drop(1006));
    expect(hook.result.current.connection?.action?.label).toBe("다시 연결");
  });

  it("resumeStored는 다른 URL 세션으로 소켓을 열지 않는다", () => {
    store.save({ roomId: "ROOM1234", seatToken: TOKEN, seq: 1, serverUrl: "ws://other:9" });
    setup();
    expect(sockets).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
describe("20-2: 방이 사라진 경우 문구 (자동 rejoin vs 방 ID 직접 입력)", () => {
  it("저장 세션으로 자동 rejoin하다 unknown_room이면 방이 사라졌다는 문구", () => {
    store.save({ roomId: "ROOM1234", seatToken: TOKEN, seq: 1, serverUrl: URL_ });
    const hook = setup();
    act(() => last().open());
    send(last(), { type: "error", code: "unknown_room", message: "raw" });
    expect(hook.result.current.closeReason?.code).toBe("unknown_room");
    expect(errorText(hook.result.current.errorCode, hook.result.current.error)).toBe(LOCAL_TEXT.roomGone);
  });

  it("방 ID를 직접 입력한 join 실패는 기존 문구를 유지한다", () => {
    const hook = setup();
    act(() => hook.result.current.join("NOROOM", "park"));
    act(() => last().open());
    send(last(), { type: "error", code: "unknown_room", message: "raw" });
    expect(errorText(hook.result.current.errorCode, hook.result.current.error)).toBe(ERROR_TEXT.unknown_room);
    expect(LOCAL_TEXT.roomGone).not.toBe(ERROR_TEXT.unknown_room);
  });
});

// ---------------------------------------------------------------------------
describe("20-2: 서버 오류가 오면 acked도 풀린다", () => {
  it("ack 뒤 무관한 오류가 오면 view가 없어도 다시 행동할 수 있다", () => {
    const hook = setup();
    const view = enterWithView(hook);
    act(() => hook.result.current.act(view.legalActions[0]!));
    send(last(), { type: "ack", seq: 1 });
    expect(hook.result.current.waitingAck).toBe(true);
    send(last(), { type: "error", code: "bad_message", message: "x" });
    expect(hook.result.current.waitingAck).toBe(false);
    expect(hook.result.current.actions.length).toBeGreaterThan(0);
  });
});
