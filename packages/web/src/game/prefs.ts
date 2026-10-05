// 입장 화면 입력(이름·서버 주소)의 저장소. localStorage 접근 실패에도 동작한다.
import type { StorageLike } from "./sessionStore";

export interface EntryPrefs {
  name?: string;
  serverUrl?: string;
}

export interface PrefsStore {
  load(): EntryPrefs;
  save(prefs: EntryPrefs): void;
}

export const PREFS_STORAGE_KEY = "mahjong.entry.v1";

export function createLocalPrefsStore(storage?: StorageLike, key: string = PREFS_STORAGE_KEY): PrefsStore {
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
        if (!raw) return {};
        const v: unknown = JSON.parse(raw);
        if (typeof v !== "object" || v === null) return {};
        const r = v as Record<string, unknown>;
        return {
          ...(typeof r.name === "string" ? { name: r.name } : {}),
          ...(typeof r.serverUrl === "string" ? { serverUrl: r.serverUrl } : {}),
        };
      } catch {
        return {};
      }
    },
    save(prefs) {
      try {
        get()?.setItem(key, JSON.stringify(prefs));
      } catch {
        // 저장 실패는 무시
      }
    },
  };
}

export function createMemoryPrefsStore(initial: EntryPrefs = {}): PrefsStore {
  let cur = { ...initial };
  return { load: () => ({ ...cur }), save: (p) => void (cur = { ...p }) };
}
