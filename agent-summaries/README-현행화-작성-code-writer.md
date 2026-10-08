# README 현행화 작성 (code-writer)

## 한 일
- 루트 `README.md`를 첫인상 문서 구성으로 다시 작성했다(코드 수정 없음, 커밋 없음, 약 125줄).
- 구성: 한 줄 소개 / 현재 상태 표(1~5단계) / 구현된 룰 / 빠른 시작(명령 표, 로컬·온라인 모드, 포트·환경변수, E2E) / 프로젝트 구조(서버 권위·좌석 토큰·프로토콜 개요) / 알려진 한계 / 로드맵 / 참고 문서.
- 테스트 수는 마지막 확인값 "core 611 / server 204 / web 353"만 기재했고 테스트는 실행하지 않았다.
- 기존의 긴 E2E 상세(뷰포트 겹침 검사 설명, 재시도 사유 등)는 요약으로 줄였다. 상세는 `packages/web/e2e/run.mjs` 헤더와 ROADMAP에 남아 있다.

## 근거 확인 파일
- package.json(루트, core, server, web): dev, dev:all, build, test, e2e 스크립트
- scripts/dev-all.mjs: 8080 기본, PORT 공백 처리, VITE_SERVER_URL 기본값, 포트 점유 시 종료
- packages/web/e2e/run.mjs: E2E_BROWSER 동작(지정했는데 없으면 종료 1, 미지정 탐색 실패 시 종료 0), --repeat, --shots
- packages/server/README.md: 프로토콜, 방당 4명, start 시 빈 좌석 봇 채움, 시작 후 입장 불가(room_full), 30초/15초/자동 모드 3회, 다음 국 5초, 삼가화 tripleRon 기본 abort
- packages/web/README.md, ROADMAP.md, packages/core/src(ryuukyoku.ts, game.ts의 tripleRon)

## 확신이 약해 약하게 쓰거나 뺀 항목
- "일반 역 28종, 역만 11종, 더블역만 4종"은 ROADMAP 진행 기록 값을 인용했다(코드로 재집계하지 않음).
- packages/core에는 README가 없어 링크는 디렉터리로 걸었다.
- 웹 공통 미검증 항목(터치, 360px 미만, 접근성)은 ROADMAP 2단계 한계에서 가져왔다.
- 전체 `npm test` 등은 실행하지 않았으므로 명령은 package.json 근거만 있다.
