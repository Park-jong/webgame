import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Session } from "./controller";
import { BoardView } from "./components/BoardView";
import { EntryForm, Lobby, ModeSelect } from "./components/OnlineEntry";
import { GameEndScreen, ResultModal } from "./components/ResultModal";
import { StatusStack } from "./components/StatusStack";
import { TurnClock } from "./components/TurnClock";
import {
  DEFAULT_NAME,
  entryPlan,
  errorText,
  validateName,
  validateRoomId,
  validateServerUrl,
} from "./game/entry";
import { createLocalPrefsStore } from "./game/prefs";
import type { PrefsStore } from "./game/prefs";
import type { GameController, ServerGameController } from "./game/types";
import { useLocalGame } from "./game/useLocalGame";
import { useServerGame } from "./game/useServerGame";
import type { UseServerGameOptions } from "./game/useServerGame";
import { getServerUrl } from "./game/wsClient";

export type AppMode = "select" | "local" | "online";

export interface AppProps {
  initialSeed?: number;
  /** 봇 행동 사이 지연(ms). 0이면 지연 없음. 기본 450 */
  botDelayMs?: number;
  /** 이미 진행된 세션으로 시작 (테스트용). 지정하면 initialSeed는 시드 입력칸 표시에만 쓰인다 */
  initialSession?: Session;
  /**
   * 서버 모드 여부 (모드 선택 화면을 건너뛴다). true면 온라인, false면 로컬.
   * 지정하지 않으면: URL 쿼리 ?online=1 → 온라인, initialSeed/initialSession 지정 → 로컬, 그 외 → 모드 선택 화면
   */
  online?: boolean;
  /** 서버 모드 훅 옵션 (테스트/개발용) */
  serverOptions?: UseServerGameOptions;
  /** 입장 화면 입력(이름·서버 주소) 저장소 (기본 localStorage) */
  prefsStore?: PrefsStore;
}

/** 온라인 선택 단축: URL에 ?online=1 이 있으면 서버 모드 */
export function isOnlineRequested(search: string = typeof window === "undefined" ? "" : window.location.search): boolean {
  const v = new URLSearchParams(search).get("online");
  return v === "1" || v === "true";
}

function initialMode(p: AppProps): AppMode {
  if (p.online !== undefined) return p.online ? "online" : "local";
  if (isOnlineRequested()) return "online";
  if (p.initialSeed !== undefined || p.initialSession !== undefined) return "local";
  return "select";
}

export function App(props: AppProps) {
  const { initialSeed, botDelayMs, initialSession, serverOptions, prefsStore } = props;
  const [startedAs] = useState<AppMode>(() => initialMode(props));
  const [mode, setMode] = useState<AppMode>(startedAs);
  const prefs = useMemo(() => prefsStore ?? createLocalPrefsStore(), [prefsStore]);
  // 모드 선택 화면에서 시작한 경우에만 '처음으로'를 보여 준다
  const onBack = startedAs === "select" ? () => setMode("select") : undefined;

  // 훅 호출 순서가 바뀌지 않도록 모드별 컴포넌트로 나눈다
  if (mode === "select") return <ModeSelect onLocal={() => setMode("local")} onOnline={() => setMode("online")} />;
  return mode === "online" ? (
    <ServerApp options={serverOptions} prefs={prefs} onBack={onBack} />
  ) : (
    <LocalApp
      {...(initialSeed !== undefined ? { initialSeed } : {})}
      {...(botDelayMs !== undefined ? { botDelayMs } : {})}
      {...(initialSession !== undefined ? { initialSession } : {})}
      onBack={onBack}
    />
  );
}

function LocalApp(props: { initialSeed?: number; botDelayMs?: number; initialSession?: Session; onBack: (() => void) | undefined }) {
  const { onBack, ...gameProps } = props;
  const c = useLocalGame(gameProps);
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
        {onBack && (
          <button type="button" onClick={onBack}>
            처음으로
          </button>
        )}
      </header>
      <GameScreen controller={c} onNewGame={() => c.newGame?.()} />
    </div>
  );
}

