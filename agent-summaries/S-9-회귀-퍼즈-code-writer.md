# S-9 전체 회귀·퍼즈·누출·부하 점검 (code-writer)

소스(프로덕션) 변경 없음. 테스트 4개 파일만 추가했다 (packages/server/src).

## 추가 파일 / 테스트
- `test-utils.ts`: 공용 헬퍼 (시드 PRNG, `STRESS`/`scale()`, `logSeed`, `FakeConn`, 실제 ws `Player`, `leakProblems`, `activeTimeouts`). `FUZZ_SEED=n` 으로 시드 재현.
- `regression.test.ts` (4): 사람 4명 한 판 완주+다음 국 자동 진행 / 끊김·재접속·타임아웃->자동 모드->복귀(실제 타이머) / 혼합 방 다중 동시 진행(한 방 전원 이탈해도 나머지 영향 없음) / 진행 중 서버 close.
- `fuzz.test.ts` (6): 프로토콜 퍼즈(임의·깨진 JSON, 거대 값, 깊은 중첩, 바이너리, 프로토타입 오염) / 반복 위반 종료 / 속도 제한 / 실제 ws(maxPayload 초과, 깨진 UTF-8 프레임, 이후 새 연결 정상) / 행동 퍼즈(합법·불법·남의 차례·좌석 위조·seq 역행/점프/중복, core를 직접 쓰는 독립 오라클로 기대 오류 코드 정확 비교 + 오류 시 GameState 참조·내용 동일) / 상태 순서 퍼즈(join/rejoin/start/action/close/시간 경과 임의 순서, 불변식, 전원 종료 후 방·연결·타이머 0).
- `stress.test.ts` (4): 가짜 연결+가짜 타이머로 방/연결 대량 개폐(타이머 수 상한 검증, 방 상한 room_full, 종료 후 0) / 실제 ws 연결 폭주+유휴(join 제한)+비정상 종료 / 느린 소비자(소켓 읽기 중지) / 진행 중 방이 많은 상태의 서버 close.
- 정보 누출 전수 점검(`leakProblems`)은 위 모든 시나리오에서 모든 좌석이 받은 모든 메시지에 적용: 금지 키(view.test 목록), 뷰 최상위/players 키 허용 목록, 타 좌석 토큰 문자열, 본인 토큰이 joined 외에 등장, 오류 메시지의 스택/내부 용어, 정의되지 않은 오류 코드, 다른 좌석 뷰 수신, 점수 합 불변식, 타인 차례 drawnTile, 재접속 뷰 포함.

## 발견한 결함과 수정
- 이번 점검 범위(기본·긴 버전 모두)에서 크래시, 정보 누출, 상태 손상, 타이머/연결 누수, 교착은 발견되지 않았다. 따라서 소스 수정 없음, 기존 테스트 약화 없음.

## 실행 시간
- 기본 `npm test`: 신규 14개 테스트. server 패키지 단독 실행 약 22초 -> 약 28초 (합계 +6~7초). 파일별: fuzz 약 3.5초, stress 약 7초, regression 약 6초(병렬 실행 시 서로 느려져 각 6~7초).
- 긴 버전 `STRESS=1` (한 번 실제 실행): fuzz.test.ts 118초(행동 25시드x12000스텝 28초, 상태 순서 60시드x2500연산 80초), regression+stress 35초(다중 방 12개 15초, 서버 close 60방 25초). 전부 통과.
- 루트 `npm test` 3회: 모두 exit 0, core 337 / server 182 / web 51 (server는 168 + 신규 14). flaky 없음. server typecheck 통과, `npm run build` exit 0.

## 알려진 한계 (새 기능으로 만들지 않음)
- 연결 수/IP 단위 제한 없음: 방 수 상한(1000)과 join 제한 시간(10초)만 있어 join 한 유휴 연결은 keepalive가 살아 있는 한 유지된다. 방 만들기 폭주는 방 상한까지.
- 느린 소비자 backpressure 없음: ws 전송 버퍼(bufferedAmount)를 제한하지 않는다. 게임 길이가 유한하고 타임아웃/서버 close가 terminate 하므로 누수는 없었으나, 메모리 한도는 보장하지 않는다.
- `session.onMessage`는 RoomError/GameError 외 예외를 다시 던지고 index.ts의 ws message 핸들러에는 try/catch가 없다. 퍼즈로는 도달하지 못했지만, 내부 버그가 생기면 프로세스 미처리 예외로 이어질 수 있다(방어적 try/catch + server_error 권장, 기능 추가라 보류).
- terminate 시 500ms 유예 타이머(unref)는 서버 close 후 최대 0.5초 남는다(테스트는 기준값 복귀를 폴링).
- 전원 이탈 후 TTL 경과 시 게임 상태 소멸(영속화 없음), 방 존재 여부가 unknown_room/bad_token으로 구분됨(S-8 한계 그대로).
- 퍼즈의 행동 오라클은 응답 구간(responseWindow)이 열린 상태를 다루지 않는다(즉시 스케줄러 사용). 구간 중 큐잉은 기존 game-timeout/game-session 테스트가 담당.
- 실제 타이머를 쓰는 통합 테스트는 시간 의존(수 초 한도)이라 매우 느린 환경에서는 한도 여유가 줄 수 있다.

## 피드백 반영

1. [중요] `packages/server/src/index.ts`: `ws.on("message")`를 try/catch로 감싸 예상 밖 예외 시 `server_error`("서버 내부 오류가 발생했습니다", 스택/원문 미노출)를 보내고 해당 연결만 `terminate`. `close` 핸들러(`session.onClose`)와 keepalive의 `ping`도 try/catch로 보호(pong/error 핸들러는 예외 경로 없음). `session.ts`의 `throw e`는 유지(index가 처리, 기존 오류 코드·동작 불변). 회귀 테스트(`regression.test.ts`): `rooms.join`을 TypeError로 교체 -> 해당 연결만 server_error 후 종료, 다른 연결 pong/신규 join 정상, 원문에 boom/TypeError/경로/스택 없음.
2. [경미] `createGameServer().close()` 멱등화(종료 Promise 캐시). 테스트: 동시/후속 호출 모두 resolve, `rooms.close()` 1회만 호출.
3. [경미] close 경로 테스트 추가(GameSession.close 후 살아 있는 타이머 0 단언, RoomManager.close가 모든 게임 close 호출, createGameServer.close가 rooms.close 호출). 변이 확인: game-session `clearTimer()` 제거, room `g.close()` 루프 제거, index `rooms.close()` 제거 각각에서 새 테스트가 실패함을 확인 후 원복.
4. [경미] `game-ws.test.ts`: race 기본 한도 15s->45s, "여러 시드"/"퍼즈" 테스트 한도 60s. `fuzz.test.ts`: 상태 순서 퍼즈·행동 퍼즈 한도 120s->240s. 작업량은 그대로.

검증(NO_COLOR=1): npm test exit 0 (core 337, server 187, web 51), server typecheck 0, npm run build 0.
