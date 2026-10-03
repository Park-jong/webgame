# 마작 화료/역 판정 로직 구현 (2026-09-29)

## 작업 범위
ROADMAP.md 1단계(룰 엔진) 중 미구현 항목 4개를 순서대로 구현:
1. 손패 정렬/조작
2. 멘츠(면자) 분해 및 텐파이/샹텐 판정 (표준형 + 치토이츠)
3. 화료(和了) 판정
4. 역(役) 판정 — 핵심 역 세트

## 생성한 파일

| 파일 | 책임 |
|---|---|
| `packages/core/src/hand.ts` | 손패 조작: `sortHand`(수패 슈트별 오름차순→자패 동남서북→백발중), `compareTiles`, `addTile`, `removeTile`(불변, 없는 패 제거 시 에러) |
| `packages/core/src/meld.ts` | 34종 패 인덱스 매핑(`tileToIndex`, `indexSuit`, `indexRank`), `decomposeStandardHand`(14장→멘츠4+대자1 모든 유효 분해를 재귀 백트래킹으로 탐색, 모호한 손패는 여러 분해 반환), `isChiitoitsuHand`(7종×2장 정확히 검증) |
| `packages/core/src/shanten.ts` | `calculateStandardShanten`(표준형, 멘츠/타츠/대자 탐색 기반 8-2×멘츠-타츠-대자 공식), `calculateChiitoitsuShanten`(6-쌍+max(0,7-종류수) 공식), `calculateShanten`(둘 중 최소값, 13/14장 지원), `isTenpai`(13장 전용, shanten===0) |
| `packages/core/src/agari.ts` | `isAgari`: 14장이 표준형 또는 치토이츠로 완성됐는지 boolean 판정 (14장이 아니면 false, 에러 없음) |
| `packages/core/src/yaku.ts` | `WinContext`(hand/winningTile/isConcealed/winType/isRiichi/seatWind/roundWind), `detectYaku`, `hasAnyYaku` |

각 파일에 대응하는 `*.test.ts` 작성. `packages/core/src/index.ts`에 5개 모듈 모두 re-export 추가. 기존 `tiles.ts`/`wall.ts` 공개 API와 `packages/core/demo/index.html`은 손대지 않음.

## 최종 테스트/빌드 결과
- `npm test --workspace=@mahjong/core`: **7개 파일, 86개 테스트 전부 통과** (기존 16개 + 신규 70개)
- `npm run build --workspace=@mahjong/core`: **에러 없이 통과** (strict TS, `noUncheckedIndexedAccess` 포함)

## 구현한 핵심 역
- 리치 (`riichi`) — `isRiichi && isConcealed`
- 멘젠츠모 (`menzenTsumo`) — `isConcealed && winType==="tsumo"`
- 핑후 (`pinfu`) — 전 멘츠 순자, 대자가 역패 아님, 당첨패가 양짱(료멘) 대기로 완성. 분해 단위로 판정하며 같은 패가 여러 슬롯(대자/멘츠)에 걸치는 경우 가장 유리한 해석을 채택
- 탕야오 (`tanyao`) — 전 패가 2~8 숫자패 (표준형/치토이츠 모두 적용)
- 역패 (`yakuhaiDragon`/`yakuhaiSeatWind`/`yakuhaiRoundWind`) — 삼원패/자풍/장풍 각자(3장)만 인정, 대자(2장)는 불인정. 자풍=장풍(더블동)이면 두 id 동시 성립
- 이페이코 (`iipeikou`) — 동일 슈트·동일 시작숫자 순자 2벌, 멘젠 필수
- 판퐁/또이또이 (`toitoi`) — 멘츠 4개 전부 각자
- (추가) 치토이츠 (`chiitoitsu`) — 요청 목록엔 없었지만, 없으면 치토이츠 화료가 "역 없는 화료"가 되는 정합성 문제가 있어 최소 요건으로 추가

## 의도적으로 제외한 것
- 도라 계산, 점수(부수/판수) 계산 — 요청대로 완전히 손대지 않음
- 코쿠시무소(국사무쌍) 등 특수형 — ROADMAP에 "이후 단계"로 명시된 대로 제외
- 치/펑/깡 판정 및 처리 — 이번 라운드 범위 밖 (ROADMAP 항목은 그대로 미체크 유지)

## 설계상 트레이드오프 및 다음 단계 유의사항
1. **"판퐁" 용어 모호성**: 요청서의 "판퐁(가능하면)"이 정확히 어떤 정식 역명을 가리키는지 확신이 서지 않아, 코드/테스트에서 "모든 멘츠가 각자(커츠)로 구성된 역"인 또이또이(対々和)로 해석해 구현했다(`yaku.ts` 상단 주석에도 명시). 의도가 다르다면 알려주면 쉽게 교체 가능한 구조.
2. **역 판정의 "최적 해석" 정책**: 손패가 여러 방식으로 분해될 수 있을 때(예: 111222333 같은 애매한 패), 각 역을 "어떤 분해에서든 성립하면 인정"하는 합집합 방식을 택했다. 이는 실전에서 가장 유리한 해석을 채택하는 것과 동일한 결과를 주지만, 점수 계산 단계에서는 "역의 합"이 아니라 "하나의 특정 분해가 주는 점수의 최댓값"을 골라야 하므로, 다음 라운드에서 점수 계산을 구현할 때는 `decomposeStandardHand`가 반환하는 각 분해별로 역을 따로 계산해 분해별 총점을 비교하는 방식으로 재구성이 필요할 것이다(현재 `detectYaku`는 분해별 부분 함수들을 이미 내부적으로 갖고 있어 재사용 가능).
3. **`calculateShanten`은 13/14장 모두 받지만 "최선의 버림패" 최적화는 하지 않는다**: 14장 입력 시 있는 그대로의 샹텐(사실상 대부분 -1 아니면 그 이상)을 계산할 뿐, "어떤 패를 버려야 최소 샹텐이 되는가"는 계산하지 않는다. 향후 AI/봇 로직에 필요하면 별도 함수로 추가해야 한다.
4. **역패 카운트 단순화**: 삼원패 각자가 2개(예: 백+발 둘 다 각자)라도 `yakuhaiDragon` id는 하나만 나온다(boolean 판정 범위이므로 판수 카운트는 하지 않음). 점수 계산 단계에서 "역패가 몇 개 있는지"가 필요하면 `yakuhaiIdsForDecomposition`류 내부 로직을 확장해야 한다.
5. **샹텐/멘츠분해 알고리즘**: 34종 패 인덱스 기반 재귀 백트래킹(표준적인 마작 엔진 구현 방식)을 사용했다. 13~14장 규모에서는 성능 문제가 없지만, 향후 최적 버림패 탐색처럼 다수의 13장 조합을 반복 평가해야 하는 기능을 추가할 경우 메모이제이션 등의 최적화가 필요할 수 있다.
