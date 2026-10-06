# 21-1 웹 마감·결과·종료 UI 구현 (3단계 마무리 3번, code-writer)

커밋하지 않았고 server/core는 수정하지 않았다. 기존 318개 테스트는 수정 없이 통과했다(문구·구조 변경으로 깨진 것 없음).

## 변경 파일
- `packages/web/src/game/useCountdown.ts` (신규): `useSecondsLeft(at, clock)`. 주입 가능한 시계(now/setTimeout/clearTimeout)로 남은 초를 돌려준다. 갱신은 setInterval이 아니라 '남은 초가 줄어드는 시각'에 거는 setTimeout 체인이며 0초에 멈춘다. at이 막 바뀐 렌더에서도 낡은 값을 주지 않는다.
- `packages/web/src/components/TurnClock.tsx` (신규): 마감 카운트다운. 고정 영역(`.clock-slot`, 항상 같은 높이)에 그리고 deadlineAt이 없으면 빈 칸만 남긴다.
- `packages/web/src/game/messages.ts`: `URGENT_SECONDS`(10), `NEXT_ROUND_ESTIMATE_MS`(5000, '약'), `CLOCK_TEXT`, `ACK_TEXT`, `NEXT_ROUND_TEXT`, `RETRY_TEXT`. `RetryInfo.nextAt`, `ConnectionBanner.retry`(다음 시도 정보, 정적 `detail`은 그대로 유지).
- `packages/web/src/game/wsClient.ts`: `retry` 이벤트에 `nextAt`(= timers.now() + delay) 추가. 기존 동작 변경 없음.
- `packages/web/src/game/types.ts`: `GameController`에 `ackState`, `nextRoundAt`, `clock` 추가. `AckState` 타입.
- `packages/web/src/game/useServerGame.ts`: `nextRoundAt` 상태(국 종료 view 수신 시각 + 5초, 같은 국 종료 view 재수신은 처음 추정 유지), `ackState`(sending/accepted/none), `deadlineAt`을 연결됨 + 행동 미전송일 때만 노출, `clock` 노출. act가 `deadlineAt`을 지우던 줄을 삭제하고 노출 단계에서 숨긴다(서버 오류·응답 타임아웃으로 대기가 풀리면 같은 마감이 다시 보임).
- `packages/web/src/game/useLocalGame.ts`: 새 필드의 로컬 값(none, null, defaultTimers).
- `packages/web/src/components/BoardView.tsx`: `clock`(국 정보 안 고정 영역), `ackState` prop. ack 문구는 기존 응답 안내 영역(`response-slot`, 높이 예약됨)에 표시, 표시 중에는 쿠이가에시 안내를 숨겨 영역이 늘지 않게 한다.
- `packages/web/src/components/ResultModal.tsx`: `autoNext` prop(서버 모드, 게임 종료 전만). 푸터를 '다음 국 약 N초 후 자동 시작' + '결과 닫기'로 바꾼다. 로컬과 게임 종료(최종 결과 버튼)는 기존 그대로. 최종 순위에서 내 줄 강조(`ranking-me`).
- `packages/web/src/components/StatusStack.tsx`: `clock` prop, 재접속 배너가 다음 시도까지 남은 초를 카운트다운(0이 되면 '지금 다시 접속하는 중').
- `packages/web/src/App.tsx`: 헤더의 임시 `Countdown`(헤더 높이를 흔들던 것)과 `useTick` 삭제, TurnClock·ackState·autoNext·StatusStack clock 연결.
- `packages/web/src/styles.css`: `.clock-slot`/`.turn-clock`(min-width, tabular-nums, 강조), `.auto-next-row`, 모달 z-index 10 -> 60, 연결 배너 50 -> 70(모달 위에도 보임), 순위 목록 정리.
- 테스트: `packages/web/src/game/deadlineUx.test.tsx` 신규 33개.

