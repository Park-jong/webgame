# 15-1 웹 상태 필드 - SeatView 대조 조사 (code-verifier)

범위: 읽기/실행만 수행. 소스 변경 없음, 커밋 없음. 웹 테스트 기준선 (packages/web, vitest run) 7파일 90개 전부 통과.

## 0. 먼저 알아둘 사실
- useGame이라는 훅/함수는 존재하지 않는다(grep 0건). 로컬 "컨트롤러"는 controller.ts의 순수 함수 묶음이고, 상태 소유(useState Session, 봇 진행 useEffect, riichiMode 등)는 App.tsx가 직접 한다. 인터페이스를 맞추려면 먼저 이 App 로직을 훅으로 추출해야 한다.
- Board/SeatPanel/ResultModal 등은 GameState 전체(state)를 props로 받는다. Session(seed, rng, state, log)은 로컬 전용.
- 좌석 0=사람, 1~3=봇이 하드코딩: HUMAN_SEAT=0, SeatPanel의 isHuman = (seat === 0), Board 배치(2=위, 3=왼쪽, 1=오른쪽, 0=아래), SEAT_NAMES=[나,하가,대면,상가](0 기준 상대 위치).

## A-1. 웹이 읽는 필드 전수 (파일:함수 -> 필드 -> 용도)
[숨김] = 서버 뷰에서 비공개로 다루는 정보를 읽는 곳.

### controller.ts
| 함수 | 읽는 필드 | 용도 | 비공개 |
|---|---|---|---|
| roundLabel | roundWind, kyoku, honba | 국 라벨 | |
| humanMustAct | awaitingSeats(state), legalActions(state,0) | 사람이 선택해야 하는지 | [숨김] awaiting(상대 포함 전체 대기 좌석) |
| isRoundOver | phase | 국 종료 판정 | |
| autoRiichiAction | phase, turn, players[0].riichi, legalActions | 리치 후 자동 츠모기리 | |
| autoPending / stepAuto / advance | awaitingSeats, decideAction(state, seat, rng) | 봇 진행 | [숨김] 봇이 전체 state 사용 (온라인에선 서버 담당, 웹 불필요) |
| humanActions | legalActions(state,0) | 합법 행동 | |
| applyAction / describeAction | action 자체 | 로그 문자열 | |
| summarizeRound | result(type, wins[].seat/from/winningTile/score, tenpai, reason, nagashiMangan, deltas, dealerContinues), players[w.seat].hand/melds/riichi, scores, doraIndicatorsOf, uraDoraIndicatorsOf, phase | 결과 모달 데이터(도라/적도라/뒷도라 재계산, 점수 분해) | [숨김] 왕패 유래 도라/뒷도라 표시패 (뒷도라는 리치 화료 때만 공개) |
| finalRanking | scores | 최종 순위 | |
| visibleTilesFor (내부) | doraIndicatorsOf, players[*].discards(tile, calledBy), players[s!=seat].melds | 대기패 잔여 장수 계산용 보이는 패 | 전부 공개 정보 |
| humanTenpaiView | players[0].hand/melds/riichi/discards, roundWind, seatWindOf(state,0), furitenTemp[0], phase, turn, drawnTile, kuikae, visibleTilesFor | 텐파이 배지, 대기패, 버리면 텐파이 힌트 | [숨김] furitenTemp, kuikae (비공개 플래그), drawnTile(본인 차례만 필요) |

humanTenpaiView 필요 입력: 본인 hand/melds/riichi/discards, 본인 자풍, 장풍, 도라 표시패, 전원 버림패(calledBy 포함), 타인 멜드, 본인 furitenTemp, phase/turn/drawnTile, kuikae 금지패.

### App.tsx
| 위치 | 필드 | 용도 | 비공개 |
|---|---|---|---|
| App 본문 | session.state, autoPending, humanMustAct, humanActions, isRoundOver | 봇 진행 루프, 사람 행동 목록, 종료 판정 | [숨김] awaiting |
| 렌더 | state.phase, state.scores, summarizeRound(state) | GameEnd/ResultModal | |
| 로컬 상태 | session.seed, session.log, riichiMode, showFinal, seedInput, delayOn | 시드 표시/입력, 로그, 리치 모드 UI, 지연 토글 | 시드/log는 서버에 없음 |
| 핸들러 | newSession, beginNextRound, applyAction | 새 게임/다음 국/행동 | 서버에선 다음 국을 서버가 자동 진행 |

