# 18-1 웹 GameController와 서버 컨트롤러 구현 (W-6, code-writer)

선행: 15-1 조사, 16-2(wsClient), 17-1(어댑터). 커밋 없음, 서버/코어 소스 변경 없음. 입장 화면(W-7)은 만들지 않았다.

## 변경 파일 (packages/web/src)
- game/types.ts (신규): `GameController`(공통), `ServerGameController`(서버 전용 확장), `GameStatus`, `GameNotice`.
- game/useLocalGame.ts (신규): App의 상태 소유(Session, 봇 진행 effect, riichiMode, showFinal, 시드 입력, 지연 토글)를 동작 변경 없이 추출. 내부는 기존 controller(GameState), 외부 `view = viewFor(state, 0)`. 요약은 기존 `summarizeRound(state)` 사용(동작 불변).
- game/useServerGame.ts (신규): wsClient 기반 훅.
- App.tsx: `App`은 모드 선택기(`online` prop 또는 URL `?online=1`, 기본 로컬)이고 `LocalApp`/`ServerApp`으로 나뉜다(훅 순서 고정). 공통 `GameScreen`(BoardView + 결과 모달 + 최종 순위). 서버 모드는 개발용 최소 UI(방 만들기/방 ID 입장/시작/나가기, 상태·남은 시간·notice·error 표시)만 있다.
- components/BoardView.tsx (신규): SeatView 입력 대국 화면. mySeat 기준 `seatLayout` 회전, `tenpaiViewFromSeatView`, `view.kuikae`, `view.pending.chankan`, `seatName` 사용. `view.furiten` 직접 사용 없음.
- components/Board.tsx: 얇은 래퍼. 기존 props(state)를 유지하고 `viewFor(state, 0)`로 BoardView를 렌더(기존 테스트 무수정).
- components/SeatPanel.tsx: props를 `view`+`seat`로 변경. isHuman = (seat === view.seat), 이름은 `seatName(seat, view.seat)`, 상대 손패는 `handCount`. CSS 클래스 `seat-N`의 N은 화면 상대 위치(내 기준 0=아래, 2=위)로 정의해 styles.css 변경 없이 회전이 맞는다. `data-seat`(절대 좌석) 추가. `MeldView`/`Pond`는 그대로 export.
- components/ResultModal.tsx: `mySeat`(기본 0) prop 추가, 모든 이름을 `seatName(seat, mySeat)`로. GameEndScreen도 `mySeat`.
- controller.ts: `roundLabel`의 인자 타입을 `Pick<GameState, "roundWind"|"kyoku"|"honba">`로 넓힘(동작 불변).
- game/wsClient.ts: 낮은 심각도 정리 (아래).

## 인터페이스 요약
- `GameController`: mode, status(`idle|connecting|reconnecting|waiting|playing|ended|closed`), mySeat, view(SeatView|null), actions(합법 행동, 내 차례가 아니거나 응답 대기 중이면 빈 배열), act(action), waitingAck, riichiMode/toggleRiichi, roundOver, gameOver, summary, resultOpen, showFinal, advanceResult, deadlineAt(절대 ms|null), notice('timeout'|'auto_mode'|null)/dismissNotice, error/errorCode/dismissError, log. 로컬 전용 선택 필드: seed, seedInput/setSeedInput, botDelayOn/setBotDelayOn, nextRound, newGame.
- `ServerGameController`: roomId, closeReason, create(name?), join(roomId, name?), start(), leave().
- `useServerGame(options)`: `{url, createSocket, store, timers, resumeStored(기본 true), name, clientOptions}`. 기본은 브라우저 WebSocket + localStorage 저장소 + `getServerUrl()`.

## useServerGame 동작
- create/join: 연결이 없으면 `connect()` 후 연결이 열리면 join 전송(의도 보관), 이미 연결돼 있으면 즉시 전송. 이미 방에 있으면 오류 표시.
- act: `viewRef`의 view로 (1) 응답 대기 중이면 무시 (2) awaitingYou 아니면 오류 (3) `clientActionFromView`로 합법 행동 대조(없으면 전송 안 하고 `illegal_action` 오류) (4) `client.action()` 전송, 성공 시 in-flight 표시·riichiMode/notice/error 초기화·deadlineAt null. 같은 tick 중복 호출은 ref로 차단.
- ack: in-flight를 풀고 `acked`로 전환. 다음 view가 올 때까지 재응답 차단(서버의 `not_your_turn` 방지). view 수신 시 둘 다 해제. 서버 오류 수신 시 in-flight 해제(acked는 유지).
- 끊김: status `reconnecting`(마지막 view 유지), in-flight 해제, 재접속 후 joined -> 새 view로 복귀. close 1008 등은 `closed` + 사유를 error로 표시. rejoin 실패(unknown_room/bad_token/room_full)는 방/뷰 상태를 비움.
- 마운트 시 저장 세션이 있으면 `resumeStored()`(자동 rejoin, seq 저장값+11). 언마운트 시 구독 해제 + `client.close()`(재접속 타이머 정리). `leave()`는 close + 저장소 삭제 + 상태 초기화.
- 결과: roundEnd/gameEnd view에서 `summarizeFromView`. 서버가 5초 뒤 자동으로 다음 국을 시작하므로 "다음 국" 버튼은 모달만 닫고, 결과가 사라진 view가 오면 닫힘 상태 초기화. gameEnd는 "최종 결과" -> GameEndScreen(서버 모드의 새 게임 버튼은 leave).

