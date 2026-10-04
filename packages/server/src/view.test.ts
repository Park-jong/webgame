import { describe, expect, it } from "vitest";
import { awaitingSeats, createGame, decideAction, dispatch, legalActions, startNextRound } from "@mahjong/core";
import type { CalledMeld, GameState, Seat, Tile } from "@mahjong/core";
import type { ServerMessage } from "./index";
import { viewFor } from "./index";
import type { SeatView } from "./index";

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

const SEATS: Seat[] = [0, 1, 2, 3];
const east: Tile = { kind: "wind", wind: "east" };

// ---------------------------------------------------------------------------
// 키 허용 목록 스냅샷 (배열 인덱스는 []로 접는다)
// ---------------------------------------------------------------------------

function keyPaths(value: unknown, prefix = "", out = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const v of value) keyPaths(v, `${prefix}[]`, out);
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      const p = prefix === "" ? k : `${prefix}.${k}`;
      out.add(p);
      keyPaths(v, p, out);
    }
  }
  return out;
}

function tilePaths(prefix: string): string[] {
  return ["kind", "suit", "rank", "isRedFive", "wind", "dragon"].map((k) => `${prefix}.${k}`).concat(prefix);
}

const MELD_FIELDS = ["type", "tiles", "calledTile", "fromSeat", "from", "addedTile"];
function meldPaths(prefix: string): string[] {
  return [
    prefix,
    ...MELD_FIELDS.map((f) => `${prefix}.${f}`),
    ...tilePaths(`${prefix}.tiles[]`),
    ...tilePaths(`${prefix}.calledTile`),
    ...tilePaths(`${prefix}.addedTile`),
  ];
}

const ALLOWED_TOP_KEYS = [
  "awaitingYou",
  "dealer",
  "doraIndicators",
  "drawnTile",
  "furiten",
  "hand",
  "honba",
  "kuikae",
  "kyoku",
  "legalActions",
  "liveWallCount",
  "pending",
  "phase",
  "players",
  "result",
  "riichiSticks",
  "roundWind",
  "seat",
  "turn",
];

const ALLOWED_PATHS = new Set<string>([
  ...ALLOWED_TOP_KEYS,
  ...tilePaths("doraIndicators[]"),
  ...tilePaths("hand[]"),
  ...tilePaths("drawnTile"),
  // 쿠이가에시 금지패 (본인 차례 한정)
  ...tilePaths("kuikae[]"),
  // 합법 행동 (seat 포함)
  "legalActions[]",
  "legalActions[].type",
  "legalActions[].seat",
  "legalActions[].riichi",
  ...tilePaths("legalActions[].tile"),
  "legalActions[].use",
  ...tilePaths("legalActions[].use[]"),
  // 좌석 공개 정보
  "players[]",
  ...["seat", "seatWind", "score", "riichi", "handCount", "melds", "discards"].map((k) => `players[].${k}`),
  ...meldPaths("players[].melds[]"),
  "players[].discards[]",
  ...["tile", "riichi", "tsumogiri", "calledBy"].map((k) => `players[].discards[].${k}`),
  ...tilePaths("players[].discards[].tile"),
  // 응답 대기: ronEligible / responses 없음
  "pending.discarder",
  "pending.chankan",
  "pending.tile",
  ...tilePaths("pending.tile"),
  // 국 종료 결과
  ...["type", "wins", "tenpai", "reason", "deltas", "dealerContinues", "uraDoraIndicators", "nagashiMangan"].map((k) => `result.${k}`),
  "result.tenpai[]",
  "result.nagashiMangan[]",
  "result.deltas[]",
  ...tilePaths("result.uraDoraIndicators[]"),
  "result.wins[]",
  ...["seat", "from", "winningTile", "hand", "melds", "score"].map((k) => `result.wins[].${k}`),
  ...tilePaths("result.wins[].winningTile"),
  ...tilePaths("result.wins[].hand[]"),
  ...meldPaths("result.wins[].melds[]"),
  ...[
    "kind", "yaku", "yakuHan", "dora", "han", "fu", "basePoints", "limit", "yakumanCount", "isDealer", "payment", "total",
  ].map((k) => `result.wins[].score.${k}`),
  "result.wins[].score.yaku[]",
  ...["id", "name", "han"].map((k) => `result.wins[].score.yaku[].${k}`),
  ...["type", "fromDiscarder", "fromDealer", "fromEachNonDealer"].map((k) => `result.wins[].score.payment.${k}`),
]);

// ---------------------------------------------------------------------------
// 공통 검증 유틸
// ---------------------------------------------------------------------------

function collectObjects(value: unknown, out = new Set<object>()): Set<object> {
  if (typeof value === "object" && value !== null) {
    out.add(value);
    for (const v of Object.values(value)) collectObjects(v, out);
  }
  return out;
}

/** 허용 목록에 없는 키 경로를 첫 발견 즉시 반환 (할당 없이 가볍게) */
function firstDisallowed(value: unknown, prefix = ""): string | null {
  if (Array.isArray(value)) {
    for (const v of value) {
      const r = firstDisallowed(v, `${prefix}[]`);
      if (r) return r;
    }
  } else if (typeof value === "object" && value !== null) {
    for (const [k, v] of Object.entries(value)) {
      const p = prefix === "" ? k : `${prefix}.${k}`;
      if (!ALLOWED_PATHS.has(p)) return p;
      const r = firstDisallowed(v, p);
      if (r) return r;
    }
  }
  return null;
}

