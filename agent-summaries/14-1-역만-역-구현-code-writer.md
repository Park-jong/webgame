# 14-1 역만 역 구현 (code-writer)

## 한 일
- Step 0: `YAKU_NAMES`의 기존 11개 표시 이름을 역.txt 표기로 통일 (멘젠쯔모, 삼원패, 자풍패, 장풍패, 이페코, 또이또이, 산안커, 치또이쯔). id 불변. 코드 주석/테스트 설명의 옛 표기도 정리.
- Step 1: 역만 9종 + 더블역만 4종 구현 (천화/지화는 15번 범위라 제외).
- Step 2: 웹 결과 모달/요약/로그가 역만, 더블역만, N배 역만을 표시.

## 설계 결정
- 배수: `YAKUMAN_COUNT: Partial<Record<YakuId, number>>` (역만 1, 더블역만 별도 id로 2). 역만 id의 `YAKU_HAN`은 0이라 기존 호출과 호환. `yakumanMultiplier(ids)`, `isYakumanId` 추가.
- 후보 비교: 역만은 일반 후보와 별도 경로. `yakumanCandidates(ctx)`(국사무쌍, 구련보등, 치또이쯔 자일색, 표준형 분해 x 대기 해석)를 만들고 `bestYakuman`이 배수 합이 가장 큰 후보를 고른다. 역만이 있으면 항상 일반 후보보다 우선하고 noYaku가 될 수 없다. `calculateScore`와 `detectYaku`가 같은 `bestYakuman`을 사용 (detectYaku는 역만이 있으면 역만만 반환).
- `ScoreResult.yakumanCount` 추가: 역만 역이 있으면 배수 합, 13판 이상 헤아림은 1, 그 외 0. 역만 결과는 yakuHan/han/dora/fu를 0으로 둔다 (일반 역/도라 무시). 기본점 = 8000 x 배수, 지불식은 기존 그대로.
- 국사무쌍: `meld.ts`에 `YAOCHUU_INDICES`, `isKokushiHand` 추가, `agari.ts`의 `isAgari`가 멜드 없을 때 국사 형태 인정, `shanten.ts`에 `calculateKokushiShanten`을 추가하고 `calculateShanten`에 포함. `ryuukyoku.ts`의 별도 국사 텐파이 판정은 제거(동작 동일, calculateShanten이 포함). game.ts 리치 사전 검사는 샹텐/텐파이 판정을 통해 국사 텐파이 리치를 자동 허용.
- 스안커 형태에서 산안커는 부여하지 않음 (역만 우선으로 일반 역이 전부 무시됨).
- 웹: `WinSummary.yaku[].yakuman`, `WinSummary.yakumanMultiple`, `yakumanLabel()` 추가. 역만이면 도라/적도라/뒷도라 표시값은 0으로 두고 "역만 (기본점 8000)" 형식으로 표시. `splitPoints`는 수정 없이 8000 x 배수 기본점에서도 정확함을 테스트로 확인.

## 룰 선택 / 미구현
- 명세 3장 그대로: 복합 역만 배수 합산, 더블역만 각각 2배, 13판 헤아림 역만은 1배로 역만 역과 합치지 않음. 패오(책임지불) 미구현.
- 창깡(국사무쌍 안깡 론) 미구현, 천화/지화 미구현 (15번).
- 봇은 국사무쌍 샹텐이 낮으면 그쪽으로 타패할 수 있다 (calculateShanten 변경의 부작용, 불변식은 통과).

## 정정한 기존 테스트 (기대값 변경 사유)
- `yaku.test.ts` 또이또이: 멘젠 4각자 단기 론은 이제 스안커 단기라서, 샤보 론(안커 3개)으로 바꿔 또이또이+산안커를 단언.
- `game.test.ts` 봇 구종구패 테스트: 기존 손패가 국사무쌍 완성형이라 츠모하게 되어, 손패를 국사 비완성형으로 변경.

## 테스트 결과
- `npm test`: core 395개 통과 (기존 337 + 신규 58), web 59개 통과 (기존 54 + 신규 5).
- `npm run build`: core/web 모두 통과.

## 수정/추가 파일
- core: `yaku.ts`, `score.ts`, `agari.ts`, `shanten.ts`, `meld.ts`, `ryuukyoku.ts`, `game.ts`(주석), `call.ts`/`dora.ts`(주석), `yakuman.test.ts`(신규), `yaku.test.ts`, `game.test.ts`와 이름 정정된 기타 테스트
- web: `controller.ts`, `components/ResultModal.tsx`, `controller.test.ts`, `components/components.test.tsx`
