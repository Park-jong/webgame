# 15-2 서버 SeatView에 chankan / nagashiMangan / kuikae 추가 (code-writer)

선행 조사: 15-1 문서. 커밋 없음.

## 변경 내용
| 필드 | 형태 | 노출 규칙 |
|---|---|---|
| `SeatView.pending.chankan?` | `"shouminkan" \| "ankan"` | phase가 response이고 core pending.chankan이 있을 때만 키 존재(없으면 키 자체 없음). 전 좌석 공개(깡 선언은 공개 정보). 웹 Board의 `responseTarget.chankan` 사용 방식과 동일 |
| `RoundResultView.nagashiMangan?` | `Seat[]` | core `RoundResult.nagashiMangan`과 동일: 달성자가 있을 때만 키 존재, 배열은 복사. 전 좌석 공개. 웹 summarizeRound는 `?? []`로 처리하므로 호환 |
| `SeatView.kuikae` | `Tile[]` | `phase === "turn" && turn === 본인`일 때만 core `state.kuikae`를 복사해 제공, 그 외(타 좌석, response/roundEnd)는 항상 `[]`. 키는 항상 존재 |

- view.ts는 허용 목록 방식 유지(새 객체를 명시 필드로 구성, 스프레드 없음). `pendingView`를 별도 변수로 만들어 chankan 조건부 키를 추가.
- protocol.ts는 SeatView 타입을 그대로 참조하므로 별도 변경 불필요(`ServerMessage<SeatView>`).

## kuikae와 legalActions
이미 반영돼 있음: core `turnActions`가 `state.kuikae` 종류를 discard 후보와 리치 선언 타패 후보에서 모두 제외한다(game.ts 456~470). 따라서 본인 legalActions에는 금지패 discard가 없다. 다만 core는 "모든 패가 금지 대상이면 금지를 푼다"(kuikae가 빈 배열이 됨). 웹의 안내문과 버리면 텐파이 힌트 필터에는 값이 따로 필요해 SeatView.kuikae를 추가했다. 테스트로 legalActions의 discard 후보와 kuikae가 겹치지 않음을 확인.

## 수정 파일
- packages/server/src/view.ts: 타입 3개 필드 추가, 변환 로직, 정책 주석 갱신
- packages/server/src/view.test.ts: ALLOWED_TOP_KEYS/ALLOWED_PATHS(kuikae[], pending.chankan, result.nagashiMangan) 갱신, 시뮬레이션 불변식(checkInvariants)에 kuikae/chankan/nagashiMangan 대조 추가, 신규 describe 3개(14개 중 아래 참고)
- packages/server/src/test-utils.ts: 누출 전수 검사의 VIEW_TOP_KEYS에 kuikae 추가, 타인 차례/비턴 단계 kuikae 노출 및 chankan 값 이상 검사 추가(통합/퍼즈/부하 테스트가 공유)
- packages/server/README.md: 뷰 정책 표(본인 한정 kuikae, 공개 pending.chankan, 결과 nagashiMangan)

## 추가한 테스트 (view.test.ts, 신규 14개 + 불변식 강화)
- kuikae(5개): 펑 직후 state.kuikae와 값 일치(복사, 참조 비공유) / 합법 타패에서 금지패 제외 / 다른 좌석은 빈 배열 / turn 단계가 아니면 빈 배열 / 평상시 및 타패 후 빈 배열
- chankan(4개): 가깡/안깡 대기 시 전 좌석에 깡 종류 / 일반 응답은 키 없음 / 응답 단계 외 pending null / 실제 dispatch 가깡 후 창깡 대기와 일치
- nagashiMangan(5개): 달성 좌석 값 일치와 전 좌석 공개(복사) / 달성자 없으면 키 없음 / 국 종료 외 null / 유국(abortive) 결과에는 없음 / 허용 경로 및 관측
- checkInvariants(봇 20시드, 부로·깡 우선 정책)가 매 스텝 kuikae, chankan 키 유무, nagashiMangan을 core state와 대조.

## 검증
- `npm run typecheck -w @mahjong/server` 통과
- `npm test -w @mahjong/server` 13파일 202개 통과(기존 188 + 신규 14)
- core 595개, web 90개 통과(마지막에 1회, 영향 없음 확인)
- 변이 확인(원복 완료): chankan 대입 제거 -> 2개 실패, kuikae를 전 좌석에 노출 -> 3개 실패(시뮬레이션 불변식 포함), nagashiMangan 대입 제거 -> 2개 실패

## 알려진 한계 / 후속
- 시뮬레이션에서 nagashiMangan이 실제로 발생하는 경우는 드물어 실제 dispatch 경로의 nagashi 대조는 직접 구성한 결과 상태 위주(core 쪽 nagashi-kuikae.test.ts가 판정 자체를 검증).
- kuikae 금지패는 치/펑 직후 부로 형태로 누구나 추정할 수 있는 정보이지만, 정책상 본인 차례 한정으로 제한했다.
- 웹 어댑터(15-1 단계 3 이후)에서는 `view.kuikae`를 `state.kuikae` 대신 사용하면 된다.
