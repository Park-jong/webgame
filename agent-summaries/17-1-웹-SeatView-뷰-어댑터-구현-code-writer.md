# 17-1 웹 SeatView 뷰 어댑터 구현 (W-5, code-writer)

선행: 15-1 조사, 15-2(view.kuikae/chankan/nagashiMangan), 16-1(alias). 커밋 없음, 서버/코어 소스 변경 없음, UI 컴포넌트/App 미변경.

## 변경
- packages/web/src/controller.ts (기존 동작 불변 리팩터링, 공통 순수 함수 추출)
  - `computeTenpaiView(TenpaiInput)` 추출: humanTenpaiView 본문. `humanTenpaiView(state, seat = HUMAN_SEAT)`는 이 함수를 호출 (시그니처는 기본값 추가만, 기존 호출 불변).
  - `buildRoundSummary(SummaryInput)` 추출: summarizeRound 본문. `summarizeRound(state)`는 state에서 입력을 만들어 호출. `LIMIT_NAMES` export 추가.
- packages/web/src/model/fromView.ts (신규)
  - `tenpaiViewFromSeatView(view)`: 공개 정보만으로 visibleTiles(도라 표시패 + 비 called 전 버림패 + 타인 멜드) 구성, `view.furiten`을 임시 후리텐 입력으로, `view.kuikae`로 힌트 필터, 리치 14장은 drawnTile 제외 13장. 국 종료는 null.
  - `summarizeFromView(view)`: view.result/players[].score/doraIndicators/result.uraDoraIndicators로 buildRoundSummary 호출. 국 미종료면 throw (summarizeRound와 동일).
  - `toClientAction(action)`: seat 제거. `clientActionFromView(view, chosen)`: view.legalActions에서 구조 동일한 행동을 찾아 ClientAction 반환, 없으면 null.
  - `seatPosition(seat, mySeat)`('self'|'right'|'across'|'left'), `seatName(seat, mySeat)`(SEAT_NAMES를 상대 위치로 대응), `seatLayout(mySeat)`({top,left,right,bottom}).
- packages/web/src/model/fromView.test.ts (신규, 7개)

## 동치 테스트 결과
- 봇 4명 + 부로 우선(50%)/론 패스(50%) 정책으로 반장전 끝까지 시뮬레이션. 매 상태에서 `humanTenpaiView(state, seat)` 와 `tenpaiViewFromSeatView(viewFor(state, seat))`를 toEqual 비교, 국 종료 시 summarizeRound와 summarizeFromView 비교.
- 좌석 0: 시드 8개, 좌석 0~3 전부: 시드 3개 (각 2000 상태 이상, 커버리지 단언: 텐파이, 리치 중 내 차례 14장, discardHints, 쿠이가에시 상태, 텐파이+임시 후리텐 상태, 화료 요약 존재).
- 불일치 0건. 따라서 core 규칙 판단이 필요한 상황 없음, 기존 동작 변경 없음.
- 후리텐: 리치 중 14장(뽑은 직후)에서는 view.furiten이 임시 플래그만 반영하는 한계(뷰 주석)가 있으나, 버림패 기반 후리텐은 calculateWaitInfo가 공개 버림패로 직접 계산하므로 결과가 state 기반과 동일.

## 검증
- `npx tsc -p tsconfig.json` (web) 오류 없음.
- `npm test -w @mahjong/web`: 12파일 133개 통과 (기존 126 무수정 + 신규 7). 신규 테스트가 약 30초 소요(웹 전체 합산 기준 가장 무거움).
- 변이(원복 완료): furiten 무시(furitenTemp: false) -> 동치 2개 실패(처음에는 생존해서 론 패스 정책과 tempFuriten 커버리지 단언을 추가한 뒤 검출됨), kuikae 필터 제거(kuikae: []) -> 2개 실패, 뒷도라 표시패 무시 -> 2개 실패.

## 참고
- 요약의 seat 인덱스는 절대 좌석 그대로이므로 ResultModal 연동 시 SEAT_NAMES[seat] 대신 seatName(seat, view.seat) 사용 필요(이번엔 UI 미변경).
- 다음 단계: Board/SeatPanel을 view 입력으로 전환하고 useServerGame에서 clientActionFromView를 사용.
