# 튜토리얼 보드 화면 전환 (code-writer)

## 변경
- `components/BoardView.tsx`: 선택적 prop 추가 (`handSlot`, `actionSlot`, `tenpai`, `hideOpponentHands`). 기본 동작 불변.
- `components/SeatPanel.tsx`: 선택적 prop `hideOpponentHand` 추가 (상대 손패 장수/뒷면 줄 생략).
- `tutorial/TutorialPage.tsx`: 장면 데이터로 SeatView를 구성해 BoardView에 넣음. 안내 패널(제목/말풍선/패 종류)은 보드 위, 캡션/결과 카드/상태 문구는 보드 아래.
- `tutorial/scenes.ts`: `riichi?: boolean` 추가 (6, 7단계 리치 표시).
- `styles.css`: 튜토리얼 전용 손패/폭/타일 크기 규칙 제거, 묶음 손패 줄바꿈 규칙 추가.
- 테스트: `TutorialPage.test.tsx` 갱신(3단계 상가 버림패 1장, 상대 손패 미렌더, 4좌석 보드, 리치 표시).

## 화면 구성
상단 대면, 좌 상가, 중앙 국 정보(동 1국 0본장, 리치봉 0, 산패 70, 도라 표시패 6통 1장), 우 하가, 하단 내 좌석(손패, 뽑은 패, 멜드, 텐파이 정보, 행동 줄). 점수 25000 고정, 상대 손패/버림패 없음.
- 3단계: 상가 버림패에 5통 한 장(응답 대상 강조 + 응답 안내 문구). 치/펑 후 내 멜드로 이동.
- 5단계 선언 후, 6, 7단계: 내 좌석 리치 배지. 5단계 선언 후 리치 버림패 표시.

## 검증
- web 테스트 380개 통과, 빌드 통과.
- headless Edge로 1~7단계를 1280px, 390px에서 캡처해 확인: 가로 스크롤/콘솔 오류 없음.
