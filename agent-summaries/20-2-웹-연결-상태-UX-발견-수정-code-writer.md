# 20-2 웹 연결 상태 UX 발견 수정 (code-writer)

20-1 종합(feedback-synthesizer)의 수정 지시 1, 2, 3, 7, 5, 6번과 통합 테스트 acts 단언을 처리했다. 커밋하지 않았고 server/core는 수정하지 않았다.

## 변경 파일
- `packages/web/src/components/StatusStack.tsx`: `onLeave`, `switchNote`, `onDismissSwitchNote` prop. 재접속 중/닫힘 배너 안에 '나가기'(testid `banner-leave`), 서버 전환 안내를 고정 영역의 닫기 가능한 카드로 이동.
- `packages/web/src/App.tsx`: 헤더를 sticky로 하고 높이를 `--header-h`로 측정(ResizeObserver·resize), 모든 나가기 경로를 `leave`(안내 지움 + c.leave)로 통일, 인라인 reconnecting/disconnected 문구와 인라인 서버 전환 안내 삭제, 입장 시점 안내 삭제 effect 삭제. 방이 있을 때만 배너에 onLeave 전달.
- `packages/web/src/styles.css`: `.app-header-sticky`, 배너 `top: calc(var(--header-h, 0px) + 8px)`.
- `packages/web/src/game/sessionStore.ts`: `loadResumable(store, url)`, `isResumable(store, url)` 추가 (서버 URL 비교의 단일 위치).
- `packages/web/src/game/wsClient.ts`: `resumeStored`가 loadResumable 사용.
- `packages/web/src/game/useServerGame.ts`: closed의 resumable 계산과 discardOtherServerSession이 isResumable 사용, error 이벤트에서 acked(ref와 state) 해제, closed(unknown_room)이면 `LOCAL_TEXT.roomGone` 문구.
- `packages/web/src/game/messages.ts`: `LOCAL_TEXT.roomGone` ("방이 사라졌습니다. 서버가 다시 시작되었거나 방이 닫혔을 수 있습니다.").
- 테스트: `connectionUx.test.tsx` 신규 17개 안팎(배너 나가기, closed 두 버튼, 방 없음 시 나가기 없음, 인라인 없음, 서버 전환 안내 유지/닫기/나가기, isResumable 4개, 방 사라짐 문구 2개, acked 해제 1개), `useServerGame.integration.test.tsx` 단언 완화.

## 기존 테스트 수정 (사유)
1. `useServerGame.test.tsx` "방에 남은 채 displaced로 closed면…": 인라인 '연결이 끊겼습니다. 나가기를 눌러 주세요'를 삭제하라는 지시(3번)에 따라 "문구 있음"을 "문구 없음 + 나가기 2개(헤더·배너)"로 바꿈. 나가기 클릭은 `getAllByText(...)[0]`(헤더).
2. `connectionUx.test.tsx` "재접속 중: 배너에 시도 횟수…": `배너에 button 없음` 단언을 "다시 연결은 없고 나가기만 있음"으로 바꿈 (1번으로 배너에 나가기가 생김).
3. `connectionUx.test.tsx` "서버 전환 안내는 방에 입장하면 사라진다": 2번 지시에 따라 "입장해도 남고 닫기로 사라진다"로 반전.
4. 통합 테스트: `acts >= 10`을 `acts >= 1 && (acts >= 10 || roundOver)`로 완화. 같은 원인(일찍 끝난 판)으로 `acked >= 1`도 acts >= 10일 때만 요구하도록 함 (시드 고정은 서버 RNG라 불가).

## 7번: 확정한 원인
코드를 따라가 확인한 결과, HEAD에서 '이어서 접속 가능' 판단은 세 곳에 따로 있었다: (1) `useServerGame` closed 처리의 `resumable` 계산, (2) `wsClient.resumeStored`의 URL 비교, (3) `discardOtherServerSession`의 반대 비교. `entry.ts`와 `App.tsx`에는 계산이 없고 컨트롤러가 준 `resumable`만 쓴다. 세 곳 모두 URL을 이미 비교하고 있어 실제 동작 버그는 재현되지 않았다. 검증의 변이 N6이 살아남은 이유는 세 곳 중 URL 비교를 어느 쪽에서 빼도 이를 확인하는 테스트가 없었기 때문(테스트 공백)이고, 같은 사실이 3중 구현이어서 어긋날 위험이 있었다. `isResumable`/`loadResumable` 한 곳으로 모았다. 변이(URL 비교 제거)는 이제 6개 테스트가 잡는다.

