# 튜토리얼 화면 요소 설명 (code-writer)

## 변경 파일 (packages/web/src, 공용 컴포넌트는 수정 없음)
- tutorial/infoTexts.ts (신규): id -> {title, text} 문구
- tutorial/boardInfo.ts (신규): 선택자 -> id 매핑, role/tabindex/aria-label/data-info 부여, 이벤트 대상 해석
- tutorial/TutorialPage.tsx: 설명 상태, 보드 래퍼(.tutorial-board), 고정 높이 "화면 설명" 패널(aria-live=polite, 단계 안내 아래), document click/keydown(Esc, Enter/Space)
- styles.css: .tutorial-info, 점선 outline(.tutorial-board [data-info])
- tutorial/TutorialPage.test.tsx: 화면 설명 테스트 3개 추가
- 용어 통일: 멜드/부로 -> 후로 (scenes.ts, infoTexts.ts, boardInfo.ts, 테스트 문구)

## 설명 대상
도라 표시패, 리치봉, 산패, 국/본장, 자풍, 친, 점수, 상대 손패(뒷면), 버림패, 리치 선언패, 리치 표시, 내 후로.
- 후로: "치·펑·깡으로 남이 버린 패(깡은 자기 패)를 가져와 손패 옆에 공개해 둔 패 묶음입니다..."
- 리치봉: "1000점 막대의 개수, 화료한 사람이 가져가요", 산패: "0이 되도록 아무도 화료하지 못하면 유국", 친: "점수 1.5배"
- 기본 상태에는 "화면의 점선 요소를 눌러 보면 설명이 나옵니다." 한 줄 표시

## 동작
- 공통 클래스를 DOM 선택자로 찾아 속성만 부여(재렌더마다 갱신). 같은 종류가 여럿이면 Tab 순서에는 첫 번째만.
- 닫기 버튼, Esc, 다른 곳 클릭, 단계 전환 시 닫힘. 설명 상태는 연습 reducer와 분리되어 완료 상태에 영향 없음.
- 기존 role=status는 단계 상태 한 개만 유지(설명 패널은 aria-live).

## 테스트
npm test -w @mahjong/web: 24 파일 383개 통과(후로 문구 반영 후 tutorial 30개 재통과), npm run build -w @mahjong/web 통과.

## 육안 확인
별도 포트 5391 vite + headless Edge, 1280px/390px에서 도라/상대 손패 클릭: 설명 표시, scrollWidth == 뷰포트(가로 스크롤 없음), 레이아웃 정상. 임시 파일 삭제, 서버 PID로 종료, 포트 비어 있음 확인.

## 한계
- 390px에서는 기존 CSS가 상대 손패 뒷면 줄을 숨겨 그 요소는 설명 대상이 되지 않음("손패 13" 텍스트만 보임).
- 점선 어포던스는 요소 위에 outline으로 표시, 설명 패널이 sticky라 스크롤 시 상단에 따라옴.
- 후로 변경 후 전체 육안 재확인은 하지 않음(텍스트만 변경).
