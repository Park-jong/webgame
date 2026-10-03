import { describe, expect, it } from "vitest";
import { awaitingSeats, createGame, dispatch, legalActions, startNextRound } from "@mahjong/core";
import type { GameState, Tile } from "@mahjong/core";
import { MAX_MESSAGE_LENGTH, parseClientMessage } from "./index";

const t5: Tile = { kind: "number", suit: "man", rank: 5, isRedFive: false };
const east: Tile = { kind: "wind", wind: "east" };

function parse(m: unknown) {
  return parseClientMessage(typeof m === "string" ? m : JSON.stringify(m));
}
function expectBad(raw: unknown) {
  const r = parseClientMessage(raw);
  expect(r.ok).toBe(false);
  if (!r.ok) expect(r.error.code).toBe("bad_message");
}

function seeded(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6d2b79f5) >>> 0;
    let x = s;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}

describe("parseClientMessage 정상", () => {
  it("join / rejoin / ping", () => {
    expect(parse({ type: "join" })).toEqual({ ok: true, message: { type: "join" } });
    expect(parse({ type: "join", roomId: "r1", name: "나" })).toEqual({
      ok: true,
      message: { type: "join", roomId: "r1", name: "나" },
    });
    expect(parse({ type: "rejoin", roomId: "r1", seatToken: "tok" })).toEqual({
      ok: true,
      message: { type: "rejoin", roomId: "r1", seatToken: "tok" },
    });
    expect(parse({ type: "ping" })).toEqual({ ok: true, message: { type: "ping" } });
  });

  it("start: 추가 필드는 무시된다", () => {
    expect(parse({ type: "start" })).toEqual({ ok: true, message: { type: "start" } });
    expect(parse({ type: "start", seed: 1, seat: 2 })).toEqual({ ok: true, message: { type: "start" } });
  });

  it("action: seq와 정규화된 action", () => {
    const r = parse({ type: "action", seq: 3, action: { type: "discard", tile: t5, riichi: true } });
    expect(r).toEqual({ ok: true, message: { type: "action", seq: 3, action: { type: "discard", tile: t5, riichi: true } } });
    expect(parse({ type: "action", seq: 0, action: { type: "chi", use: [t5, east] } }).ok).toBe(true);
  });

  it("이미 파싱된 객체도 받는다", () => {
    expect(parseClientMessage({ type: "ping" }).ok).toBe(true);
  });
});

describe("parseClientMessage 거부", () => {
  it("깨진 JSON / 객체 아님", () => {
    for (const raw of ["{", "", "[]", "null", "1", '"x"', null, undefined, 5, []]) expectBad(raw);
  });

  it("알 수 없는 type / type 누락", () => {
    expectBad({ type: "hack" });
    expectBad({});
    expectBad({ type: 1 });
  });

  it("필드 누락/타입 오류", () => {
    expectBad({ type: "rejoin", roomId: "r" });
    expectBad({ type: "rejoin", roomId: "", seatToken: "t" });
    expectBad({ type: "join", roomId: 3 });
    expectBad({ type: "join", name: {} });
    expectBad({ type: "action", action: { type: "pass" } });
    expectBad({ type: "action", seq: 1 });
  });

  it("seq는 0 이상의 정수", () => {
    for (const seq of [-1, 1.5, "1", null, Infinity, 2 ** 60]) {
      expectBad({ type: "action", seq, action: { type: "pass" } });
    }
    expectBad({ type: "action", seq: NaN, action: { type: "pass" } });
  });

  it("과대 payload", () => {
    expectBad(JSON.stringify({ type: "join", name: "x".repeat(MAX_MESSAGE_LENGTH) }));
    expectBad(JSON.stringify({ type: "join", name: "x".repeat(100) }));
    expectBad(" ".repeat(MAX_MESSAGE_LENGTH + 1) + '{"type":"ping"}');
  });

  it("Action의 잘못된 variant/tile/seat", () => {
    const bad = (action: unknown) => expectBad({ type: "action", seq: 0, action });
    bad(null);
    bad([]);
    bad({ type: "nuke" });
    bad({ type: "discard" });
    bad({ type: "discard", tile: { kind: "number", suit: "man", rank: 0, isRedFive: false } });
    bad({ type: "discard", tile: { kind: "number", suit: "man", rank: 1.5, isRedFive: false } });
    bad({ type: "discard", tile: { kind: "number", suit: "foo", rank: 1, isRedFive: false } });
    bad({ type: "discard", tile: { kind: "number", suit: "man", rank: 3, isRedFive: true } });
    bad({ type: "discard", tile: { kind: "number", suit: "man", rank: 3 } });
    bad({ type: "discard", tile: { kind: "wind", wind: "up" } });
    bad({ type: "discard", tile: { kind: "dragon", dragon: "blue" } });
    bad({ type: "discard", tile: { kind: "x" } });
    bad({ type: "discard", tile: t5, riichi: "yes" });
    bad({ type: "ankan" });
    bad({ type: "chi", use: [t5] });
    bad({ type: "pon", use: [t5, t5, t5] });
    bad({ type: "pon", use: "xx" });
    bad({ type: "pass", seat: 4 });
    bad({ type: "pass", seat: -1 });
    bad({ type: "pass", seat: 1.5 });
    bad({ type: "pass", seat: "0" });
  });
});