### components/Board.tsx
| 필드 | 용도 | 비공개 |
|---|---|---|
| players[0].hand, phase, turn, drawnTile | 손패+뽑은 패 분리(splitDrawn) | drawnTile은 본인 차례에만 사용 |
| doraIndicatorsOf(state) | 도라 표시패 5칸 | 공개분만 |
| pending.discarder/tile/chankan | 응답 안내문, 버림패 강조, 창깡 문구 | pending.awaiting/ronEligible/responses는 읽지 않음 |
| roundLabel, riichiSticks, liveWall.length | 국 정보, 리치봉, 산패 수 | liveWall은 길이만 |
| kuikae | 쿠이가에시 안내 | [숨김] 비공개 플래그 |
| players[0].melds | 내 멜드 줄 | |
| humanTenpaiView(state) | 텐파이 정보 | 위 참조 |
| (prop) actions, log | 합법 행동, 로그 | |

### components/SeatPanel.tsx (SeatPanel, Pond, MeldView)
| 필드 | 용도 | 비공개 |
|---|---|---|
| players[seat].riichi, melds, discards(tile/riichi/calledBy) | 배지, 멜드, 버림패 | |
| players[상대].hand.length | 손패 장수만큼 뒷면 타일 | [숨김] 상대 hand는 배열 길이만 사용(내용 안 읽음) |
| dealer, turn, phase, scores[seat], seatWindOf(state, seat) | 친/차례/점수/자풍 배지 | |
| MeldView: type, tiles, calledTile, from | 멜드 표시(안깡 양끝 뒷면) | 안깡 타일 내용은 서버가 공개함 |

### Hand / ActionBar / TenpaiInfo / TileView / actions.ts
순수 props 컴포넌트: Tile[], Action[](합법 행동), TenpaiView, 콜백. GameState를 읽지 않음. Hand.splitDrawn은 뽑은 패가 손패 맨 뒤라는 규약에 의존.

### components/ResultModal.tsx
RoundSummary(controller 파생 데이터)만 읽음: wins[].hand/melds/winningTile/yaku/doraCount/redDora/uraDora/han/fu/limit/yakumanMultiple/handPoints/honbaPoints/riichiPoints/basePoints/total, drawName, tenpai, nagashiMangan, deltas, scores, doraIndicators, uraDoraIndicators, gameOver. GameEndScreen은 scores만.

## A-2. SeatView 대조표
판정: 있음 / 가공 필요 / 없음. SeatView = packages/server/src/view.ts, 메시지 = protocol.ts.

