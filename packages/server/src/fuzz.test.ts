import { afterEach, describe, expect, it, vi } from "vitest";
import { WebSocket } from "ws";
import { awaitingSeats, legalActions, type Action, type RandomFn, type Tile } from "@mahjong/core";
import {
  actionKey,
  createGameServer,
  createSession,
  immediateScheduler,
  parseClientMessage,
  RoomManager,
  type GameServerHandle,
  type ServerMessage,
} from "./index";
import { fakeConn, intIn, leakProblems, logSeed, pickOf, scale, seeded, sleep, until, baseSeed, type FakeConn } from "./test-utils";

// S-9 퍼즈: 프로토콜 / 행동 / 상태 순서. 모든 무작위는 시드 고정(실패 시 시드로 재현: FUZZ_SEED=n)

const OPEN = { maxViolations: 1e9, ratePerSecond: 1e9, rateBurst: 1e9 };
const NO_LIMIT = { turnTimeoutMs: Infinity, responseTimeoutMs: Infinity, disconnectedTimeoutMs: Infinity };

afterEach(() => {
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// 생성기
// ---------------------------------------------------------------------------

function randomTile(rng: RandomFn): Tile {
  const k = rng();
  if (k < 0.6) {
    const rank = intIn(rng, 1, 9) as 1;
    return { kind: "number", suit: pickOf(rng, ["man", "pin", "sou"] as const), rank, isRedFive: (rank as number) === 5 && rng() < 0.3 };
  }
  if (k < 0.85) return { kind: "wind", wind: pickOf(rng, ["east", "south", "west", "north"] as const) };
  return { kind: "dragon", dragon: pickOf(rng, ["white", "green", "red"] as const) };
}

const JUNK: unknown[] = [
  null, true, false, 0, -1, 1.5, 1e308, -1e308, Number.MAX_SAFE_INTEGER, 2 ** 53, 4, "", " ", "x".repeat(70), "x".repeat(5000),
  "한글", "\u0000", "\ud800", "__proto__", "constructor", [], [[]], {}, { a: 1 }, { __proto__: null }, [null], ["a", "b"],
];

function randomJson(rng: RandomFn, depth = 0): unknown {
  const r = rng();
  if (depth > 5 || r < 0.35) return pickOf(rng, JUNK);
  if (r < 0.65) return Array.from({ length: intIn(rng, 0, 4) }, () => randomJson(rng, depth + 1));
  const o: Record<string, unknown> = {};
  const keys = ["type", "roomId", "seatToken", "seq", "action", "name", "seat", "tile", "use", "riichi", "isRedFive", "kind", "x"];
  for (let i = intIn(rng, 0, 5); i > 0; i--) o[pickOf(rng, keys)] = randomJson(rng, depth + 1);
  return o;
}

function validMessage(rng: RandomFn): Record<string, unknown> {
  switch (intIn(rng, 0, 6)) {
    case 0: return { type: "join" };
    case 1: return { type: "join", roomId: "ABCD2345", name: "봇" };
    case 2: return { type: "rejoin", roomId: "ABCD2345", seatToken: "t".repeat(32) };
    case 3: return { type: "start" };
    case 4: return { type: "ping" };
    case 5: return { type: "action", seq: intIn(rng, 0, 9), action: { type: "discard", tile: randomTile(rng), riichi: rng() < 0.5 } };
    default: return { type: "action", seq: intIn(rng, 0, 9), action: { type: pickOf(rng, ["chi", "pon"]), use: [randomTile(rng), randomTile(rng)] } };
  }
}

/** string = 텍스트 프레임, null = 바이너리 프레임 */
function genPayload(rng: RandomFn): string | null {
  switch (intIn(rng, 0, 9)) {
    case 0: return JSON.stringify(randomJson(rng));
    case 1: {
      const s = JSON.stringify(validMessage(rng));
      return s.slice(0, intIn(rng, 0, s.length - 1)); // 깨진 JSON
    }
    case 2: {
      const m = validMessage(rng);
      const keys = Object.keys(m);
      m[pickOf(rng, keys)] = pickOf(rng, JUNK);
      return JSON.stringify(m);
    }
    case 3: {
      const n = intIn(rng, 1, 1000); // 깊은 중첩 (길이 한도 2048 이내)
      return rng() < 0.5 ? "[".repeat(n) + "]".repeat(n) : '{"a":'.repeat(Math.min(n, 400)) + "1" + "}".repeat(Math.min(n, 400));
    }
    case 4: return JSON.stringify({ type: "join", name: "n".repeat(intIn(rng, 2000, 9000)) }); // 거대 값
    case 5: return null;
    case 6: return Array.from({ length: intIn(rng, 0, 40) }, () => String.fromCharCode(intIn(rng, 0, 0xffff))).join("");
    case 7: return '{"__proto__":{"polluted":1},"constructor":{"prototype":{"polluted":2}},"type":"ping"}';
    case 8: return JSON.stringify({ ...validMessage(rng), seat: intIn(rng, -3, 9), extra: randomJson(rng) });
    default: return pickOf(rng, ["", "null", "true", "123", '"join"', "[]", "{}", "{\"type\":null}", "{\"type\":[\"join\"]}"]);
  }
}

// ---------------------------------------------------------------------------
// 1. 프로토콜 퍼즈
// ---------------------------------------------------------------------------

describe("퍼즈: 프로토콜", () => {
  it("임의/깨진/거대/깊은 중첩/바이너리 입력: 예외 없음, 정의된 오류 코드만, 프로토타입 오염 없음", () => {
    const seed = baseSeed(1001);
    logSeed("protocol", seed);
    const rng = seeded(seed);
    const n = scale(3000, 40000);
    vi.useFakeTimers();
    const manager = new RoomManager({ game: { rng: seeded(seed), ...NO_LIMIT } });
    const conns: FakeConn[] = [];
    const sessions: ReturnType<typeof createSession>[] = [];
    let parsedOk = 0;
    for (let i = 0; i < n; i++) {
      const c = fakeConn();
      const s = createSession(manager, c, OPEN);
      conns.push(c);
      sessions.push(s);
      const payload = genPayload(rng);
      // 서버가 던지면 테스트가 바로 실패한다. 시드와 반복 번호를 메시지로 남긴다
      try {
        s.onMessage(payload);
        if (rng() < 0.3) s.onMessage(payload); // 중복 전송
      } catch (e) {
        throw new Error(`예외 누출 seed=${seed} i=${i} payload=${JSON.stringify(payload)?.slice(0, 200)}: ${String(e)}`);
      }
      if (typeof payload === "string" && parseClientMessage(payload).ok) parsedOk++;
      const problems = leakProblems(c.sent, {}, []);
      if (problems.length) throw new Error(`seed=${seed} i=${i}: ${problems.join("; ")}`);
      // 오류 응답은 오류 코드가 정의된 값이고, 잘못된 입력 하나당 오류는 정확히 1개
      if (payload === null || (typeof payload === "string" && !parseClientMessage(payload).ok)) {
        const errs = c.sent.filter((m): m is Extract<ServerMessage, { type: "error" }> => m.type === "error");
        expect(errs.every((e) => e.code === "bad_message")).toBe(true);
        expect(errs.length).toBeGreaterThan(0);
      }
    }
    expect(parsedOk).toBeGreaterThan(0);
    expect(Object.keys(Object.prototype)).toEqual([]);
    expect(({} as Record<string, unknown>).polluted).toBeUndefined();
    for (const s of sessions) s.onClose();
    expect(manager.connectionCount).toBe(0);
    manager.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("위반을 반복하는 연결은 끊긴다 (잘못된 입력만 / 유효 입력을 섞어도 위반이 우세하면)", () => {
    const seed = baseSeed(1002);
    logSeed("violations", seed);
    vi.useFakeTimers();
    const manager = new RoomManager({ game: { rng: seeded(seed), ...NO_LIMIT } });
    const rng = seeded(seed);
    for (let round = 0; round < scale(50, 500); round++) {
      const c = fakeConn();
      const s = createSession(manager, c, { ratePerSecond: 1e9, rateBurst: 1e9 });
      let sentAfterKill = -1;
      let invalidOnly = round % 2 === 0;
      for (let i = 0; i < 300 && !c.terminated; i++) {
        let p = genPayload(rng);
        const bad = p === null || !parseClientMessage(p).ok;
        // 잘못된 입력만 보내거나, 70%만 잘못된 입력으로 섞는다
        if (invalidOnly ? !bad : !bad && rng() < 0.6) p = null;
        s.onMessage(p);
      }
      expect(c.terminated).toBe(true);
      if (invalidOnly) expect(c.sent.length).toBeLessThanOrEqual(6); // 6번째 위반(한도 5 초과)에서 종료
      sentAfterKill = c.sent.length;
      s.onMessage(null);
      s.onMessage(JSON.stringify({ type: "ping" }));
      expect(c.sent.length).toBe(sentAfterKill); // 종료 후에는 아무 응답도 하지 않는다
      s.onClose();
      invalidOnly = !invalidOnly;
    }
    expect(manager.connectionCount).toBe(0);
    manager.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  it("속도 제한: 버스트를 넘기는 폭주는 종료", () => {
    vi.useFakeTimers();
    const manager = new RoomManager({ game: NO_LIMIT });
    const c = fakeConn();
    const s = createSession(manager, c, { rateBurst: 10, ratePerSecond: 1 });
    for (let i = 0; i < 100; i++) s.onMessage(JSON.stringify({ type: "ping" }));
    expect(c.terminated).toBe(true);
    s.onClose();
    manager.close();
    expect(vi.getTimerCount()).toBe(0);
  });

  describe("실제 ws", () => {
    let server: GameServerHandle | undefined;
    afterEach(async () => {
      await server?.close();
      server = undefined;
    });

    it("거대 프레임/바이너리/깨진 UTF-8/무작위 페이로드를 보내도 서버가 살아 있고 새 연결이 가능하다", async () => {
      const seed = baseSeed(1003);
      logSeed("protocol-ws", seed);
      const rng = seeded(seed);
      server = await createGameServer({ port: 0, session: { rateBurst: 1e9, ratePerSecond: 1e9 }, room: { game: { rng: seeded(seed), ...NO_LIMIT } } });
      const port = server.port;
      const open = async (): Promise<{ ws: WebSocket; got: string[]; closed: Promise<number> }> => {
        const ws = new WebSocket(`ws://127.0.0.1:${port}`);
        const got: string[] = [];
        ws.on("message", (d) => got.push(d.toString()));
        ws.on("error", () => {});
        const closed = new Promise<number>((r) => ws.once("close", (code) => r(code)));
        await new Promise<void>((res, rej) => {
          ws.once("open", () => res());
          ws.once("error", rej);
        });
        return { ws, got, closed };
      };
      const n = scale(40, 400);
      for (let i = 0; i < n; i++) {
        const { ws, got } = await open();
        const burst = intIn(rng, 1, 4);
        for (let j = 0; j < burst; j++) {
          const p = genPayload(rng);
          if (p === null) ws.send(Buffer.from([0xff, 0xfe, 0x00, intIn(rng, 0, 255)]));
          else ws.send(p);
        }
        if (i % 10 === 3) ws.send("x".repeat(20000)); // maxPayload 초과 -> 1009 종료
        if (i % 10 === 6) (ws as unknown as { _socket: { write(b: Buffer): void } })._socket.write(Buffer.from([0x81, 0x82, 0, 0, 0, 0, 0xff, 0xfe])); // 깨진 UTF-8 텍스트 프레임
        await sleep(2);
        expect(leakProblems(got, {}, [])).toEqual([]);
        ws.terminate();
        // 매 10번째마다 서버가 정상 동작하는지 확인
        if (i % 10 === 9) {
          const probe = await open();
          probe.ws.send(JSON.stringify({ type: "join" }));
          await until(() => probe.got.some((g) => g.includes('"joined"')), 3000, "probe joined");
          probe.ws.terminate();
        }
      }
      // 반복 위반 연결은 서버가 끊는다
      const v = await open();
      for (let i = 0; i < 30; i++) v.ws.send("{깨짐");
      const code = await Promise.race([v.closed, sleep(5000).then(() => -1)]);
      expect(code).not.toBe(-1);
      await until(() => server!.rooms.connectionCount === 0, 5000, "연결 정리");
    }, 60000);
  });
});

// ---------------------------------------------------------------------------
// 2. 행동 퍼즈 (전후 GameState 비교 + 독립 오라클)
// ---------------------------------------------------------------------------

describe("퍼즈: 행동", () => {
  function runActionFuzz(seed: number, steps: number): { accepted: number; rejected: number; ended: boolean } {
    const rng = seeded(seed);
    const manager = new RoomManager({ game: { rng: seeded(seed + 1), scheduler: immediateScheduler, ...NO_LIMIT } });
    const conns: FakeConn[] = [];
    const sessions: ReturnType<typeof createSession>[] = [];
    let roomId = "";
    for (let i = 0; i < 4; i++) {
      const c = fakeConn();
      const s = createSession(manager, c, OPEN);
      s.onMessage(JSON.stringify({ type: "join", ...(i > 0 && { roomId }) }));
      roomId = (c.sent[0] as { roomId: string }).roomId;
      conns.push(c);
      sessions.push(s);
    }
    sessions[0]!.onMessage(JSON.stringify({ type: "start" }));
    const game = manager.gameOf(manager.getRoom(roomId)!)!;
    const last = [-1, -1, -1, -1]; // 오라클이 따로 관리하는 좌석별 마지막 seq
    let prev: { s: number; raw: string } | undefined;
    let accepted = 0;
    let rejected = 0;
    let extra = 50;
    for (let step = 0; step < steps; step++) {
      const state = game.peekState()!;
      if (state.phase === "gameEnd" && --extra < 0) break;
      const awaiting = awaitingSeats(state);
      const s = awaiting.length > 0 && rng() < 0.6 ? pickOf(rng, awaiting) : intIn(rng, 0, 3);
      const otherSeat = (s + intIn(rng, 1, 3)) % 4;
      const nextSeq = last[s]! + 1 + intIn(rng, 0, 2);
      const own = legalActions(state, s);
      let msg: Record<string, unknown> = { type: "ping" };
      let raw: string | undefined;
      let actor: number = s;
      const roll = rng();
      if (roll < 0.4 && own.length > 0) msg = { type: "action", seq: nextSeq, action: pickOf(rng, own) };
      else if (roll < 0.5 && own.length > 0) msg = { type: "action", seq: nextSeq, action: { ...pickOf(rng, own), seat: otherSeat } }; // 좌석 위조(action 안)
      else if (roll < 0.58) msg = { type: "action", seq: nextSeq, seat: otherSeat, action: own.length ? pickOf(rng, own) : { type: "pass" } }; // 좌석 위조(최상위)
      else if (roll < 0.68) {
        const o = legalActions(state, otherSeat); // 남의 합법 행동을 내 이름으로
        msg = { type: "action", seq: nextSeq, action: o.length ? pickOf(rng, o) : { type: "pass" } };
      } else if (roll < 0.76) msg = { type: "action", seq: nextSeq, action: { type: "discard", tile: randomTile(rng), riichi: rng() < 0.3 } };
      else if (roll < 0.82) msg = { type: "action", seq: nextSeq, action: { type: pickOf(rng, ["tsumo", "ron", "pass", "kyuushu", "daiminkan"] as const) } };
      else if (roll < 0.86) msg = { type: "action", seq: nextSeq, action: { type: pickOf(rng, ["chi", "pon"] as const), use: [randomTile(rng), randomTile(rng)] } };
      else if (roll < 0.9) msg = { type: "action", seq: pickOf(rng, [last[s]!, last[s]! - 1, 0, last[s]! + 1000, last[s]! + 1001, last[s]! + 5000, -1, 1.5, 2 ** 53, 1e308, "7"]), action: own.length ? pickOf(rng, own) : { type: "pass" } };
      else if (roll < 0.95 && prev) {
        // 직전 메시지 중복 전송 (보낸 좌석은 달라질 수 있음)
        raw = prev.raw;
        actor = rng() < 0.5 ? prev.s : s;
      } else msg = { type: "action", seq: nextSeq, action: randomJson(rng) };
      raw ??= JSON.stringify(msg);

      // 오라클: core를 직접 사용해 기대 결과를 계산 (서버 코드 경로와 독립)
      const parsed = parseClientMessage(raw);
      let expected: string | null;
      if (!parsed.ok) expected = "bad_message";
      else if (parsed.message.type !== "action") expected = null;
      else {
        const { seq, action } = parsed.message;
        if (!(seq > last[actor]!) || seq > last[actor]! + 1000) expected = "bad_seq";
        else {
          last[actor] = seq;
          if (!awaiting.includes(actor)) expected = "not_your_turn";
          else {
            const wanted = actionKey({ ...action, seat: actor } as Action);
            expected = legalActions(state, actor).some((a) => actionKey(a) === wanted) ? null : "illegal_action";
          }
        }
      }

      const before = JSON.stringify(state);
      const sentBefore = conns.map((c) => c.sent.length);
      sessions[actor]!.onMessage(raw);
      prev = { s: actor, raw };
      const after = game.peekState()!;
      const errs = conns[actor]!.sent.slice(sentBefore[actor]!).filter((m) => m.type === "error");
      const ctx = `seed=${seed} step=${step} actor=${actor} raw=${raw.slice(0, 200)}`;
      if (expected) {
        rejected++;
        expect(errs.map((e) => (e as { code: string }).code), ctx).toEqual([expected]);
        expect(after, ctx).toBe(state); // 참조까지 동일
        expect(JSON.stringify(after), ctx).toBe(before); // 내용도 동일
      } else {
        accepted++;
        expect(errs, ctx).toEqual([]);
        expect(JSON.stringify(after), ctx).not.toBe(before);
      }
      // 오류는 요청한 연결에게만 간다
      conns.forEach((c, i) => {
        if (i !== actor) expect(c.sent.slice(sentBefore[i]!).some((m) => m.type === "error"), ctx).toBe(false);
      });
    }
    // 누출 검사: 모든 좌석이 받은 전체 메시지
    const tokens = conns.map((c) => (c.sent[0] as { seatToken: string }).seatToken);
    conns.forEach((c, i) => {
      expect(leakProblems(c.sent, { seat: i, token: tokens[i]! }, tokens), `seed=${seed} seat=${i}`).toEqual([]);
    });
    const ended = game.ended;
    manager.close();
    return { accepted, rejected, ended };
  }

  it("합법/불법/좌석 위조/seq 이상/중복을 섞어도 불법 행동은 상태를 바꾸지 못한다", () => {
    const base = baseSeed(2001);
    const seeds = scale(3, 25);
    let accepted = 0;
    let rejected = 0;
    for (let i = 0; i < seeds; i++) {
      logSeed("action", base + i);
      const r = runActionFuzz(base + i, scale(4000, 12000));
      accepted += r.accepted;
      rejected += r.rejected;
    }
    // 퍼즈가 두 경로를 모두 충분히 탔는지
    expect(accepted).toBeGreaterThan(100);
    expect(rejected).toBeGreaterThan(100);
  }, 240000);
});

// ---------------------------------------------------------------------------
// 3. 상태 순서 퍼즈
// ---------------------------------------------------------------------------

describe("퍼즈: 상태 순서", () => {
  function runOrderFuzz(seed: number, ops: number): { games: number; actionsApplied: number } {
    const rng = seeded(seed);
    vi.useFakeTimers();
    const manager = new RoomManager({ emptyRoomTtlMs: 3000, game: { rng: seeded(seed + 1) } }); // 기본 타이머 스케줄러 + 기본 시간 제한
    interface H {
      conn: FakeConn;
      session: ReturnType<typeof createSession>;
      closed: boolean;
      seq: number;
    }
    const hs: H[] = [];
    const seen = { rooms: [] as string[], tokens: [] as { roomId: string; token: string }[] };
    const note = (h: H): void => {
      for (const m of h.conn.sent) {
        if (m.type === "joined" && !seen.tokens.some((t) => t.token === m.seatToken)) {
          seen.tokens.push({ roomId: m.roomId, token: m.seatToken });
          if (!seen.rooms.includes(m.roomId)) seen.rooms.push(m.roomId);
        }
      }
    };
    const closeH = (h: H): void => {
      if (h.closed) return;
      h.closed = true;
      h.session.onClose();
    };
    const send = (h: H, m: unknown): void => {
      if (h.closed) return;
      h.session.onMessage(typeof m === "string" ? m : JSON.stringify(m));
    };
    const live = (): H[] => hs.filter((h) => !h.closed);
    const anyRoomId = (): string => (seen.rooms.length && rng() < 0.85 ? pickOf(rng, seen.rooms) : pickOf(rng, ["ZZZZZZZZ", "x", "ABCD2345"]));

    for (let i = 0; i < ops; i++) {
      const ctx = `seed=${seed} op=${i}`;
      const pool = live();
      const h = pool.length && rng() < 0.9 ? pickOf(rng, pool) : undefined;
      const roll = rng();
      try {
        if (!h || roll < 0.08) {
          const conn = fakeConn();
          const session = createSession(manager, conn, { ratePerSecond: 1e9, rateBurst: 1e9 });
          hs.push({ conn, session, closed: false, seq: 1 });
        } else if (roll < 0.22) {
          send(h, { type: "join", ...(rng() < 0.7 && { roomId: anyRoomId() }) });
        } else if (roll < 0.34) {
          const t = seen.tokens.length ? pickOf(rng, seen.tokens) : { roomId: "ZZZZZZZZ", token: "t".repeat(32) };
          const sameRoom = rng() < 0.7;
          send(h, { type: "rejoin", roomId: sameRoom ? t.roomId : anyRoomId(), seatToken: rng() < 0.9 ? t.token : "t".repeat(32) });
        } else if (roll < 0.42) {
          send(h, { type: "start" });
        } else if (roll < 0.64) {
          const found = manager.find(h.conn);
          const game = found && manager.gameOf(found.room);
          const st = game?.peekState();
          const legal = found && st ? legalActions(st, found.seat) : [];
          const action = legal.length && rng() < 0.7 ? pickOf(rng, legal) : { type: "pass" };
          h.seq += intIn(rng, 0, 3);
          send(h, { type: "action", seq: h.seq, action });
        } else if (roll < 0.68) {
          send(h, { type: "ping" });
        } else if (roll < 0.74) {
          send(h, genPayload(rng) ?? "");
        } else if (roll < 0.84) {
          closeH(h);
        } else {
          vi.advanceTimersByTime(pickOf(rng, [1, 40, 700, 1100, 4000, 12000, 31000]));
        }
      } catch (e) {
        throw new Error(`예외 누출 ${ctx}: ${String(e)}`);
      }
      // ws가 하듯: terminate된 연결은 곧 close 이벤트가 온다
      for (const x of hs) {
        note(x);
        if (x.conn.terminated) closeH(x);
      }
      // 불변식
      expect(manager.connectionCount, ctx).toBeLessThanOrEqual(hs.filter((x) => !x.closed).length);
      for (const id of seen.rooms) {
        const room = manager.getRoom(id);
        if (!room) continue;
        expect(room.connectedCount(), ctx).toBeLessThanOrEqual(4);
        room.seats.forEach((slot, si) => {
          if (slot.kind !== "human") return;
          const owner = hs.find((x) => x.conn === slot.conn);
          if (slot.connected) {
            expect(slot.conn !== undefined && owner !== undefined && !owner.closed, `${ctx} room=${id} seat=${si} 연결 표시된 좌석에 닫힌/없는 연결`).toBe(true);
          } else expect(slot.conn, ctx).toBeUndefined();
        });
      }
    }

    const games = seen.rooms.filter((id) => { const r = manager.getRoom(id); return r && manager.gameOf(r); }).length;
    const actionsApplied = hs.reduce((n, x) => n + x.conn.sent.filter((m) => m.type === "view").length, 0);
    // 정리: 전원 종료 -> TTL 경과 -> 방/연결/타이머 0
    for (const x of hs) closeH(x);
    for (const x of hs) note(x);
    expect(manager.connectionCount).toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(manager.roomCount, `seed=${seed}`).toBe(0);
    expect(vi.getTimerCount(), `seed=${seed} 타이머 잔존`).toBe(0);
    manager.close();

    // 누출: 연결별로 자기 토큰 외 토큰이 없고 금지 키/내부 정보가 없다
    const all = seen.tokens.map((t) => t.token);
    for (const x of hs) {
      const own = x.conn.sent.find((m): m is Extract<ServerMessage, { type: "joined" }> => m.type === "joined");
      expect(leakProblems(x.conn.sent, own ? { seat: own.seat, token: own.seatToken } : {}, all), `seed=${seed}`).toEqual([]);
    }
    return { games, actionsApplied };
  }

  it("join/rejoin/start/action/close/시간 경과를 임의 순서로 섞어도 예외 없음, 불변식 유지, 자원 0", () => {
    const base = baseSeed(3001);
    let games = 0;
    let views = 0;
    for (let i = 0; i < scale(6, 60); i++) {
      logSeed("order", base + i);
      const r = runOrderFuzz(base + i, scale(500, 2500));
      games += r.games;
      views += r.actionsApplied;
    }
    // 퍼즈가 실제 게임 진행 경로까지 탔는지
    expect(games).toBeGreaterThan(0);
    expect(views).toBeGreaterThan(100);
  }, 240000);
});
