# 20-1 웹 연결 상태 UX 구현 (3단계 마무리 1번, code-writer)

## 변경 파일
- `packages/web/src/game/messages.ts` (신규): 문구 단일 출처. 서버 오류 코드(`ERROR_TEXT`, 의도된 폴백 `INTENTIONAL_FALLBACK_CODES`), 컨트롤러 로컬 오류(`LOCAL_TEXT`), notice(`NOTICE_TEXT`), close 사유(`CLOSE_REASON_TEXT`), 헤더 상태 문구(`STATUS_LABEL`), 서버 전환 안내, 순수 함수 `buildConnectionBanner`.
- `packages/web/src/components/StatusStack.tsx` (신규): 화면 상단 고정(fixed) 연결 배너와 notice. 컨트롤러의 `connection`/`notice`만 받는다.
- `packages/web/src/game/entry.ts`: 오류 문구를 messages로 이전(`errorText`는 재export), `EntryPlan.statusLabel` 추가, `connecting`+방 있음은 `reconnecting` 화면(수동 다시 연결 중에 대국 위로 입장 폼이 뜨지 않게).
- `packages/web/src/game/wsClient.ts`: 이벤트 `retry`(attempt, max, delayMs) 추가. 재접속 예약 때 1회 발행(동작 변경 없음).
- `packages/web/src/game/types.ts`: `ServerGameController`에 `connection`, `reconnect()`, `discardOtherServerSession(url)`.
- `packages/web/src/game/useServerGame.ts`: retry/resumable 상태, notice 소멸 타이머, 응답 대기 타이머, `reconnect`, `discardOtherServerSession`, 옵션 `noticeTimeoutMs`(5초)·`responseTimeoutMs`(10초), 로컬 문구를 LOCAL_TEXT로 교체. **closed 사유를 `error`로 복사하지 않음**(배너와 중복 방지).
- `packages/web/src/App.tsx`: StatusStack 사용, 헤더는 `plan.statusLabel`, 서버 전환 안내(`switchNote`), 로컬 STATUS_LABEL 삭제.
- `packages/web/src/styles.css`: `.status-stack`/`.status-card` (position: fixed, 레이아웃을 밀지 않음).
- 테스트: `packages/web/src/game/connectionUx.test.tsx` (신규 80개), `useServerGame.test.tsx` 1곳 수정.

## 기존 테스트 수정 (1건, 사유)
`useServerGame.test.tsx`의 "재접속이 불가능하면(1008) closed 상태와 사유를 보여 준다": `error`가 `closeReason.message`와 같다는 단언을 `error === null`, `connection.kind === "closed"`로 교체. 닫힘 사유는 이제 배너가 안내하고 error 알림과 중복 표시하지 않는다는 설계 변경 때문.

## 상태 x 배너·버튼 표 (`buildConnectionBanner`, it.each 19행으로 테스트)
| status | 조건 | 배너 | 버튼 |
|---|---|---|---|
| idle | - | 없음 | - |
| connecting | 방 없음 (입장 요청·자동 resume) | 없음 (입장 화면의 '연결 중/이어서 접속 중' 안내가 담당) | 취소 |
| connecting | 방 있음 (수동 다시 연결 중) | 재접속 중 안내 | 헤더 나가기 |
| reconnecting | 방 있음 | "다시 접속하는 중" + 재접속 시도 n/10회, 다음 시도 약 N초 뒤 | 헤더 나가기 |
| reconnecting | 방 없음 (resume 중) | 없음 (입장 화면 안내) | 취소 |
| waiting / playing / ended | - | 없음 | - |
| closed user | - | 없음 | - |
| closed unknown_room / bad_token / room_full | - | 없음. 세션은 wsClient가 삭제, 입장 화면에 한글 오류 문구 | - |
| closed displaced | 저장 세션 있음 | "다른 곳에서 접속해 이 연결이 종료되었습니다" + 핑퐁 위험 안내 | 여기서 다시 접속 (사용자가 누를 때만) |
| closed displaced | 저장 세션 없음 | 위와 동일 | 없음 |
| closed retries_exhausted / rejoin_timeout | 저장 세션 있음 | 재접속 실패 안내 | 다시 연결 |
| closed connection_failed | 저장 세션 있음 | "서버에 연결하지 못했습니다" | 다시 연결 |
| closed (위 3종) | 저장 세션 없음 | 안내만 | 없음 |

헤더 상태 문구 (`entryPlan.statusLabel`, it.each 9행): closed+방 없음 = "입장 전"(unknown_room 복귀 포함), closed+방 있음 = "연결 끊김", connecting+방 있음 = "재접속 중", 나머지는 기존과 같음.

'다시 연결'은 `client.resumeStored()`를 쓴다. `beginConnect`가 attempts를 0으로 되돌리므로 백오프(1초부터)와 시도 횟수가 초기화된다(테스트로 확인). displaced는 자동 재시도 경로가 없고(1008은 즉시 closed) 120초가 지나도 소켓이 생기지 않음을 테스트했다.