## 안내의 수명 표 (무엇이 지우는가)
| 안내 | 만드는 것 | 지우는 것 |
|---|---|---|
| 연결 배너(재접속 중) | status reconnecting/connecting + 방 있음 | 재접속 성공(joined), closed로 전이, 나가기(헤더·배너), 언마운트 |
| 연결 배너(closed) | closed + 사유가 배너 대상(displaced, retries_exhausted, rejoin_timeout, connection_failed) | 나가기, 다시 연결/여기서 다시 접속 성공, 상태 전이. 시간으로는 안 지워짐 |
| notice timeout | 서버 notice | 5초, 사용자 행동, 닫기, 새 notice(재시작), closed, joined, leave, 언마운트 |
| notice auto_mode | 서버 notice | 사용자 행동, joined(rejoin), closed, leave. 닫기·시간 없음 |
| 서버 전환 안내(switchNote) | 다른 서버 세션 정리 | 닫기, 나가기(`leave`)만. 방 입장·서버 세션 교체(remount)·시간으로는 지워지지 않음 (상태가 세션 위의 ServerApp에 있음) |
| 오류 알림(response-note alert) | 서버 오류, 로컬 오류 | 닫기, 다음 행동, joined, 새 입장 요청. 방이 사라진 문구는 입장 화면에 닫기 전까지 유지 |
| 응답 대기(inFlight/acked) | act 전송 | 10초, 새 view, 서버 오류(이번에 acked도 해제), 연결 변경·closed, leave, 언마운트 |

## 브라우저 확인 (headless Edge + puppeteer-core, 실서버 8080/8081 + vite, 스크립트와 스크린샷: `$CLAUDE_JOB_DIR/tmp/pp/v20a.mjs`, `v20b.mjs`, `v20c.mjs`, `shots20_2/`)
- 서버 모드 대국 중 소켓 강제 종료(오프라인 + ws.close) 후 390/768/1280px 모두:
  - reconnecting 배너에서 헤더 '나가기'와 배너 '나가기' 모두 elementFromPoint가 자기 자신을 반환(눌림). 배너 top이 헤더 bottom 이상(390: 74 vs 70, 768/1280: 50 vs 50).
  - 배너 표시/소멸·closed 전환 전체에서 `.board`의 top/height 불변(390: 74/544, 768·1280: 54/672). 가로 넘침 없음(scrollWidth = 뷰포트 폭). 인라인 문구 없음.
  - 75초 뒤 closed 배너: 버튼은 '다시 연결', '나가기' 순. 390px에서 closed 배너 '나가기' 클릭 -> 입장 화면(입장 전). 768px에서 네트워크 복구 후 '다시 연결' 클릭 -> 진행 중, 배너 소멸. 1280px에서 reconnecting 배너 '나가기' 클릭 -> 입장 화면.
- 2번: 서버 A(8080) 방 입장 후 입력 주소를 B(8081)로 바꿔 새로고침, '방 만들기'. 정상 속도(지연 주입 없음)에서 입장 직후 대기실에서도 안내가 2초 이상, 3초 뒤에도 남고 '닫기'로 사라짐. 저장 세션은 A에서 B로 교체됨.
- 변이(브라우저): 배너 top 오프셋을 8px로 되돌리면 390px에서 헤더 '나가기' reachable=false, 원복하면 true.
- 콘솔: 앱 오류 없음(단절 시나리오의 WebSocket 연결 실패 로그 제외).
- 서버 2개, vite, headless Edge 모두 종료. 5173/8080/8081 LISTENING 없음(TIME_WAIT만 남음), `.tmpv`는 쓰지 않았다. 사용자의 Edge는 건드리지 않았다.

## 변이 확인 (모두 원복, sha256 일치 확인)
| 변이 | 결과 |
|---|---|
| 배너 나가기 렌더 조건 삭제 | 검출 (4개 실패) |
| 서버 전환 안내를 입장 시 지우는 effect 복원 | 검출 (1) |
| 인라인 재접속 문구 복원 | 검출 (1) |
| 인라인 closed 안내 복원 | 검출 (2) |
| isResumable URL 비교 제거 | 검출 (6) |
| unknown_room 문구 분기 제거 | 검출 (1) |
| error에서 acked 해제 삭제 (ref+state / state만) | 둘 다 검출 (각 1) |
| 통합 테스트 루프 0회(행동 0회) | 검출 |
| CSS 헤더 오프셋 제거 | 브라우저에서 검출 (reachable=false) |
생존 변이 없음.

## 검증
- web tsc: 오류 없음
- `npm test -w @mahjong/web`: 19개 파일, 318개 통과 (기존 306 + 신규 12, 기존 단언 수정 3건은 위 사유)
- `useServerGame.integration.test.tsx` 30회 반복: 실패 0
- `npm run build -w @mahjong/web`: 성공

## 알려진 한계와 다음 단계로 남긴 것
- 4번(방 없는 resume 중 배너·시도 횟수·최대 75초), 정적 '약 N초' 문구, 1008을 규칙 위반과 구분 못 하는 점은 지시대로 손대지 않았다.
- 방이 사라진 문구는 closed 사유 unknown_room이 저장 세션 rejoin 경로에서만 온다는 점에 의존한다(방 ID 직접 입력 실패는 error 이벤트만 오고 소켓이 닫히지 않음). 이 전제가 바뀌면 문구 분기도 다시 봐야 한다.
- 헤더가 서버 모드에서 sticky가 되어 스크롤해도 화면 위에 고정된다(배너가 헤더 아래에 뜨는 전제). 로컬 모드 헤더는 그대로.
- 배너는 여전히 fixed라 390px에서 보드 윗부분(상대 패널)을 가린다(헤더는 가리지 않고 나가기는 항상 눌림). 카드가 많이 겹치면(배너+전환 안내+알림) 더 많이 가린다.