| 웹이 읽는 GameState 필드 | SeatView 대응 | 판정 | 비고 / 제안 |
|---|---|---|---|
| phase, turn, dealer, roundWind, kyoku, honba, riichiSticks | 동일 이름 | 있음 | |
| scores[i] | players[i].score | 가공 필요 | 단순 매핑. 국 종료 후 점수도 동일 |
| players[i].riichi/melds/discards | players[i].* (DiscardView는 DiscardEntry와 동일 4필드) | 있음 | |
| players[0].hand | view.hand | 있음 | 순서 보존, 뽑은 패 맨 뒤 규약 유지 |
| players[상대].hand.length | players[i].handCount | 가공 필요 | 뒷면 N장 |
| drawnTile | view.drawnTile | 있음 | 본인 차례일 때만 non-null (웹 사용처와 일치) |
| liveWall.length | liveWallCount | 가공 필요 | |
| doraIndicatorsOf(state) | doraIndicators | 있음 | |
| seatWindOf(state, seat) | players[i].seatWind | 있음 | |
| legalActions(state,0) | view.legalActions | 있음 | seat는 본인 좌석. 전송 시 ClientAction(seat 제거)로 변환 필요 |
| awaitingSeats(state)에 0 포함 | awaitingYou | 있음 | humanMustAct = awaitingYou AND legalActions.length > 0 |
| awaitingSeats 중 타인 | 없음 | 없음 [비공개] | 봇 진행은 서버 몫 -> UI에서 포기 |
| pending.discarder, tile | pending.discarder, tile | 있음 | phase가 response일 때만 non-null |
| pending.chankan | 없음 | 없음 (서버 변경) | PendingView에 chankan 추가 권장(깡 선언은 공개 정보). 어댑터 추정은 가깡/버림패 구분이 모호해 안내문/강조가 틀어짐 |
| pending.awaiting/ronEligible/responses | 의도적 제외 | 없음 [비공개] | 웹이 읽지 않음, 포기 |
| furitenTemp[0] | view.furiten (isFuriten: temp 또는 버림패가 대기에 포함) | 가공 필요 | 웹 규칙 info.furiten OR (tenpai AND temp)는 tenpai AND view.furiten 으로 대체 가능(13장). 14장 상태는 temp만 반영(뷰 주석의 알려진 한계)이나 웹은 14장에서 furiten을 쓰지 않음 |
| kuikae | 없음 | 없음 (서버 변경 또는 추정) | 용도: 안내문, 버리면 텐파이 힌트 필터. 어댑터 대체: 본인 14장 차례+비리치에서 손패 중 discard 합법 행동이 없는 종류를 금지로 추정(legalActions가 이미 제외). 정확하나 추정이라 SeatView.kuikae(본인용) 추가가 더 깔끔 |
| result.type/wins/tenpai/reason/deltas/dealerContinues | result.* | 있음 | |
| result.nagashiMangan | 없음 | 없음 (서버 변경) | RoundResultView 누락(core RoundResult에는 존재). 추가 권장(deltas로도 추측되는 공개 정보). deltas 패턴 추정은 위험 |
| wins[].score (yaku id/name/han, dora, han, fu, basePoints, limit, yakumanCount, isDealer, payment, total) | wins[].score 동일 | 있음 | YAKUMAN_COUNT[y.id]는 id 보존으로 OK |
| players[w.seat].hand/melds | wins[].hand/melds | 있음 | 론이면 화료패 제외, 츠모면 포함(core 보관 그대로) = summarize의 removeExact 규약과 일치 |
| players[w.seat].riichi | players[seat].riichi | 있음 | |
| doraIndicatorsOf (결과 시점) | doraIndicators | 있음 | countDora 재계산 입력(core 함수 재사용) |
| uraDoraIndicatorsOf | result.uraDoraIndicators | 있음 | 리치 화료 있을 때만 non-empty (summarize 조건과 일치) |
| 왕패/산패 내용 | 없음 | 없음 [비공개] | 웹은 읽지 않음 |
| session.seed | 없음 | 없음 | 온라인에서 시드 UI 포기 (README: 시드 미기록) |
| session.log | 없음 | 없음 | 연속 view diff로 합성(버림패/멜드 증가, 리치, 결과) 또는 로그 포기 |
| 새 게임/다음 국 버튼 | 없음 | 없음 | 서버가 nextRoundDelayMs 후 자동 진행, gameEnd 후 새 게임 메시지 없음 |
| 신규: deadlineMs, notice, ack, joined, error | 봉투 메시지 | 있음 | 컨트롤러 인터페이스에 선택 필드로 추가 |

결론: 서버 변경 필요 3건(모두 공개 정보): PendingView.chankan(필수), RoundResultView.nagashiMangan(필수), SeatView.kuikae(권장, 추정으로 대체 가능). 나머지는 어댑터 또는 포기로 해결.

## 추가 확인
### (1) 로컬 컨트롤러 인터페이스와 서버 컨트롤러 정합
현 상태: 훅 없음. App이 Session을 쥐고 advance/stepAuto/applyAction/beginNextRound/newSession을 호출한다. 맞추려면:
1. 로컬 로직을 useLocalGame으로 추출. 공통 인터페이스 제안: GameController { view: SeatView, actions: Action[], log: string[], mySeat, act(action), summary: RoundSummary 또는 null, roundOver, gameOver, nextRound?(), newGame?(seed?), deadlineMs?, status(local/connecting/waiting/playing/disconnected), notice? }
2. Board 등 UI는 이 인터페이스의 view만 읽게 변경(GameState 의존 제거).
3. 로컬은 viewFor(state, 0)로 view 생성(서버 view.ts 재사용 -> 한 코드 경로, 비공개 누출 회귀도 로컬에서 검증됨).
4. useServerGame(url): WebSocket, join/rejoin(seatToken 보관), seq 증가, ack 수신 시 버튼 비활성화, view/error/notice 처리, 재접속.
5. 차이 흡수: autoRiichiDiscard(로컬은 자동 츠모기리, 서버는 discard 합법 행동 1개일 뿐 -> 어댑터가 자동 전송 여부 결정), 봇 지연(서버 고정, 웹 토글 무의미), 다음 국/새 게임(서버 자동), 시드(없음).

