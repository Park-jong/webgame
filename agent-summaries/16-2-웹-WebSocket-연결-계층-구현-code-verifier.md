# 16-2 웹 WebSocket 연결 계층 검증 (code-verifier)

결론: 결함 없음(차단 이슈 0). 소스 수정 없음, 변이는 모두 원복 확인(cmp).

- 웹 tsc 통과, web 테스트 11파일 126개 통과, 빌드 성공. dist에 ws/WebSocketServer/createGameServer 없음, alias는 protocol.ts/view.ts만.
- 실서버 시나리오(port:0 + wsClient + Node ws): join/start/약 34회 합법 action(seq 연속, 에러 없음), 소켓 강제 종료 후 자동 rejoin과 view 재수신, resumeStored 새 클라이언트가 bad_seq 없이 이어받음(seq 34 -> 이후 44까지), 같은 토큰 2번째 클라이언트가 rejoin하면 첫 클라이언트는 1008 displaced로 closed·재시도 없음, 잘못된 roomId join은 error 이벤트 후 소켓 유지. 이벤트 JSON에 토큰 없음.
- 변이 실패 확인: 1008 재시도, 백오프 미초기화, 에러 후 seq 되돌림, console 토큰 출력, action 시 persist 제거, unknown_room 시 clear 제거, close에서 clearTimeout 제거, join 오류에도 닫기 -> 모두 테스트 실패.
- 생존 변이: onclose의 stale 소켓 가드(socket !== sock) 제거 시 테스트 통과(테스트 공백).
