# 적도라 구현 (code-writer)

## 변경 파일
- packages/core/src/dora.ts: `countRedFives(hand)` 추가, `TotalDoraInput.includeRedFives?: boolean` 추가, 상단 주석 갱신 (적도라 지원, 부저 손패만 범위 밖)
- packages/core/src/dora.test.ts: 기존 22개 수정 없이 유지, 적도라 테스트 17개 추가 (총 39개)
- index.ts는 `export * from "./dora.js"`라 이미 새 함수를 노출하므로 수정 불필요

## 설계 결정
- 옵션 방식 `includeRedFives`(기본 false) 선택: 시그니처/기존 동작 유지, 호출부가 `{ dora }` 숫자 하나만 만들면 되어 별도 함수보다 단순하고 리치 처리 로직을 중복하지 않음.
- 5가 아닌 패의 `isRedFive === true`는 `countRedFives`에서 에러 처리: 무시하면 오염 데이터를 숨기고, 세면 없는 도라가 생김. `countDora`와 옵션 없는 `countTotalDora`는 검사하지 않음(기존 테스트가 2m에 isRedFive를 붙여 0을 기대하므로 하위 호환).
- 적5는 wall.ts/tiles.ts 기준 슈트별 1장, 총 3장. `isSameTileType`이 isRedFive를 무시하므로 적5가 도라패면 countDora에서 1판 + 적도라 1판 = 2판으로 자연 중복 가산됨(테스트로 고정).
- score.ts/yaku/agari는 isRedFive를 참조하지 않고 isSameTileType만 사용. 적5 유무로 han/fu/yaku가 바뀌지 않음을 테스트로 확인. 영향 없음.

## 통합 테스트
- 리치+핑후+탕야오(3판) + 적5 2장 = 5판 만관, 론 8000
- 역 없는 손패는 적도라가 있어도 noYaku

## 실행 결과
- `npm test --workspace=@mahjong/core`: 9 파일, 171 테스트 전부 통과
- `npm run build --workspace=@mahjong/core`: tsc 오류 없이 통과
- git 커밋과 ROADMAP.md 수정은 하지 않음
