# 튜토리얼 상대 손패 뒷면 표시 (code-writer)

- TutorialPage.tsx: 상대 3명 handCount를 0에서 13으로 변경(항상 13, 치/펑 단계 포함). 뒷면만 렌더, 실제 패 값 없음. 상가 버림패는 5통 한 장 규칙 유지.
- BoardView.tsx, SeatPanel.tsx: 튜토리얼 전용이던 hideOpponentHands/hideOpponentHand prop 제거(다른 사용처 없음). 로컬/온라인 동작 동일.
- TutorialPage.test.tsx: 상대 .opponent-hand 3줄, 각 13장 모두 "뒷면", 손패 장수 표시 3개, 버림패 규칙 유지를 검증하도록 갱신.
- 결과: web 380개 통과, 빌드 통과. 1280/390px 캡처 확인, 가로 스크롤 없음(390px은 기존 CSS대로 뒷면 줄 대신 "손패 13" 표시).
