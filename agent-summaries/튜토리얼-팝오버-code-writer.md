# 튜토리얼 화면 설명 팝오버 (code-writer)

## 변경 파일
- packages/web/src/tutorial/TutorialPage.tsx: 고정 설명 패널 제거, 누른 요소 옆 fixed 팝오버(role=dialog, aria-labelledby) 추가, 기본 안내 한 줄은 단계 안내 영역의 작은 힌트로 이동
- packages/web/src/tutorial/popoverPosition.ts (신규): computePopoverPosition 순수 함수
- packages/web/src/tutorial/popoverPosition.test.ts (신규), TutorialPage.test.tsx ('화면 설명 팝오버' 4개로 교체)
- packages/web/src/styles.css: .tutorial-info 계열을 .tutorial-popover(z-index 45, 모달 60 아래/sticky 헤더 40 위)로 교체, 꼬리(::after)

## 위치 계산 규칙
- 기본은 요소 아래(gap 10px). 아래 공간이 창 높이보다 작고 위가 더 넉넉하면 위에 배치
- 좌우는 요소 가로 중심에 맞추고 뷰포트 안(margin 8px)으로 클램프, 상하도 클램프
- 꼬리는 요소 중심을 가리키며 창 안(14px 안쪽)으로 제한
- 열릴 때, 스크롤(capture), 리사이즈 때 재계산. 요소가 DOM에서 사라지면 닫음
- 창 폭 300px, max-width calc(100vw - 16px)

## 동작
- 한 번에 하나, 다른 요소는 교체, 같은 요소 재클릭은 닫힘(같은 종류 여러 개도 요소 단위 구분)
- 닫기: 닫기 버튼, Esc, 바깥 클릭, 단계 전환. 바깥 클릭은 문서 리스너라 연습 클릭은 그대로 동작
- 키보드(Enter/Space)로 열면 닫기 버튼으로 포커스 이동, 닫으면 원래 요소로 복귀. 마우스로 열면 포커스 이동 없음
- 대상에 aria-expanded/aria-controls 부여. aria-live 사용 안 함(중복 낭독 방지)
- infoTexts.ts, boardInfo.ts는 그대로 재사용

## 테스트
- npm test -w @mahjong/web: 전체 390개 통과 (popoverPosition 4개, 팝오버 4개 포함)
- npm run build -w @mahjong/web: 통과

## 육안 확인 (headless Edge, 별도 포트 5199, PID로 종료 후 포트 비어 있음 확인, 임시 파일 삭제)
- 1280x800, 390x844, 1280x390에서 도라 표시패/점수/리치봉 클릭: 창이 뷰포트 안, scrollWidth가 뷰포트 폭과 같아 가로 스크롤 없음, 꼬리가 요소를 가리킴
- 내 후로(3단계 이후)와 위쪽 배치(above)는 캡처로 직접 확인하지 못했고 순수 함수·jsdom 테스트로만 검증

## 남은 한계
- 창이 요소 아래의 연습용 패/버튼을 일시적으로 가릴 수 있음(닫기/바깥 클릭으로 해소). 가림 회피는 위/아래 선택까지만
- 스크롤 중에는 이벤트마다 재계산
