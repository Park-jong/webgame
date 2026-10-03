# 웹 UI 화면 문제 수정 (code-writer)

verifier의 실제 브라우저 검증 발견 사항을 `packages/web`에서 수정했다. core, ROADMAP, git 커밋은 건드리지 않았다.

## 변경 사항
1. 내 멜드 중복 제거: `SeatPanel`은 상대(비인간) 좌석에서만 멜드 줄을 그리고, 내 멜드는 `Board`의 손패 위 `melds-own` 줄 하나만 남겼다.
2. 모바일 손패 (760px 이하): 손패 패를 34x48px(360px 이하는 30px)로 키우고 `.hand-tiles`를 7열 grid(2줄)로 배치했다. 뽑은 패는 오른쪽 별도 자리(아래 정렬, margin 12px, 금색 강조)에 둔다. 폭 계산은 7x34+6x3+12+34=302px로 390px 폭의 패널 내부(약 350px)에 들어간다. 가로 스크롤 없이 처리했고 `overflow-x`는 쓰지 않았다. 브라우저 실측은 하지 못했다(verifier 몫).
3. 액션바 안정화:
   - `.response-slot`이 안내 문구 자리를 항상 예약한다. `role="status"`는 실제 안내가 있을 때만 붙는다.
   - `.pond`는 3줄 분량 min-height, `.log`는 8줄 min-height, `.action-bar`는 min-height를 갖는다.
   - `ActionBar`는 `legalActions`에 있는 행동의 버튼만 렌더한다. 리치 버튼은 리치 가능하거나 리치 모드일 때만 나온다. 패스는 응답 단계의 합법 행동이라 항상 나온다.
   - 비활성 버튼 opacity를 0.4에서 0.6으로 올렸다.
4. 리치 선언패: 눕히기를 그만두고 `TileView`에 `riichi` prop을 추가했다. 붉은 테두리와 붉은 배경으로 표시하고, 패 아래에 "리치" 표식(`.riichi-mark`)을 붙였다. `sideways`는 멜드의 가져온 패에만 쓴다.
5. `index.html`에 인라인 data URI 아이콘(🀄 SVG)을 넣어 favicon 404를 없앴다.
6. 결과 모달: `WinSummary`에 `doraCount`, `redDora`, `uraDora`를 추가했다(기존 `dora` 유지). 값은 core `countDora`/`countRedFives`로 계산하며 `doraCount + redDora + uraDora === dora`가 화료 요약 전부에서 성립한다(controller 테스트와 신규 테스트로 확인). 모달은 0이 아닌 항목만 "도라 / 적도라 / 뒷도라"로 나눠 보여준다.
   - 미구현: 점수 변동 표의 "본장 +300, 리치봉 +1000" 분해. 요약 데이터(`RoundSummary`)에서 본장/리치봉 값을 신뢰성 있게 분리할 수 없어(화료 시 `riichiSticks`가 0으로 초기화되고 `deltas`가 합산값이라) 하지 않았다. 필요하면 core `RoundResult`에 분해 값을 추가해야 한다.
7. `App`에 `initialSession?` prop을 추가했다(테스트용, 기본 동작 불변).

## 테스트
- 기존 테스트 정정(모두 정당한 변경):
  - ActionBar "legalActions에 없는 행동은 모두 비활성"은 "버튼 자체를 렌더하지 않는다"로 바꿨다.
  - "츠모/리치/안깡" 테스트에서 론/펑은 disabled 대신 미렌더로 확인한다.
  - "론/패스 응답" 테스트에서 리치 버튼은 미렌더로 확인한다.
  - ResultModal 테스트는 도라 분리 표기로 바꿨고, 픽스처에 `doraCount`, `redDora`, `uraDora`를 추가했다.
- 신규(web 42 -> 48):
  - 사람이 츠모 버튼을 눌러 화료(seed 탐색 + `initialSession`)
  - 사람이 론 버튼을 눌러 화료(삼가화 유국이 되는 경우는 제외하고 탐색)
  - 내 멜드가 한 번만 렌더됨(상대 멜드는 각자 패널에 유지)
  - 합법 행동 버튼만 렌더되고 안내 영역이 예약됨
  - 응답 안내가 예약 영역 안에 표시됨
  - 리치 표식
- 결과: 루트 `npm test` core 337/337, web 48/48 통과. `npm run build` 통과. dev 서버(포트 5199)는 HTTP 200을 확인하고 종료했다.
- 실제 브라우저 확인(레이아웃, 폭별 scrollWidth)은 미실행이며 verifier가 재수행해야 한다.

## 수정 파일
- `packages/web/index.html`
- `packages/web/src/App.tsx`
- `packages/web/src/controller.ts`
- `packages/web/src/styles.css`
- `packages/web/src/components/{ActionBar,Board,ResultModal,SeatPanel,TileView}.tsx`
- `packages/web/src/components/components.test.tsx`
