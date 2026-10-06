# 20-1 웹 연결 상태 UX 검증 (code-verifier)

결론: 치명·높음 없음. 중간 2건, 낮음 5건. 소스 수정 없음(변이는 모두 원복, sha256 전체 일치, git status는 시작 때와 동일). server/core diff 없음.

## 실행
- web tsc 오류 0, `npm test -w @mahjong/web` 306개 통과, `npm run build -w @mahjong/web` 성공.

## 발견 문제 (심각도순)
1. (중간) 연결 배너(position: fixed, top 8px)가 헤더를 덮어 헤더의 '나가기'를 누를 수 없다. 390/768/1280px 모두 elementFromPoint가 connection-banner를 반환. 390px에서는 배너가 헤더 전체(4~62px)와 보드 위쪽까지 덮고, 알림이 함께 뜨면 8~136px을 덮는다(h4-390-stack.png). 재접속 중에 사용자가 쓸 수 있는 유일한 이탈 수단이 가려진다(closed 배너에는 '다시 연결'이 있으나 '나가기'는 여전히 가려짐). 헤더 상태 문구('연결 끊김' 등)도 가려져 c1-displaced-T1.png에서 잘려 보인다.
2. (중간) 서버 주소 전환 안내(switchNote)가 사실상 보이지 않는다. 입장(joined)과 동시에 지워지는 설계라 정상 속도에서는 수십 ms만 보이고, 응답을 1.5초 지연시켰을 때만 보인다(g3-switch-note-slow-join.png). 세션은 실제로 지워지고 토큰은 새 서버로 가지 않는다(안전은 확인). 안내의 목적(되돌릴 수 없는 정리 통지)을 달성하지 못한다.
3. (낮음) 레이아웃이 흔들린다. 재접속 화면에 기존 인라인 문구('연결이 끊겨 다시 접속하는 중입니다…', 49px)가 그대로 남아 배너와 같은 말을 중복하고 보드가 49px 밀린다(390px에서 66에서 115). closed에서는 기존 '연결이 끊겼습니다. 나가기를 눌러 주세요'가 배너의 '다시 연결'과 함께 보여 안내가 상충한다(작성자 한계에 명시됨). 요약의 '레이아웃을 밀지 않음'은 notice에만 해당한다.
4. (낮음) 방 없음+reconnecting(새로고침 후 resume)에는 배너·횟수가 없고 '취소'만 있다. 서버가 죽어 있으면 최대 약 75초 동안 입장 화면에 '재접속 중' 헤더와 비활성 버튼만 보인다(작성자 한계에 명시).
5. (낮음) unknown_room 복귀 문구가 '해당 방을 찾을 수 없습니다. 방 ID를 확인해 주세요'다. 서버 재기동으로 방이 사라진 경우 사용자가 방 ID를 입력한 적이 없어 어색하다.
6. (낮음) 서버 오류(error 이벤트) 처리가 ack 타이머만 지우고 acked는 풀지 않는다(useServerGame.ts case "error"). ack 후 무관한 오류가 오고 view가 영영 안 오면 다음 재연결까지 조작 불가가 이론상 가능. 재현하지 못했고(2인 동시 응답에서 서버가 ack 후 view를 보내 10초 거짓 타임아웃도 발생하지 않음), 발생 가능성 매우 낮음.
7. (낮음) 테스트 공백: 변이 N6(resumable이 저장 세션의 serverUrl 비교를 무시)이 생존. 이 변이는 등가가 아니다. 다른 서버의 세션이 저장된 채 현재 서버 연결이 실패하면 '다시 연결' 버튼이 뜨고 눌러도 '저장된 접속 정보가 없어…' 오류만 나는 동작 차이가 생긴다.

