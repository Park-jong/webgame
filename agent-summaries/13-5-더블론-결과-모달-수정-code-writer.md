# 13-5 더블론 결과 모달 수정 (code-writer)

## 문제
더블론 결과 모달이 390x844에서 801px(보이는 영역 776px)라 "다음 국" 버튼이 잘림. 1024x707에서도 849px.

## 변경 (packages/web만)
- `src/components/ResultModal.tsx`: ResultModal과 GameEndScreen을 `.modal-header`(제목) / `.modal-body`(내용) / `.modal-footer`(주 액션) 구조로 분리. 두 컴포넌트와 유국 모달이 같은 구조를 공유.
- `src/styles.css`:
  - `.modal`을 flex column + `overflow: hidden`, `max-height: calc(100vh - 20px)` 후 `calc(100dvh - 20px)` 폴백 선언.
  - `.modal-body`만 `overflow-y: auto; overflow-x: hidden; min-height: 0`. 헤더와 푸터는 `flex: 0 0 auto`로 고정.
  - 760px 이하에서 모달 패딩/제목/역 목록/도라 줄/점수표 간격을 줄이고, 모달 안 패(`.tile-sm`) 폭은 24px로 고정.
  - 1280 데스크톱은 구조만 바뀌고 모양은 거의 동일. 내용이 짧으면 스크롤바 없음.
- `src/components/components.test.tsx`: 구조 테스트 3개 추가 (푸터가 body 밖/dialog 직계, 더블론 두 화료자와 버튼, 유국/게임 종료 동일 구조). 기존 테스트는 수정하지 않음.

## 결과
- 루트 `npm test`: core 337 통과, web 54 통과 (기존 51 + 신규 3).
- `npm run build`: 통과.
- 실제 높이 실측(390x844, 1024x707)은 미실시. verifier가 브라우저로 확인 필요.