/** 뷰를 마구 변형해도 원본이 바뀌지 않아야 한다 */
function vandalize(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) vandalize(v);
    value.push("vandal");
    value.length = 0;
  } else if (typeof value === "object" && value !== null) {
    for (const k of Object.keys(value)) {
      const rec = value as Record<string, unknown>;
      vandalize(rec[k]);
      rec[k] = "vandal";
    }
  }
}

const FORBIDDEN_KEYS = ["liveWall", "deadWall", "seed", "rng", "ronEligible", "responses", "furitenTemp", "pendingKanDora", "firstDiscards", "options"];

interface Stats {
  views: number;
  response: number;
  riichi: number;
  kan: number;
  ended: number;
  endedByWin: number;
  exhaustive: number;
  withUra: number;
  meld: Record<"chi" | "pon" | "daiminkan" | "shouminkan" | "ankan", number>;
  kanDora: number;
}

function newStats(): Stats {
  return {
    views: 0, response: 0, riichi: 0, kan: 0, ended: 0, endedByWin: 0, exhaustive: 0, withUra: 0,
    meld: { chi: 0, pon: 0, daiminkan: 0, shouminkan: 0, ankan: 0 },
    kanDora: 0,
  };
}

/**
 * heavy=false: 가벼운 검사만 (키 허용 목록, 금지 키, 본인 손패/상대 장수, 상대 행동 미포함)
 * heavy=true: 전체 검사 (원본 대조, 불변, 참조 공유, 훼손)
 */
function checkInvariants(state: GameState, stats?: Stats, heavy = true): SeatView[] {
  const before = heavy ? structuredClone(state) : null;
  const stateObjects = heavy ? collectObjects(state) : null;
  const views = SEATS.map((s) => viewFor(state, s));
  if (before) expect(state).toEqual(before); // 불변

  if (!heavy) {
    views.forEach((v, seat) => {
      // 매 스텝 실행되므로 expect 대신 조건 분기 후 실패 시에만 expect로 상세 보고
      const bad = firstDisallowed(v);
      if (bad !== null) expect(bad).toBeNull();
      const json = JSON.stringify(v);
      for (const k of FORBIDDEN_KEYS) if (json.includes(`"${k}"`)) expect(json).not.toContain(`"${k}"`);
      if (JSON.stringify(v.hand) !== JSON.stringify(state.players[seat]!.hand)) expect(v.hand).toEqual(state.players[seat]!.hand);
      state.players.forEach((p, i) => {
        if (v.players[i]!.handCount !== p.hand.length) expect(v.players[i]!.handCount).toBe(p.hand.length);
      });
      for (const a of v.legalActions) if (a.seat !== seat) expect(a.seat).toBe(seat);
    });
    if (stats) countStats(state, views, stats);
    return views;
  }

  views.forEach((v, seat) => {
    // 구조: 키 허용 목록
    const extra = [...keyPaths(v)].filter((p) => !ALLOWED_PATHS.has(p));
    expect(extra).toEqual([]);
    const json = JSON.stringify(v);
    for (const k of FORBIDDEN_KEYS) expect(json).not.toContain(`"${k}"`);

    // 본인 정보
    expect(v.seat).toBe(seat);
    expect(v.hand).toEqual(state.players[seat]!.hand);
    expect(v.legalActions).toEqual(legalActions(state, seat));
    expect(v.awaitingYou).toBe(awaitingSeats(state).includes(seat));
    expect(v.liveWallCount).toBe(state.liveWall.length);
    expect(v.drawnTile).toEqual(state.phase === "turn" && state.turn === seat ? state.drawnTile : null);
    // 쿠이가에시: 본인 차례에만 core 값 그대로, 그 외에는 빈 배열
    expect(v.kuikae).toEqual(state.phase === "turn" && state.turn === seat ? state.kuikae : []);
    // 공개 정보
    expect(v.players).toHaveLength(4);
    v.players.forEach((p, i) => {
      expect(p.seat).toBe(i);
      expect(p.handCount).toBe(state.players[i]!.hand.length);
      expect(p.score).toBe(state.scores[i]);
      expect(p.riichi).toBe(state.players[i]!.riichi);
      expect(p.melds).toEqual(state.players[i]!.melds);
      expect(p.discards).toEqual(state.players[i]!.discards);
    });
    expect(v.phase).toBe(state.phase);
    expect(v.turn).toBe(state.turn);
    expect(v.dealer).toBe(state.dealer);
    expect(v.honba).toBe(state.honba);
    expect(v.riichiSticks).toBe(state.riichiSticks);
    expect(v.doraIndicators).toEqual(state.deadWall.slice(4, 4 + state.doraCount));
    if (state.phase === "response") {
      expect(v.pending).toEqual({
        discarder: state.pending!.discarder,
        tile: state.pending!.tile,
        ...(state.pending!.chankan !== undefined ? { chankan: state.pending!.chankan } : {}),
      });
      expect("chankan" in v.pending!).toBe(state.pending!.chankan !== undefined);
    } else {
      expect(v.pending).toBeNull();
    }
    // 상대 합법 행동은 포함되지 않는다: 오직 본인 좌석의 행동만
    for (const a of v.legalActions) expect(a.seat).toBe(seat);
    // 결과
    const ended = state.phase === "roundEnd" || state.phase === "gameEnd";
    expect(v.result === null).toBe(!ended);
    if (ended && v.result) {
      const r = state.result!;
      expect(v.result.deltas).toEqual(r.deltas);
      expect(v.result.type).toBe(r.type);
      expect(v.result.nagashiMangan).toEqual(r.nagashiMangan);
      expect("nagashiMangan" in v.result).toBe(r.nagashiMangan !== undefined);
      expect(v.result.wins).toHaveLength(r.wins.length);
      v.result.wins.forEach((w, i) => {
        expect(w.hand).toEqual(state.players[r.wins[i]!.seat]!.hand);
        expect(w.score).toEqual(r.wins[i]!.score);
      });
      const anyRiichiWin = r.wins.some((w) => state.players[w.seat]!.riichi);
      expect(v.result.uraDoraIndicators).toEqual(anyRiichiWin ? state.deadWall.slice(9, 9 + state.doraCount) : []);
    }
    // 참조 공유 없음
    for (const o of collectObjects(v)) expect(stateObjects!.has(o)).toBe(false);
  });

  if (stats) countStats(state, views, stats);

  // 뷰 객체를 훼손해도 원본은 그대로 (모든 검사 후 마지막에)
  views.forEach(vandalize);
  expect(state).toEqual(before);

  return views;
}

