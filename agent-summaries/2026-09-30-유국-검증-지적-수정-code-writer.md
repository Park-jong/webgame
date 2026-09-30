# 유국 검증 지적 수정 (code-writer)

## 변경 파일
- packages/core/src/ryuukyoku.ts
- packages/core/src/ryuukyoku.test.ts

## 수정 내용
1. 국사무쌍 텐파이 버그: `isKokushiTenpai`(비공개)를 추가했다. 부로 없는 13장이 모두 요구패이고 종류가 12종 이상이면 텐파이로 본다. 13면 대기와 12종+1장 중복을 모두 포함한다. `isTenpaiWithMelds`에서 `calculateShanten(...) === 0`과 OR 처리했다. shanten.ts는 수정하지 않았다. 치토이츠는 `calculateShanten`이 이미 처리하므로 추가 작업이 없었고, 테스트로 확인했다.
2. 입력 검증:
   - `resolveExhaustiveDraw`는 `meldsBySeat` 길이가 4가 아니면 예외를 던진다.
   - `dealer`가 0~3 정수가 아니어도 예외를 던진다.
   - `isSanchaHou`는 ronCount가 0~3 정수가 아니면 call.ts의 assertSeat 스타일로 예외를 던진다. 판정은 `=== 3`으로 바꿨다.
3. 파일 헤더 주석에 카라텐/역 없음 텐파이를 텐파이로 인정한다고 명시했다. 국사 별도 판정도 함께 적었다.
4. 테스트 추가 (ryuukyoku 테스트 41개, 전체 258개 통과):
   - 국사 13면, 12종+1장 중복, 국사 11종 이하, 비요구패 혼입
   - 치토이 텐파이
   - 깡 멜드, 치 멜드, 멜드 2개
   - 적5 포함 손패
   - meldsBySeat 경로, 텐파이 2/3명 통합
   - dealer가 0이 아닌 경우의 렌짱/친 교대
   - `isSuukaikan` 5회 이상
   - 사풍연타에 다른 풍패가 섞인 경우, 빈 배열, 5장
   - 위 입력 검증 예외

## 검증
- `npx vitest run` 통과 (11 파일, 258 테스트)
- `npx tsc --noEmit` 오류 없음

## 참고
- 부로가 있는 경우의 국사는 성립 불가라 처리하지 않았다. 안깡만 있어도 국사는 불가하다.
- ROADMAP.md는 수정하지 않았다.
