# 부저(치/펑/깡) 손패 연동 구현 - code-writer

## 한 일
멘젠 14장 전용이던 룰 엔진이 `call.ts`의 `CalledMeld`가 있는 손패를 화료/역/점수/도라에서 처리하도록 확장. 공개 API는 선택 인자/필드로만 추가(하위 호환).

규약: 멜드가 있으면 `hand`는 멜드를 제외한 손패이며 장수는 `14 - 3 * 멜드 수`(깡도 3장, call.ts 규약과 동일). 당첨패는 항상 hand 안.

## 변경 파일 (packages/core/src)
- `meld.ts`: `decomposeStandardHand(tiles, calledMeldCount = 0)` - 손패 장수/멘츠 수 조정.
- `agari.ts`: `isAgari(tiles, melds = [])`. 멜드가 있으면 치토이츠 불가.
- `yaku.ts`: `WinContext.melds?`, 헬퍼(`isContextConcealed`, `meldsOf`, `calledMeldToMeld`, `allTilesOf`, `assertHandSize`, `countConcealedTriplets`). 멘젠 = `isConcealed && 멜드가 전부 안깡` (isConcealed=true라도 부로 멜드가 있으면 비멘젠으로 재판정). 리치/멘젠츠모/핑후/이페이코/치토이츠는 부로 시 불성립, 탕야오는 멜드 패까지 검사(쿠이탄 허용), 역패/또이또이는 멜드 포함해 판정. `detectYakuForDecomposition`에 선택 인자 `wait` 추가. 삼안커(`sanankou`, 2판) 신규 역 추가.
- `score.ts`: 부로 멜드 부수(펑 2/4, 명깡 8/16, 안깡 16/32, 치 0), 부로 론은 멘젠 론 +10 없음, 부로 30부 최소. 부로 손패에서 에러 대신 계산. 안깡만 있으면 멘젠 론 +10 유지.
- `dora.ts`: `countDora/countRedFives(hand, indicators?, melds = [])`, `TotalDoraInput.melds?`. 멜드 패 포함(깡 4장 포함) 정책으로 정정.
- `call.ts`: 상단 주석의 "범위 밖" 문구만 갱신.
- `buro.test.ts` (신규, 35개): isAgari/분해, 역(멘젠 한정 역 불성립, 쿠이탄, 역패, 삼안커), 점수(부수 각 종류, 30부 최소), 도라(깡 4장, 적5, totalDora).
- ROADMAP.md는 수정하지 않음.

## 룰 선택 사항 (코드 주석에도 기재)
- 가깡(shouminkan)은 명깡 부수로 계산.
- 삼안커: 안깡은 안커로 셈, 론으로 완성된 샤보 각자는 안커로 세지 않음(츠모는 셈). 4안커(스안커, 역만)는 미구현이라 삼안커 2판으로 판정됨.
- 쿠이사가리 대상 역(삼색/일기통관 등)은 아직 미구현이라 현재 구현 역은 모두 부로 시 판수 동일.
- `calculateScore`: `isConcealed=false`인데 부로(비안깡) 멜드가 없으면 기존처럼 에러(정합성 오류로 간주, 기존 테스트 유지).

## 주의/발견
- 삼안커는 신규 역이라 멘젠 손패에서도 안커 3개 이상이면 새로 성립한다. 기존 258개 테스트에는 영향 없었으나, "기존 멘젠 결과 불변"의 예외임. 원치 않으면 `yaku.ts`의 `sanankou` 판정만 제거하면 됨.
- 도라: 멜드 없이 11장 등 장수 불일치는 에러(기존 14장 검증의 일반화).
- 깡 후 영상패, 깡도라 공개 등은 여전히 미구현.

## 검증
`npx tsc --noEmit` 통과, `npx vitest run` 12개 파일 293개(기존 258 + 신규 35) 전부 통과.
