# S-10 문서화 검증 (code-verifier)

판정: 통과. 치명 0, 중요 0, 경미 6(전부 표현/누락 수준). 파일 수정 없음, git add/commit 없음.

## 실행
- git status: README.md, ROADMAP.md 수정 + packages/server/README.md, agent-summaries/S-10-...-code-writer.md 신규. packages/ 코드 변경 0.
- 루트 npm test(NO_COLOR=1) exit 0: core 337 / server 187 / web 51. npm run build exit 0. server typecheck exit 0.
- npm run dev -w @mahjong/server: PORT=18765 기동("mahjong server listening on :18765"), PORT=0 이면 임의 포트 출력 확인. 실제 ws 클라이언트로 ping/join/start/action 확인: joined(roomId 8자 알파벳 일치, 토큰 32자), view 봉투 키 type,view,deadlineMs(약 29999), 뷰 키 목록, bad_seq(+seq 반환), 알 수 없는 type bad_message, 이미 참가한 연결의 join/rejoin bad_message 모두 README와 일치.
- FUZZ_SEED=42 퍼즈: "[seed] ... (재현: FUZZ_SEED=42)" 로그 일치. STRESS=1 stress.test.ts 4개 통과, 로그에 "STRESS=1" 표기 일치.
- 예시 클라이언트 JSON 9개 parseClientMessage 전부 ok. 최상위 seat 무시/action.seat 제거, seq 2^53 거부, name 33자/roomId 65자/2049자/알 수 없는 type 모두 bad_message (README 서술과 일치).

## 불일치 목록 (전부 경미)
| # | 위치 | README 현재 서술 | 실제 | 수정 제안 |
|---|---|---|---|---|
| 1 | server README "서버->클라이언트" error 행 | action 오류면 요청 seq가 되돌아옴 | 방에 앉지 않은 연결의 action(bad_message, RoomError)과 형식 오류에는 seq 없음 (GameError만 seq 부착) | "게임 행동 오류(not_your_turn 등)에는 seq가 붙는다. 형식 오류/미참가 action 의 bad_message 에는 없다" |
| 2 | "흐름" 4번 / bad_seq | (seq 소비 규칙 없음) | seq 검증 통과 후에는 not_your_turn/illegal_action 이어도 lastSeq가 갱신됨(소비). 같은 seq 재전송 시 bad_seq | "오류 응답을 받은 seq도 소비되므로 다음 행동은 더 큰 seq" 한 줄 추가 |
| 3 | "흐름" 4번 | rejoin 후 joined 다음에 현재 view가 온다 | 게임 시작 전이면 view 없음. 응답 구간 중이면(응답 대상 아닌 좌석) 구간 종료 시 도착 | "게임이 진행 중이면, 응답 구간 중에는 구간 종료 시" 단서 |
| 4 | "흐름" 2번 | 동풍전이 끝나면 gameEnd | core: 동풍전 4국 종료 또는 점수 마이너스(0 미만)로도 종료 | "(또는 누군가 점수가 0 미만이 되면)" |
| 5 | "토큰/재접속 모델" 좌석 토큰 | 모든 좌석을 끝까지 비교 | 길이가 다르면 tokenEquals가 먼저 거부, 사람 아닌 좌석은 비교 생략(verifyToken 단락). 토큰 길이는 고정 32라 실질 영향 작음 | "토큰 값은 timingSafeEqual, 좌석 전체를 순회" 정도로 완화 |
| 6 | 테스트 환경변수 / ROADMAP | `STRESS=1 npm test` 예시는 POSIX 쉘 표기이고 쉘 명시 없음, PowerShell 설정이 세션에 남는다는 설명 없음. ROADMAP "연속 3회 초과 시 자동 모드" | 실제는 3회째 마감에서 진입(>=3), server README 는 "연속 3회 넘기면"으로 정확 | "(bash 기준)" 명시, PowerShell 은 `Remove-Item Env:STRESS` 안내, ROADMAP 은 "연속 3회 시" |

## 항목별 결과
1. 사실 대조: 상수/기본값/한도/마감/오류 코드/옵션 이름·기본값(PORT 8080, maxPayload 8192, 2048/64/32, seq 점프 1000, 위반 5(> 초과), 식별 실패 5(> 초과, 6번째 종료), 토큰 버킷 20/40, 참가 10s, keepalive 30s, TTL 5분, 방 1000, 30s/15s/3s/600ms/3회, 응답 구간 1s, 다음 국 5s, 봇 실패 3(>=), 방 ID 8자/32자 알파벳/40비트, 토큰 24바이트/32자, close 1008+500ms, join 타이머 해제 시점, 위반 +1/-1/+2) 전부 코드와 일치. 빠진 상수 없음. 과장 없음(위 경미 5건 제외).
2. 프로토콜 예시: 위 실행 결과대로 모두 일치. 서버 예시 형태는 ServerMessage 와 동일.
3. 명령: dev/build/typecheck/test, STRESS, FUZZ_SEED, PORT 동작 확인. PORT 사용 예시는 문서에 없어 쉘 문제 없음.
4. 한계 메모: S-3~S-9 한계 반영 확인. S-7의 "전원 끊김도 TTL까지 봇처럼 진행"은 S-8 pause 로 대체되어 올바르게 pause 로 서술. S-8 마감 연장 방지(wasConnected), S-9 예외 격리(server_error+해당 연결만 종료), close 멱등 모두 반영. 이미 수정된 한계를 남겨둔 항목 없음. 누락(경미): terminate 500ms 유예 타이머가 서버 close 후 최대 0.5초 남음(S-9, 사용자 영향 거의 없음).
5. ROADMAP: diff 상 3단계 블록(제목+체크 3개 완료, 미완 2개 추가, 경계 메모)만 변경, 4~5단계 및 타 단계 변경 없음. 체크 상태는 실제와 일치(웹 전환 미완, 영속화/배포 미완). 링크/경로 packages/server/README.md 존재, 루트 README 상대 링크 유효.
6. 위 실행 참고.
