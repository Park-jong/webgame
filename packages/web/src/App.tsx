import { useEffect, useState } from "react";
import type { Action } from "@mahjong/core";
import {
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
} from "./controller";
import type { Session } from "./controller";
import { Board } from "./components/Board";
import { GameEndScreen, ResultModal } from "./components/ResultModal";

export interface AppProps {
  initialSeed?: number;
  /** 봇 행동 사이 지연(ms). 0이면 지연 없음. 기본 450 */
  botDelayMs?: number;
  /** 이미 진행된 세션으로 시작 (테스트용). 지정하면 initialSeed는 시드 입력칸 표시에만 쓰인다 */
  initialSession?: Session;
}

export function App({ initialSeed, botDelayMs = 450, initialSession }: AppProps) {
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
  const actions = humanMustAct(state) ? humanActions(state) : [];

  const act = (action: Action) => {
    setRiichiMode(false);
    setSession(applyAction(session, action));
  };

  const startNewGame = () => {
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

  return (
    <div className="app">
      <header className="app-header">
        <h1>리치마작</h1>
        <label className="seed-field">
          시드
          <input
            type="text"
            inputMode="numeric"
            value={seedInput}
            placeholder="랜덤"
            onChange={(e) => setSeedInput(e.target.value)}
            aria-label="시드"
          />
        </label>
        <button type="button" onClick={startNewGame}>
          새 게임
        </button>
        <label className="delay-toggle">
          <input type="checkbox" checked={delayOn} onChange={(e) => setDelayOn(e.target.checked)} />
          봇 지연
        </label>
        <span className="seed-shown">현재 시드 {session.seed}</span>
      </header>

      <Board
        state={state}
        actions={actions}
        riichiMode={riichiMode}
        onToggleRiichi={() => setRiichiMode((m) => !m)}
        onAction={act}
        log={session.log}
      />

      {over && state.phase === "gameEnd" && showFinal && (
        <GameEndScreen scores={state.scores} onNewGame={startNewGame} />
      )}
      {over && !(state.phase === "gameEnd" && showFinal) && (
        <ResultModal
          summary={summarizeRound(state)}
          onNext={state.phase === "gameEnd" ? () => setShowFinal(true) : nextRound}
        />
      )}
    </div>
  );
}