function countStats(state: GameState, views: SeatView[], stats: Stats): void {
  {
    stats.views += 4;
    if (state.phase === "response") stats.response++;
    if (state.players.some((p) => p.riichi)) stats.riichi++;
    if (state.players.some((p) => p.melds.some((m) => m.type === "ankan" || m.type === "daiminkan" || m.type === "shouminkan"))) stats.kan++;
    if (state.phase === "roundEnd" || state.phase === "gameEnd") {
      stats.ended++;
      if (state.result!.wins.length > 0) stats.endedByWin++;
      if (state.result!.type === "exhaustive") stats.exhaustive++;
      if (views[0]!.result!.uraDoraIndicators.length > 0) stats.withUra++;
    }
    for (const k of ["chi", "pon", "daiminkan", "shouminkan", "ankan"] as const) {
      if (state.players.some((p) => p.melds.some((m) => m.type === k))) stats.meld[k]++;
    }
    if (state.doraCount > 1) stats.kanDora++;
  }
}

// ---------------------------------------------------------------------------
// 기본 동작
// ---------------------------------------------------------------------------

describe("viewFor 기본", () => {
  const state = createGame(seeded(1));

  it("배분 직후: 본인 손패/상대 장수/도라/산패 장수", () => {
    const views = SEATS.map((s) => viewFor(state, s));
    views.forEach((v, seat) => {
      expect(v.hand).toEqual(state.players[seat]!.hand);
      expect(v.players.map((p) => p.handCount)).toEqual(state.players.map((p) => p.hand.length));
      expect(v.liveWallCount).toBe(state.liveWall.length);
      expect(v.doraIndicators).toHaveLength(1);
      expect(v.result).toBeNull();
    });
    // 친만 14장, 뽑은 패는 본인에게만
    expect(views[state.turn]!.drawnTile).toEqual(state.drawnTile);
    for (const s of SEATS.filter((x) => x !== state.turn)) expect(views[s]!.drawnTile).toBeNull();
    // 합법 행동은 차례인 좌석만
    expect(views[state.turn]!.legalActions.length).toBeGreaterThan(0);
    for (const s of SEATS.filter((x) => x !== state.turn)) expect(views[s]!.legalActions).toEqual([]);
  });

  it("좌석 범위를 벗어나면 던진다", () => {
    expect(() => viewFor(state, 4)).toThrow();
    expect(() => viewFor(state, -1)).toThrow();
    expect(() => viewFor(state, 1.5)).toThrow();
  });

  it("최상위 키 집합 스냅샷", () => {
    expect(Object.keys(viewFor(state, 0)).sort()).toEqual(ALLOWED_TOP_KEYS);
  });

  it("ServerMessage<SeatView>로 연결된다", () => {
    const msg: ServerMessage = { type: "view", view: viewFor(state, 0) };
    const msg2: ServerMessage<SeatView> = msg;
    expect(JSON.parse(JSON.stringify(msg2)).view.seat).toBe(0);
  });

  it("안깡은 선언 후 상대에게도 종류가 공개된다(정책)", () => {
    const ankan: CalledMeld = { type: "ankan", tiles: [east, east, east, east] };
    const withKan: GameState = {
      ...state,
      players: state.players.map((p, i) => (i === 1 ? { ...p, melds: [ankan] } : p)),
    };
    const v0 = viewFor(withKan, 0);
    expect(v0.players[1]!.melds).toEqual([ankan]);
    expect(v0.players[1]!.melds[0]).not.toBe(ankan);
    expect(v0.players[1]!.handCount).toBe(withKan.players[1]!.hand.length);
  });

  it("후리텐은 본인 것만: 임시 후리텐 플래그", () => {
    const flagged: GameState = { ...state, furitenTemp: [false, true, false, false] };
    expect(viewFor(flagged, 1).furiten).toBe(true);
    expect(viewFor(flagged, 0).furiten).toBe(false);
    expect(Object.keys(viewFor(flagged, 0).players[1]!)).not.toContain("furiten");
  });
});

// ---------------------------------------------------------------------------
// allowlist 회귀 방지
// ---------------------------------------------------------------------------

/** 모든 객체(타일/멜드/점수/행동 포함)에 가짜 비밀 필드를 주입한 사본 */
function inject(value: unknown): void {
  if (Array.isArray(value)) {
    for (const v of value) inject(v);
  } else if (typeof value === "object" && value !== null) {
    for (const v of Object.values(value)) inject(v);
    (value as Record<string, unknown>).secretFoo = "SECRET_VALUE";
  }
}

