# 13-6 텐파이/대기패 표시 구현 (code-writer)

## 변경 파일
- 신규 `packages/core/src/waits.ts`, `packages/core/src/waits.test.ts` (28개 테스트)
- 수정 `packages/core/src/index.ts` (waits export 1줄만 추가). game.ts, ryuukyoku.ts 등 기존 core 로직은 건드리지 않음
- 신규 `packages/web/src/components/TenpaiInfo.tsx`, `packages/web/src/tenpai.test.tsx` (13개 테스트)
- 수정 `packages/web/src/controller.ts` (humanTenpaiView 추가), `components/Board.tsx`, `styles.css`

## core waits.ts API
- `findWaitTiles(hand, melds)`: 대기패 종류 목록. isAgari 재사용(치또이/국사무쌍 포함), 손패+멜드로 4장 소진된 패 제외. 13장 상당이 아니면 에러.
- `calculateWaits(hand, melds, {context?, visibleTiles?})`: `{tile, remaining, hasYaku}[]`. remaining은 4에서 손패/멜드/visibleTiles를 뺀 값. hasYaku는 calculateScore(론, 도라 0, 상황 역 없음, 멘젠/리치/자풍/장풍 반영)로 판정하며 context가 없으면 true.
- `hasYakuForWait`, `isFuritenForWaits(waits, discards)`, `calculateWaitInfo(hand, melds, discards, options)`: `{tenpai, waits, furiten}`
- `findDiscardCandidates(hand14, melds, discards, options)`: 버리면 텐파이가 되는 후보 `{discard, waits, furiten}` (같은 종류 1회, 버리는 패 자체가 대기패면 후리텐)

## web
- `humanTenpaiView(state)`: 13장 상당이면 대기패, 내 차례 14장이면 discardHints. 리치 중 내 차례는 뽑은 패를 뺀 13장의 대기패. 남은 장수는 부로되지 않은 모든 버림패, 타인 멜드, 도라 표시패를 반영. 후리텐은 버림패 + state.furitenTemp 반영. 국 종료 시 null.
- `TenpaiInfo`: 텐파이 배지 + 대기패 타일(남은 장수), 후리텐 배지, 역 없는 대기패는 dimmed + "역없음". 텐파이가 아니고 내 차례면 "버리면 텐파이" 후보 타일 표시. Board의 손패와 response-slot 사이에 배치, 높이는 항상 예약(액션바 움직임 방지).

## 검증
- core 586개, web 87개 통과. `npx tsc --noEmit -p .` core/web 모두 통과.

## 참고/한계
- 중복 로직: game.ts에 이미 export된 `waitingTileTypes`와 ryuukyoku.ts의 `isTenpaiWithMelds`가 같은 방식이지만, "기존 파일 수정 최소화/game.ts 불가" 지침에 따라 공통화하지 않고 waits.ts를 독립 구현했다. 후속으로 이쪽을 `findWaitTiles`에 위임하도록 정리 가능. 테스트에서 isTenpaiWithMelds와의 일치를 확인함.
- 모바일(390x844) 레이아웃은 실제 브라우저로 확인하지 못했다. 텐파이 영역은 sm 타일 높이 1줄(약 26px)만 예약하므로 영향은 작을 것으로 보지만 육안 확인 필요.
- 14장 타패 힌트는 목록만 표시하고, 손패의 해당 타일 강조나 호버 시 대기패 표시는 구현하지 않았다(title 속성에 대기패 표기).
- hasYaku는 론 기준이며 하저로어/일발/창깡 등 상황 역은 제외. 후리텐은 동순/리치 후 일시 후리텐을 furitenTemp로만 반영.
