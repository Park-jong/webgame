# 16-2 웹 WebSocket 연결 계층 구현 (W-2)

## 신규 파일 (packages/web/src/game/)
- wsClient.ts: createWsClient({url, createSocket, store, timers?, initialSeq?, maxReconnectAttempts?(10), baseDelayMs?, maxDelayMs?}), getServerUrl(), computeDeadlineAt(), parseServerMessage()
- sessionStore.ts: SessionStore(load/save/clear), createLocalSessionStore(storage?, key?), createMemorySessionStore()
- testkit.ts: 테스트용 MockSocket, FakeTimers
- wsClient.test.ts(26), sessionStore.test.ts(6), wsClient.integration.test.ts(1, node 환경, 실제 createGameServer port 0 + ws)

## 동작 요약
- 상태 idle/connecting/connected/reconnecting/closed, 닫힘 사유 {code,message,closeCode?}. subscribe로 status/joined/view/ack/notice/error 이벤트 전달(view에 receivedAt, deadlineAt 포함).
- 송신은 status가 connected일 때만 가능, 아니면 {ok:false, reason:'not_connected'} 반환(큐잉 없음). 사용 순서: connect() -> status connected -> join/rejoin/start/action/ping.
- action seq: initialSeq(기본 1)부터 전송 성공 시 증가, 오류 응답과 무관하게 단조 증가. 전송 예외 시 소비 안 함.
- 재접속: 비정상 끊김 + 세션 보유 시 1s,2s,4s,...최대 10s 백오프로 새 소켓 rejoin. 재시도 안 함: close 1008(displaced), rejoin 중 unknown_room/bad_token/room_full(세션 삭제 후 소켓 닫음), 사용자 close(), 상한 초과(retries_exhausted), 세션 없는 연결 실패. joined 성공 시 백오프 초기화.
- resumeStored(): 저장 세션(서버 URL 일치 시)으로 연결 후 rejoin, seq는 저장값+1+RESUME_SEQ_JUMP(10)부터.
- 일반 join 중 unknown_room 등은 연결을 유지(방 ID 재입력 가능).
- 토큰은 console/URL/이벤트에 출력되지 않음(테스트로 검증). 저장소 접근은 전부 try/catch.

## 검증
- npx tsc -p tsconfig.json 통과, npm test -w @mahjong/web 11파일 126개 통과(신규 33), npm run build -w @mahjong/web 실행.
- 서버/코어 소스 수정 없음, 커밋 없음. web 본체에서 server index.ts import 없음(통합 테스트 파일만 상대 경로 import).
