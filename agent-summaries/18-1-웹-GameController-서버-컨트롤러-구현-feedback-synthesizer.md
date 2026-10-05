# 18-1 W-6 종합 (feedback-synthesizer)

> feedback-synthesizer에는 Write 도구가 없어 메인 세션이 보고 내용을 그대로 저장했다.
> 종합 에이전트는 `useServerGame.ts`, `App.tsx`, 검증 문서만 읽었고, code-writer 문서와 `types.ts`, `BoardView.tsx`는 읽지 않았다. 한계 6건은 요청 문구를 근거로 했다.

## 결론
치명/높음 문제 없음. 검증 통과. W-6에서는 작은 수정 2건만 한다.

## 분류

### A. W-6 안에서 고칠 것
| # | 항목 | 근거 | 우선순위 |
|---|---|---|---|
| 1 | closed 상태에서 패 버튼이 활성처럼 보임 | 실제 조작 오류로 이어지고 한 줄 수정. 컨트롤러 계약(`actions`) 문제라 W-7 이후 UI가 같은 결함을 물려받기 전에 막아야 함 | 1 |
| 2 | closed 상태에서 방 만들기/입장 버튼 노출 후 "이미 방에 입장해 있습니다" 오류 | 누르면 항상 오류가 나는 UI. `App.tsx` 조건 한 줄 | 2 |

### B. W-7 / W-12로 넘길 것
| 항목 | 시점 | 근거 |
|---|---|---|
| resume 중 create/join 경합으로 bad_message | W-7 | 입장 화면에서 status가 connecting이면 버튼 비활성화 |
| 새 게임 없음 (서버 모드 onNewGame은 leave) | W-7 | 입장 화면과 방 흐름이 정해져야 의미가 있음 |
| GameEnd 순위 화면 브라우저 미확인 | W-7 | 입장 화면 검증 때 브라우저로 끝까지 진행해 확인 |
| notice 자동 소멸 없음 | W-12 | 연결 UX 범위. 수동 확인 버튼은 있음 |
| closed 상태 재접속 재시도 UI | W-12 | 현재는 나가기로만 복구 |
| rejoinTimeout 실서버 미발동 | W-12 | 모의 타이머 단위 테스트는 있음. 서버 응답 지연 장치 필요 |
| inFlight 해제 경합 | W-12 | 서버가 중복 응답을 거부하므로 피해 없음. 잘못 고치면 응답 멈춤 위험. 요청·응답 식별자 도입 시 함께 |

### C. 고치지 않아도 되는 것
- 서버 모드 로그 없음 (의도, 서버가 로그를 보내지 않음)
- StrictMode에서 소켓이 한 번 열렸다 닫힘 (개발 모드 한정, cleanup 정상)
- 통합 테스트 실시간 대기 (3~5초, 5회 반복 통과)

## A 수정 지시
- A-1 `useServerGame.ts` (약 198행): `actions`에 `s.conn === "connected"` 조건 추가. 테스트: closed(retries_exhausted/1008)에서 `[]`, reconnecting에서 `[]`, rejoin 성공 후 새 view에서 복구. 변이: 조건 제거 시 실패.
- A-2 `App.tsx` (131행): `(c.status === "idle" || (c.status === "closed" && c.roomId === null)) && <MinimalEntry/>`. 선택: closed일 때 "연결이 끊겼습니다. 나가기를 눌러 주세요" 안내. 테스트: displaced로 closed → 입장 버튼 없고 나가기 있음 / 방 입장 전 unknown_room으로 closed → 입장 버튼 보임 / 나가기 후 idle → 입장 버튼 보임.

## 패턴·재발 위험
1. closed/reconnecting 상태 UI 처리 누락: 노출·활성 조건이 컴포넌트마다 흩어져 있음. W-7·W-12에서 버튼을 추가할 때 idle/connecting/reconnecting/closed 각각 확인. 컨트롤러가 가공한 값(`actions`, `status`)만 쓰고 `view`/`roomId`로 직접 판단하지 말 것.
2. inFlight와 acked 동기화: ref와 state 이중 관리, 해제 위치가 이벤트마다 따로. 수정 시 "act 중복 전송 가드" 변이를 반드시 같이 돌릴 것.
3. 경합 시나리오가 모의로만 검증됨(resume 중 create/join, rejoinTimeout, inFlight). W-12에서 서버 응답 지연 장치로 실서버 검증 권장.
4. GameEnd 화면은 브라우저에서 열어 본 적 없음. W-7 브라우저 검증 체크리스트에 포함.
