// 로컬 게임 훅: App이 직접 쥐고 있던 상태(Session, 봇 진행 effect, 리치 모드, 시드 입력 등)를 동작 변경 없이 추출했다.
// 내부는 기존 controller(GameState)를 쓰고, 외부에는 viewFor(state, 0)의 SeatView로 노출한다.
import { useEffect, useMemo, useState } from "react";
import { defaultTimers } from "./wsClient";
import type { Action } from "@mahjong/core";
import {
  HUMAN_SEAT,
  advance,
  applyAction,
  autoPending,
  beginNextRound,
  humanActions,
  humanMustAct,
  isRoundOver,
  newSession,
  randomSeed,
  stepAuto,
  summarizeRound,
} from "../controller";
import type { Session } from "../controller";
import { viewFor } from "../model/seatView";
import type { GameController } from "./types";

export interface UseLocalGameOptions {
  initialSeed?: number;
  /** 봇 행동 사이 지연(ms). 0이면 지연 없음. 기본 450 */
  botDelayMs?: number;
  /** 이미 진행된 세션으로 시작 (테스트용). 지정하면 initialSeed는 시드 입력칸 표시에만 쓰인다 */
  initialSession?: Session;
}

export function useLocalGame({ initialSeed, botDelayMs = 450, initialSession }: UseLocalGameOptions = {}): GameController {
  const [session, setSession] = useState<Session>(
    () => initialSession ?? advance(newSession(initialSeed ?? randomSeed())),
  );
  const [delayOn, setDelayOn] = useState(botDelayMs > 0);
  const [riichiMode, setRiichiMode] = useState(false);
  const [showFinal, setShowFinal] = useState(false);
  const [seedInput, setSeedInput] = useState(initialSeed === undefined ? "" : String(initialSeed));

  const { state } = session;
  const delay = delayOn ? botDelayMs : 0;

  // 봇 진행: 지연이 있으면 한 걸음씩, 없으면 사람 차례까지 한 번에
  useEffect(() => {
    if (!autoPending(state)) return;
    if (delay <= 0) {
      setSession(advance(session));
      return;
    }
    const timer = setTimeout(() => {
      const next = stepAuto(session);
      if (next) setSession(next);
    }, delay);
    return () => clearTimeout(timer);
  }, [session, state, delay]);

  const over = isRoundOver(state);
  const gameOver = state.phase === "gameEnd";
  const view = useMemo(() => viewFor(state, HUMAN_SEAT), [state]);
  const actions: readonly Action[] = humanMustAct(state) ? humanActions(state) : [];

  const act = (action: Action) => {
    setRiichiMode(false);
    setSession(applyAction(session, action));
  };

  const newGame = () => {
    const parsed = Number.parseInt(seedInput, 10);
    const seed = seedInput.trim() !== "" && Number.isFinite(parsed) ? parsed >>> 0 : randomSeed();
    setRiichiMode(false);
    setShowFinal(false);
    setSession(newSession(seed));
  };

  const nextRound = () => {
    setRiichiMode(false);
    setSession(beginNextRound(session));
  };

  return {
    mode: "local",
    status: gameOver ? "ended" : "playing",
    mySeat: HUMAN_SEAT,
    view,
    actions,
    act,
    waitingAck: false,
    ackState: "none",
    riichiMode,
    toggleRiichi: () => setRiichiMode((m) => !m),
    roundOver: over,
    gameOver: over && gameOver,
    summary: over ? summarizeRound(state) : null,
    resultOpen: over && !(gameOver && showFinal),
    showFinal: over && gameOver && showFinal,
    advanceResult: gameOver ? () => setShowFinal(true) : nextRound,
    deadlineAt: null,
    nextRoundAt: null,
    clock: defaultTimers,
    notice: null,
    dismissNotice: () => {},
    error: null,
    errorCode: null,
    dismissError: () => {},
    log: session.log,
    seed: session.seed,
    seedInput,
    setSeedInput,
    botDelayOn: delayOn,
    setBotDelayOn: setDelayOn,
    nextRound,
    newGame,
  };
}
