# 치/펑/깡 판정 및 처리 구현 (code-writer)

## 만든/수정한 파일
- packages/core/src/call.ts (신규)
- packages/core/src/call.test.ts (신규, 30개 테스트)
- packages/core/src/index.ts (`export * from "./call.js"` 추가)

## 설계 결정
- 좌석은 0~3 정수. 상가 = (내 좌석+3)%4. `from`은 left/across/right.
- 타입: `CalledMeld` = ChiMeld | PonMeld | DaiminkanMeld | ShouminkanMeld | AnkanMeld (기존 meld.ts의 `Meld`와 충돌 방지를 위해 이름 분리). 상태는 `CallState {hand, melds}`.
- 적5: 판정은 종류 기준. canChi/canPon은 실제 Tile 객체 선택지(`use`)를 반환하고 적5 사용 여부가 다르면 별도 선택지(미사용이 먼저). applyChi/applyPon의 `use`로 선택. 치는 선택지가 여러 개인데 use 생략 시 에러, 펑은 생략 시 첫 선택지(적5 미사용).
- canAnkan은 종류별 대표 패 배열, canShouminkan은 `{meldIndex, tile}[]`, canDaiminkan은 boolean.
- 장수 검증: 손패 + 멜드*3 = 13(치/펑/대명깡 직전), 14(안깡/카칸 직전). 깡도 3장으로 계산.
- isMenzen: 멜드가 모두 안깡이면 true.

## 테스트 결과
- vitest: 10 파일, 201개 통과(기존 171 + 신규 30). `tsc --noEmit` 통과.

## 후속 연동 필요 (이번 범위 밖, 미변경)
- score/yaku/agari/dora에 CalledMeld 반영 (쿠이사가리, 부수, 멘젠 한정 역, 도라 계산에 멜드 패 포함)
- 깡 후 영상패 뽑기(깡 처리 후 손패는 13장 상태), 깡도라, 창깡, 치쿠, 유국/4깡 유국
- 쿠이가에시(치/펑 후 버리기 제약)
