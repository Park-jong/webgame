# 19-1 웹 입장 화면(W-7) 검증 (code-verifier)

## 결론
치명·높음 문제 없음. 실브라우저(headless Edge) a~f, GameEnd(서버/로컬), 회귀, 변이 검증 통과. 보완할 점 3건(중간 1, 낮음 2). 소스 수정 없음(변이 원복, sha 일치 확인).

## 발견 문제 (심각도순)
1. (중간) 연결 실패 경로의 joining 해제가 작성자 테스트로 보호되지 않음. 변이 "closed 핸들러에서 joining:false 제거"가 entry/useServerGame 테스트 59개를 모두 통과(생존). 임시 모의 시나리오 8개(연결 실패, join 전송 후 소켓 끊김, bad_message, 1008, send 예외, resume unknown_room, 연결 중 취소 후 재생성, 오류 후 재시도)는 현 코드에서 모두 통과하므로 코드 결함은 아니고 테스트 공백. 해제 누락이 생기면 방 만들기·입장이 영구 비활성된다.
2. (낮음~중간) join을 보냈는데 서버가 응답도 close도 하지 않으면(무응답 서버, 중간 프록시 정지) idle+joining 상태가 영구 유지: 방 만들기/입장/취소 버튼 모두 비활성, 나가기 없음(표의 idle+joining 행, canLeave=false). 30초 관찰해도 그대로(shots/w7-h1-silent-join.png). 새로고침이 유일한 탈출구. 실서버는 10초 join 타임아웃과 정상 응답이 있어 실제 발생 가능성은 낮음. 제안: joining 구간에도 취소 허용 또는 join 응답 타임아웃.
3. (낮음) 방 ID 안내 문구와 허용 문자 불일치: 서버 방 ID 알파벳은 `23456789A-Z(I,L,O,0,1 제외)_` 이고 `_`가 실제로 나오는데(예 `_X27RGF3`) 힌트/오류 문구는 "영문 대문자·숫자"만 말함. 검증 자체는 `_`를 허용해 동작에는 문제 없음.
4. (낮음) unknown_room 등으로 입장 화면에 복귀해도 헤더가 "연결 끊김"으로 표시되고(폼은 정상 활성), 서버 주소가 저장 세션(주소 A)과 다른 값(B)으로 저장돼 있으면 새로고침 시 A 세션이 복원되지 않고 저장소에 남음(토큰이 B로 가지는 않음). 동작상 안전.
5. (참고) 요약의 상태표는 9행(playing/ended 합산)이며 구현과 일치. 요청서의 "11행"과 행 수 표현만 다름.

