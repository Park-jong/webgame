# 21-2 웹 마감 검증 발견 수정 (code-writer)

범위: `packages/web/src/game/deadlineUx.test.tsx`, `useServerGame.integration.test.tsx`, 이 문서. 소스 동작 변경 없음, 커밋 없음.

## 1. resultDismissed 순환 테스트 (deadlineUx.test.tsx)
- 추가: "결과 닫기 상태는 국마다 순환한다" — 결과 열림 -> advanceResult(닫기) -> 같은 국 종료 view 재수신은 닫힘 유지 -> result 없는 새 국 view -> 다음 roundEnd에서 다시 열림, 한 번 더 반복.
- 변이: `useServerGame.ts:288`을 `resultDismissed: prev.resultDismissed`로 교체 -> 해당 테스트만 실패(1 failed / 33 passed). 원복 후 sha256 동일 (154440b3...0a21).

## 2. ack 전 문구 테스트 (deadlineUx.test.tsx)
- ack 전에 ack-note가 리터럴 '처리 중…'과 같고, '응답이 접수되었습니다'와 '다른 플레이어|상대 대기|누군가|확인 중'이 본문에 없음을 단언. (기존 단언은 상수 `ACK_TEXT.sending`과 비교해 상수 변경에 둔감했다.)
- 변이: `messages.ts` sending을 '다른 플레이어 확인 중…'으로 교체 -> 해당 테스트 실패(1 failed). 원복 후 sha256 동일 (94e37042...277b1).

## 3. 통합 테스트 안정화 (useServerGame.integration.test.tsx)
변경
- 진단 헬퍼 `diag`/`check`: 실패 메시지에 status, conn, error, view.phase, awaitingYou, actions 수, roundOver, waitingAck 포함.
- waitFor 타임아웃 8000 -> 20000, 15000 -> 30000.
- 내 행동 가능 대기 조건을 `roundOver || (actions>0 && view.awaitingYou)`로 강화해, 이후 view 불변식 단언(awaitingYou, actions>0)은 같은 스냅샷에서 읽는다.
- `act()` 직후 `waitingAck === true` 즉시 단언 제거(ack/view가 즉시 도착하면 이미 false일 수 있음). ack 해제 대기와 error null 확인은 진단 포함 `check`로.

재현·진단 결과
- 작업 트리의 수정 전 버전: 이 세션에서 전체 8회 병렬 부하 실행은 8/8 통과로 **재현되지 않았다**. 그래서 실패 원인(즉시 단언 타이밍/stale view/타임아웃)은 확정하지 못했고 후보로만 남는다. 위 변경은 세 후보를 모두 제거한다.
- 참고(부수 발견): HEAD(커밋된) 버전의 같은 테스트는 12회 병렬 실행에서 3회 실패했다. 원인은 서버 RNG로 국이 일찍 끝나 `acts >= 10` 고정 단언이 깨지는 것(acts 6, 8, 8). 작업 트리 버전은 이미 `acts >= 10 || roundOver`로 완화되어 있다. 즉 간헐 실패의 확인된 원인은 이 RNG 건이고, 21-1 시점에 별도로 보고된 실패가 이것과 같은 것인지는 알 수 없다.
- 안정화 후: 통합 테스트 단독 20회(10개씩 2배치 동시) 20/20 통과, 전체 `npm test -w @mahjong/web` 8회 병렬 8/8 통과(352 tests). 수정 전 버전 8회 병렬도 8/8 통과.
- 한계: 통과 횟수는 간헐 실패가 없다는 증명이 아니다. 재발 시 실패 메시지의 진단 줄을 보면 된다.

## 4. 참고: z-index 계층과 다음 국 추정 근거
z-index 계층 (`packages/web/src/styles.css`)
| 요소 | z-index | 위치 |
| --- | --- | --- |
| 헤더(`.app-header-sticky`) | 40 | styles.css:307 |
| 모달 배경(`.modal-backdrop`) | 60 | styles.css:171 |
| 연결·알림 배너(`.status-stack`) | 70 | styles.css:309 |
모달이 헤더 위, 배너가 모달 위에 보여야 한다. 새 오버레이를 추가하면 이 표 안에서 층을 정한다. 알려진 부작용: 재접속 배너가 결과 모달 제목을 가릴 수 있음(이월 항목, 마무리 4번 E2E에서 확인).

NEXT_ROUND_ESTIMATE_MS = 5_000 (`packages/web/src/game/messages.ts:209`)
- 근거: 서버 `packages/server/src/game-session.ts:70`의 `NEXT_ROUND_DELAY_MS = 5000`, 같은 파일 239행에서 `options.nextRoundDelayMs ?? NEXT_ROUND_DELAY_MS`로 기본값 사용.
- 서버가 시각을 보내지 않으므로 클라이언트는 국 종료 view 수신 시각 + 5초로 추정한다. 서버 옵션 `nextRoundDelayMs`를 바꾸거나 기본값이 달라지면 이 상수도 함께 바꿔야 한다. 새로고침 후에는 최대 약 5초 길게 표시될 수 있다(알려진 한계).

## 검증
- `npx tsc -p tsconfig.json --noEmit` (web) 통과, `npm test -w @mahjong/web` 통과, `npm run build -w @mahjong/web` 통과 (아래 최종 실행 기준).