## 플래그 해제 조건 표 (조건마다 테스트 있음)
| 플래그 | 설정 | 해제 조건 |
|---|---|---|
| notice=timeout | notice 수신 | (1) noticeTimeoutMs(기본 5초) 경과 (2) 사용자 행동 act (3) 닫기 버튼 (4) 새 notice가 오면 타이머 재시작 (5) closed (6) joined(재접속) (7) leave·언마운트 |
| notice=auto_mode | notice 수신 | 시간 경과로는 해제 안 됨. (1) 사용자 행동 (2) joined(rejoin 성공, 서버가 자동 모드 해제) (3) closed (4) leave. 닫기 버튼 없음 |
| 응답 타이머(inFlight/acked 대기) | act 전송 성공 | (1) 10초 경과: inFlight·acked 모두 해제 + "서버 응답이 없습니다" (2) 새 view (3) 서버 오류 (4) connecting/reconnecting/closed (5) leave·언마운트. ack를 받으면 타이머를 다시 시작 |
| retry (재시도 정보) | wsClient `retry` 이벤트 | connected, joined, connecting, closed |
| resumable | closed 시 저장소 조회 | 다음 closed에서 재계산, 저장 세션 삭제 시 false |
| switchNote | 다른 서버 세션 정리 | 닫기 버튼, 방 입장 |

변이 확인(모두 원복): 22개 중 18개 검출. notice 소멸 patch 삭제, joined/closed의 notice 해제 삭제, view/오류/연결 변경/closed/언마운트의 응답 타이머 해제 삭제, ack 재시작 삭제, 만료 시 inFlight·acked 해제 삭제, reconnect closed 가드 삭제, 서버 전환 세션 삭제·방 가드 삭제, resumable 항상 true, displaced 버튼 삭제, 헤더 문구 규칙 삭제.
생존 4건은 모두 등가 변이: `leave`의 ack 타이머 해제(close()가 closed 핸들러를 거쳐 해제), closed/joined의 retry 해제(배너가 reconnecting 상태에서만 retry를 읽고 재접속 예약마다 갱신), auto_mode에도 소멸 타이머를 거는 변이(만료 patch가 timeout일 때만 지움).

## 서버 주소 전환 정책
저장된 세션의 serverUrl이 입장하려는 주소와 다르면, 입력 검증을 통과해 create/join 하는 순간 저장소를 지운다(`discardOtherServerSession`). 방에 앉은 상태에서는 지우지 않는다. 토큰은 다른 서버로 가지 않는 기존 보호(resumeStored의 URL 비교)를 유지하며 테스트에서 새 서버 전송 내용에 토큰이 없음을 확인했다. 안내는 하기로 판단했다. 이전 방으로 이어서 들어갈 수 없게 되는 되돌릴 수 없는 변화이기 때문이다. 입장 화면에 "서버 주소가 바뀌어 이전 서버의 저장된 접속 정보를 지웠습니다…"를 닫기 버튼과 함께 표시하며, 방에 입장하면 사라진다.

## inFlight 해제 경합: 변경하지 않음 (근거)
"전송 직후 무관한 view가 먼저 오면 inFlight가 풀림"은 요청 식별자가 없는 현재 프로토콜에서 안전하게 구분할 수 없어 바꾸지 않았다. 'awaitingYou가 변할 때만 해제'로 하면, 깡 직후 새로 뽑아 다시 내 차례가 되는 경우처럼 내 행동의 정상 결과 view에서도 awaitingYou가 true로 유지돼 inFlight가 풀리지 않는 deadlock(타임아웃 10초까지 조작 불가)이 생긴다. 대신 이번에 넣은 응답 타임아웃이 최악의 경우를 10초로 제한하고, 경합으로 중복 전송되어도 서버가 거부하므로(not_your_turn 등) 피해가 없다는 18-1 종합 판단은 유지한다. 근본 해결은 view에 마지막 처리 seq를 싣는 프로토콜 변경이며 server 수정이 필요하다(보고만).

## 검증
- web tsc: 오류 없음
- `npm test -w @mahjong/web`: 306개 통과 (기존 226 + 신규 80, 기존 1개 단언 수정). 처음 한 번 `useServerGame.integration.test.tsx`가 실패했으나(acts >= 10 단언, 국이 일찍 끝나는 무작위 판 의존) 단독 재실행 2회 통과, 전체 재실행 통과. 이번 변경 이전부터 있던 불안정성으로 보인다.
- `npm run build -w @mahjong/web`: 성공
- 브라우저 수동 확인은 하지 않았다(모의 소켓 테스트만).

## 알려진 한계
- 방 없음 + reconnecting(새로고침 후 resume 중)에는 시도 횟수 배너가 없다(입장 화면의 '이어서 접속 중' 안내만). 새로고침 후 resume이 실패해 closed가 되면 그때 배너와 '다시 연결'이 나온다.
- 재접속 안내의 "약 N초"는 예약 시점 값의 정적 문구이며 카운트다운이 아니다.
- displaced 문구는 1008이 규칙 위반 종료와 구분되지 않아(wsClient가 같은 코드로 처리) 두 경우를 함께 안내한다.
- 배너는 화면 상단 고정이라 모바일 폭에서 헤더 일부를 가릴 수 있다(카드 폭·글자 축소만 적용).
- 오류 알림(`role=alert`)은 기존처럼 인라인이라 표시 시 레이아웃이 움직인다(notice만 고정 영역으로 옮김).
- `disconnected` 화면의 "연결이 끊겼습니다. 나가기를 눌러 주세요" 안내(기존 테스트가 고정)가 배너의 '다시 연결'과 함께 보일 수 있다.
- 서버 `bad_seq`는 문구를 매핑했고 `not_supported`(서버가 보내지 않는 예약 코드)만 의도된 폴백이다.
- 커밋하지 않았고 server/core는 수정하지 않았다.
