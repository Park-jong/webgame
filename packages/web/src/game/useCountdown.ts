// 절대 시각(at)까지 남은 초를 1초 단위로 돌려주는 훅. 시계는 주입할 수 있다(가짜 타이머 테스트).
// 갱신은 setInterval이 아니라 '남은 초가 줄어드는 시각'에 맞춘 setTimeout 체인이며, 0초에 도달하면 멈춘다.
import { useEffect, useState } from "react";
import type { Timers } from "./wsClient";

export type Clock = Pick<Timers, "now" | "setTimeout" | "clearTimeout">;

/** 남은 초 (올림, 0 이상) */
export function secondsUntil(at: number, now: number): number {
  return Math.max(0, Math.ceil((at - now) / 1000));
}

/**
 * at이 null이면 null. 아니면 남은 초.
 * 타이머 해제 조건: at 변경, clock 변경, 언마운트, 0초 도달(다시 걸지 않음)
 */
export function useSecondsLeft(at: number | null, clock: Clock): number | null {
  const [state, setState] = useState<{ at: number; left: number } | null>(null);

  useEffect(() => {
    if (at === null) {
      setState(null);
      return;
    }
    let handle: unknown = null;
    const tick = (): void => {
      handle = null;
      const remaining = at - clock.now();
      const left = Math.max(0, Math.ceil(remaining / 1000));
      setState((prev) => (prev !== null && prev.at === at && prev.left === left ? prev : { at, left }));
      if (left <= 0) return;
      // 남은 초가 한 칸 줄어드는 시각까지만 기다린다
      handle = clock.setTimeout(tick, Math.max(1, remaining - (left - 1) * 1000));
    };
    tick();
    return () => {
      if (handle !== null) clock.clearTimeout(handle);
      handle = null;
    };
  }, [at, clock]);

  if (at === null) return null;
  // effect가 돌기 전(at이 막 바뀐 렌더)에는 현재 시각으로 직접 계산해 낡은 값을 보이지 않는다
  return state !== null && state.at === at ? state.left : secondsUntil(at, clock.now());
}
