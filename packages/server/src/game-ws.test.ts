import { afterEach, describe, expect, it } from "vitest";
import { WebSocket } from "ws";
import type { RandomFn } from "@mahjong/core";
import { createGameServer, immediateScheduler, timeoutScheduler, type GameServerHandle, type SeatView } from "./index";

// 실제 ws를 통한 통합 테스트: 클라이언트는 뷰의 legalActions만 보고 행동을 고른다

function mulberry32(seed: number): RandomFn {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

let server: GameServerHandle | undefined;
afterEach(async () => {
  await server?.close();
  server = undefined;
});

interface Client {
  ws: WebSocket;
  views: SeatView[];
  errors: { code: string; seq?: number }[];
  roomId: string;
  seat: number;
  /** 게임 종료 뷰를 받으면 resolve */
  done: Promise<void>;
  /** 첫 국 종료 뷰를 받으면 resolve */
  roundEnd: Promise<void>;
}

/** 스크립트 클라이언트: 뷰를 받을 때마다 불변식을 확인하고, 행동이 필요하면 legalActions 중 하나를 보낸다 */
async function connect(port: number, rng: RandomFn, roomId?: string, opts: { chaos?: boolean } = {}): Promise<Client> {
  const ws = new WebSocket(`ws://127.0.0.1:${port}`);
  const views: SeatView[] = [];
  const errors: Client["errors"] = [];
  let seq = 1;
  let lastKey = "";
  let resolveDone!: () => void;
  const done = new Promise<void>((r) => (resolveDone = r));
  let resolveRound!: () => void;
  const roundEnd = new Promise<void>((r) => (resolveRound = r));
  let joined!: (m: { roomId: string; seat: number }) => void;
  const joinedP = new Promise<{ roomId: string; seat: number }>((r) => (joined = r));

  const send = (m: unknown): void => ws.send(JSON.stringify(m));
  ws.on("message", (data) => {
    const msg = JSON.parse(data.toString());
    if (msg.type === "joined") return joined(msg);
    if (msg.type === "error") {
      errors.push({ code: msg.code, seq: msg.seq });
      return;
    }
    if (msg.type !== "view") return;
    const v = msg.view as SeatView;
    views.push(v);
    // 불변식: 점수 합 + 리치봉 = 100000, 상대 손패 미노출
    expect(v.players.reduce((a, p) => a + p.score, 0) + v.riichiSticks * 1000).toBe(100000);
    expect(v.players.every((p) => !("hand" in p))).toBe(true);
    expect(v.hand.length).toBe(v.players[v.seat]!.handCount);
    if (v.phase === "roundEnd" || v.phase === "gameEnd") expect(v.result).not.toBeNull();
    if (v.phase === "roundEnd") resolveRound();
    if (v.phase === "gameEnd") return resolveDone();
    if (opts.chaos) {
      // 합법 응답 앞뒤로 깨진/불법/seq 역전 입력을 섞는다
      const roll = rng();
      if (roll < 0.15) ws.send("{깨짐");
      else if (roll < 0.3) send({ type: "action", seq: seq++, action: { type: "discard", tile: { kind: "wind", wind: "east" }, seat: 3 } });
      else if (roll < 0.4) send({ type: "action", seq: 0, action: { type: "pass" } });
    }
    // 같은 결정 상황(손패+합법 행동+버림 수)에는 한 번만 응답
    const key = JSON.stringify([v.hand, v.legalActions, v.players.map((p) => p.discards.length), v.liveWallCount]);
    if (key !== lastKey && v.awaitingYou && v.legalActions.length > 0) {
      lastKey = key;
      const win = v.legalActions.find((a) => a.type === "tsumo" || a.type === "ron");
      const pick = win ?? v.legalActions[Math.floor(rng() * v.legalActions.length)]!;
      send({ type: "action", seq: seq++, action: pick });
    }
  });
  await new Promise<void>((res, rej) => {
    ws.once("open", () => res());
    ws.once("error", rej);
  });
  send({ type: "join", ...(roomId && { roomId }) });
  const j = await joinedP;
  return { ws, views, errors, roomId: j.roomId, seat: j.seat, done, roundEnd };
}

const TIMEOUT = 15000;

async function race(p: Promise<unknown>, ms = TIMEOUT): Promise<void> {
  let t: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([p, new Promise((_, rej) => (t = setTimeout(() => rej(new Error("시간 초과")), ms)))]);
  clearTimeout(t);
}

describe("게임 루프 ws 통합", () => {
  it("사람 1 + 봇 3: 뷰의 legalActions만으로 첫 국까지 진행 (타이머 스케줄러)", async () => {
    for (const seed of [1]) {
      server = await createGameServer({
        port: 0,
        session: { rateBurst: 1e9, ratePerSecond: 1e9 },
        room: { game: { rng: mulberry32(seed), scheduler: timeoutScheduler, botDelayMs: 0, responseWindowMs: 0, nextRoundDelayMs: 0 } },
      });
      const c = await connect(server.port, mulberry32(seed + 100));
      c.ws.send(JSON.stringify({ type: "start" }));
      // 타이머 스케줄러는 느리므로 첫 국 종료까지만 확인 (게임 끝까지는 아래 즉시 스케줄러 테스트)
      await race(c.roundEnd);
      expect(c.errors).toEqual([]);
      expect(c.views.some((v) => v.phase === "roundEnd")).toBe(true);
      c.ws.close();
      await server.close();
      server = undefined;
    }
  }, 20000);

  it("여러 시드 (즉시 스케줄러)", async () => {
    for (const seed of [3, 4, 5, 6]) {
      server = await createGameServer({
        port: 0,
        session: { rateBurst: 1e9, ratePerSecond: 1e9 },
        room: { game: { rng: mulberry32(seed), scheduler: immediateScheduler, turnTimeoutMs: Infinity, responseTimeoutMs: Infinity, disconnectedTimeoutMs: Infinity, botDelayMs: 0, responseWindowMs: 0, nextRoundDelayMs: 0 } },
      });
      const c = await connect(server.port, mulberry32(seed + 100));
      c.ws.send(JSON.stringify({ type: "start" }));
      await race(c.done);
      expect(c.errors).toEqual([]);
      expect(c.views.at(-1)!.phase).toBe("gameEnd");
      c.ws.close();
      await server.close();
      server = undefined;
    }
  }, 20000);

  it("사람 4명: 각자 자기 좌석 뷰만 받고 게임이 끝난다", async () => {
    server = await createGameServer({
      port: 0,
      session: { rateBurst: 1e9, ratePerSecond: 1e9 },
      room: { game: { rng: mulberry32(9), scheduler: immediateScheduler, turnTimeoutMs: Infinity, responseTimeoutMs: Infinity, disconnectedTimeoutMs: Infinity, } },
    });
    const first = await connect(server.port, mulberry32(11));
    const others = [];
    for (let i = 1; i < 4; i++) others.push(await connect(server.port, mulberry32(11 + i), first.roomId));
    const all = [first, ...others];
    expect(all.map((c) => c.seat)).toEqual([0, 1, 2, 3]);
    first.ws.send(JSON.stringify({ type: "start" }));
    await race(Promise.all(all.map((c) => c.done)));
    for (const c of all) {
      expect(c.errors).toEqual([]);
      expect(c.views.every((v) => v.seat === c.seat)).toBe(true);
    }
    all.forEach((c) => c.ws.close());
  });

  it("퍼즈: 깨진/불법/중복 seq 입력을 섞어도 서버가 죽지 않고 게임이 끝난다", async () => {
    for (const seed of [21, 22, 23]) {
      server = await createGameServer({
        port: 0,
        session: { rateBurst: 1e9, ratePerSecond: 1e9, maxViolations: 1e9 },
        room: { game: { rng: mulberry32(seed), scheduler: immediateScheduler, turnTimeoutMs: Infinity, responseTimeoutMs: Infinity, disconnectedTimeoutMs: Infinity, } },
      });
      const c = await connect(server.port, mulberry32(seed), undefined, { chaos: true });
      c.ws.send(JSON.stringify({ type: "start" }));
      await race(c.done);
      expect(c.errors.length).toBeGreaterThan(0);
      // 서버가 살아 있고 새 연결을 받는다
      const probe = await connect(server.port, mulberry32(1));
      probe.ws.close();
      c.ws.close();
      await server.close();
      server = undefined;
    }
  });

  it("불법 행동을 반복하면 위반 누적으로 연결이 종료된다", async () => {
    server = await createGameServer({
      port: 0,
      room: { game: { rng: mulberry32(1), scheduler: immediateScheduler, turnTimeoutMs: Infinity, responseTimeoutMs: Infinity, disconnectedTimeoutMs: Infinity, } },
    });
    const ws = new WebSocket(`ws://127.0.0.1:${server.port}`);
    await new Promise<void>((res) => ws.once("open", () => res()));
    const closed = new Promise<void>((r) => ws.once("close", () => r()));
    ws.on("error", () => {});
    ws.send(JSON.stringify({ type: "join" }));
    ws.send(JSON.stringify({ type: "start" }));
    // 순차 seq의 불법 행동(역 없는 화료)을 반복
    for (let i = 0; i < 20; i++) ws.send(JSON.stringify({ type: "action", seq: 1000 + i, action: { type: "tsumo" } }));
    await race(closed, 5000);
  });
});