### (2) 프로토콜 타입 import와 번들 문제
- packages/server/src/index.ts는 ws를 import하고 export *로 서버 전체를 재노출. 웹이 이를 import하면 tsc가 ws와 @types/node를 끌어들여 web tsconfig(types: vite/client)에서 오류 가능. 값 import면 번들에도 ws가 유입. import type은 vite(esbuild)에서 지워지므로 번들은 안전하나 tsc 문제는 남음.
- protocol.ts는 core 타입만 type-import, view.ts는 core 값(awaitingSeats 등)만 import. ws/node 의존 없음 -> 파일 단위 import는 번들 안전. (server package.json에 main/exports 없음, 웹 vite.config는 core만 alias)
- 판단: 단기는 vite alias + tsconfig paths로 server/src/protocol.ts, view.ts만 import type (index.ts 절대 import 금지). 로컬 모드의 viewFor 값 import는 view.ts 직접 import로 가능(core만 의존). 장기(권장): protocol.ts + view.ts를 core 또는 신규 packages/protocol로 이동, server는 거기서 import. 클라이언트 쪽 parseClientMessage는 불필요.

### (3) 좌석/풍/친 표현 차이
- 서버: 입장 순서대로 빈 좌석 0..3(room.ts findIndex empty) 배정, 나머지는 봇. 내 좌석은 0~3 어느 것이든 가능(joined.seat, view.seat). 웹 로컬은 항상 0.
- 서버 seat 번호/풍 규칙은 core와 동일(자풍 = (seat - dealer + 4) % 4). 시작 dealer=0. 웹은 seatWindOf를 쓰므로 풍/친 표시는 문제 없음.
- 필요한 일: 화면 배치를 상대 좌석으로 회전. 화면 위치 = (seat - mySeat + 4) % 4 -> 0=아래, 1=오른쪽(하가), 2=위(대면), 3=왼쪽(상가). SEAT_NAMES를 상대 오프셋 기준으로, isHuman = (seat === view.seat), HUMAN_SEAT 상수 제거, 결과/로그/최종순위의 SEAT_NAMES[seat]도 상대 변환. 멜드 from(left/across/right)은 소유자 기준 상대값이라 영향 없음.
- 서버는 다중 사람 접속 가능하나 view에 상대 이름(name)은 없음.

### (4) 웹 테스트 영향 (기준선 90개 전부 통과)
대부분 GameState를 직접 구성해 UI에 넣는다.
| 파일 | 테스트 수 | 의존 | 어댑터 도입 시 |
|---|---|---|---|
| controller.test.ts | 13 | newSession/advance/summarizeRound(7회)/finalRanking | 로컬 컨트롤러와 summarizeRound(state)를 유지하면 영향 없음 |
| tenpai.test.tsx | 16 | humanTenpaiView(state) 24회, Board 1 | 시그니처를 view 기반으로 바꾸면 전부 수정. 기존 유지 + 신규 view 기반 함수 추가가 안전 |
| components/components.test.tsx | 34 | Board 6, App 3, ResultModal 12, Pond/Meld 5 | TileView/Hand/ActionBar/GameEndScreen/Pond/Meld/ResultModal(summary 입력)은 영향 없음. Board/App 9곳만 영향 |
| situational.test.tsx | 6 | Board 3, ResultModal 2 | Board props 변경 시 영향 |
| nagashi-kuikae.test.tsx | 5 | Board 2(쿠이가에시 안내), ResultModal 2 | Board props 변경 시 영향, kuikae 대체 필요 |
| kandora.test.tsx | 3 | Board 2, ResultModal 1 | Board props 변경 시 영향 |
| ordinary-yaku.test.tsx | 1 | ResultModal 1 | 영향 없음 |

