import { useEffect, useState } from "react";
import type { Session } from "./controller";
import { BoardView } from "./components/BoardView";
import { GameEndScreen, ResultModal } from "./components/ResultModal";
import type { GameController, ServerGameController } from "./game/types";
import { useLocalGame } from "./game/useLocalGame";
import { useServerGame } from "./game/useServerGame";
import type { UseServerGameOptions } from "./game/useServerGame";

export interface AppProps {
  initialSeed?: number;
  /** 봇 행동 사이 지연(ms). 0이면 지연 없음. 기본 450 */
  botDelayMs?: number;
  /** 이미 진행된 세션으로 시작 (테스트용). 지정하면 initialSeed는 시드 입력칸 표시에만 쓰인다 */
  initialSession?: Session;
  /** 서버 모드 여부. 기본은 URL 쿼리 ?online=1 일 때만 서버 모드, 아니면 로컬 모드 */
  online?: boolean;
  /** 서버 모드 훅 옵션 (테스트/개발용) */
  serverOptions?: UseServerGameOptions;
}

/** 개발용 진입: URL에 ?online=1 이 있으면 서버 모드 */
export function isOnlineRequested(search: string = typeof window === "undefined" ? "" : window.location.search): boolean {
  const v = new URLSearchParams(search).get("online");
  return v === "1" || v === "true";
}

export function App({ initialSeed, botDelayMs, initialSession, online, serverOptions }: AppProps) {
  const useOnline = online ?? isOnlineRequested();
  // 훅 호출 순서가 바뀌지 않도록 모드별 컴포넌트로 나눈다 (모드는 마운트 동안 고정)
  return useOnline ? (
    <ServerApp options={serverOptions} />
  ) : (
    <LocalApp
      {...(initialSeed !== undefined ? { initialSeed } : {})}
      {...(botDelayMs !== undefined ? { botDelayMs } : {})}
      {...(initialSession !== undefined ? { initialSession } : {})}
    />
  );
}

function LocalApp(props: { initialSeed?: number; botDelayMs?: number; initialSession?: Session }) {
  const c = useLocalGame(props);
  return (
    <div className="app">
      <header className="app-header">
        <h1>리치마작</h1>
        <label className="seed-field">
          시드
          <input
            type="text"
            inputMode="numeric"
            value={c.seedInput ?? ""}
            placeholder="랜덤"
            onChange={(e) => c.setSeedInput?.(e.target.value)}
            aria-label="시드"
          />
        </label>
        <button type="button" onClick={c.newGame}>
          새 게임
        </button>
        <label className="delay-toggle">
          <input type="checkbox" checked={c.botDelayOn ?? false} onChange={(e) => c.setBotDelayOn?.(e.target.checked)} />
          봇 지연
        </label>
        <span className="seed-shown">현재 시드 {c.seed}</span>
      </header>
      <GameScreen controller={c} onNewGame={() => c.newGame?.()} />
    </div>
  );
}

/** 컨트롤러가 주는 view만으로 대국 화면과 결과 모달을 그린다 (로컬/서버 공통) */
export function GameScreen({ controller: c, onNewGame }: { controller: GameController; onNewGame: () => void }) {
  if (c.view === null) return null;
  return (
    <>
      <BoardView
        view={c.view}
        actions={c.actions}
        riichiMode={c.riichiMode}
        onToggleRiichi={c.toggleRiichi}
        onAction={c.act}
        log={c.log}
      />
      {c.showFinal && (
        <GameEndScreen scores={c.view.players.map((p) => p.score)} onNewGame={onNewGame} mySeat={c.mySeat} />
      )}
      {c.resultOpen && c.summary && <ResultModal summary={c.summary} onNext={c.advanceResult} mySeat={c.mySeat} />}
    </>
  );
}

// ---------------------------------------------------------------------------
// 서버 모드 (개발용 최소 진입. 입장 화면은 W-7에서 만든다)
// ---------------------------------------------------------------------------

function ServerApp({ options }: { options: UseServerGameOptions | undefined }) {
  const c = useServerGame(options);
  return (
    <div className="app">
      <header className="app-header">
        <h1>리치마작 (온라인)</h1>
        <span className="seed-shown" data-testid="server-status">
          {STATUS_LABEL[c.status]}
          {c.roomId ? ` · 방 ${c.roomId}` : ""}
        </span>
        {c.deadlineAt !== null && <Countdown deadlineAt={c.deadlineAt} />}
        {c.roomId && (
          <button type="button" onClick={c.leave}>
            나가기
          </button>
        )}
      </header>
      {c.notice && (
        <div className="response-note" role="status">
          {c.notice === "auto_mode" ? "연속 시간 초과로 자동 진행 중입니다. 행동하면 해제됩니다." : "시간 초과로 자동 처리되었습니다."}{" "}
          <button type="button" onClick={c.dismissNotice}>
            확인
          </button>
        </div>
      )}
      {c.error && (
        <div className="response-note" role="alert">
          {c.error}{" "}
          <button type="button" onClick={c.dismissError}>
            닫기
          </button>
        </div>
      )}
      {(c.status === "idle" || (c.status === "closed" && c.roomId === null)) && <MinimalEntry controller={c} />}
      {c.status === "closed" && c.roomId !== null && (
        <p className="response-note" role="status">
          연결이 끊겼습니다. 나가기를 눌러 주세요
        </p>
      )}
      {c.status === "waiting" && (
        <div className="response-note">
          대기 중입니다. 방 ID {c.roomId} {" "}
          <button type="button" onClick={c.start}>
            시작
          </button>
        </div>
      )}
      <GameScreen controller={c} onNewGame={c.leave} />
    </div>
  );
}

const STATUS_LABEL: Record<GameController["status"], string> = {
  idle: "입장 전",
  connecting: "연결 중",
  reconnecting: "재접속 중",
  waiting: "대기",
  playing: "진행 중",
  ended: "게임 종료",
  closed: "연결 끊김",
};

function MinimalEntry({ controller: c }: { controller: ServerGameController }) {
  const [roomId, setRoomId] = useState("");
  return (
    <div className="response-note">
      <button type="button" onClick={() => c.create()}>
        방 만들기
      </button>{" "}
      <input value={roomId} onChange={(e) => setRoomId(e.target.value)} placeholder="방 ID" aria-label="방 ID" />
      <button type="button" disabled={roomId.trim() === ""} onClick={() => c.join(roomId.trim())}>
        입장
      </button>
    </div>
  );
}

function Countdown({ deadlineAt }: { deadlineAt: number }) {
  const [now, setNow] = useState(() => Date.now());
  useTick(setNow);
  return <span className="seed-shown">남은 시간 {Math.max(0, Math.ceil((deadlineAt - now) / 1000))}초</span>;
}

function useTick(setNow: (n: number) => void): void {
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 500);
    return () => clearInterval(id);
  }, [setNow]);
}
