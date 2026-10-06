# 22-1 웹–서버 연결 마무리 검증 (code-verifier)

소스 수정·커밋 없음(변이는 모두 원복, sha256 일치 확인). 서버·vite·headless Edge 모두 종료, 포트 해제 확인.

## 결론
치명적 결함 없음. 아래 낮은 심각도 6건.

## 발견 문제 (심각도순)
1. (낮음~중간) web 전체 테스트 1회 간헐 실패: useServerGame.integration.test.tsx "사람 1 + 봇 3 ... 한 판" 1건. `npm run build` 직후 첫 전체 실행에서만 발생, 이후 단독 3회·전체 5회(코어/서버 테스트 동시 부하 포함) 모두 통과. 실패 메시지를 확보하지 못해 원인 미상(부하 시 타임아웃 추정).
2. (낮음) E2E 390x844 겹침 검사가 변별력이 약함: styles.css 760px 이하 규칙의 `padding-top: calc(6px + var(--overlay-top))`를 제거해도 E2E가 통과(mE2 생존). 결과 모달이 짧아 겹치지 않기 때문. README/ROADMAP이 "390x844, 768x500에서 확인"이라 쓰므로 390 쪽 보장은 과장. 별도로 만든 긴 모달 주입 검사에서는 --overlay-top 없으면 390x844/768x500/390x500/1280x900 모두 제목이 가려지고, 있으면 모두 제목·푸터가 눌림(CSS 자체는 정상).
3. (낮음) E2E_BROWSER에 존재하지 않는 경로를 주면 오류·건너뜀이 아니라 조용히 시스템 Edge/Chrome으로 대체됨(findBrowser가 존재하는 첫 후보 선택). 존재하지만 브라우저가 아닌 파일은 1초 만에 실패(종료 1, 포트 정리 OK). 건너뜀(종료 0) 분기는 CI에서 조용한 통과가 될 수 있음(문서에는 명시됨).
4. (낮음) dev:all에서 PORT가 빈 문자열/공백이면 Number("")=0이라 서버는 임의 포트, 웹 기본 주소는 ws://localhost:0으로 어긋남. 인젝션은 불가(셸 미사용, 정수 검증; "8080; calc"·abc·-1·70000·9090.5는 거부).
5. (낮음) README "dev-all만 강제 종료하면 자식이 남을 수 있다"는 이 환경(Windows)에서 재현되지 않음: taskkill /F로 dev-all만 종료해도 서버·vite가 곧 종료(파이프 끊김 추정). 문구는 가능성 서술이라 틀리진 않으나 보수적. 정상 종료 신호(SIGINT/SIGTERM/SIGBREAK) 경로는 Windows 하네스에서 직접 보낼 수 없어 자식 종료 경로로만 확인.
6. (사소) e2e/artifacts에 이전 실행의 FAIL 스크린샷이 남음(실행 시 비우지 않음, git 제외). 방 없는 resume 최대 약 75초 수치는 재현하지 못함(백오프 합 코드상 65~75초 범위로 타당해 보임).

## 확인 결과
1) dev:all: `PORT=9090 node scripts/dev-all.mjs`로 서버 9090 + vite 5173 기동, HTTP 200, 브라우저 입장 화면 서버 주소 기본값 `ws://localhost:9090` 확인. 서버 자식 강제 종료 시 vite·스크립트 종료, 잔존 0. 8080 점유 시 3개 셸 안내 후 종료 코드 1. 프로세스는 셸 없이 node로 직접 실행(Windows/bash 공통).
2) E2E `--repeat 3 --shots`: 3/3 통과(69/83/70초, 1회는 1국 종료로 시나리오 재시도 1회), 프로세스·포트 잔존 없음. 변이: 소켓 미종료(mB), 재접속 막기(wsClient, mA), 카운트다운 고정(mC), 콘솔 에러 주입(mD), 768x500 CSS 되돌림(mE1) 모두 종료 코드 1로 실패하고 정리됨. 브라우저 없음/puppeteer-core 없음 분기는 사본으로 확인: 메시지 출력 + 종료 0. 단언은 단계별로 구체적이며 실패 시 종료 코드 1.
3) --overlay-top: 위 2번. 배너 없을 때(로컬 모드 실제 결과 모달, 390x844·1280x900) 새 CSS와 HEAD CSS의 .modal 위치·크기·패딩·max-height가 완전히 동일. statusOverlay 테스트는 변이 2종(설정 제거, 해제 제거) 모두 검출(jsdom은 0px이라 값 자체는 검증 못 함).
4) 문서: 명령·포트·환경변수·테스트 수(core 595, server 202, web 353)·서버 기본 마감(30/15/3초)·seq 규칙(저장 seq+1+10=+11, 서버 상한 1000, ack는 해당 좌석에만)·시작 후 입장 거부(game_already_started)가 코드와 일치. "웹은 서버에 연결하지 않는다" 낡은 서술 잔존 없음. 줄바꿈: 작업 트리에서 ROADMAP.md만 CRLF(전 줄 일관), 나머지 LF(HEAD blob은 모두 LF, autocrlf=true라 git 경고만 있음, 혼재 없음). ROADMAP의 "응답 직후 seq 규약"과 "seq 프로토콜" 표기가 서로 다름(사소).
5) 위생: package-lock.json은 추가 309줄뿐(삭제 0, puppeteer-core와 의존성만), 라이선스 Apache-2.0/MIT/ISC/BSD, node_modules 추가 약 22MB. 브라우저 다운로드 없음(~/.cache/puppeteer 없음). .gitignore에 e2e/artifacts 포함. e2e·dev-all에 절대 경로·비밀 하드코딩 없음(Edge 후보 경로 목록만).
6) 전체: 루트 build 통과, core 595/server 202/web 353 통과(web은 1회 간헐 실패 후 재통과, 위 1번), web tsc 통과.