## 1) 실브라우저 결과 (headless Edge + puppeteer-core, 실서버 8080/vite 5173)
- (a) 쿼리 없이 접속 -> 모드 선택 -> "혼자 연습" 로컬 진행 정상, "처음으로" 선택 화면 복귀: 통과.
- (b) 빈 이름/33자/http:// /"ws://" 오류 문구 한글, 입력 유지, 전송 안 함: 통과. 잘못된 주소(ws://localhost:9)는 "서버 연결이 끊어졌습니다"와 폼 유지. 새 방 만들기 -> 대기실(방 ID, 복사 성공 안내, 복사 실패 폴백 입력칸 선택, 좌석 1(동가)) -> 시작 -> 대국: 통과.
- (c) 두 번째 컨텍스트: 없는 방 ID는 "해당 방을 찾을 수 없습니다..." 한글, 입력 유지. 소문자+공백 입력은 정규화되어 입장(좌석 2 남가), 시작 후 양쪽 진행: 통과.
- (d) 지연 프록시(8081)로 검증: 연결 중 방 만들기/입장 비활성 + "서버에 연결 중…/취소", Enter 연타해도 중복 전송 없음. 새로고침 시 "이어서 접속 중…" + "취소(나가기)" 동작, 취소 후 저장 세션 삭제, 새로고침해도 입장 화면. 나가기 후 새로고침도 입장 화면: 통과.
- (e) 서버 프로세스 종료: 대국 중 "재접속 중" + 안내(패 버튼 비활성). 서버 재기동(방 소멸) 후 unknown_room 한글 오류, 입장 화면 복귀, 저장 세션 삭제, 새 방 만들기 가능. 대기실에서 종료해 재시도 상한 초과: "연결이 끊겼습니다. 나가기를 눌러 주세요" + 나가기 -> 입장 화면, 세션 삭제: 통과.
- (f) 390px, 768px: 모든 화면 가로 넘침 0(scrollWidth==clientWidth). 입력 3개 label 연결·aria-describedby·aria-invalid 확인, :focus-visible 3px 금색 외곽선. 이름칸 Enter는 방 만들기(이름·서버 주소 폼이므로 의도에 부합), 방 ID칸 Enter는 입장: 통과.
- 콘솔: 앱 오류/경고/미처리 예외 0. 브라우저 자체 네트워크 오류만 발생(ws://localhost:9 ERR_UNSAFE_PORT, 서버 종료 중 ERR_CONNECTION_REFUSED) - 의도된 시나리오.
- 스크린샷: C:\Users\park\.claude\jobs\1ef5b1fa\tmp\pp\shots\ (w7-a1-select, w7-a2-local, w7-b1~b8, w7-c1~c3, w7-d1-resuming, w7-d2-connecting, w7-e1~e4, w7-f-m390-*, w7-f-t768-*, w7-g1-gameend-server, w7-g2-after-exit, w7-h1-silent-join, w7-l1-local-gameend)

## 2) GameEnd
- 서버(startingScore 500, 포트 8082)에서 사람 1+봇 3 진행: "게임 종료 / 1위 하가 3100 / 2위 대면 500 / 3위 상가 500 / 4위 나 -2100", 안내 "온라인 대전에는 새 게임이 없습니다...", 버튼 "나가기 (입장 화면으로)"만. 클릭 시 입장 화면, 저장 세션 null, 새로고침해도 입장 화면. 게임 종료 상태에서 새로고침하면 종료 화면이 복원됨. 순위 이름은 seatName 기준(나/하가/대면/상가) 정상.
- 로컬: 게임 종료 화면 "새 게임" 정상, 클릭 시 새 판 시작(동 1국 0본장).

## 3) entryPlan/joining
- 표 9행을 entry.ts와 대조: 전부 일치. App.tsx는 c.status/c.roomId/c.joining만 사용(화면 판단에 view 직접 사용 없음; c.view는 GameScreen 렌더용).
- joining 해제 지점: joined, error, closed, join 전송 실패(두 곳). connecting/reconnecting에서는 유지(의도). 모의 테스트 8개 통과(위 1번), 무응답 서버만 예외(위 2번).

## 4) 안전
- 사용자 입력은 모두 React 텍스트 노드/value로만 렌더(dangerouslySetInnerHTML/innerHTML 없음). 이름 `<b>x</b>` 입력 시 DOM에 리터럴 태그 없음 확인. 서버 오류 원문도 텍스트로만 렌더.
- localStorage: `mahjong.entry.v1`={name,serverUrl}(토큰 없음), `mahjong.session.v1`={roomId,seatToken,seq,serverUrl} 분리. 토큰은 DOM/URL에 없음(코드/실행 확인).
- 세션 복원은 `stored.serverUrl === options.url`일 때만(wsClient.resumeStored), 다른 주소 입력 시 새 세션은 resumeStored:false로 시작: 토큰이 다른 서버로 가지 않음.

## 5) 회귀
- npx tsc 통과, npm test -w @mahjong/web 211개 통과(기존 177 수정 없음 + 신규 34), npm run build 성공. packages/server, packages/core git diff 변경 없음.
- App.tsx 모드 분기 우선순위: online prop > ?online=1 > initialSeed/initialSession(로컬) > 선택 화면. 기존 `online ?? isOnlineRequested()` 동작 유지, 인자 없는 App의 기본이 로컬에서 선택 화면으로 바뀐 것이 의도된 변경.

## 6) 변이(작성자와 다른 것, 모두 원복 후 sha256 일치)
- 검출: error 핸들러 joining 해제 제거, 서버 주소 검증 제거, 이름 길이 검증 제거(2개 실패), 서버 모드 새 게임 노출, requestJoin joining=true 제거, connecting+joining 시 버튼 활성화.
- 생존: closed 핸들러 joining 해제 제거(실질 공백, 1번), joined 핸들러 joining 해제 제거(이후 closed/leave가 해제하므로 사실상 동등).
- 임시 파일: $CLAUDE_JOB_DIR/tmp/pp/w7/*(스크립트), packages/web/.tmpv 삭제 완료. vite/서버/Edge 프로세스 종료, 포트 5173/8080~8090 해제 확인.