## 타이머·플래그 해제 조건 표 (조건마다 테스트 있음)
| 대상 | 설정 | 해제 조건 |
|---|---|---|
| `useSecondsLeft` 타이머(마감 / 다음 국 / 재접속 배너 공통) | at이 null이 아닐 때 초 경계마다 1개 | at 변경(교체), at이 null, 0초 도달(다시 걸지 않음), clock 변경, 언마운트 |
| `deadlineAt` 노출 | view의 deadlineMs(수신 시각 + ms) | 마감 없는 새 view(자동 모드·응답 구간·마감 없음), 행동 전송(waitingAck), 연결이 connected가 아님. 서버 오류·응답 타임아웃으로 대기가 풀리면 다시 노출 |
| `nextRoundAt` | phase roundEnd view 수신 시 시각 + 5초 | roundEnd가 아닌 view, 연결 끊김(노출만 null, 복귀 후 같은 추정 유지). 같은 국 종료 view 재수신은 갱신하지 않음 |
| 결과 모달(서버) | roundOver && 미닫힘 | 새 국 view(roundEnd 아님), '결과 닫기', 나가기. 시간으로는 닫히지 않음(서버 view가 닫는다) |
| `ackState` sending | act 전송 | ack, 새 view, 서버 오류, 응답 타임아웃(10초), 연결 변경, leave |
| `ackState` accepted | 응답 구간 ack | 새 view, 응답 타임아웃, 서버 오류, 연결 변경, leave |
| 재접속 배너 카운트다운 | wsClient retry 이벤트의 nextAt | 재접속 성공(배너 소멸), closed, 남은 0초(문구 전환), 언마운트 |

## 항목별 결과
1. 마감 카운트다운: 내 턴 30초·응답 15초 모두 deadlineMs 기준. 10초 이하는 노란 배경 + `⚠` 아이콘 + '곧 마감' 문구. 0초는 '시간 종료 · 처리 중…'(서버가 자동 처리). 영역은 항상 예약, 숫자는 `min-width: 2ch` + tabular-nums, 카드 `min-width: 13.5em`. 헤더에서 대국 화면 안으로 옮겼다.
2. 결과 화면: 서버 모드는 '다음 국' 버튼 대신 카운트다운. 0이 되어도 view가 없으면 '다음 국을 기다리는 중…', 연결이 끊기면 '연결을 확인하는 중…'으로 구분(연결 배너는 모달 위(z-index 70)에 보임). '결과 닫기'를 남겼다: 모달이 헤더를 가려 view가 늦으면 나가기에 닿을 수 없기 때문이다. 새 국 view에서 자동 닫힘(실서버에서 모달 등장 후 5.0초에 닫힘 확인). 로컬의 '다음 국' 동작은 그대로.
3. 게임 종료: 나가기 화면 유지(회귀 테스트 통과). 가독성은 내 줄 강조(굵게 + 연한 배경), 목록 기호·들여쓰기 제거만 했다.
4. 응답 구간 표시: 내가 행동하면 '처리 중…', ack 후 '응답이 접수되었습니다 · 결과를 기다리는 중…'. 요청 문구의 '다른 플레이어 확인 중'은 쓰지 않았다(아래).
5. 재접속 배너: '재접속 시도 n/10회 · 다음 시도까지 N초'로 카운트다운. `detail` 정적 문구는 남겨 기존 테스트가 그대로 통과한다.
6. 모달 위치: 하단 액션 영역은 이미 본문 밖(flex 고정)이라 버튼은 항상 보였다. 실제 문제는 서버 모드의 sticky 헤더(z-index 40)가 모달(10)보다 위여서 키가 큰 모달의 제목을 가리는 것이었다(390px에서 `elementFromPoint`로 제목 hit=false 확인). 모달을 60, 연결 배너를 70으로 올려 해결(390x844, 390x600, 768에서 제목·버튼 모두 hit=true).

## 정보 누출 판단
- 서버는 누가 응답 대기 중인지 숨긴다(view에 `awaiting`·`ronEligible`·`responses` 없음). 이번 표시는 전부 '내가 보낸 행동'과 '내가 받은 view'에만 의존하고 다른 좌석 정보를 읽지 않는다.
- 문구를 '다른 플레이어 확인 중'이 아니라 '결과를 기다리는 중'으로 바꿨다. 내가 유일한 응답자일 때도 항상 같은 문구가 나오므로 일률적이긴 하지만, 문구가 타인의 대기를 단정하면 사실과 달라지기 때문이다. 테스트로 '다른 플레이어·상대 대기·누군가' 문구 부재를 확인한다.
- 타패 직후 최소 1초 응답 구간의 '진행 중' 미세 표시는 상대 쪽(내가 응답 대상이 아닌 좌석)에는 하지 않았다. 이유: (1) 응답 대상이 아닌 좌석은 구간이 끝날 때까지 view를 받지 못하므로(서버 README) 구간의 시작을 클라이언트가 알 방법이 없다. 상대 타패를 근거로 표시를 만들면 클라이언트가 추측해야 하고, 구간이 1초보다 길게 이어질 때 '표시가 계속 남는지'가 곧 '사람이 응답 대기 중'이라는 신호가 된다(README의 알려진 타이밍 정보와 같은 종류, 표시가 이를 강화함). (2) 내 행동 직후의 '처리 중…'은 내 행동에만 근거하므로 그대로 표시한다. 즉 구간 동안 내 타패 직후에는 일률적 표시가 나오고, 상대 타패 구간에는 표시가 없다.