describe("allowlist 회귀 방지", () => {
  it("GameState에 가짜 필드를 주입해도 뷰에 나타나지 않는다 (진행 중/국 종료 모두)", () => {
    const rng = seeded(77);
    let state = createGame(rng);
    const snapshots: GameState[] = [state];
    for (let i = 0; i < 400 && (state.phase === "turn" || state.phase === "response"); i++) {
      const seat = awaitingSeats(state)[0]!;
      state = dispatch(state, decideAction(state, seat, rng));
      if (i % 7 === 0 || state.phase === "response") snapshots.push(state);
    }
    snapshots.push(state);
    for (const s of snapshots) {
      const polluted = structuredClone(s) as GameState;
      inject(polluted);
      for (const seat of SEATS) {
        const v = viewFor(polluted, seat);
        expect(v).toEqual(viewFor(s, seat));
        expect(JSON.stringify(v)).not.toContain("SECRET_VALUE");
        expect(JSON.stringify(v)).not.toContain("secretFoo");
      }
    }
  });

  it("뷰의 모든 키 경로는 허용 목록 안에 있다 (시뮬레이션 합집합이 부분집합)", () => {
    const seen = new Set<string>();
    for (let g = 0; g < 4; g++) {
      const rng = seeded(500 + g);
      let state = createGame(rng);
      for (let i = 0; i < 600 && state.phase !== "gameEnd"; i++) {
        if (state.phase === "roundEnd") state = startNextRound(state, rng);
        else state = dispatch(state, decideAction(state, awaitingSeats(state)[0]!, rng));
        for (const s of SEATS) keyPaths(viewFor(state, s), "", seen);
      }
    }
    const unexpected = [...seen].filter((p) => !ALLOWED_PATHS.has(p));
    expect(unexpected).toEqual([]);
    // 대표 경로가 실제로 관측됐는지(허용 목록이 죽은 목록이 아님)
    for (const p of ["hand[].kind", "players[].discards[].calledBy", "pending.discarder", "result.wins[].score.yaku[].id"]) {
      expect(seen.has(p)).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
// 국 종료 공개 범위
// ---------------------------------------------------------------------------

describe("국 종료 뷰", () => {
  // 국 종료 상태 모음 (여러 시드의 첫 몇 국), 한 번만 생성
  let ends: GameState[] | null = null;
  function allEnds(): GameState[] {
    if (ends) return ends;
    ends = [];
    const has = (f: (x: GameState) => boolean) => ends!.some(f);
    for (let seed = 1; seed <= 60; seed++) {
      // 필요한 유형(리치 화료/비리치 화료/유국)이 모두 모이면 중단
      if (
        has((x) => x.result!.wins.some((w) => x.players[w.seat]!.riichi)) &&
        has((x) => x.result!.type === "exhaustive")
      ) break;
      const rng = seeded(seed);
      let state = createGame(rng);
      for (let i = 0; i < 1500 && state.phase !== "gameEnd"; i++) {
        if (state.phase === "roundEnd") {
          ends.push(state);
          state = startNextRound(state, rng);
        } else {
          state = dispatch(state, decideAction(state, awaitingSeats(state)[0]!, rng));
        }
      }
      ends.push(state);
    }
    return ends;
  }

  function find(pick: (s: GameState) => boolean): GameState {
    const s = allEnds().find(pick);
    if (!s) throw new Error("조건에 맞는 국 종료를 찾지 못했습니다");
    return s;
  }

  it("화료: 화료자 손패/역/점수는 전원 공개, 비화료자 손패는 비공개", () => {
    const state = find((s) => s.result!.wins.length > 0);
    const r = state.result!;
    const winSeats = r.wins.map((w) => w.seat);
    for (const seat of SEATS) {
      const v = viewFor(state, seat);
      expect(v.result!.wins.map((w) => w.seat)).toEqual(winSeats);
      v.result!.wins.forEach((w, i) => {
        expect(w.hand).toEqual(state.players[w.seat]!.hand);
        expect(w.melds).toEqual(state.players[w.seat]!.melds);
        expect(w.winningTile).toEqual(r.wins[i]!.winningTile);
        expect(w.score.yaku.length).toBeGreaterThan(0);
        expect(w.score.total).toBe(r.wins[i]!.score.total);
      });
      // 화료자가 아닌 좌석의 손패는 본인 뷰의 hand 외에는 존재하지 않는다
      expect(v.hand).toEqual(state.players[seat]!.hand);
      expect(v.liveWallCount).toBe(state.liveWall.length);
    }
  });

  it("점수 뷰는 yakumanCount를 보존 (더블 역만 값)", () => {
    const state = find((s) => s.result!.wins.length > 0);
    const r = state.result!;
    const doubled: GameState = {
      ...state,
      result: {
        ...r,
        wins: r.wins.map((w, i) =>
          i === 0 ? { ...w, score: { ...w.score, limit: "yakuman", yakumanCount: 2, basePoints: 16000 } } : w,
        ),
      },
    };
    for (const seat of SEATS) {
      const w = viewFor(doubled, seat).result!.wins[0]!;
      expect(w.score.yakumanCount).toBe(2);
      expect(w.score).toEqual(doubled.result!.wins[0]!.score);
    }
  });

  it("뒷도라는 리치한 화료자가 있을 때만 공개", () => {
    const riichiWin = find((s) => s.result!.wins.some((w) => s.players[w.seat]!.riichi));
    expect(viewFor(riichiWin, 0).result!.uraDoraIndicators).toEqual(
      riichiWin.deadWall.slice(9, 9 + riichiWin.doraCount),
    );
    // 봇은 거의 리치로만 화료하므로, 화료자의 리치 플래그를 끈 사본으로 비리치 화료를 흉내 낸다
    const plainWin: GameState = {
      ...riichiWin,
      players: riichiWin.players.map((p) => ({ ...p, riichi: false })),
    };
    expect(viewFor(plainWin, 0).result!.uraDoraIndicators).toEqual([]);
  });

  it("유국: tenpai 배열만 공개되고 손패는 공개되지 않는다", () => {
    const state = find((s) => s.result!.type === "exhaustive");
    for (const seat of SEATS) {
      const v = viewFor(state, seat);
      expect(v.result!.wins).toEqual([]);
      expect(v.result!.tenpai).toEqual(state.result!.tenpai);
      expect(v.result!.uraDoraIndicators).toEqual([]);
      expect(v.liveWallCount).toBe(0);
    }
  });

  it("진행 중에는 result가 null", () => {
    const rng = seeded(3);
    let state = createGame(rng);
    for (let i = 0; i < 20; i++) {
      state = dispatch(state, decideAction(state, awaitingSeats(state)[0]!, rng));
      if (state.phase === "turn" || state.phase === "response") {
        for (const seat of SEATS) expect(viewFor(state, seat).result).toBeNull();
      }
    }
  });
});

// ---------------------------------------------------------------------------
// 시뮬레이션: 매 스텝 4좌석 뷰에 불변식 적용
// ---------------------------------------------------------------------------

/** 부로/깡을 가능하면 항상 하는 정책 (부로·깡 후 상태, 깡도라 공개 경로를 지나가기 위함) */
function aggressiveAction(state: GameState, seat: Seat, rng: () => number) {
  const legal = legalActions(state, seat);
  const prefer = (types: string[]) => types.map((t) => legal.find((a) => a.type === t)).find((a) => a !== undefined);
  if (state.phase === "response") return prefer(seat % 2 === 0 ? ["ron", "pon", "daiminkan", "chi"] : ["ron", "daiminkan", "pon", "chi"]) ?? decideAction(state, seat, rng);
  return prefer(["tsumo", "ankan", "shouminkan"]) ?? decideAction(state, seat, rng);
}

function simulate(
  seeds: number[],
  pick: (state: GameState, seat: Seat, rng: () => number) => ReturnType<typeof decideAction>,
  stats: Stats,
  maxRounds = Infinity,
): void {
  const meldCount = (s: GameState) => s.players.reduce((n, p) => n + p.melds.length, 0);
  for (const g of seeds) {
    const rng = seeded(g);
    let state = createGame(rng);
    checkInvariants(state, stats, true);
    let rounds = 0;
    for (let i = 1; i <= 2500 && state.phase !== "gameEnd"; i++) {
      const melds = meldCount(state);
      if (state.phase === "roundEnd") {
        checkInvariants(state, stats, true);
        if (++rounds >= maxRounds) return;
        state = startNextRound(state, rng);
      } else {
        state = dispatch(state, pick(state, awaitingSeats(state)[0]!, rng));
      }
      // 전체 검사는 일부 스텝/이벤트(멜드 수 변화, 국 종료)에서만, 가벼운 검사는 매 스텝
      const heavy =
        i % 25 === 0 || meldCount(state) !== melds || state.phase === "roundEnd" || state.phase === "gameEnd";
      checkInvariants(state, stats, heavy);
    }
    expect(state.phase).toBe("gameEnd");
  }
}

/** 시간 절약: 3개 시드는 게임 끝까지, 나머지는 앞의 2개 국만 진행 (시드는 총 20개) */
const BOT_FULL = [1000, 1001, 1002];
const BOT_SHORT = Array.from({ length: 17 }, (_, g) => 1003 + g);

describe("시뮬레이션 불변식", () => {
  it("봇 20개 시드 (3개는 게임 끝까지, 17개는 2개 국)", { timeout: 120_000 }, () => {
    const stats = newStats();
    const bot = (s: GameState, seat: Seat, rng: () => number) => decideAction(s, seat, rng);
    simulate(BOT_FULL, bot, stats);
    simulate(BOT_SHORT, bot, stats, 2);
    expect(stats.response).toBeGreaterThan(0);
    expect(stats.riichi).toBeGreaterThan(0);
    expect(stats.endedByWin).toBeGreaterThan(0);
    expect(stats.exhaustive).toBeGreaterThan(0);
    expect(stats.withUra).toBeGreaterThan(0);
  });

  it("부로/깡 우선 정책: 부로·깡 후 상태와 깡도라 공개까지", { timeout: 120_000 }, () => {
    const stats = newStats();
    simulate(Array.from({ length: 40 }, (_, g) => 2000 + g), aggressiveAction, stats, 3);
    expect(stats.meld.chi).toBeGreaterThan(0);
    expect(stats.meld.pon).toBeGreaterThan(0);
    expect(stats.meld.daiminkan).toBeGreaterThan(0);
    expect(stats.kanDora).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 부로 5종 직접 구성 + 무간섭
// ---------------------------------------------------------------------------

const man = (rank: number): Tile => ({ kind: "number", suit: "man", rank: rank as 1, isRedFive: false });
const pin = (rank: number): Tile => ({ kind: "number", suit: "pin", rank: rank as 1, isRedFive: false });
const redDragon: Tile = { kind: "dragon", dragon: "red" };

const MELDS: CalledMeld[] = [
  { type: "chi", tiles: [man(1), man(2), man(3)], calledTile: man(2), fromSeat: 3, from: "left" },
  { type: "pon", tiles: [pin(4), pin(4), pin(4)], calledTile: pin(4), fromSeat: 2, from: "across" },
  { type: "daiminkan", tiles: [east, east, east, east], calledTile: east, fromSeat: 0, from: "right" },
  { type: "shouminkan", tiles: [man(7), man(7), man(7), man(7)], calledTile: man(7), fromSeat: 3, from: "left", addedTile: man(7) },
  { type: "ankan", tiles: [pin(9), pin(9), pin(9), pin(9)] },
];

describe("가깡 직접 구성", () => {
  it("펑 후 4번째 패로 가깡: 선언 전후 모든 좌석 뷰가 불변식을 만족한다", () => {
    const base = createGame(seeded(5));
    const filler = [man(1), man(2), man(3), man(4), man(6), man(7), man(8), pin(1), pin(2), pin(3)];
    const ponMeld: CalledMeld = { type: "pon", tiles: [east, east, east], calledTile: east, fromSeat: 2, from: "across" };
    const state: GameState = {
      ...base,
      phase: "turn",
      turn: 0,
      pending: null,
      drawnTile: east,
      players: base.players.map((p, i) => (i === 0 ? { ...p, hand: [...filler, east], melds: [ponMeld] } : p)),
    };
    expect(legalActions(state, 0).some((a) => a.type === "shouminkan")).toBe(true);
    checkInvariants(state);
    const after = dispatch(state, { type: "shouminkan", seat: 0, tile: east });
    expect(after.players[0]!.melds[0]!.type).toBe("shouminkan");
    checkInvariants(after);
    expect(viewFor(after, 1).players[0]!.melds[0]!.type).toBe("shouminkan");
  });

  it("안깡: 선언 전후 뷰 불변식, 상대에게 종류 공개", () => {
    const base = createGame(seeded(6));
    const filler = [man(1), man(2), man(3), man(4), man(6), man(7), man(8), pin(1), pin(2), pin(3)];
    // 손패: filler 10장 + 동 4장 = 14장, 마지막 동이 뽑은 패
    const fixed: GameState = {
      ...base,
      phase: "turn",
      turn: 0,
      pending: null,
      drawnTile: east,
      players: base.players.map((p, i) => (i === 0 ? { ...p, hand: [...filler, east, east, east, east] } : p)),
    };
    expect(legalActions(fixed, 0).some((a) => a.type === "ankan")).toBe(true);
    checkInvariants(fixed);
    const after = dispatch(fixed, { type: "ankan", seat: 0, tile: east });
    expect(after.players[0]!.melds[0]!.type).toBe("ankan");
    checkInvariants(after);
    expect(viewFor(after, 2).players[0]!.melds[0]).toEqual({ type: "ankan", tiles: [east, east, east, east] });
  });
});

describe("부로 5종 구성 상태", () => {
  // 센티넬(붉은 용패)이 본인 손패/도라/행동에 없는 시작 상태를 고른다
  let base = createGame(seeded(1));
  for (let seed = 1; seed < 100; seed++) {
    base = createGame(seeded(seed));
    const mine = [
      ...base.players[0]!.hand,
      ...base.deadWall.slice(4, 5),
      ...legalActions(base, 0).flatMap((a) => ("tile" in a ? [a.tile] : [])),
    ];
    if (!mine.some((t) => t.kind === "dragon" && t.dragon === "red")) break;
  }
  const state: GameState = {
    ...base,
    players: base.players.map((p, i) =>
      i === 0
        ? p
        : {
            ...p,
            hand: p.hand.map(() => redDragon), // 상대 손패는 전부 센티넬
            melds: i === 1 ? [MELDS[0]!, MELDS[1]!, MELDS[2]!] : i === 2 ? [MELDS[3]!, MELDS[4]!] : [],
          },
    ),
    liveWall: base.liveWall.map(() => redDragon), // 산패도 센티넬
  };

  it("멜드 내부 필드까지 허용 목록 안이고 모든 필드가 관측된다", () => {
    const seen = new Set<string>();
    for (const seat of SEATS) {
      const v = viewFor(state, seat);
      keyPaths(v, "", seen);
      expect(v.players[1]!.melds).toEqual(state.players[1]!.melds);
      expect(v.players[2]!.melds).toEqual(state.players[2]!.melds);
    }
    expect([...seen].filter((p) => !ALLOWED_PATHS.has(p))).toEqual([]);
    for (const f of ["type", "tiles", "calledTile", "fromSeat", "from", "addedTile"]) {
      expect(seen.has(`players[].melds[].${f}`)).toBe(true);
    }
    expect(seen.has("players[].melds[].addedTile.rank")).toBe(true);
  });

  it("상대 손패/산패 센티넬이 어디에도 나타나지 않는다", () => {
    for (const seat of SEATS) {
      // 센티넬은 본인 손패에만 있을 수 있다 (여기서는 본인 손패를 제외하고 검사)
      const { hand: _own, ...rest } = viewFor(state, seat);
      expect(JSON.stringify(rest)).not.toContain('"dragon":"red"');
      expect(_own).toEqual(state.players[seat]!.hand);
    }
  });

  it("멜드/타일 어디에 가짜 필드를 주입해도 뷰에 나타나지 않는다", () => {
    const polluted = structuredClone(state) as GameState;
    inject(polluted);
    for (const seat of SEATS) {
      expect(viewFor(polluted, seat)).toEqual(viewFor(state, seat));
      expect(JSON.stringify(viewFor(polluted, seat))).not.toContain("secretFoo");
    }
  });
});

// ---------------------------------------------------------------------------
// 응답 대기 무간섭
// ---------------------------------------------------------------------------

describe("응답 대기 무간섭", () => {
  it("상대의 응답 가능 여부/손패가 달라져도 본인 뷰는 동일하다", () => {
    const rng = seeded(4242);
    let state = createGame(rng);
    let checked = 0;
    for (let i = 0; i < 600 && state.phase !== "gameEnd" && checked < 12; i++) {
      if (state.phase === "roundEnd") state = startNextRound(state, rng);
      else state = dispatch(state, aggressiveAction(state, awaitingSeats(state)[0]!, rng));
      if (state.phase !== "response" || !state.pending) continue;
      for (const x of state.pending.awaiting) {
        // x가 응답할 수 없는 상태: 대기/론 가능에서 제외하고, 손패는 다른 패로 교체, 임시 후리텐도 반전
        const b: GameState = {
          ...state,
          players: state.players.map((p, idx) => (idx === x ? { ...p, hand: p.hand.map(() => redDragon) } : p)),
          furitenTemp: state.furitenTemp.map((f, idx) => (idx === x ? !f : f)),
          pending: {
            ...state.pending,
            awaiting: state.pending.awaiting.filter((s) => s !== x),
            ronEligible: state.pending.ronEligible.filter((s) => s !== x),
          },
        };
        for (const me of SEATS.filter((s) => s !== x)) {
          const a = viewFor(state, me);
          const bv = viewFor(b, me);
          expect(bv.pending).toEqual(a.pending);
          expect(bv.awaitingYou).toBe(a.awaitingYou);
          expect(bv.legalActions).toEqual(a.legalActions);
          expect(bv.furiten).toBe(a.furiten);
          expect(bv).toEqual(a);
        }
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// 15-2: pending.chankan / result.nagashiMangan / kuikae
// ---------------------------------------------------------------------------

const sou = (rank: number): Tile => ({ kind: "number", suit: "sou", rank: rank as 1, isRedFive: false });
const JUNK_13 = [man(1), man(3), man(7), man(9), pin(1), pin(3), pin(7), pin(9), sou(1), sou(3), sou(7), sou(9), { kind: "wind", wind: "south" } as Tile];

/** 좌석 0이 5m을 버리고 좌석 2가 펑한 직후(좌석 2의 차례, 쿠이가에시 5m 금지) 상태 */
function afterPonState(): GameState {
  const base = createGame(seeded(1));
  const hands: Tile[][] = [
    [...JUNK_13, man(5)],
    JUNK_13,
    [man(5), man(5), man(7), pin(1), pin(3), pin(7), pin(9), sou(1), sou(3), sou(7), sou(9), { kind: "wind", wind: "west" }, { kind: "wind", wind: "north" }],
    JUNK_13,
  ];
  const s0: GameState = {
    ...base,
    phase: "turn",
    turn: 0,
    pending: null,
    drawnTile: man(5),
    kuikae: [],
    players: base.players.map((p, i) => ({ ...p, hand: hands[i]!, melds: [], discards: [], riichi: false })),
  };
  const afterDiscard = dispatch(s0, { type: "discard", seat: 0, tile: man(5) });
  const pon = legalActions(afterDiscard, 2).find((a) => a.type === "pon");
  if (!pon) throw new Error("펑 선택지가 없음");
  return dispatch(afterDiscard, pon);
}

describe("SeatView.kuikae (본인 차례 한정)", () => {
  const state = afterPonState();

  it("전제: 펑 직후 core state.kuikae가 5m이고 좌석 2의 합법 타패에서 5m이 빠져 있다", () => {
    expect(state.phase).toBe("turn");
    expect(state.turn).toBe(2);
    expect(state.kuikae).toEqual([man(5)]);
    const discards = legalActions(state, 2).flatMap((a) => (a.type === "discard" ? [a.tile] : []));
    expect(discards.length).toBeGreaterThan(0);
    expect(discards.some((t) => t.kind === "number" && t.suit === "man" && t.rank === 5)).toBe(false);
  });

  it("본인(차례 좌석)에게는 core state.kuikae와 같은 값이 나간다", () => {
    const v = viewFor(state, 2);
    expect(v.kuikae).toEqual(state.kuikae);
    expect(v.kuikae).not.toBe(state.kuikae);
    expect(v.kuikae[0]).not.toBe(state.kuikae[0]);
    // 금지패는 legalActions의 discard 후보와 겹치지 않는다
    for (const a of v.legalActions) {
      if (a.type === "discard") expect(v.kuikae.some((k) => k.kind === "number" && a.tile.kind === "number" && k.suit === a.tile.suit && k.rank === a.tile.rank)).toBe(false);
    }
  });

  it("다른 좌석에게는 빈 배열이다 (값이 어디에도 나타나지 않는다)", () => {
    for (const seat of SEATS.filter((s) => s !== 2)) {
      const v = viewFor(state, seat);
      expect(v.kuikae).toEqual([]);
    }
  });

  it("차례 좌석이어도 turn 단계가 아니면 빈 배열이다 (응답/국 종료)", () => {
    const resp: GameState = { ...state, phase: "response", pending: { discarder: 2, tile: man(1), awaiting: [], ronEligible: [], responses: [] } };
    for (const seat of SEATS) expect(viewFor(resp, seat).kuikae).toEqual([]);
    const ended: GameState = { ...state, phase: "roundEnd" };
    for (const seat of SEATS) expect(viewFor(ended, seat).kuikae).toEqual([]);
  });

  it("금지가 없는 보통 상태에서는 빈 배열이고, 타패 후 해제된다", () => {
    const fresh = createGame(seeded(2));
    for (const seat of SEATS) expect(viewFor(fresh, seat).kuikae).toEqual([]);
    const after = dispatch(state, legalActions(state, 2).find((a) => a.type === "discard")!);
    for (const seat of SEATS) expect(viewFor(after, seat).kuikae).toEqual([]);
  });
});

describe("SeatView.pending.chankan", () => {
  const base = createGame(seeded(1));
  const kanState = (chankan?: "shouminkan" | "ankan"): GameState => ({
    ...base,
    phase: "response",
    turn: 0,
    pending: {
      discarder: 0,
      tile: east,
      awaiting: [1],
      ronEligible: [1],
      responses: [],
      ...(chankan !== undefined ? { chankan } : {}),
    },
  });

  it("창깡 대기(가깡/안깡)면 전 좌석 뷰에 깡 종류가 나간다 (공개 정보)", () => {
    for (const kind of ["shouminkan", "ankan"] as const) {
      const s = kanState(kind);
      for (const seat of SEATS) {
        expect(viewFor(s, seat).pending).toEqual({ discarder: 0, tile: east, chankan: kind });
      }
    }
  });

  it("일반 버림패 응답에는 chankan 키 자체가 없다", () => {
    for (const seat of SEATS) {
      const p = viewFor(kanState(), seat).pending!;
      expect(p).toEqual({ discarder: 0, tile: east });
      expect("chankan" in p).toBe(false);
    }
  });

  it("응답 단계가 아니면 pending 전체가 null이다 (chankan 포함)", () => {
    const s: GameState = { ...kanState("ankan"), phase: "turn" };
    for (const seat of SEATS) expect(viewFor(s, seat).pending).toBeNull();
  });

  it("실제 가깡 선언을 core가 창깡 대기로 만들면 값이 일치한다 (론 가능 좌석이 있는 경우)", () => {
    // 좌석 1이 동 단기 대기(동 3장 펑 + 텐파이)가 되도록 구성: 좌석 0의 가깡 패를 론할 수 있다
    const ponMeld: CalledMeld = { type: "pon", tiles: [east, east, east], calledTile: east, fromSeat: 2, from: "across" };
    const filler = [man(1), man(2), man(3), man(4), man(6), man(7), man(8), pin(1), pin(2), pin(3)];
    const waiter = [man(1), man(2), man(3), pin(4), pin(5), pin(6), sou(7), sou(8), sou(9), sou(2), sou(3), sou(4), east];
    const s: GameState = {
      ...base,
      phase: "turn",
      turn: 0,
      pending: null,
      drawnTile: east,
      players: base.players.map((p, i) =>
        i === 0 ? { ...p, hand: [...filler, east], melds: [ponMeld] } : i === 1 ? { ...p, hand: waiter, melds: [] } : p,
      ),
    };
    const after = dispatch(s, { type: "shouminkan", seat: 0, tile: east });
    expect(after.phase).toBe("response");
    expect(after.pending!.chankan).toBe("shouminkan");
    for (const seat of SEATS) {
      expect(viewFor(after, seat).pending).toEqual({ discarder: 0, tile: east, chankan: "shouminkan" });
    }
  });
});

describe("RoundResultView.nagashiMangan", () => {
  const base = createGame(seeded(1));
  const ended = (nagashi?: Seat[]): GameState => ({
    ...base,
    phase: "roundEnd",
    result: {
      type: "exhaustive",
      wins: [],
      tenpai: [true, false, false, false],
      deltas: [-4000, 8000, -2000, -2000],
      dealerContinues: true,
      ...(nagashi !== undefined ? { nagashiMangan: nagashi } : {}),
    },
  });

  it("달성 좌석 목록이 core 결과와 같고 전 좌석에게 공개된다", () => {
    for (const nagashi of [[1], [1, 2]]) {
      const s = ended(nagashi);
      for (const seat of SEATS) {
        const r = viewFor(s, seat).result!;
        expect(r.nagashiMangan).toEqual(nagashi);
        expect(r.nagashiMangan).not.toBe(s.result!.nagashiMangan);
      }
    }
  });

  it("달성자가 없으면 키 자체가 없다 (core와 동일)", () => {
    for (const seat of SEATS) expect("nagashiMangan" in viewFor(ended(), seat).result!).toBe(false);
  });

  it("국 종료가 아니면 result가 null이라 노출되지 않는다", () => {
    const s: GameState = { ...ended([1]), phase: "turn" };
    for (const seat of SEATS) expect(viewFor(s, seat).result).toBeNull();
  });

  it("화료 결과에는 없다", () => {
    const win = ended();
    const rons: GameState = { ...win, result: { ...win.result!, type: "abortive", reason: "kyuushu" as never } };
    for (const seat of SEATS) expect("nagashiMangan" in viewFor(rons, seat).result!).toBe(false);
  });

  it("허용 경로 안에 있고 모든 필드가 관측된다", () => {
    const seen = new Set<string>();
    for (const seat of SEATS) keyPaths(viewFor(ended([1]), seat), "", seen);
    expect([...seen].filter((p) => !ALLOWED_PATHS.has(p))).toEqual([]);
    expect(seen.has("result.nagashiMangan")).toBe(true);
  });
});
