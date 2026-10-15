# 패 디자인 개선 (code-writer)

- 변경: packages/web/src/styles.css (수트 클래스 .tile-man/.tile-pin/.tile-sou 규칙만). TileView.tsx·tileText.ts·테스트 무변경.
- 색: 만 #b3211a(적) + 배경 #fdece6, 통 #0a4fb3(청) + #e6f0fd, 삭 #0c7a2c(녹) + #e5f5e6. 수트 한자는 font-weight 900.
- 모양 단서: 상단 띠(만=실선, 통=점선, 삭=세로줄) + 우하단 기호(만=작은 사각, 통=원, 삭=대마디 막대). 자패는 무수트 클래스라 기존 그대로.
- 패 크기는 불변. 웹 테스트 378개 통과, 빌드 통과. 6샷 육안 확인(1280/390, 흑백 포함).
- docs/screenshots 는 패 모양이 바뀌었으므로 갱신 권장(이번에는 미갱신).

## 후속: 상단 띠 제거
- packages/web/src/styles.css: .tile-man/.tile-pin/.tile-sou 의 ::before(상단 띠) 규칙 4개 삭제, 주석 갱신. ::before 는 absolute 였으므로 숫자 위치·패 크기 불변.
- 유지: 우하단 ::after 기호, 글자색, 배경 틴트, 굵은 수트 글자. 적5·리치·dimmed·highlight 규칙은 미변경.
- 웹 테스트·빌드 통과. 육안 캡처는 생략(레이아웃 영향 없는 순수 삭제).
