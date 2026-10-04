# S-5 서버 권위 게임 루프 (code-writer)

## 변경 파일 (packages/server/src)
- `game-session.ts` (신규): `GameSession` (방당 1개, GameState 단일 소스), `GameError`, `actionKey`, `Scheduler`/`timeoutScheduler`/`immediateScheduler`
- `rng.ts` (신규): `secureRandom` (crypto.randomBytes 기반 53비트 [0,1) RandomFn, 기본 RNG)
- `protocol.ts`: `start` 클라이언트 메시지, 오류 코드 `game_not_started` / `game_already_started` / `bad_seq` 추가
- `room.ts`: `RoomManagerOptions.game`, `gameOf(room)`, `startGame(conn)`, close/TTL 삭제 시 게임 close
- `session.ts`: `start`/`action` 케이스 구현, 게임 오류 위반 점수 정책 (`rejoin`은 여전히 `not_supported`)
- `index.ts`: 새 모듈 export
- 테스트: `game-session.test.ts`(단위+세션 퍼즈), `game-ws.test.ts`(실제 ws 통합+퍼즈), `protocol.test.ts`(start), `room.test.ts`(참가 전 action 기대값 not_supported -> bad_message 1줄 변경)

## 설계 판단
- **행동 검증 순서**: 시작됨(game_not_started) -> seq(bad_seq) -> awaitingSeats 포함(not_your_turn) -> legalActions와 `actionKey` 동일(illegal_action) -> dispatch. 클라이언트 seat는 parse에서 이미 제거되고 소켓 좌석을 주입한다. dispatch에는 클라이언트 객체가 아니라 서버가 만든 legalActions 원소를 넘긴다. dispatch 예외는 상태 불변 + illegal_action. 오류 문구는 고정(내부 정보 없음). core에 actionKey가 export되지 않아 `game-session.ts`에 자체 정규 키를 작성(chi/pon use 순서 무관, riichi 생략=false).
- **seq 정책**: 좌석별 마지막 처리 seq보다 커야 함(`>`). 검증을 통과한 seq는 이후 not_your_turn/illegal_action이어도 소비됨(재전송 방어). 게임 시작 전 거부는 소비하지 않음. 응답 `error`에 요청 seq를 실음.
- **응답 구간 균일화**: 타패로 response에 들어가면 사람 응답 대상 여부와 무관하게 항상 `responseWindowMs`(기본 1000) 타이머를 건다. 구간 중 사람 응답은 검증 후 큐에만 쌓고(뷰 전송 없음, 같은 좌석 재응답은 not_your_turn) 구간 종료 때 큐 + 봇 응답을 한꺼번에 적용하고 뷰를 1회 전송한다. 일찍 패스해도 종료가 앞당겨지지 않는다.
- **남는 한계**: 구간 종료 후에도 사람이 응답 대기 중이면 진행이 그 사람의 응답 시간에 의존한다. 즉 "고정 지연 뒤에도 안 끝남 = 누군가 사람이 응답 대기 중"은 추측 가능(누구인지/무엇이 가능한지는 본인 awaitingYou만). 또 봇 차례 지연(botDelay)은 고정이라 타이밍 정보는 없음. 완전 은닉은 불가.
- **진행**: `pump()` 재진입 안전 루프, 타이머는 항상 최대 1개. 봇 차례 `botDelayMs`(600), 국 종료 후 `nextRoundDelayMs`(5000) 뒤 자동 `startNextRound`(클라이언트 메시지 없음), gameEnd면 정지 후 action은 not_your_turn. 타이머는 unref, `close()`/RoomManager.close()/방 TTL 삭제 시 취소.
- **끊김**: 자동 처리 없음(S-7). 끊긴 사람 차례에서는 타이머 없이 대기만 한다. 재접속용 `sendViewTo(seat)` 제공(연결된 사람 좌석에만 전송).
- **위반 정책**: 파싱 실패 +1(기존), 게임 오류(illegal_action/not_your_turn/bad_seq)는 +2(유효 메시지 감쇠 -1과 합쳐 순증 +1) 후 한도 초과 시 종료. game_not_started/game_already_started는 비계산. 참가 전 start/action은 RoomError bad_message.
- **RNG**: `GameSessionOptions.rng` 주입 가능(기본 secureRandom). 시드/상태는 메시지에 실리지 않음(테스트에서 확인). 봇 결정에도 같은 rng 사용.

## 검증
- `npm test`(루트): core 337, server 98(6파일), web 51 모두 통과. `npm run build` 통과. 서버 테스트 약 10초.

## 2차 반영 (검증 권장 사항)
- **ack 규약**: 응답 구간 중 사람 응답이 수락돼 큐에 쌓이면 해당 좌석에만 `{type:"ack", seq}` 전송(protocol `ServerMessage`에 추가). 다른 좌석에는 절대 보내지 않음. 같은 구간 재응답은 not_your_turn(위반 점수 +2/-1 정책 유지, 클라이언트는 ack 후 재전송 금지). 규약은 game-session.ts 헤더에도 명시.
- **seq 자기 잠금 방지**: seq가 `last + maxSeqJump`(기본 `MAX_SEQ_JUMP`=1000, 옵션 주입)를 넘거나 last 이하이면 bad_seq이며 lastSeq 미갱신. MAX_SAFE_INTEGER 전송 후에도 정상 seq 행동 가능(테스트).
- **응답 구간 확장**: 응답 가능자가 없어도 모든 타패 직후 `responseWindowMs`(기본 1000) 구간을 둔다. 구간 중 뷰 전송은 보류하고(응답 단계에서 응답 대상인 사람 좌석만 예외로 전송), 종료 시 전원에게 최종 뷰 전송. 구간 중 phase가 turn/roundEnd일 때의 행동은 not_your_turn. 속도 영향: 매 타패(봇 포함)마다 최소 1000ms 추가, 옵션으로 조정. 남는 한계: 응답 대상 사람은 구간 중 뷰를 받아 본인에게만 대상임이 드러나고, 구간 후에도 사람이 대기하면 그 응답 시간에 의존.
- **봇 정체 방지**: `botDecide` 주입 가능. 봇 한 수 후 상태가 진행되지 않으면 실패로 세고 연속 `maxBotFailures`(기본 3) 회에서 방을 halt(타이머 정리, 사람에게 `server_error` 1회, 이후 action은 server_error). 즉시 스케줄러에서도 무한 재귀 없음. 오류 코드 `server_error` 추가.
- `GameSessionOptions.initialState`(테스트용 시작 상태 주입) 추가.
- **테스트**: 구간 중 불법 응답(chi/kyuushu) 즉시 거부·큐 미적재·이후 pass 수락·ack/타 좌석 미수신, 모든 타패 지연 균일(+뷰 보류), seq 점프, 봇 정지, `game-tamper.test.ts`(리치 타패/멘젠 츠모/리치 후 츠모/안깡/소밍깡/구종구패/적5 타패/론/펑+대명깡/치 적5 구분 변조: 필드 변조 요청 전부 illegal_action·깨진 형식 bad_message·상태 참조 불변·이후 합법 행동 수락). 변이 확인: legalActions 비교를 임시 제거하면 구간 테스트가 실패함을 확인하고 원복함. ws 타이머 테스트는 느려져 첫 국 종료까지만 확인하도록 축소.
