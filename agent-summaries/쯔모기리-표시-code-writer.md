# 쯔모기리 버림패 표시

## 변경 파일
- packages/web/src/components/SeatPanel.tsx: Pond 항목에 tsumogiri 시 `pond-tsumogiri` 클래스, `data-tsumogiri`, `title="쯔모기리"` 추가 (aria-label은 그대로)
- packages/web/src/styles.css: `.pond-tsumogiri .tile { filter: brightness(0.78); }` 한 줄 추가
- packages/web/src/components/components.test.tsx: 쯔모기리/테다시 구분, 리치 선언+쯔모기리 조합 테스트 2개
- README.md: 버림패 표시 설명 한 줄

## 구분 방식
- 값 전달: 로컬(viewFor)·서버 모두 같은 SeatView/DiscardView라 tsumogiri가 이미 도달. 경로 수정 없음.
- 패 요소에만 brightness(0.78) 적용. 수트 색·기호 유지, 리치 표식·붉은 테두리·dimmed(opacity)·강조와 독립적으로 합성됨.
- 튜토리얼은 같은 Pond 사용(장면 버림패 tsumogiri=false면 변화 없음), 튜토리얼 파일 미수정.

## 결과
- npm test -w @mahjong/web: 24 파일 385개 통과
- npm run build -w @mahjong/web: 통과
- 육안: 빈 포트 dev 서버 + headless Edge, 시드 7, 10번 버리기(테다시/쯔모기리 교대), 1280px/390px 캡처 확인. 쯔모기리 패는 약간 어둡지만 숫자·수트 판독 가능. 임시 파일·프로세스 정리 완료.