- Board props를 state에서 view로 바꾸면 약 25~35개가 입력만 viewFor(state, 0)로 바꾸는 기계적 수정 대상. ResultModal/TileView/Hand/ActionBar 계열 약 50개는 영향 없음. (수치는 grep 기반 추정)
- 최소 영향 전략: Board는 state props를 유지하는 얇은 래퍼(BoardFromState)를 두고 내부 코어 컴포넌트가 view를 받게 이중화 -> 기존 90개 무수정 통과 가능, view 경로 테스트는 신규 추가.

## 어댑터 설계안
### 권장 구조
1. UI 입력 모델을 SeatView로 일원화: 컴포넌트는 view + actions + riichiMode 등만 읽는다. 로컬은 viewFor(state, 0), 온라인은 수신 view 그대로. 좌석 0 가정은 view.seat/상대 오프셋으로 대체.
2. GameController 공통 인터페이스 + 구현 2개: useLocalGame(App 로직 추출, 봇 진행/로그/시드 유지), useServerGame(WS).
3. 순수 함수 어댑터(프레임워크 무관, 테스트 용이):
   - tenpaiViewFromSeatView(view): visibleTiles = doraIndicators + 전원 discards(calledBy null) + 타인 melds, furiten = tenpai AND view.furiten, kuikae는 view.kuikae 또는 추정
   - summarizeFromView(view): wins/melds/hand/dora 재계산, scores = players[].score
   - logFromViewDiff(prev, next) (선택)
   - toClientAction(action): seat 제거
4. 좌석 회전/이름: relativePos(seat, mySeat), seatLabel(seat, mySeat)
5. 서버 소규모 변경(공개 정보): PendingView.chankan, RoundResultView.nagashiMangan, SeatView.kuikae(권장). view.test.ts 필드 허용 목록 테스트 갱신 필요.

### 신규 파일(제안)
- packages/web/src/model/seatView.ts (타입 re-export + 상대 좌석 헬퍼)
- packages/web/src/model/fromView.ts (tenpaiViewFromSeatView, summarizeFromView, logFromViewDiff, toClientAction)
- packages/web/src/game/types.ts (GameController 인터페이스)
- packages/web/src/game/useLocalGame.ts (App 로직 추출)
- packages/web/src/game/useServerGame.ts, wsClient.ts (연결/재접속/seq/ack)
- packages/web/src/model/*.test.ts (같은 시드로 viewFor(state,0)를 어댑터에 넣은 결과와 기존 state 기반 함수 결과의 동치 테스트)
- packages/web/vite.config.ts, tsconfig.json 수정: protocol alias (type-only 우선)

### 단계별 위험
| 단계 | 내용 | 위험 | 완화 |
|---|---|---|---|
| 1 | alias/타입 import 추가 | server index.ts 우발 import로 ws 유입, tsc에 node 타입 유입 | 파일 단위 import만, vite build 검증 |
| 2 | 서버 view 3필드 추가 | 서버 허용목록/누출 테스트 수정 | 공개 정보만 추가, view.test.ts 갱신 |
| 3 | 어댑터 순수 함수 + 동치 테스트 | 도라/뒷도라/점수 분해 로직 중복으로 불일치 | summarizeRound와 summarizeFromView를 다수 시드로 비교 |
| 4 | Board/SeatPanel view 기반 + 좌석 회전 | 기존 테스트 25~35개 수정, 좌석 라벨 오류 | 래퍼로 기존 테스트 유지, mySeat 0~3 전부 테스트 |
| 5 | useLocalGame 추출 | App 테스트 3개와 타이머 동작 변화 | 시드 고정 결과 동일성 테스트 |
| 6 | useServerGame | 재접속, seq 관리, 서버 자동 다음 국과 결과 모달 겹침, autoRiichiDiscard 정책, 새 게임 프로토콜 부재, 시드/로그 부재 | 결과 모달은 roundEnd 동안만 표시, 로그는 diff 합성, 새 게임은 후속 서버 작업으로 분리 |

## 한계
- WS 연동/번들은 실행하지 않음(조사 단계). 테스트 영향 수는 grep 기반 추정.
- gameEnd 이후 새 게임 시작 경로는 protocol.ts 메시지 목록 기준으로만 판단(방 재시작 경로 미확인).
