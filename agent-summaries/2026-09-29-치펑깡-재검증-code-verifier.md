# 치/펑/깡 재검증 (code-verifier)

## 실행 결과
- vitest run: 10개 파일 217개 통과 (call.test.ts 46개). tsc 빌드(npm run build) 오류 없음.
- canShouminkan: 적5+일반5 -> 같은 meldIndex 옵션 2개(일반 먼저), 한 장뿐이면 1개, pon 없음/치만 있음 -> 빈 배열, 안깡/치/펑 혼재 시 meldIndex(1,3,4) 정확.
- applyShouminkan: 적5 지정 시 addedTile=적5, 손패에서 적5만 제거(일반5 잔존). 일반5 지정 시 반대로 동작. 일반5만 보유+적5 지정 -> 에러, 적5만 보유+일반5 지정 -> 에러, 재카칸 에러, 다중 pon에서 해당 멜드만 교체, 입력 불변.
- 테스트 품질: canChi 경계 테스트는 정렬한 정확한 집합을 toEqual로 단언(의미 있음).
- git: tracked 변경은 ROADMAP.md, packages/core/src/index.ts(1줄)뿐. score/yaku/agari/dora 미변경.

## 버그: 없음
## 남은 공백(경미)
- 다중 pon 카칸의 apply 테스트가 테스트 파일에는 없음(스크립트로만 확인).
- 적5를 지정 안 한 applyShouminkan 자동선택 규칙 없음(tile 필수라 문제 없음).
- canShouminkan은 손패 장수 검증을 하지 않음(설계상 무방).
## 완료 처리: 가능
