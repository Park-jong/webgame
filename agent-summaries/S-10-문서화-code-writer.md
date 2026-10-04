# S-10 서버 문서화 (code-writer)

코드 변경 없음. 문서만 수정/추가했다.

## 변경 파일
- `ROADMAP.md`: 3단계 제목·체크리스트 갱신(완료 3항목 체크, 남은 2항목 추가, 4/5단계 경계 서술). 다른 단계는 미변경.
- `README.md`(루트): "패키지" 절 추가, 서버 README 링크와 dev 명령.
- `packages/server/README.md`: 신규.
- `agent-summaries/S-10-문서화-code-writer.md`: 이 파일.

## 문서 항목별 코드 출처
- 구조 표: `src/*.ts` 파일 헤더 주석과 `index.ts` re-export. core 소스 참조는 `tsconfig.json`(paths)·`vitest.config.ts`(alias).
- 실행/스크립트: `package.json`(dev=`tsx src/main.ts`, build/typecheck=`tsc --noEmit`, test=`vitest run`). `start` 스크립트 없음, JS 산출물 없음. `tsx src/main.ts`를 PORT=0으로 실제 실행해 기동 확인.
- `PORT` 기본 8080: `main.ts`. `STRESS=1`/`FUZZ_SEED`: `test-utils.ts`(`STRESS`, `baseSeed`, `logSeed`).
- 클라이언트 메시지·길이 한도(2048/64/32, seq 0~MAX_SAFE_INTEGER)·seat 무시 규칙: `protocol.ts`(`parseMessage`, `parseAction`, `MAX_*`).
- 서버 메시지 필드(`joined`/`view.deadlineMs`/`error.seq`/`ack`/`notice`/`pong`): `protocol.ts`의 `ServerMessage`, 전송 지점은 `session.ts`·`game-session.ts`(`sendViewTo`, `fireDeadline`, `handleAction`).
- 오류 코드 표: `protocol.ts`의 `ERROR_CODES`, 발생 조건은 `session.ts`(`seated`, 중복 join/rejoin), `room.ts`(`RoomError` 지점: unknown_room/bad_token/room_full), `game-session.ts`(`GameError` 지점: game_not_started/already_started/bad_seq/not_your_turn/illegal_action/server_error, `halt`), `index.ts`(내부 예외 server_error). `not_supported`는 예약 코드(주석 확인).
- 흐름: `session.ts` `dispatch`(join/rejoin/start/action 순서, rejoin의 joined -> seatReconnected -> sendViewTo), `game-session.ts` `step`의 roundEnd 분기(`startNextRound` 자동 시작).
- 뷰 정책: `view.ts` 헤더 주석과 `viewFor`/`resultView`(awaitingYou, 뒷도라 조건, 안깡 공개, pending 필드). deadlineMs 봉투 전용: `game-session.ts` `sendViewTo`. name 비노출: `view.ts`의 `PlayerView`에 name 없음.
- 방 ID/토큰: `room.ts`(`ROOM_ID_ALPHABET`, `ROOM_ID_LENGTH`=8, `SEAT_TOKEN_BYTES`=24, `SEAT_TOKEN_LENGTH`=32, `tokenEquals`, `Room.rejoin` 전 좌석 비교, `MAX_ROOMS`, `EMPTY_ROOM_TTL_MS`, `MAX_CONNECTIONS_PER_ROOM`).
- 끊김/전원 이탈/중복 rejoin: `room.ts` `RoomManager.disconnect`/`rejoin`/`scheduleDelete`, `game-session.ts` `pause`/`onSeatDisconnected`/`onSeatReconnected(wasConnected)`, `terminate`는 `index.ts`(close 1008 + `TERMINATE_GRACE_MS` 500ms).
- 타임아웃/자동 모드: `game-session.ts` 상수(`TURN_TIMEOUT_MS` 30000, `RESPONSE_TIMEOUT_MS` 15000, `DISCONNECTED_TIMEOUT_MS` 3000, `AUTO_DELAY_MS`=`BOT_DELAY_MS` 600, `MAX_CONSECUTIVE_TIMEOUTS` 3, `RESPONSE_WINDOW_MS` 1000, `NEXT_ROUND_DELAY_MS` 5000, `MAX_BOT_FAILURES` 3, `MAX_SEQ_JUMP` 1000), `deadlineFor`, `autoAction`, `fireDeadline`, `normalizeMs`, `MAX_TIMER_MS`.
- 연결 보호 표: `session.ts`(`MAX_CONSECUTIVE_VIOLATIONS`=5, `MAX_IDENTIFY_FAILURES`=5, `RATE_PER_SECOND`=20, `RATE_BURST`=40, `JOIN_TIMEOUT_MS`=10000, 위반 +1/-1/+2 로직, 초과(`>`) 판정, join 시도 즉시 타이머 해제 vs rejoin 성공 시 해제), `index.ts`(`MAX_PAYLOAD_BYTES`=8192, `KEEPALIVE_INTERVAL_MS`=30000).
- 옵션 표: `index.ts`(`GameServerOptions`), `room.ts`(`RoomManagerOptions`), `session.ts`(`SessionOptions`), `game-session.ts`(`GameSessionOptions`), core `game.ts`(`DEFAULT_GAME_OPTIONS`: tripleRon abort, startingScore 25000, useRedFives true).
- 한계/보안 메모: S-3(안깡 적5, 14장 후리텐), S-5(타이밍 한계, 응답 구간 비용), S-6(시드 기록 없음), S-7(타이밍·쯔모기리 패턴), S-8(rejoin 브루트포스·unknown_room/bad_token 구분·토큰=권한·TTL 소멸·seq 점프·교체 사유 미통지), S-9(IP/연결 수 제한 없음, backpressure 없음, 이벤트 루프 지연 약 0.5초 실험, 시간 의존 테스트) 요약의 '한계' 절. 이전 요약의 "모두 끊긴 방도 TTL까지 봇처럼 진행"(S-7)은 S-8의 pause로 대체되어 문서에는 pause로 서술.
- 로그인 시 변경점: S-8/ROADMAP 5단계 경계에서 도출한 설계 메모(코드 사실 아님, 방향만 기술).

