import { afterEach, describe, expect, it, vi } from "vitest";
import { createFullTileSet, createGame, shuffleTiles, tileToString } from "@mahjong/core";

describe("secureRandom", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.doUnmock("node:crypto");
  });

  it("[0, 1) 범위의 값만 반환한다", async () => {
    const { secureRandom } = await import("./rng");
    for (let i = 0; i < 20000; i++) {
      const v = secureRandom();
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThan(1);
    }
  });

  it("경계 입력(전부 0x00, 전부 0xFF)에서도 [0, 1)을 벗어나지 않는다", async () => {
    vi.doMock("node:crypto", () => ({ randomBytes: (n: number) => Buffer.alloc(n, 0x00) }));
    const zero = await import("./rng");
    expect(zero.secureRandom()).toBe(0);

    vi.resetModules();
    vi.doMock("node:crypto", () => ({ randomBytes: (n: number) => Buffer.alloc(n, 0xff) }));
    const max = await import("./rng");
    const v = max.secureRandom();
    expect(v).toBeLessThan(1);
    expect(v).toBeGreaterThan(0.999999999);
  });

  it("crypto.randomBytes만 사용하고 Math.random은 호출하지 않는다", async () => {
    const spy = vi.spyOn(Math, "random");
    const { secureRandom } = await import("./rng");
    for (let i = 0; i < 100; i++) secureRandom();
    createGame(secureRandom);
    expect(spy).not.toHaveBeenCalled();
  });

  it("값이 균등하게 퍼진다 (10개 구간 모두 기대값 근처)", async () => {
    const { secureRandom } = await import("./rng");
    const N = 50000;
    const bins = new Array<number>(10).fill(0);
    for (let i = 0; i < N; i++) bins[Math.floor(secureRandom() * 10)]!++;
    // 기대 5000, 표준편차 약 67 — 6시그마 여유로 사실상 오탐이 없게 한다
    for (const c of bins) expect(Math.abs(c - N / 10)).toBeLessThan(400);
  });

  it("셔플 결과가 136장 순열을 유지하고 호출마다 달라진다", async () => {
    const { secureRandom } = await import("./rng");
    const base = createFullTileSet();
    const key = (ts: typeof base) => ts.map(tileToString).join(",");
    const sortedBase = base.map(tileToString).sort().join(",");

    const seen = new Set<string>();
    for (let i = 0; i < 20; i++) {
      const shuffled = shuffleTiles([...base], secureRandom);
      expect(shuffled).toHaveLength(136);
      expect(shuffled.map(tileToString).sort().join(",")).toBe(sortedBase);
      seen.add(key(shuffled));
    }
    expect(seen.size).toBe(20);
  });

  it("서로 다른 게임은 다른 배패를 받는다 (고정 시드가 아니다)", async () => {
    const { secureRandom } = await import("./rng");
    const hands = new Set<string>();
    for (let i = 0; i < 10; i++) {
      const g = createGame(secureRandom);
      hands.add(g.players[0]!.hand.map(tileToString).sort().join(","));
    }
    expect(hands.size).toBeGreaterThan(8);
  });
});