/** 컨트롤러가 주는 view만으로 대국 화면과 결과 모달을 그린다 (로컬/서버 공통) */
export function GameScreen({ controller: c, onNewGame }: { controller: GameController; onNewGame: () => void }) {
  if (c.view === null) return null;
  const server = c.mode === "server";
  return (
    <>
      <BoardView
        view={c.view}
        actions={c.actions}
        riichiMode={c.riichiMode}
        onToggleRiichi={c.toggleRiichi}
        onAction={c.act}
        log={c.log}
        ackState={c.ackState}
        {...(server ? { clock: <TurnClock deadlineAt={c.deadlineAt} clock={c.clock} /> } : {})}
      />
      {c.showFinal && (
        <GameEndScreen
          scores={c.view.players.map((p) => p.score)}
          onNewGame={onNewGame}
          mySeat={c.mySeat}
          {...(server
            ? {
                actionLabel: "나가기 (입장 화면으로)",
                note: "온라인 대전에는 새 게임이 없습니다. 나가기를 누른 뒤 새 방을 만들거나 방 ID로 입장해 주세요.",
              }
            : {})}
        />
      )}
      {c.resultOpen && c.summary && (
        <ResultModal
          summary={c.summary}
          onNext={c.advanceResult}
          mySeat={c.mySeat}
          {...(server ? { autoNext: { at: c.nextRoundAt, clock: c.clock } } : {})}
        />
      )}
    </>
  );
}

// ---------------------------------------------------------------------------
// 서버 모드: 입장 폼 -> 대기실 -> 대국
// ---------------------------------------------------------------------------

interface JoinIntent {
  kind: "create" | "join";
  roomId?: string;
  name: string;
}

interface SessionConfig {
  /** 이 세션(소켓)이 연결하는 서버 주소. 바뀌면 새 세션(훅)으로 교체한다 */
  url: string;
  /** 새 세션이 마운트되자마자 보낼 입장 요청 (서버 주소를 바꾼 직후) */
  intent: JoinIntent | null;
  key: number;
}

function ServerApp({ options, prefs, onBack }: { options: UseServerGameOptions | undefined; prefs: PrefsStore; onBack: (() => void) | undefined }) {
  // 입력은 훅(세션)보다 위에 둔다: 서버 주소 교체로 세션이 다시 만들어지거나 오류가 나도 입력이 유지된다
  const [initial] = useState(() => {
    const saved = prefs.load();
    const savedUrl = saved.serverUrl !== undefined && validateServerUrl(saved.serverUrl).ok ? saved.serverUrl : undefined;
    return {
      name: saved.name ?? options?.name ?? DEFAULT_NAME,
      url: options?.url ?? savedUrl ?? getServerUrl(),
    };
  });
  const [name, setName] = useState(initial.name);
  const [urlInput, setUrlInput] = useState(initial.url);
  const [roomInput, setRoomInput] = useState("");
  // 서버 주소 전환으로 이전 서버의 저장 세션을 지웠다는 안내 (세션이 교체돼도 유지)
  const [switchNote, setSwitchNote] = useState(false);
  const [config, setConfig] = useState<SessionConfig>({ url: initial.url, intent: null, key: 0 });

  return (
    <ServerSession
      key={config.key}
      config={config}
      options={options}
      prefs={prefs}
      onBack={onBack}
      form={{ name, setName, urlInput, setUrlInput, roomInput, setRoomInput, switchNote, setSwitchNote }}
      onChangeServer={(url, intent) => setConfig((p) => ({ url, intent, key: p.key + 1 }))}
    />
  );
}

interface FormState {
  name: string;
  setName: (v: string) => void;
  urlInput: string;
  setUrlInput: (v: string) => void;
  roomInput: string;
  setRoomInput: (v: string) => void;
  switchNote: boolean;
  setSwitchNote: (v: boolean) => void;
}

