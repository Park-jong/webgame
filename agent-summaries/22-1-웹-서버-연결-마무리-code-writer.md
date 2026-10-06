# 22-1 웹–서버 연결 마무리 (3단계 마무리 4번, code-writer)

커밋하지 않았고 server/core 소스는 수정하지 않았다. 새 의존성은 `puppeteer-core`(web devDependency) 하나다.

## 변경 파일
- `scripts/dev-all.mjs` (신규), 루트 `package.json`: `npm run dev:all`. 서버(`node --import tsx src/main.ts`)와 vite(`node .../vite/bin/vite.js`)를 셸 없이 각각 한 프로세스로 실행하고 `[server]`/`[web]` 접두어로 출력. 시작 전 포트를 점검해 사용 중이면 PORT 안내(bash/PowerShell/cmd)를 출력하고 종료. `PORT`는 서버에 전달하고 웹의 `VITE_SERVER_URL` 기본값도 `ws://localhost:$PORT`로 맞춘다(직접 지정한 `VITE_SERVER_URL`이 우선). 한쪽이 종료되면 나머지도 종료, SIGINT/SIGTERM/SIGBREAK에서 둘 다 종료.
- `packages/web/e2e/run.mjs`, `packages/web/e2e/test-server.mts` (신규), `packages/web/package.json`(`e2e` 스크립트, `puppeteer-core` devDependency), `package-lock.json`, `.gitignore`(`packages/web/e2e/artifacts/`): 브라우저 E2E.
- `packages/web/src/components/StatusStack.tsx`, `packages/web/src/styles.css`, `packages/web/src/components/statusOverlay.test.tsx` (신규 테스트 1개): 재접속 배너가 결과 모달 제목을 가리던 문제 수정.
- `README.md`(재작성), `ROADMAP.md`, `packages/server/README.md`(웹이 연결하지 않는다는 낡은 문구 교체), `packages/web/README.md`(두 모드·e2e 안내).

## 실행·E2E 방법
- `npm run dev:all` (PORT 충돌 시 `PORT=9090 npm run dev:all` / `$env:PORT=9090; npm run dev:all` / `set PORT=9090 && npm run dev:all`).
- `npm run e2e -w @mahjong/web [-- --repeat N] [-- --shots]`. 임의의 빈 포트로 서버·vite를 띄우고(개발 서버와 충돌 없음) 시스템 Edge/Chrome(`E2E_BROWSER`로 경로 지정)로 실행. 브라우저·puppeteer-core가 없으면 이유를 출력하고 종료 코드 0으로 건너뛴다(이 분기는 Edge가 있는 이 PC에서는 실제로 타 보지 못했다). 기본 `npm test`에는 포함되지 않는다(web vitest include는 `src/**`).
- 시나리오(각 단계에 단언): 모드 선택 -> 온라인 -> 이름 -> 방 만들기(방 ID 8자) -> B가 방 ID로 입장(좌석이 서로 다름) -> 시작 -> UI 클릭(액션바·패 클릭, B는 펑/치도 선택)으로 진행 -> B의 소켓 강제 종료(`ws.close()`) 후 배너 표시, 자동 재접속, 저장 세션 불변, 이후 B가 다시 행동 -> 1국 결과 모달: B는 카운트다운이 5->1로 감소하고 클릭 없이 자동으로 닫힘, A(390x844)는 가짜 소켓으로 재접속 배너를 유지한 채 390x844와 768x500에서 `elementFromPoint`로 모달 제목·푸터 버튼·배너 나가기 확인 -> 사람도 화료하며 게임 종료까지 -> 게임 종료 화면(4줄 순위, 내 줄 강조, 나가기만 표시, 새 게임 없음 안내, 두 화면 점수 일치) -> 나가기(입장 전, 저장 세션 삭제) -> 콘솔 에러 0(favicon 404만 제외).
- 사람 A는 모바일 폭(390x844), B는 데스크톱(1280x900). 1국에서는 사람이 화료하지 않는다(1국에서 게임이 끝나면 자동 진행 모달을 못 보기 때문). 그래도 1국에서 끝나면 같은 회 안에서 새 방으로 최대 3번 재시도하고 사유를 출력한다.
- 실패 시 단계 메시지 + 두 페이지 스크린샷(`e2e/artifacts/runN-FAIL-A/B.png`) + 서버·vite 로그 끝 15줄. 종료 시 브라우저 -> vite -> 서버 순으로 정리하고 포트 해제와 브라우저 PID 종료를 확인(실패하면 그 회를 실패 처리).
- 테스트 서버(`test-server.mts`): 시작 점수 9000, botDelay 40ms, 응답 구간 250ms, 턴 12초, 응답 8초, 끊김 2초, 자동 모드 지연 100ms. `nextRoundDelayMs`는 웹의 '약 5초' 추정과 맞추려고 기본 5000을 유지.