## 브라우저 확인 (headless Edge + puppeteer-core, 실서버 8080: 턴 25초·응답 15초·봇 60ms·응답 구간 0.5초·다음 국 5초, vite 5173, 스크립트와 스크린샷 `$CLAUDE_JOB_DIR/tmp/pp/v21*.mjs`, `shots21/`)
- 390/768/1280px 각각 실서버 한 국 진행: 카운트다운이 25에서 1초씩 줄고 11초까지 일반, 10초부터 `⚠` + '곧 마감', 다음 턴에 다시 25. 카운트다운 카드 크기는 전 구간 동일(184x24), `.clock-slot` 높이 고정(27). 가로 넘침 없음(scrollWidth = 뷰포트 폭).
- 보드 높이가 한 번 13px 변했으나(577 -> 590) 원인은 상대 버림패가 둘째 줄로 넘어가는 기존 동작이며 응답 영역·카운트다운 영역은 변하지 않음을 확인.
- ack 표시 '처리 중…', '응답이 접수되었습니다…' 모두 관찰. 결과 모달: '다음 국 약 5초 -> 1초 후 자동 시작' 순서로 표시, 모달 등장 후 5.0초에 자동 닫힘(closedAfter 5020~5047ms), 푸터 버튼 hit=true.
- 키 큰 모달(본문을 DOM으로 늘림): 수정 전 제목 hit=false, 수정 후 true.
- 재접속 배너(390px): '시도 1/10 · 1초', '2/10 · 2초 -> 1초', '3/10 · 4초 -> 1초', '4/10 · 8초' 순서로 감소.
- 게임 종료 순위 화면(컴포넌트를 직접 렌더, 390/1280): 내 줄 강조 확인. 실서버로 게임 종료까지는 진행하지 않았다(시간).
- 서버·vite·headless Edge 모두 종료, 8080/5173 LISTENING 없음. `.tmpv`는 만들지 않았다. 사용자의 Edge(msedgewebview2 포함)는 건드리지 않았다.
- '다음 국을 기다리는 중…'(0초 이후)은 실서버 지연이 정확히 5초라 브라우저에서는 보지 못했고, 가짜 타이머 테스트로만 확인했다.

## 변이 확인 (모두 원복, sha256 일치)
12개 중 11개 검출, 1개 생존.
- 검출: 행동 후 마감 숨김 제거(3), 연결 끊김 시 마감 숨김 제거(1), 타이머 cleanup 삭제(4), 국 종료 view 재수신 시 추정 유지 제거(1), 끊김 시 nextRoundAt 숨김 제거(2), ackState accepted 제거(2), 게임 종료에도 자동 진행 푸터(1), 강조 임계 `<=` -> `<`(1), retry nextAt 누락(3), effect deps에서 at 제거(1), 0초에서 타이머 계속(3).
- 생존(등가): 새 view에서 `nextRoundAt`을 null로 지우는 줄. 컨트롤러가 `view.phase === "roundEnd"`일 때만 노출하고 다음 roundEnd에서는 `prev.view.phase`가 roundEnd가 아니면 새로 추정하므로 관찰 가능한 차이가 없다(이중 방어).

## 검증
- web tsc: 오류 없음
- `npm test -w @mahjong/web`: 20개 파일 351개 통과(기존 318 + 신규 33)
- `npm run build -w @mahjong/web`: 성공

## 알려진 한계
- '다음 국 약 N초'는 서버 `nextRoundDelayMs`(기본 5000)를 가정한 추정이며 서버 설정이 다르면 어긋난다(0초 이후는 '기다리는 중'으로 표시). 재접속으로 같은 국 종료 view를 다시 받으면 처음 추정을 유지하므로 이미 지난 시각일 수 있고 그 경우 곧바로 '기다리는 중'이 된다.
- 국 종료 모달 동안 헤더의 나가기는 모달에 가려진다(모달 z-index가 헤더 위). 필요하면 '결과 닫기' 후 헤더를 쓴다. 연결 배너의 나가기는 모달 위에 보인다.
- 상대 타패 직후 1초 구간에는 진행 표시가 없다(정보 누출 판단 참고).
- 마감 0초 이후 '처리 중' 문구는 서버가 마감 처리를 하기까지의 시계 편차(수신 시각 기준 계산) 때문에 몇백 ms 일찍/늦게 나올 수 있다.
- 게임 종료 화면은 실서버 종료까지 진행한 브라우저 확인을 하지 않았다.
- 표 항목 6 외의 알려진 UI 한계(배너가 보드를 가림, 알림 영역 레이아웃 이동 등)는 건드리지 않았다.
