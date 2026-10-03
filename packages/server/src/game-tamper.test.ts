import { describe, expect, it } from "vitest";
import { createGame, legalActions, type Action, type CalledMeld, type GameState, type RandomFn, type Tile } from "@mahjong/core";
import { actionKey, createSession, immediateScheduler, RoomManager, type Connection, type ServerMessage } from "./index";

// 무작위 플레이에서 잘 나오지 않는 행동에 대한 수작업 상태 기반 변조 테스트:
// 합법 행동의 필드를 바꾼 모든 요청은 illegal_action이어야 하고 상태 참조는 변하지 않아야 한다.

function seeded(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HONORS: Tile[] = [
  { kind: "wind", wind: "east" },
  { kind: "wind", wind: "south" },
  { kind: "wind", wind: "west" },
  { kind: "wind", wind: "north" },
  { kind: "dragon", dragon: "white" },
  { kind: "dragon", dragon: "green" },
  { kind: "dragon", dragon: "red" },
];

/** "123m456p0s1z" 표기법 (0 = 적5, z: 1~4 동남서북, 5~7 백발중) */
function T(notation: string): Tile[] {
  const out: Tile[] = [];
  let digits: string[] = [];
  for (const ch of notation) {
    if (/[0-9]/.test(ch)) {
      digits.push(ch);
      continue;
    }
    for (const d of digits) {
      if (ch === "z") out.push(HONORS[Number(d) - 1]!);
      else {
        const suit = ch === "m" ? "man" : ch === "p" ? "pin" : "sou";
        out.push({ kind: "number", suit, rank: (d === "0" ? 5 : Number(d)) as 1, isRedFive: d === "0" });
      }
    }
    digits = [];
  }
  return out;
}

const JUNK = "1379m1379p1379s2z";
const TENPAI_5P = "234m567m234p678s5p";
const DEAD = "5s6s7s8s" + "7z".repeat(10);

function turnState(hand0: string, drawn: string, extra: Partial<GameState> = {}, melds: CalledMeld[] = [], riichi = false): GameState {
  const base = createGame(seeded(1));
  const d = T(drawn)[0]!;
  return {
    ...base,
    players: base.players.map((p, i) => ({
      hand: i === 0 ? [...T(hand0), d] : T(JUNK),
      melds: i === 0 ? melds : [],
      discards: [],
      riichi: i === 0 && riichi,
    })),
    liveWall: T("2z".repeat(5) + "3z".repeat(5) + "4z".repeat(5)),
    deadWall: T(DEAD),
    doraCount: 1,
    drawnTile: d,
    turn: 0,
    ...extra,
  };
}

/** 좌석 0이 discarder의 버림패에 응답해야 하는 상태 */
function responseState(hand0: string, tile: string, discarder: number, ronEligible: number[]): GameState {
  const base = turnState(hand0, "1z");
  const t = T(tile)[0]!;
  return {
    ...base,
    phase: "response",
    turn: discarder,
    drawnTile: null,
    players: base.players.map((p, i) =>
      i === 0
        ? { ...p, hand: T(hand0) }
        : i === discarder
          ? { ...p, discards: [{ tile: t, riichi: false, tsumogiri: false, calledBy: null }] }
          : p,
    ),
    pending: { discarder, tile: t, awaiting: [0], ronEligible, responses: [] },
  };
}

const ponMeld = (n: string): CalledMeld => {
  const t = T(n)[0]!;
  return { type: "pon", tiles: [t, t, t], calledTile: t, fromSeat: 1, from: "right" };
};

// ---------------------------------------------------------------------------

type FakeConn = Connection & { sent: ServerMessage[] };

function run(state: GameState): { conn: FakeConn; act: (a: unknown) => void; state: () => GameState; raw: (s: string) => void } {
  const manager = new RoomManager({
    game: { rng: seeded(1), scheduler: immediateScheduler, botDelayMs: 0, responseWindowMs: 0, nextRoundDelayMs: 0, initialState: state },
  });
  const conn: FakeConn = { sent: [], send: (m) => void conn.sent.push(m), close: () => {}, terminate: () => {} };
  const s = createSession(manager, conn, { maxViolations: 1e9, ratePerSecond: 1e9, rateBurst: 1e9 });
  s.onMessage(JSON.stringify({ type: "join" }));
  s.onMessage(JSON.stringify({ type: "start" }));
  let seq = 0;
  const game = (): ReturnType<typeof manager.gameOf> => manager.gameOf(manager.getRoom((conn.sent[0] as { roomId: string }).roomId)!);
  return {
    conn,
    act: (a) => s.onMessage(JSON.stringify({ type: "action", seq: seq++, action: a })),
    raw: (m) => s.onMessage(m),
    state: () => game()!.peekState()!,
  };
}

function strip(a: Action): Record<string, unknown> {
  const { seat: _seat, ...rest } = a;
  return rest;
}

const sameType = (a: Tile, b: Tile): boolean => JSON.stringify({ ...a, isRedFive: 0 }) === JSON.stringify({ ...b, isRedFive: 0 });

/** 합법 행동의 패를 기반으로 변조 후보 패 목록 (적5 뒤집기, 숫자 ±1, 다른 종류 포함) */
function candidateTiles(legal: Action[], hand: readonly Tile[]): Tile[] {
  const base: Tile[] = [];
  for (const a of legal) {
    if ("tile" in a) base.push(a.tile);
    if ("use" in a) base.push(...a.use);
  }
  const out: Tile[] = [HONORS[0]!, HONORS[5]!, hand[0]!];
  for (const t of base) {
    out.push(t);
    if (t.kind === "number") {
      out.push({ ...t, isRedFive: t.rank === 5 ? !t.isRedFive : false });
      if (t.rank < 9) out.push({ ...t, rank: (t.rank + 1) as 1, isRedFive: false });
      if (t.rank > 1) out.push({ ...t, rank: (t.rank - 1) as 1, isRedFive: false });
      out.push({ ...t, suit: t.suit === "man" ? "pin" : "man", isRedFive: false });
    }
  }
  const uniq: Tile[] = [];
  for (const t of out) if (!uniq.some((u) => JSON.stringify(u) === JSON.stringify(t))) uniq.push(t);
  return uniq.slice(0, 8); // 시간 제한을 위해 상한
}

function mutations(candidates: Tile[]): Record<string, unknown>[] {
  const out: Record<string, unknown>[] = [];
  for (const type of ["tsumo", "ron", "pass", "kyuushu", "daiminkan"]) out.push({ type });
  for (const tile of candidates) {
    out.push({ type: "discard", tile }, { type: "discard", tile, riichi: true });
    out.push({ type: "ankan", tile }, { type: "shouminkan", tile });
  }
  for (const a of candidates) {
    for (const b of candidates) out.push({ type: "chi", use: [a, b] }, { type: "pon", use: [a, b] });
  }
  return out;
}

function tamperCheck(state: GameState, mustHave: string[]): void {
  const legal = legalActions(state, 0);
  for (const t of mustHave) expect(legal.map((a) => a.type)).toContain(t);
  const legalKeys = new Set(legal.map(actionKey));
  const ctx = run(state);
  expect(ctx.state()).toBe(state);

  const bad = mutations(candidateTiles(legal, state.players[0]!.hand)).filter((m) => !legalKeys.has(actionKey({ ...m, seat: 0 } as Action)));
  expect(bad.length).toBeGreaterThan(20);
  const before = ctx.conn.sent.length;
  for (const m of bad) ctx.act(m);
  // 형식이 깨진 요청
  const malformed = ['{"type":"action","seq":999,"action":{"type":"discard"}}', '{"type":"action","seq":998,"action":{"type":"chi","use":[1,2]}}'];
  for (const m of malformed) ctx.raw(m);

  const replies = ctx.conn.sent.slice(before);
  expect(replies).toHaveLength(bad.length + malformed.length);
  expect(replies.slice(0, bad.length).every((m) => m.type === "error" && m.code === "illegal_action")).toBe(true);
  expect(replies.slice(bad.length).every((m) => m.type === "error" && m.code === "bad_message")).toBe(true);
  expect(ctx.state()).toBe(state); // 상태 참조 불변

  // 변조 후에도 원래 합법 행동은 수락된다 (seq 잠금/큐 오염 없음)
  const n = ctx.conn.sent.length;
  ctx.act(strip(legal[legal.length - 1]!));
  expect(ctx.conn.sent.slice(n).some((m) => m.type === "error")).toBe(false);
  expect(ctx.state()).not.toBe(state);
}

describe("행동 변조 (수작업 상태)", () => {
  it("리치 타패", () => {
    const s = turnState(TENPAI_5P, "1z");
    expect(legalActions(s, 0).some((a) => a.type === "discard" && a.riichi === true)).toBe(true);
    tamperCheck(s, ["discard"]);
  });

  it("멘젠 츠모", () => tamperCheck(turnState(TENPAI_5P, "5p"), ["tsumo"]));

  it("리치 후 츠모 (타패는 뽑은 패뿐)", () => tamperCheck(turnState(TENPAI_5P, "5p", {}, [], true), ["tsumo"]));

  it("안깡", () => tamperCheck(turnState("1111m234p567p678s", "5z"), ["ankan"]));

  it("소밍깡", () => tamperCheck(turnState("234p567p678s5z", "1m", {}, [ponMeld("1m")]), ["shouminkan"]));

  it("구종구패", () => tamperCheck(turnState("19m19p19s1234567z", "2m"), ["kyuushu"]));

  it("적5 타패 (적/비적 구분)", () => tamperCheck(turnState("234m567m234p678s0p", "5p"), ["discard"]));

  it("론", () => tamperCheck(responseState(TENPAI_5P, "5p", 1, [0]), ["ron", "pass"]));

  it("펑 + 대명깡", () => tamperCheck(responseState("555m1379p1379s23z", "5m", 1, []), ["pon", "daiminkan", "pass"]));

  it("치 (적5/비적5 구분)", () => {
    const s = responseState("3m0m5m6m1379p1379s2z", "4m", 3, []);
    const chis = legalActions(s, 0).filter((a) => a.type === "chi");
    expect(chis.length).toBeGreaterThanOrEqual(3);
    expect(chis.some((a) => a.type === "chi" && a.use.some((t) => t.kind === "number" && t.isRedFive))).toBe(true);
    expect(chis.some((a) => a.type === "chi" && a.use.some((t) => t.kind === "number" && t.rank === 5 && !t.isRedFive))).toBe(true);
    tamperCheck(s, ["chi"]);
  });

  it("use 순서만 바꾼 요청은 같은 합법 행동으로 인정된다", () => {
    const s = responseState("3m0m5m6m1379p1379s2z", "4m", 3, []);
    const chi = legalActions(s, 0).find((a) => a.type === "chi")!;
    expect(chi.type === "chi" && sameType(chi.use[0], chi.use[1])).toBe(false);
    const ctx = run(s);
    ctx.act({ type: "chi", use: chi.type === "chi" ? [chi.use[1], chi.use[0]] : [] });
    expect(ctx.conn.sent.some((m) => m.type === "error")).toBe(false);
    expect(ctx.state()).not.toBe(s);
  });
});
