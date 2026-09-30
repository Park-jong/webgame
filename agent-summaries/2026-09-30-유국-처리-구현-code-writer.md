# 유국 처리 구현 (code-writer)

## 변경 파일 (packages/core/src)
- ryuukyoku.ts (신규), ryuukyoku.test.ts (신규, 24 테스트), index.ts (`export * from "./ryuukyoku.js"` 추가)
- ROADMAP.md는 수정하지 않음.
- `npx vitest run` 241개 통과, `npx tsc --noEmit` 통과 (구현자 확인).

## 구현 내용
- 타입: `ExhaustiveDraw`, `AbortiveDraw`(reason: kyuushuKyuuhai/suufonRenda/suukaikan/suuchaRiichi/sanchaHou), 판별 유니온 `RyuukyokuResult`.
- 황패평국: `isTenpaiWithMelds`, `calculateNotenPenalty`(3000점 분배), `isDealerRenchan`, `resolveExhaustiveDraw`.
- 도중유국: `countYaochuuKinds`, `canDeclareKyuushuKyuuhai`, `isSuufonRenda`, `isSuukaikan`, `isSuuchaRiichi`, `isSanchaHou`(옵션 `tripleRon: "abort" | "allow"`), `abortiveDraw`.

## 룰 선택 / 설계 결정 (파일 상단 주석에도 기재)
- 노텐 벌부 총 3000점. 텐파이 0/4명이면 이동 없음.
- 황패평국은 친 텐파이 시 렌짱. 도중유국은 항상 렌짱.
- 부로 있는 손패는 멜드당 3장을 더해 13장으로 맞춰 표준형 샹텐만 계산 (치토이츠 제외).
- 사개깡: 한 명이 4깡이면 유국 아님, 5깡 이상은 항상 유국.
- 삼가화 기본은 유국.
- 구종구패는 선택 선언이므로 "선언 가능 여부"만 판정.

## 주의 / 한계
- 유국이 성립하는 타이밍(사개깡/사가리치는 론이 없는 버림패 이후 등)은 호출자 책임.
- 카라텐(대기패 4장 모두 보유), 역 없는 텐파이는 구분하지 않음.
- 점수 반영, 본장/공탁 처리, 유국만관(나가시만관) 등은 미구현.
