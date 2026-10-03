# S-7 행동 타임아웃 (code-writer)

## 변경 파일 (packages/server/src)
- `game-session.ts`: 좌석별 마감(`deadlines`), 자동 행동, 자동 모드, 끊김/재접속 훅 `onSeatDisconnected`/`onSeatReconnected`, 상수 `TURN_TIMEOUT_MS`(30s)/`RESPONSE_TIMEOUT_MS`(15s)/`DISCONNECTED_TIMEOUT_MS`(3s)/`AUTO_DELAY_MS`(600)/`MAX_CONSECUTIVE_TIMEOUTS`(3), 옵션 `turnTimeoutMs`/`responseTimeoutMs`/`disconnectedTimeoutMs`/`autoDelayMs`/`maxConsecutiveTimeouts`/`now`
- `protocol.ts`: `view` 메시지에 선택 `deadlineMs`(남은 ms), 새 `{type:"notice", code:"timeout"|"auto_mode"}`
- `room.ts`: `RoomManager.disconnect`가 게임에 끊김 통지, `RoomManager.seatReconnected(room, seat)` (S-8 훅)
- 테스트: `game-timeout.test.ts` 신규(23개). 기존 테스트(`game-session/game-ws/game-tamper`)는 즉시 스케줄러에서 사람 마감이 바로 발동하므로 `turnTimeoutMs/responseTimeoutMs: Infinity`(마감 비활성)를 설정 한 줄 추가

## 설계 판단
- **타이머**: 여전히 최대 1개. 마감은 좌석별 절대 시각(`deadlines: Map<seat,{at,kind}>`)으로 보관하고, 사람 대기 시 가장 이른 마감에 타이머 하나(`waitHuman`)만 건다. 사람 행동이 수락되면 본인 마감 삭제 + 마감 타이머 취소 후 pump가 남은 마감(다른 사람 좌석의 원래 마감 유지)으로 다시 건다. 타이머 세대(`timerId`)를 도입해 취소가 무시돼 뒤늦게 실행된 낡은 콜백은 무시한다. unref/close/halt/방 삭제/gameEnd에서 정리.
- **마감 시작**: 응답 구간 중에는 마감을 만들지 않고(구간 시작 시 비움), 구간 종료 후 `broadcast()` 직전에 `armDeadlines()`(멱등)가 시작해 뷰에 남은 시간을 실을 수 있게 했다.
- **마감 전달**: viewFor는 건드리지 않고 `sendViewTo`가 view 메시지 봉투에 `deadlineMs`(남은 ms)를 본인 좌석에게만 붙인다. 일반(normal) 마감에만 붙이고 자동/끊김 마감에는 붙이지 않는다. `sendViewTo` 재전송 시 남은 시간이 갱신된다.
- **자동 규칙**: turn은 뽑은 패 쯔모기리(legal discard 중 비리치), 없으면 합법 비리치 타패 중 마지막 것(결정적). response는 legal pass. 항상 `legalActions` 원소를 `tryApply`(dispatch)로 넘기고, 화료/리치/깡/부로는 하지 않는다. 리치 후에도 합법 타패가 뽑은 패뿐이므로 그대로 쯔모기리.
- **연속 타임아웃/자동 모드**: normal 마감 초과 때만 카운트. N회(기본 3) 도달 시 자동 모드: 이후 `autoDelayMs`(600) 마감으로 같은 규칙 수행. 유효 행동이 수락되면(구간 중 큐 적재 포함) 카운터 리셋·해제. 본인에게만 `notice`(timeout / auto_mode).
- **끊김**: 끊긴 좌석은 `disconnectedTimeoutMs`(3s) 마감(카운트·notice 없음, 자동 모드로 보지 않음). 대기 중 끊기면 기존 마감과 min으로 단축. 재접속 훅(`RoomManager.seatReconnected` -> `onSeatReconnected`)은 카운터/자동 모드를 풀고 마감을 일반 시간으로 재시작한다. 뷰 재전송은 S-8이 `sendViewTo`로 한다(이 훅은 뷰를 보내지 않음).
- **경합**: JS 단일 스레드라 "행동 먼저 -> 마감 타이머 취소/낡은 콜백 무시", "마감 먼저 -> 이후 행동은 not_your_turn"으로 정확히 한 번만 처리. 마감 콜백은 발동 시점에 해당 좌석의 마감 엔트리와 awaiting 여부를 재확인한다. 자동 행동 실패(dispatch 예외)는 기존 `noteProgress`/halt 경로로 합류.
- **비활성**: 시간값이 유한하지 않으면(Infinity) 해당 마감 없음(테스트/무제한). 즉시(동기) 스케줄러와 유한 마감을 같이 쓰면 사람이 바로 자동 행동하므로 주의.

## 정보 은닉 및 남는 한계
- 자동 행동은 일반 타패/패스 상태 변화로만 상대에게 보이고 별도 신호/notice는 본인에게만 간다. 마감 정보는 본인 view 봉투에만 존재(테스트로 다른 좌석 메시지에 `deadline|notice|timeout` 없음 확인).
- 한계: (1) 타이밍 — 사람이 응답 대기면 마감(15s)까지 진행이 지연돼 "누군가 대기 중"은 추측 가능(S-5 한계와 동일). 자동 모드/끊긴 좌석은 짧은 지연이라 자동 모드 여부가 타이밍으로 일부 추측될 수 있다. (2) 쯔모기리 패턴이 반복되면 상대가 "방치 중"임을 짐작할 수 있다(일반 타패이므로 규칙 상 불가피). (3) 모두 끊긴 방도 TTL(5분)까지 끊김 마감으로 봇처럼 진행되다 삭제된다.

## 검증
- 신규 `game-timeout.test.ts`: 쯔모기리(화료/리치 가능해도 안 함), 리치 후, 뽑은 패 없음, 응답 pass(구간 후 시작), 구간 중 큐 응답, 마감 본인 전용·viewFor 불변, 마감 직전 행동 수락·타이머 취소, 마감 먼저 후 지연 행동, 낡은 콜백, 두 사람 응답 대기 시 남은 마감 유지, 자동 모드 진입/해제/카운터 리셋, 자동 규칙만 사용, 재접속 훅, 끊김 마감, 실제 타이머 `vi.getTimerCount`(행동/close/gameEnd/TTL 삭제), 사람 4명·혼합·전원 끊김 무행동 한 판 완주(점수합 100000, 타이머 ≤1, legalActions 원소 검증).
- 변이 확인(원복 완료): 자동 행동을 legalActions 밖으로 바꾸면 12개 실패, `cancelDeadlineTimer` 본문 제거 시 6개 실패.

## 검증 피드백 반영 (2차)
- 안깡 직후처럼 같은 좌석이 계속 행동하는 전이에서 새 마감(TURN)이 걸리는 테스트 추가. handleAction의 `deadlines.delete(seat)`를 임시 제거하면 실패함을 확인하고 원복.
- 시간 옵션 정규화(`normalizeMs`, `MAX_TIMER_MS`=2^31-1): 미지정=기본값, NaN/Infinity=마감 없음, 0 이하=0(즉시 발동), 유한 양수는 상한 clamp. `autoDelayMs`가 Infinity/NaN이면 기본값(영구 정지 방지), `maxConsecutiveTimeouts`는 내림 후 1 이상(NaN은 기본값). 옵션 주석에 규칙 명시, 단위 테스트 추가.
- `game-tamper.test.ts`, `game-ws.test.ts`에 `disconnectedTimeoutMs: Infinity` 추가(의도 불변).
- 결과: 루트 npm test core 337 / server 144 / web 51 통과, build 통과.