## 재현율
- 시작 점수 3000(초기 설정): 5회 중 4회 통과. 실패 1회는 1국 종료 시 게임이 끝나는 경우가 3번 연속이라 모달 자동 진행을 확인하지 못한 것(앱 결함 아님). 1국에서 끝나는 비율이 높아(대략 시도의 절반 이상) 9000으로 올렸다.
- 시작 점수 9000(최종 설정): 5회 5/5 통과, 이어서 5회 5/5 통과 = 10/10. 시나리오 재시도는 10회 중 1회(1국에서 게임이 끝남). 1회 소요 약 40~125초(게임 길이에 따라 다름).
- 이 통과 횟수는 간헐 실패가 없다는 증명이 아니다.

## 21-2 이월 항목: 재접속 배너가 결과 모달 제목을 가림
- 현재 상태 확인: E2E에서 수정 전 768x500은 제목이 가려짐(`title:false`, 배너 y 50~151, 제목 y 72~107). 390x844는 그날 모달 높이에서는 겹치지 않았다.
- 수정(CSS 변수 방식, 작은 변경): `StatusStack`이 보이는 동안 자기 아래 가장자리를 `document.documentElement`의 `--overlay-top`으로 설정(ResizeObserver/resize, 사라지면 제거). `.modal-backdrop`의 위쪽 패딩과 `.modal`의 max-height가 이 값을 반영(기본 0px이라 배너가 없으면 변화 없음, 760px 이하 규칙도 같이 수정).
- 검증: 수정 후 E2E 10회 모두 390x844·768x500에서 제목·푸터 버튼·배너 나가기가 `elementFromPoint`로 자기 자신을 반환. 스크린샷으로 모달이 배너 아래에 배치된 것을 확인. 부작용: 배너(또는 알림 카드)가 떠 있으면 모달이 그 아래로 내려가 높이가 줄어든다(내용은 내부 스크롤).

## 최종 점검
- 루트 `npm run build` 통과. `npm test`: core 22파일 595개, server 13파일 202개, web 21파일 353개 통과(web은 신규 1개 포함).
- `dev:all` 확인: 정상 기동(서버 :8080 + vite :5173, HTTP 200), `PORT=9090`(서버 9090 + 웹 5173 기동), 8080 점유 시 안내 후 종료, 서버 프로세스를 강제 종료하면 vite도 종료되고 스크립트 종료(자식 0개). 콘솔 Ctrl+Break(SIGBREAK) 이벤트로 둘 다 종료되고 포트 해제 확인. Ctrl+C(SIGINT) 이벤트는 이 하네스에서 재현하지 못했다(Ctrl+Break로 같은 정리 경로를 확인, 핸들러는 SIGINT에도 등록).
- 웹이 `VITE_SERVER_URL`을 쓰는 것은 E2E(입력칸 기본값이 임의 포트의 서버 주소인지 단언)로 확인. `dev:all`의 `VITE_SERVER_URL` 전달 자체를 브라우저로 따로 확인하지는 않았다(같은 메커니즘).
- 작업 후 서버·vite·headless Edge 프로세스 없음, 사용한 포트 해제 확인. 사용자의 Edge는 건드리지 않았다.

## 알려진 한계
- `dev:all` 프로세스만 강제 종료(TerminateProcess/SIGKILL)하면 자식이 남는다(핸들러가 실행되지 않으므로). Ctrl+C·Ctrl+Break·정상 종료·자식 종료는 정리된다.
- E2E의 소켓 끊김은 `ws.close()`와 가짜 소켓으로 재현한다(실제 네트워크 단절·오프라인 모드는 사용하지 않음). 가짜 소켓은 페이지의 `WebSocket` 생성자를 덮어쓰는 방식이다.
- E2E는 사람 정책이 단순하다(패 클릭은 마지막 패, 패스 우선; B는 펑/치를 취함, 리치·깡 선택은 하지 않음). 화료는 1국 이후에만 한다.
- 시작 점수가 9000이라도 1국에서 게임이 끝나면 재시도하며, 이는 재현율에 포함되지 않고 재시도 횟수로만 기록된다.
- 배너가 떠 있는 동안 모달이 아래로 밀리는 것은 의도된 부작용이다. 배너 자체가 보드 윗부분을 가리는 기존 한계는 그대로다.
- 알려진 서버·웹 한계 목록은 ROADMAP "3단계 남은 항목"에 정리했다(시작 전 착석 현황·시작 권한자, 방 없는 resume 중 배너와 최대 75초, 1008 구분, seq 프로토콜, 새로고침 시 카운트다운 오차, 서버 모드 행동 로그 없음).
