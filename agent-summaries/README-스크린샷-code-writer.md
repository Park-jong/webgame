# README 스크린샷 추가와 재작성 (code-writer)

- scripts/capture-screenshots.mjs 신규: vite dev 서버를 빈 포트로 띄우고 puppeteer-core + 시스템 Edge/Chrome(E2E_BROWSER 지정 가능)으로 로컬 모드 장면을 docs/screenshots/에 저장한 뒤 PID로 서버를 종료. 시드 1부터 탐색해 텐파이를 거쳐 화료로 끝나는 시드(4)를 선택.
- docs/screenshots/ (총 308,158바이트): mode-select.png 13KB, local-board-desktop.png 62KB(1280x900), local-tenpai-desktop.png 84KB(텐파이 배지·대기패), local-board-mobile.png 60KB(390x844, 텐파이 장면), result-modal-desktop.png 82KB(론 화료 결과 모달).
- README.md: 상단 소개 2문단과 스크린샷 섹션(한글 alt) 추가, 명령 표에 deploy:pages와 캡처 스크립트 추가, 현재 상태 3단계 문구에서 웹 정적 배포 사실 반영. 나머지 내용(룰 범위, 모드, E2E, alias 구조, Pages, 알려진 한계)은 유지.
- 생략한 항목 없음. 게임 로직·루트 package.json 변경 없음, 커밋·배포 안 함.
