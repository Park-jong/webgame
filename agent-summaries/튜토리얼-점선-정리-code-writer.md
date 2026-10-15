# 튜토리얼 점선 정리
- 변경: packages/web/src/styles.css, tutorial/TutorialPage.tsx, tutorial/TutorialPage.test.tsx
- `[data-info]` 점선 outline 제거. cursor:pointer, hover 배경 틴트, focus-visible 실선, aria-expanded=true 실선 outline+틴트. 용어(.tutorial-term) 점선 밑줄과 금색 응답 대상 규칙은 유지.
- 힌트: "도라 표시패, 점수, 버림패 같은 화면의 각 부분을 눌러 보면 설명이 나옵니다."
- 테스트: web 402개 통과, 빌드 통과.
- 한계: 헤드리스 육안 캡처는 수행하지 못함.
