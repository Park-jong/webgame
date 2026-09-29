# 적도라(적5) 검증 결과 (code-verifier)

## 결론
통과. 차단 이슈 없음. 경미한 관찰 2건.

## 실행 결과
- npm test --workspace=@mahjong/core: 9 파일, 171/171 통과 (dora 39 = 기존 22 + 신규 17, 나머지 기존 132 무회귀)
- npm run build --workspace=@mahjong/core: tsc 에러 없음
- 실제 벽: createFullTileSet() 136장, 적5는 man5/pin5/sou5 각 1장 = 3장. 옵션 false 이면 0장. shuffle+dealTiles 후 hands/liveWall/deadWall 합계 136장, 적5 3장 유지.
- 변경 범위: dora.ts, dora.test.ts 만 수정 (score/wall/tiles 미변경, calculateScore 시그니처 불변). score/yaku/agari/hand 에 isRedFive 참조 0건 -> han/fu/yaku 무영향(통합 테스트에서 적5 유/무 결과 동일 확인).

## 하위 호환 / 비대칭
- includeRedFives 기본 undefined(=false), 옵션 없는 countTotalDora 는 기존과 동일.
- 5가 아닌 패에 isRedFive=true 인 오염 입력: countDora 및 옵션 없는 countTotalDora = 0 반환(무검사), includeRedFives=true 일 때만 countRedFives 가 Error("손패[0]: 5가 아닌 패에 적도라 표시가 있습니다: {...}") 던짐.
  직접 재현으로 확인. 일관성 문제는 아님(옵션 사용자만 검증, 문서화됨). 다만 같은 손패가 옵션 유무에 따라 throw 여부가 달라지는 점은 인지 필요.

## 테스트 기대값 재계산
- 통합: 234m 456m 345p 678s 55p, 2m 론, 리치+핑후+탕야오 3판 + 적5 2장 = 5판 만관, 비친 론 8000 -> 일치.
- 적5 배치는 슈트별 최대 1장(5m 1, 5p 1, 3슈트 테스트도 m/p/s 각 1)이라 실제 벽과 모순 없음.
- 역 없는 손패(123m 456m 345p 789s 55p)는 적도라 2장이 있어도 noYaku.

## 회귀 검출력(임시 폴더 복사본 뮤테이션, 원본 미수정)
6개 변이 모두 테스트가 실패해 검출됨: 적5 카운트 0 (10 실패), includeRedFives 무시 (7), 항상 포함 (2), 리치 조건 제거 (2), rank!==5 검사 제거 (1), 적도라 2배 (7). 임시 폴더/junction 정리 완료, 원본 node_modules 무손상.

## 관찰(경미)
1. 위 비대칭(옵션 유무에 따른 throw 차이) - 정보성.
2. 원본 workspace 외부 임시 실행 시 vitest 는 tsconfig extends 경로 때문에 복사본에서 tsconfig 제거 필요했음(검증 방식 이슈이며 코드 문제 아님).
