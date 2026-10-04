// 재접속용 세션 저장소. localStorage 접근은 모두 try/catch로 감싸 접근 불가여도 동작한다.
// 주의: seatToken은 좌석의 권한 그 자체이므로 콘솔·로그·URL 어디에도 출력하지 않는다.

export interface StoredSession {
  roomId: string;
  seatToken: string;
  /** 마지막으로 보낸 action seq */
  seq: number;
  serverUrl: string;
}

export interface SessionStore {
  load(): StoredSession | null;
  save(session: StoredSession): void;
  clear(): void;
}

/** localStorage 호환 최소 인터페이스 */
export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export const SESSION_STORAGE_KEY = "mahjong.session.v1";

function isStoredSession(v: unknown): v is StoredSession {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  return (
    typeof r.roomId === "string" &&
    r.roomId.length > 0 &&
    typeof r.seatToken === "string" &&
    r.seatToken.length > 0 &&
    typeof r.seq === "number" &&
    Number.isSafeInteger(r.seq) &&
    r.seq >= 0 &&
    typeof r.serverUrl === "string"
  );
}

/** storage를 주입하지 않으면 globalThis.localStorage를 (접근 시마다 안전하게) 사용한다 */
export function createLocalSessionStore(storage?: StorageLike, key: string = SESSION_STORAGE_KEY): SessionStore {
  const get = (): StorageLike | null => {
    try {
      return storage ?? (globalThis as { localStorage?: StorageLike }).localStorage ?? null;
    } catch {
      return null;
    }
  };
  return {
    load() {
      try {
        const raw = get()?.getItem(key);
        if (!raw) return null;
        const parsed: unknown = JSON.parse(raw);
        return isStoredSession(parsed)
          ? { roomId: parsed.roomId, seatToken: parsed.seatToken, seq: parsed.seq, serverUrl: parsed.serverUrl }
          : null;
      } catch {
        return null;
      }
    },
    save(session) {
      try {
        get()?.setItem(key, JSON.stringify(session));
      } catch {
        // 용량 초과/접근 불가: 재접속 복원만 포기하고 게임은 계속한다
      }
    },
    clear() {
      try {
        get()?.removeItem(key);
      } catch {
        // 무시
      }
    },
  };
}

/** 테스트/저장소 미사용용 메모리 구현 */
export function createMemorySessionStore(initial: StoredSession | null = null): SessionStore {
  let current = initial ? { ...initial } : null;
  return {
    load: () => (current ? { ...current } : null),
    save: (s) => {
      current = { ...s };
    },
    clear: () => {
      current = null;
    },
  };
}
