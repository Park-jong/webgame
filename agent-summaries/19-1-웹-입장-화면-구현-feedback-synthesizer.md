# 19-1 웹 입장 화면 구현: 종합 분석 (feedback-synthesizer)

> feedback-synthesizer에는 Write 도구가 없어 메인 세션이 보고 내용을 저장했다.
> 종합 에이전트는 useServerGame.ts, entry.ts, wsClient.ts를 직접 읽었고, 요약 문서 2개와 App.tsx, OnlineEntry.tsx는 읽지 않았다. 발견 4번은 검증 리포트 서술을 근거로 했다. 서버 join 타임아웃 10초는 직접 확인하지 못하고 인용했다.

## 요약
검증 발견 5건과 작성자 한계를 분류했다. W-7 안에서 고칠 것은 F1~F4, 다음 단계(연결 상태 UX)로 넘길 것은 발견 4와 서버 기능이 필요한 항목, 고치지 않아도 되는 것은 발견 5와 Enter 동작.

## W-7 안에서 고칠 것
| # | 항목 | 우선순위 | 근거 |
|---|---|---|---|
| F1 | closed 핸들러의 joining 해제를 지키는 테스트 없음 | 높음 | 해제가 빠지면 입장 폼이 영구 잠김. `joining:false`가 `patch` 한 군데에만 있어 지워져도 기존 테스트가 통과 |
| F2 | join 후 서버 무응답이면 idle+joining 영구 유지, 취소 불가 | 중간 | entryPlan의 idle은 `canLeave:false`, wsClient에는 join 응답 타임아웃이 없고 rejoin에만 있음 |
| F3 | 방 ID 안내 문구에 서버가 쓰는 `_` 누락 | 낮음 | validateRoomId는 `_`를 허용하지만 ROOM_ID_HINT에는 없음 |
| F4 | 매핑 없는 서버 오류의 원문 노출 | 낮음 | errorText fallback이 서버 원문을 그대로 써서 한국어 UI에 영문이 섞임 |

## 수정 지시
- F1: useServerGame.test.tsx — create() 직후 joining true, 소켓 close로 closed가 되면 joining false·roomId null·canCreate true. connecting 중 join 호출 후 즉시 closed가 되면 이후 connected가 되어도 join이 송신되지 않음. error 이벤트(unknown_room) 경로도 joining 해제 확인. 변이: closed 핸들러와 error 핸들러의 `joining:false` 삭제 시 실패.
- F2(권장안): useServerGame에 `joinTimeoutMs`(기본 10초, 주입 가능한 timers). requestJoin에서 타이머 시작, joined/error/closed/leave/언마운트 시 해제. 만료 시 client.close()와 "서버 응답이 없습니다. 다시 시도해 주세요" 오류, joining false. entry.ts의 idle에서 joining이면 canLeave true(취소 활성화), entry.test.tsx 표 갱신. 최소안은 `canLeave: joining`만. 가짜 타이머 테스트: 응답 없을 때 만료, joined가 먼저 오면 오류 없음, leave 후 만료되어도 상태 불변. 변이: 타이머 해제 제거, 만료 시 joining:false 제거.
- F3: ROOM_ID_HINT를 "방 ID는 영문 대문자·숫자·밑줄(_)로 이뤄집니다 (대소문자·공백은 무시됩니다)"로, 검증 오류 문구에도 밑줄 추가. 테스트: `validateRoomId("ab_12cd")` ok, 힌트에 `_` 포함.
- F4: errorText에서 코드가 있고 매핑이 없으면 "요청을 처리하지 못했습니다 (코드: <code>)". 코드가 null인 로컬 문구는 원문 유지. 변이: 폴백 분기 제거 시 실패.

## 다음 단계로 넘길 것
- unknown_room 복귀 후 헤더 "연결 끊김" 표시, 저장 서버 주소 B ≠ 세션 주소 A면 A 세션이 저장소에 남는 문제(서버 주소 전환 정책 필요)
- 착석 현황·시작 권한자 구분(프로토콜 확장 필요), 방 ID 검증 강화
- 응답 대기 전반(join, inFlight)의 공통 타임아웃

## 고치지 않아도 되는 것
- 상태표 행 수 9 vs 요청 11(참고), 이름칸 Enter=방 만들기(의도)

## 패턴·재발 위험
- 상태 해제 경로 테스트 부재: joining, inFlight, acked와 ref들은 설정은 시험하지만 해제는 약함. 새 플래그를 추가할 때 해제 조건 표를 만들고 조건마다 시험, 변이 확인(해제 줄 삭제)을 검증 체크리스트에 고정.
- 응답 대기 타임아웃 누락: join, act의 inFlight는 연결이 살아 있고 서버만 침묵하면 같은 문제. 연결 상태 UX 단계에서 공통 타임아웃 도입.
- 정규식과 안내 문구 이중 관리: 상수 하나에서 파생하거나 테스트로 묶을 것.
- idle에서 취소 불가 조합: entryPlan 표 테스트에 "대기 표시(showConnecting)면 canLeave" 불변식 추가.