## 1) 실브라우저 (headless Edge + puppeteer-core, 실서버 + vite + TCP/WS 프록시)
스크린샷: C:/Users/park/.claude/jobs/1ef5b1fa/tmp/pp/shots20/ (a1-reconnecting, a2-recovered, b1-closed, b2-recovered, c1-displaced-T1, c2-T1-after-takeover, c2-T2-displaced, d2-bad-token, d3-closed-server-down, d1-unknown-room, e1-timeout-notice, e2-auto-mode-notice, e3-after-act, f1-response-timeout, f2-slow-2500, f3-join-delay-pending, f3-join-timeout, f4-rejoin-timeout-closed, g1-entry-prefs-B, g2-after-create-B, g3-switch-note-slow-join, h1~h4-390-*, tp*.png). 모두 통과이며 위 문제만 예외.
- (a) 소켓 강제 종료: 배너 '시도 1/10회' 표시, 약 0.8초 뒤 복귀, 배너 소멸, 이후 조작 정상.
- (b) 프록시 차단 75초: 1~10/10회(1,2,4,8,10초... 간격) 표시 후 closed 배너 + '다시 연결'. 차단 해제 후 클릭으로 복귀. 두 번째 단절은 다시 1/10부터(백오프 초기화). 서버 프로세스 종료 80초 후 재기동하고 '다시 연결'하면 unknown_room이 되어 세션 삭제, 입장 화면, 헤더 '입장 전'.
- (c) 두 번째 탭: 첫 탭 displaced 안내와 '여기서 다시 접속', 20초간 소켓 신규 생성 0건(자동 재시도 없음). 버튼으로 접속하면 반대 탭이 displaced, 이후 핑퐁 없음. 프록시 로그 업그레이드 3건(탭2 resume 2회는 dev StrictMode 이중 마운트로 보임, 탭1 takeover 1회).
- (d) bad_token(저장 토큰 변조 후 새로고침): '저장된 좌석 정보가…' 문구, 세션 삭제, 헤더 '입장 전'. unknown_room도 동일(위).
- (e) 서버 TURN=8초, 연속 2회: timeout 알림 약 4.96초 후 소멸, auto_mode 알림은 26초 이상 유지, 행동하면 해제. timeout 알림 중 행동하면 즉시 해제.
- (f) 프록시 blackhole: act 후 9.5초까지 조작 불가, 10.5초에 '서버 응답이 없습니다' + 조작 재가능, 재클릭 전송됨, 차단 해제(연결 리셋) 후 정상 복구. 2.5초 지연 40초/6초 지연 40초 동안 오작동·거짓 알림 0. join 응답 4초 지연: 연결 중 후 정상 입장. 7초 지연(합 14초): 12.2초에 '서버 응답이 없습니다' 후 폼 복귀·재시도 정상. rejoinTimeout: 차단(수신 폐기) 상태에서 시도 사이 약 11~14초, 10/10회 후 175초에 '서버 응답이 없어 다시 접속하지 못했습니다' + '다시 연결', 해제 후 복귀(f4-*.out). 참고로 첫 실행은 내 다른 스크립트가 프록시를 풀어 오염되어 재실행했다.
- (g) 서버 B 입장 시 A 세션 삭제(서버 B에 보낸 첫 메시지는 토큰 없는 join뿐). 안내는 문제 2 참조.
- (h) 390px: 문제 1, 3. 가로 넘침(scrollWidth 390) 없음. 배너 표시/소멸 시 보드 이동은 인라인 문구 때문(문제 3), 배너 자체는 레이아웃 불변. 알림 단독(8~52px)은 헤더 위를 덮음.
- 콘솔: 앱 에러·미처리 예외 0. 브라우저가 찍는 'WebSocket connection failed' 네트워크 오류만 있음(단절 시나리오 의도).