describe("정규화 (좌석/추가 필드)", () => {
  it("최상위 seat 및 추가 필드는 제거된다", () => {
    const r = parse({ type: "action", seq: 1, seat: 2, evil: true, action: { type: "pass" } });
    expect(r).toEqual({ ok: true, message: { type: "action", seq: 1, action: { type: "pass" } } });
    expect(parse({ type: "join", seat: 1, x: 1 })).toEqual({ ok: true, message: { type: "join" } });
  });

  it("action 내부 seat(형식만 검증)와 추가 필드는 제거된다", () => {
    const r = parse({
      type: "action",
      seq: 1,
      action: { type: "discard", seat: 2, extra: 1, tile: { ...t5, junk: 1 } },
    });
    expect(r).toEqual({ ok: true, message: { type: "action", seq: 1, action: { type: "discard", tile: t5 } } });
  });
});

describe("variant 고정 단위 (시드 비의존)", () => {
  const red5: Tile = { kind: "number", suit: "pin", rank: 5, isRedFive: true };
  const cases: Array<[string, Record<string, unknown>, Record<string, unknown>]> = [
    ["리치 타패", { type: "discard", tile: t5, riichi: true }, { type: "discard", tile: t5, riichi: true }],
    ["적5 타패", { type: "discard", tile: red5 }, { type: "discard", tile: red5 }],
    ["안깡", { type: "ankan", tile: east }, { type: "ankan", tile: east }],
    ["가깡(적5)", { type: "shouminkan", tile: red5 }, { type: "shouminkan", tile: red5 }],
    ["대명깡", { type: "daiminkan" }, { type: "daiminkan" }],
    ["구종구패", { type: "kyuushu" }, { type: "kyuushu" }],
  ];
  for (const [name, body, expected] of cases) {
    it(`${name}: 통과하고 seat가 제거된다`, () => {
      const r = parse({ type: "action", seq: 0, action: { ...body, seat: 3 } });
      expect(r).toEqual({ ok: true, message: { type: "action", seq: 0, action: expected } });
    });
  }
});

describe("core legalActions 전부 통과", () => {
  it("여러 시드의 모든 합법 행동이 형식 검증을 통과하고 seat만 제거된 형태로 돌아온다", () => {
    const counts: Record<string, number> = {};
    let checked = 0;
    for (let g = 0; g < 40; g++) {
      const rng = seeded(900 + g);
      let state: GameState = createGame(rng);
      let steps = 0;
      for (let round = 0; round < 3; round++) {
        while ((state.phase === "turn" || state.phase === "response") && steps++ < 2000) {
          for (const seat of awaitingSeats(state)) {
            for (const a of legalActions(state, seat)) {
              const r = parseClientMessage(JSON.stringify({ type: "action", seq: steps, action: a }));
              expect(r.ok, JSON.stringify(a)).toBe(true);
              if (r.ok && r.message.type === "action") {
                const { seat: _s, ...rest } = a;
                expect(r.message.action).toEqual(rest);
              }
              counts[a.type] = (counts[a.type] ?? 0) + 1;
              checked++;
            }
          }
          const seat = awaitingSeats(state)[0]!;
          const actions = legalActions(state, seat);
          const special = actions.filter((a) => a.type !== "discard" && a.type !== "pass");
          const win = actions.filter((a) => a.type === "ron" || a.type === "tsumo");
          const pool = win.length > 0 ? win : special.length > 0 && rng() < 0.7 ? special : actions;
          state = dispatch(state, pool[Math.floor(rng() * pool.length)]!);
        }
        if (state.phase === "gameEnd") break;
        state = startNextRound(state, rng);
      }
    }
    expect(checked).toBeGreaterThan(1000);
    for (const type of ["discard", "tsumo", "ron", "pass", "chi", "pon"]) {
      expect(counts[type] ?? 0, type).toBeGreaterThan(0);
    }
  });
});
