import { describe, expect, it, vi } from "vitest";
import { createLocalSessionStore, createMemorySessionStore, type StorageLike } from "./sessionStore";

const S = { roomId: "ROOM1234", seatToken: "tok-secret-value", seq: 5, serverUrl: "ws://x" };

function memStorage(): StorageLike & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (k) => data.get(k) ?? null,
    setItem: (k, v) => void data.set(k, v),
    removeItem: (k) => void data.delete(k),
  };
}

describe("sessionStore", () => {
  it("저장/조회/삭제", () => {
    const store = createLocalSessionStore(memStorage());
    expect(store.load()).toBeNull();
    store.save(S);
    expect(store.load()).toEqual(S);
    store.clear();
    expect(store.load()).toBeNull();
  });

  it("손상된 값은 null", () => {
    const st = memStorage();
    const store = createLocalSessionStore(st, "k");
    st.data.set("k", "{not json");
    expect(store.load()).toBeNull();
    st.data.set("k", JSON.stringify({ roomId: "a", seatToken: "b", seq: -1, serverUrl: "u" }));
    expect(store.load()).toBeNull();
    st.data.set("k", JSON.stringify({ roomId: "a" }));
    expect(store.load()).toBeNull();
  });

  it("저장소 접근이 예외를 던져도 크래시하지 않는다", () => {
    const boom = (): never => {
      throw new Error("denied");
    };
    const store = createLocalSessionStore({ getItem: boom, setItem: boom, removeItem: boom });
    expect(() => store.save(S)).not.toThrow();
    expect(store.load()).toBeNull();
    expect(() => store.clear()).not.toThrow();
  });

  it("localStorage 속성 접근 자체가 예외여도 동작", () => {
    const spy = vi.spyOn(globalThis, "localStorage", "get").mockImplementation(() => {
      throw new Error("SecurityError");
    });
    const store = createLocalSessionStore();
    expect(() => store.save(S)).not.toThrow();
    expect(store.load()).toBeNull();
    spy.mockRestore();
  });

  it("기본 localStorage 사용 및 토큰 로그 출력 없음", () => {
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const store = createLocalSessionStore();
    store.save(S);
    expect(store.load()).toEqual(S);
    store.clear();
    for (const s of spies) {
      expect(JSON.stringify(s.mock.calls)).not.toContain(S.seatToken);
      s.mockRestore();
    }
  });

  it("메모리 구현은 복사본을 다룬다", () => {
    const store = createMemorySessionStore(S);
    const a = store.load()!;
    a.seq = 99;
    expect(store.load()!.seq).toBe(5);
  });
});