## 검증
- README의 예시 클라이언트 JSON 9개를 임시 스크립트로 `parseClientMessage`에 통과시켜 전부 ok(스크립트는 삭제, repo에 남기지 않음). README의 npm 스크립트 이름(dev/build/typecheck/test)이 `packages/server/package.json`에 존재함을 확인.
- 서버 응답 예시(joined/view/error/ack/notice/pong)는 `ServerMessage` 형태와 대조(값은 임의 예시).
- 커밋/add 하지 않음.

## 피드백 반영
code-verifier 경미 불일치 6건과 누락 1건을 문서에서만 수정했다(코드 변경 없음, 해당 코드 재확인 후 반영).
1. `error` 행: `seq`는 GameError(not_your_turn/illegal_action/bad_seq 등)에만 붙고 형식 오류·미참가 `action`의 `bad_message`에는 없다고 수정.
2. 흐름 4번: seq 검증 통과 시 오류여도 lastSeq가 갱신(`game-session.ts` handleAction)되므로 같은 seq 재전송은 `bad_seq`, 다음은 더 큰 seq라고 추가.
3. 흐름 4번 rejoin: 게임 시작 전 view 없음, 응답 구간 중 비응답 좌석은 구간 종료 때 view 수신으로 수정.
4. 게임 종료 조건: core `finishRound`(`some(score < 0)` 또는 친 연장 불가 && kyoku >= LAST_KYOKU=4)대로 서술.
5. 좌석 토큰 비교: 값 비교는 `timingSafeEqual`, 길이 다르면 먼저 거부, `Room.rejoin`은 좌석 전체 순회, 봇 좌석은 `verifyToken`에서 생략으로 수정.
6. 환경변수 예시를 bash / PowerShell(`$env:STRESS=1`, 끝나면 `Remove-Item Env:STRESS`)로 구분. ROADMAP 3단계 "연속 3회 초과 시"를 "연속 3회 시"로, server README notice/자동 모드 표현도 3회째 마감 진입으로 정리.
7. 알려진 한계에 서버 close 후 terminate 유예 타이머(500ms, unref)가 최대 0.5초 남는다는 한 줄 추가.