function ServerSession(props: {
  config: SessionConfig;
  options: UseServerGameOptions | undefined;
  prefs: PrefsStore;
  onBack: (() => void) | undefined;
  form: FormState;
  onChangeServer: (url: string, intent: JoinIntent) => void;
}) {
  const { config, options, prefs, onBack, form, onChangeServer } = props;
  const c: ServerGameController = useServerGame({
    ...options,
    url: config.url,
    // 서버 주소를 바꾸며 만든 세션은 저장된 세션 복원 없이 곧바로 입장 요청을 보낸다
    ...(config.intent ? { resumeStored: false } : {}),
  });
  const [errors, setErrors] = useState<{ name?: string; url?: string; room?: string }>({});

  // 마운트 직후 입장 요청 (훅의 연결 effect가 먼저 실행되므로 소켓이 준비되어 있다)
  useEffect(() => {
    const it = config.intent;
    if (!it) return;
    if (it.kind === "create") c.create(it.name);
    else c.join(it.roomId ?? "", it.name);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 세션당 한 번만
  }, []);

  const plan = entryPlan(c.status, c.roomId, c.joining);
  const { setSwitchNote } = form;
  // 서버 전환 안내는 닫기 또는 나가기 전까지 유지한다 (방에 입장해도 지우지 않는다)
  const leave = (): void => {
    setSwitchNote(false);
    c.leave();
  };
  // 헤더(sticky) 높이를 CSS 변수로 알려, 연결 배너가 헤더 '아래'에 뜨게 한다
  const appRef = useRef<HTMLDivElement>(null);
  const headerRef = useRef<HTMLElement>(null);
  useLayoutEffect(() => {
    const app = appRef.current;
    const header = headerRef.current;
    if (!app || !header) return;
    const measure = (): void => app.style.setProperty("--header-h", `${header.offsetHeight}px`);
    measure();
    window.addEventListener("resize", measure);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(header);
    return () => {
      window.removeEventListener("resize", measure);
      ro?.disconnect();
    };
  }, []);
  const resuming = plan.showConnecting && !c.joining;

  /** 이름·서버 주소(·방 ID)를 검증하고, 통과하면 저장 후 입장 요청을 보낸다. 실패해도 입력은 유지한다 */
  const submit = (kind: "create" | "join"): void => {
    const n = validateName(form.name);
    const u = validateServerUrl(form.urlInput);
    const r = kind === "join" ? validateRoomId(form.roomInput) : null;
    const next = {
      ...(n.ok ? {} : { name: n.message }),
      ...(u.ok ? {} : { url: u.message }),
      ...(r && !r.ok ? { room: r.message } : {}),
    };
    setErrors(next);
    if (!n.ok || !u.ok || (r && !r.ok)) return;
    prefs.save({ name: n.value, serverUrl: u.value });
    // 이전 서버의 저장 세션은 다른 서버로 보내지 않으므로, 새로 입장하는 순간 정리하고 알린다
    if (c.discardOtherServerSession(u.value)) form.setSwitchNote(true);
    const roomId = r && r.ok ? r.value : undefined;
    if (roomId !== undefined) form.setRoomInput(roomId);
    const intent: JoinIntent = { kind, name: n.value, ...(roomId !== undefined ? { roomId } : {}) };
    if (u.value !== config.url) {
      onChangeServer(u.value, intent);
      return;
    }
    if (kind === "create") c.create(n.value);
    else c.join(roomId ?? "", n.value);
  };

  const errorMessage = errorText(c.errorCode, c.error);

  return (
    <div className="app" ref={appRef}>
      <header className="app-header app-header-sticky" ref={headerRef}>
        <h1>리치마작 (온라인)</h1>
        <span className="seed-shown" data-testid="server-status">
          연결 상태: {plan.statusLabel}
          {c.roomId ? ` · 방 ${c.roomId}` : ""}
        </span>
        {c.roomId && plan.screen !== "lobby" && (
          <button type="button" onClick={leave}>
            나가기
          </button>
        )}
        {onBack && plan.screen === "entry" && !plan.showConnecting && (
          <button type="button" onClick={onBack}>
            처음으로
          </button>
        )}
      </header>
      <StatusStack
        clock={c.clock}
        connection={c.connection}
        notice={c.notice}
        onReconnect={c.reconnect}
        onDismissNotice={c.dismissNotice}
        switchNote={form.switchNote}
        onDismissSwitchNote={() => setSwitchNote(false)}
        {...(c.roomId !== null ? { onLeave: leave } : {})}
      />
      {errorMessage && (
        <div className="response-note" role="alert">
          {errorMessage}{" "}
          <button type="button" onClick={c.dismissError}>
            닫기
          </button>
        </div>
      )}

      {plan.screen === "entry" && (
        <>
          {plan.showConnecting && (
            <div className="response-note" role="status">
              {resuming ? "이어서 접속 중…" : "서버에 연결 중…"}{" "}
              <button type="button" disabled={!plan.canLeave} onClick={leave}>
                {resuming ? "취소(나가기)" : "취소"}
              </button>
            </div>
          )}
          <EntryForm
            name={form.name}
            onNameChange={form.setName}
            urlInput={form.urlInput}
            onUrlChange={form.setUrlInput}
            roomInput={form.roomInput}
            onRoomChange={form.setRoomInput}
            canCreate={plan.canCreate}
            canJoin={plan.canJoin}
            onCreate={() => submit("create")}
            onJoin={() => submit("join")}
            errors={errors}
          />
        </>
      )}
      {plan.screen === "lobby" && c.roomId !== null && (
        <Lobby
          roomId={c.roomId}
          mySeat={c.mySeat}
          canStart={plan.canStart}
          canLeave={plan.canLeave}
          onStart={c.start}
          onLeave={leave}
        />
      )}
      {/* 재접속 중·연결 끊김 안내는 연결 배너가 맡는다 (인라인 문구를 두면 같은 말이 중복되고 보드가 밀린다) */}
      <GameScreen controller={c} onNewGame={leave} />
    </div>
  );
}
