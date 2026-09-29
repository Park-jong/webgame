# 치/펑/깡 검증 피드백 반영 (code-writer)

## 변경 파일
- packages/core/src/call.ts
- packages/core/src/call.test.ts

## call.ts
1. canShouminkan: hand.find 제거. 각 pon 멜드마다 tilesOfType + pickVariants(pool, 1)로 적5 사용 여부별 옵션을 반환.
   같은 meldIndex에 최대 2개, 일반 패가 먼저(pickVariants가 적5 적게 쓰는 쪽을 먼저 반환). 반환 타입 유지, JSDoc 명시.
2. applyShouminkan: `?? candidates[0]` 폴백 제거. 적5 여부까지 일치하는 패가 없으면 "지정한 패(적5 여부 포함)가 손패에 없어 카칸할 수 없습니다." 에러. JSDoc 갱신.
   기존 테스트 중 폴백에 의존하는 것은 없었음(수정 불필요).
3. applyPon/applyDaiminkan: 확인 결과 relativeSeat가 assertSeat(양쪽 좌석 0~3 정수)와 자기 버림패 거부를 이미 수행. 코드 추가 없음(테스트로 고정).

## call.test.ts 추가
- canChi 경계(1m/2m/8m/9m), 같은 패 2장 보유 시 중복 없음
- canShouminkan 적5 옵션 2개(일반 먼저)/1개
- applyShouminkan 적5 지정 성공, 일반5만 있을 때 적5 지정 에러, 재카칸 에러
- 안깡 멜드 보유 상태에서 치/펑/다이민깡/카칸 (멜드 순서, 손패 장수)
- 좌석 범위 밖(-1, 4), 자기 버림패 에러 (chi/pon/daiminkan)

## 실행 결과
- vitest run: 10 파일, 217 테스트 전부 통과 (call.test.ts 46개)
- npm run build (tsc): 에러 없음
