// 내 행동 마감 카운트다운. 대국 화면 안의 고정 영역(항상 같은 높이·폭)에 그려 1초 갱신이 레이아웃을 흔들지 않는다.
// 컨트롤러가 가공한 deadlineAt/clock만 받는다. deadlineAt이 null이면 영역만 비워 둔다.
import { CLOCK_TEXT, URGENT_SECONDS } from "../game/messages";
import { useSecondsLeft } from "../game/useCountdown";
import type { Clock } from "../game/useCountdown";

export function TurnClock({ deadlineAt, clock }: { deadlineAt: number | null; clock: Clock }) {
  const left = useSecondsLeft(deadlineAt, clock);
  if (left === null) return <div className="turn-clock" data-testid="turn-clock-slot" aria-hidden="true" />;
  const expired = left <= 0;
  const urgent = !expired && left <= URGENT_SECONDS;
  // 색만으로 구분하지 않도록 아이콘과 문구를 함께 바꾼다
  return (
    <div
      className={`turn-clock${urgent ? " turn-clock-urgent" : ""}${expired ? " turn-clock-expired" : ""}`}
      role="timer"
      aria-live="off"
      data-testid="turn-clock"
    >
      {expired ? (
        <span>{`⌛ ${CLOCK_TEXT.expired}`}</span>
      ) : (
        <>
          <span aria-hidden="true">{urgent ? "⚠" : "⏱"}</span>
          <span>{CLOCK_TEXT.label}</span>
          <b className="turn-clock-num">{left}</b>
          <span>{CLOCK_TEXT.unit}</span>
          {urgent && <span className="turn-clock-warn">{CLOCK_TEXT.urgent}</span>}
        </>
      )}
    </div>
  );
}