## 2) 서버 모드 텐파이 (실서버 initialState 주입, 사람 3명 좌석 0/1/2)
- 서버가 계산한 oracle(humanTenpaiView)과 화면 일치. 좌석0(14장): '버리면 텐파이' 힌트 4개(2통→6삭9삭, 6삭→2통5통, 5통→6삭9삭, 9삭→2통5통). 좌석1: 텐파이+후리텐 배지+대기 2통x3 5통x2(자기 버림패 5통 때문에 후리텐). 좌석2: 후리텐 없이 동일 대기. 리치 후 좌석0: 텐파이 배지+대기 유지(tp3-seat0-after-riichi.png). 이후 좌석1 힌트에 '(후리텐)' 표기 정상. 펑 후 좌석1(멜드 후): 힌트 6삭→7삭, 7삭→6삭(탄키) 정상(tp6-seat1-after-pon.png). 모두 tp*.png.

## 3) 코드 리뷰
- 해제 조건 표와 코드 일치(notice: 소멸·act·닫기·새 notice 재시작·closed·joined·leave·언마운트, auto_mode 시간 비해제, 응답 타이머: 10초·view·오류·연결 변경·closed·leave·언마운트·ack 재시작, retry: connected/joined/connecting/closed). 언마운트 누수 없음(join/ack/notice 타이머 모두 정리). 예외: 오류 시 acked 미해제(문제 6).
- wsClient retry 이벤트는 setStatus 뒤 1회 emit만 추가, 재접속 동작 변경 없음(기존 wsClient 테스트 통과, 실브라우저 backoff 1/2/4/8/10 확인).
- 1008을 displaced로 묶는 한계는 문구로 병기되어 있고 사용자 영향은 안내 정확도뿐. 규칙 위반 종료도 '여기서 다시 접속'을 권하는 것이 한계.
- connecting+방 있음을 reconnecting 화면으로 분류: 수동 '다시 연결' 중 대국 위 입장 폼 방지 효과 확인. 입장 직후 joining(방 없음)은 영향 없음(entry 화면 유지). 부작용은 인라인 문구 중복(문제 3).
- entryPlan 표는 19-1 표와 모순 없음(기존 entry 테스트 수정 없이 통과). 추가된 건 statusLabel과 connecting+방 분기뿐.
- StatusStack fixed 배치: 문제 1.
- 정보 노출: 배너·알림은 정적 문구, 서버 오류 원문(message)은 표시되지 않고 코드 매핑/폴백만 표시. 대국·재접속·displaced 상태 DOM·URL·콘솔 로그에서 좌석 토큰과 서버 주소 노출 0. 서버 주소 전환 시 B로 가는 메시지에 토큰 없음(프록시 C->S 로그).

## 4) 테스트 품질
- 작성자 생존 변이 4건: leave의 ack 타이머 해제(close가 closed 핸들러로 해제), closed/joined의 retry 해제(배너가 reconnecting에서만 retry를 읽고 connected가 해제), auto_mode 소멸 타이머(만료 patch가 timeout일 때만 지움)는 모두 등가로 판정.
- 내 변이 18개 중 17개 검출, 1개 생존(N6, 문제 7). 검출: notice 기본 5초, 응답 기본 10초, 1008 자동 재시도 허용(10개 실패), beginConnect 백오프 미초기화, reconnect 가드 제거, displaced가 방 삭제, discardOther 비교 반전, retry 번호 +1, 만료 문구 제거, act가 notice 유지, 저장 세션 없는 버튼, auto_mode 닫기 버튼, connecting+방 화면, retry 이벤트 무시, 새 notice 타이머 미재시작, 언마운트 notice/ack 타이머 미해제, 배너 max 오류.
- useServerGame.integration.test.tsx의 `acts >= 10`: 10회 반복 중 1회 실패(expected 9 >= 10). 이 파일과 테스트 대상(서버 상태 진행)은 이번 diff에 없고, 서버 RNG가 무작위(secureRandom)라 사람이 계속 패스·쯔모기리할 때 국이 9번 안에 끝나는 판이 가끔 나오는 것이 원인으로 이번 변경과 무관한 기존 불안정. 재현율 약 10%(1/10).

## 정리
서버 5173·8080~8085·프록시 8090/8091(제어 8098/8099) 종료, 포트 해제 확인. headless Edge 잔존 0. 임시 파일은 $CLAUDE_JOB_DIR/tmp(v, pp).
