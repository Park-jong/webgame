# 17-2 유국만관과 쿠이가에시 (code-writer)

`역.txt`/`server/`는 읽기만 했고 커밋/ROADMAP/`yaku.ts`/`score.ts`/`ordinary-yaku.test.ts` 수정은 하지 않았다.

## 수정 파일
- `packages/core/src/ryuukyoku.ts`: `isNagashiMangan`, `calculateNagashiManganDeltas`, `NagashiDiscard`, `ExhaustiveDraw.nagashiMangan?`; `resolveExhaustiveDraw`에 4번째 선택 인자 `discardsBySeat`.
- `packages/core/src/game.ts`: `RoundResult.nagashiMangan?`, `GameState.kuikae`, 치/펑 직후 금지 계산, `legalActions` 필터, 황패평국에서 버림패 전달.
- `packages/web`: `controller.ts`(`RoundSummary.nagashiMangan?`), `ResultModal.tsx`(유국만관 줄), `Board.tsx`(쿠이가에시 안내, 기존 `response-slot` 재사용).
- 테스트: `packages/core/src/nagashi-kuikae.test.ts`(33), `packages/web/src/nagashi-kuikae.test.tsx`(5), `sim.test.ts` 퍼즈 불변식 추가, `game.test.ts` 유국 픽스처 3개 정정.
- `docs/yaku-spec.md` 3장: 쿠이가에시/유국만관 룰 명시.

## 설계
- 결과 타입: 달성자가 있을 때만 `nagashiMangan: Seat[]` 필드가 생긴다(없으면 필드 자체가 없어 기존 결과와 동일). 이때 `deltas`는 유국만관 지불이고 노텐 벌부는 없다. `tenpai`는 그대로 채운다(렌짱 판정용).
- 금지 상태: `GameState.kuikae: readonly Tile[]`는 현재 턴 좌석이 버릴 수 없는 패 종류(적5 아닌 대표 패)다. 치/펑 처리 때 설정, `applyDiscard`에서 비움. 손패가 전부 금지 대상이면 빈 배열로 풀어 교착을 막는다. 대명깡/일반 츠모 턴에서는 항상 빈 배열.
- 스지는 끝 패를 가져온 치에서만, 반대쪽 끝이 1~9 안일 때만 추가.

## 정정한 기존 테스트
- `game.test.ts` 유국 3개: 친의 마지막 버림이 요구패(6z/2z) 한 장뿐이라 유국만관이 성립하게 되어 기대값이 달라졌다. 규칙 변경이 아니라 픽스처 정정이며 버림패를 수패(4m/8p)로 바꿨다(다른 좌석의 응답이 생기지 않도록 확인). 기대값은 그대로.

## 룰 선택/미구현
- 룰은 docs/yaku-spec.md 3장. 쿠이가에시 금지 해제 예외(손패 전부 금지)만 구현. 안내 문구는 "쿠이가에시: 3만, 6만 버릴 수 없음".

## 결과
- 루트 `npm test`: core 555, web 74 통과. `npm run build` 통과.
