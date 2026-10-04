# S-9 검증 결과 (code-verifier)

판정: 통과. 치명 0, 중요 1(기존 한계 재현), 경미 다수. 소스/테스트 수정 없음(변이는 모두 원복, git status = S-9 신규 4파일 + 요약만 untracked).

## 1. 실행
- 루트 npm test exit 0: core 337 / server 182 / web 51. server 단독 3회 연속 통과(21~22s). typecheck, build exit 0.
- 과부하(20코어에 CPU 점유 프로세스 24개 동시): S-9 신규 14개는 통과, 기존 game-ws.test.ts 2개(20s 한도)가 타임아웃. S-9 파일 문제 아님(기존 테스트의 여유 부족).
## 2. 퍼즈
- FUZZ_SEED 1,7,42,1234,99999,314159,20261004,(STRESS=1) 777, 5150: 신규 결함 없음. STRESS 전체(fuzz 120s, 상태순서 82s/120s 한도) 통과.
## 3. 변이 테스트 (S-9 3파일만 실행)
잡음(14): view에 deadWall / 타인 hand / 결과에 liveWall, 오류에 스택, rejoin 후 본인 토큰이 joined 외 메시지, 불법 행동이 state 변경, seq 검사 제거, bad_seq가 lastSeq 갱신, not_your_turn 검사 제거, 위반 종료 제거, 연결 매핑 미삭제, 뷰를 다른 좌석에 전송, pause 시 타이머 미정리, 서버 close 시 클라이언트 미종료.
놓침(경미, 등가/중복 방어): GameSession.close()의 clearTimer 제거, RoomManager.close()의 games.close 제거, createGameServer.close()의 rooms.close() 제거. 모두 terminate->disconnect->pause 경로와 unref/자체 만료 타이머가 중복 방어하여 관측 불가한 등가 변이에 가까움.
## 4. 위험 재현
- ws message 핸들러에 try/catch 없음: rooms.join을 런타임에 TypeError로 바꾸면 프로세스가 uncaught로 종료됨(재현). 현재 코드에서 그런 예외를 일으키는 자연 입력은 찾지 못함(퍼즈 포함).
- 느린 소비자 30방(소켓 pause), 10초: RSS +17.7MB. 게임 길이가 유한하고 keepalive가 있어 유계.
## 5. 추가 시나리오 (임시 스크립트, repo에 없음)
- 응답 윈도우(20ms) 중 stale/점프 seq/중복 start 폭주: 게임 완주(43s), 누출 0, 오류코드 정의된 값만, 종료 후 타이머 0.
- TTL 경계: delay 90ms 성공, 100ms 이후 unknown_room로 결정적. 같은 토큰 4중 동시 rejoin 80좌석: 서버 연결 수 정확히 80(좌석당 1), 전원 이탈 후 0, 타이머 0.
- 300연결 x 2KB 폭주: 이벤트 루프 최대 지연 약 0.5s, 연결 전부 정리.
- server.close() 2회 호출은 reject("The server is not running"), 닫힌 manager join은 unknown_room, 닫힌 포트 접속은 ECONNREFUSED.
