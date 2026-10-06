// 화면 상단(헤더 아래)에 겹쳐 뜨는(레이아웃을 밀지 않는) 연결 배너와 알림.
// 컨트롤러가 가공한 connection/notice만 받는다 (view·roomId를 직접 판단하지 않는다).
import { useLayoutEffect, useRef } from "react";
import { NOTICE_TEXT, RETRY_TEXT, SERVER_SWITCH_NOTE } from "../game/messages";
import { useSecondsLeft } from "../game/useCountdown";
import type { Clock } from "../game/useCountdown";
import type { ConnectionBanner } from "../game/messages";
import type { GameNotice } from "../game/types";

/** 재접속 대기 안내: 다음 시도까지 남은 초를 카운트다운한다 */
function RetryDetail({ retry, clock }: { retry: { attempt: number; max: number; at: number }; clock: Clock }) {
  const left = useSecondsLeft(retry.at, clock);
  return (
    <p data-testid="retry-countdown">
      {left !== null && left > 0
        ? RETRY_TEXT.countdown(retry.attempt, retry.max, left)
        : RETRY_TEXT.trying(retry.attempt, retry.max)}
    </p>
  );
}

export interface StatusStackProps {
  /** 카운트다운 시계. 없으면 재접속 안내는 정적 문구 */
  clock?: Clock;
  connection: ConnectionBanner | null;
  notice: GameNotice | null;
  onReconnect: () => void;
  onDismissNotice: () => void;
  /** 방에서 나간다. 있으면 재접속 중/닫힘 배너 안에 '나가기'를 둔다 (헤더 버튼과 같은 동작) */
  onLeave?: () => void;
  /** 서버 주소 전환으로 이전 세션을 지웠다는 안내 (닫기 또는 나가기 전까지 유지) */
  switchNote?: boolean;
  onDismissSwitchNote?: () => void;
}

export function StatusStack({
  clock,
  connection,
  notice,
  onReconnect,
  onDismissNotice,
  onLeave,
  switchNote = false,
  onDismissSwitchNote,
}: StatusStackProps) {
  const ref = useRef<HTMLDivElement>(null);
  const visible = connection !== null || notice !== null || switchNote;
  // 배너(fixed)가 모달 제목을 가리지 않도록 배너 아래 가장자리를 CSS 변수로 알린다(모달 배경의 위쪽 여백이 사용)
  useLayoutEffect(() => {
    const el = ref.current;
    if (!visible || !el) return;
    const root = document.documentElement;
    const measure = (): void => root.style.setProperty("--overlay-top", `${Math.ceil(el.getBoundingClientRect().bottom)}px`);
    measure();
    const onResize = (): void => void requestAnimationFrame(measure);
    window.addEventListener("resize", onResize);
    const ro = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    ro?.observe(el);
    return () => {
      window.removeEventListener("resize", onResize);
      ro?.disconnect();
      root.style.removeProperty("--overlay-top");
    };
  }, [visible]);
  if (!visible) return null;
  return (
    <div className="status-stack" data-testid="status-stack" ref={ref}>
      {connection && (
        <div className={`status-card conn-${connection.kind}`} role="status" data-testid="connection-banner">
          <strong>{connection.title}</strong>
          {connection.retry && clock ? (
            <RetryDetail retry={connection.retry} clock={clock} />
          ) : (
            connection.detail && <p>{connection.detail}</p>
          )}
          {connection.action && (
            <button type="button" className="primary" onClick={onReconnect}>
              {connection.action.label}
            </button>
          )}
          {onLeave && (connection.kind === "reconnecting" || connection.kind === "closed") && (
            <button type="button" data-testid="banner-leave" onClick={onLeave}>
              나가기
            </button>
          )}
        </div>
      )}
      {switchNote && (
        <div className="status-card" role="status" data-testid="server-switch-note">
          <span>{SERVER_SWITCH_NOTE}</span>
          <button type="button" onClick={onDismissSwitchNote}>
            닫기
          </button>
        </div>
      )}
      {notice && (
        <div className={`status-card notice-${notice}`} role="status" data-testid="notice">
          <span>{NOTICE_TEXT[notice]}</span>
          {/* auto_mode는 행동하거나 재접속해야 풀린다: 닫아도 해제되지 않으므로 버튼을 주지 않는다 */}
          {notice === "timeout" && (
            <button type="button" onClick={onDismissNotice}>
              닫기
            </button>
          )}
        </div>
      )}
    </div>
  );
}