## wsClient 정리 (기존 테스트 유지)
- (a) 이전 소켓의 늦은 onclose 가드 테스트 추가.
- (b) 수동 `rejoin()` 응답(joined) 전에는 `action()`이 `not_connected`.
- (c) rejoin 중 알 수 없는 오류 코드(seq 없는 error): `awaitingRejoin` 해제. 수동 rejoin이면 연결 유지 + 이전 세션 복원, 자동 rejoin이면 소켓을 버리고 백오프 재접속. 기존 unknown_room/bad_token/room_full은 그대로 종료.
- rejoin 연결+응답 타임아웃(`rejoinTimeoutMs`, 기본 10초, 주입 가능한 타이머): 만료되면 소켓을 닫고 reconnecting으로 전이. 재시도 상한에 도달한 경우 closed 사유 코드 `rejoin_timeout`(CloseReasonCode에 추가). joined/close/finishClosed/handleDrop에서 타이머 정리.

## 테스트 (신규 39개, 기존 133개 무수정 통과, 총 172개)
- game/wsClient.rejoin.test.ts (10), model/discardHints.test.ts (3: 힌트는 손패에서 각 종류를 처음 만난 순서, 정렬 아님. state/SeatView 양쪽 고정), game/useServerGame.test.tsx (20: 흐름·중복 응답 방지·합법성 검증·notice·error·끊김/재접속·자동 resume·unknown_room·언마운트/leave·결과 요약·mySeat 0~3 회전 렌더·ResultModal mySeat=2 이름), game/useLocalGame.test.tsx (5: 훅 동작 3, App 모드 선택 2), game/useServerGame.integration.test.tsx (1: 실서버 port 0 + Node ws, 사람 1+봇 3, 최대 80수까지 진행하며 view 불변식·act 수락·waitingAck 해제·응답 구간 ack 경로 1회 이상 확인).
- 변이 4개 모두 검출 후 원복(cmp 확인): act에서 clientActionFromView 우회(1개 실패), BoardView 회전 제거 seatLayout(0)(3개 실패), ack 후 중복 응답 허용(1개 실패), wsClient 소켓 stale 가드 제거(신규 테스트 1개 실패, 이전엔 생존하던 변이).

## 검증
- `npx tsc -p tsconfig.json`(web) 오류 없음, `npm test -w @mahjong/web` 17파일 172개 통과(약 37초), `npm run build -w @mahjong/web` 성공. dist에 WebSocketServer/createGameServer 없음(서버 index.ts는 테스트 파일에서만 상대 import).

## 미해결/한계
- 서버 모드 UI는 개발용 최소 화면이다(스타일 없음). 입장/대기/재접속 안내 화면은 W-7.
- 서버 모드는 행동 로그 없음(`log: []`), 새 게임 없음(서버에 메시지 없음). 서버 모드의 `autoRiichiDiscard` 같은 자동 츠모기리는 하지 않는다(리치 후에도 서버가 주는 discard 선택지를 사용자가 직접 고름).
- 서버 모드 로컬 `riichiMode`는 UI 상태라 행동 전송 시 해제됨. notice('timeout')는 사용자 행동/닫기 때만 지워진다(자동 소멸 없음).
- resume 중 사용자가 create/join을 누르면 연결 직후 join이 전송돼 서버가 `bad_message`로 거절할 수 있다(오류만 표시, 드문 경로).
- 로컬 모드의 `view`는 항상 존재하므로 `GameScreen`은 view가 null이면 아무것도 그리지 않는다(서버 대기 화면은 ServerApp이 담당).
- `useServerGame.integration.test`는 `IS_REACT_ACT_ENVIRONMENT`를 파일 안에서 끄고 실시간 대기(약 4초)를 쓴다.
- StrictMode 개발 모드에서는 마운트 effect가 두 번 돌아 저장 세션이 있으면 소켓이 한 번 열렸다 닫힌 뒤 다시 열린다(서버는 rejoin 중복을 처리함).
