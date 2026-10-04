# @mahjong/server

리치마작 서버 권위(server-authoritative) 게임 서버. Node.js + [`ws`](https://github.com/websockets/ws) WebSocket 위에서
`@mahjong/core` 룰 엔진을 구동한다. 게임 상태(`GameState`)의 유일한 원본은 서버 메모리이며, 클라이언트는
"무엇을 하고 싶은지"만 보내고 서버가 `legalActions`와 비교해 합법일 때만 반영한다.

> 현재 `packages/web`은 이 서버에 연결하지 않는다(로컬 `game.ts`/`bot.ts`로 동작). 웹 클라이언트 전환은 ROADMAP 3단계의 남은 항목이다.

## 구조

| 파일 | 역할 |
|---|---|
| `src/main.ts` | 실행 진입점. `PORT`로 `createGameServer` 실행, SIGINT/SIGTERM에서 종료 |
| `src/index.ts` | `createGameServer`(ws 연결, maxPayload, keepalive) + 아래 모듈 re-export |
| `src/protocol.ts` | 메시지 타입, 오류 코드, `parseClientMessage` (형식 검증·정규화) |
| `src/session.ts` | 연결 단위 처리: 메시지 분기, 위반 점수, 식별 실패 한도, 토큰 버킷, 참가 제한 시간 |
| `src/room.ts` | `Room`/`RoomManager`: 방 ID, 좌석 토큰, 참가/재접속/끊김, 빈 방 TTL |
| `src/game-session.ts` | 방 하나의 게임 루프: 행동 검증, 봇 구동, 응답 구간, 마감·자동 모드, 일시정지 |
| `src/view.ts` | `viewFor(state, seat)`: 좌석별 뷰(허용 목록 방식) |
| `src/rng.ts` | `secureRandom`: `crypto.randomBytes` 기반 `RandomFn` (`Math.random` 미사용) |
| `src/test-utils.ts` | 테스트 전용 헬퍼(프로덕션 코드에서 import 금지) |

`@mahjong/core`는 `dist`가 아닌 소스(`../core/src/index.ts`)를 직접 참조한다. `tsconfig.json`의 `paths`(타입 검사, `tsx` 실행)와
`vitest.config.ts`의 alias(테스트)로 설정돼 있어 core를 먼저 빌드하지 않아도 된다.

## 실행

저장소 루트에서 npm workspaces 기준으로 실행한다. 이 패키지의 스크립트(`package.json`)는 다음과 같다.

| 목적 | 명령 | 비고 |
|---|---|---|
| 개발/실행 | `npm run dev -w @mahjong/server` | `tsx src/main.ts`. 별도 `start` 스크립트는 없다 |
| 빌드(타입 검사) | `npm run build -w @mahjong/server` | `tsc --noEmit`: JS 산출물을 만들지 않는다(`typecheck`와 동일) |
| 타입 검사 | `npm run typecheck -w @mahjong/server` | |
| 테스트 | `npm test -w @mahjong/server` | `vitest run` (루트 `npm test`는 전 패키지) |

산출물(dist)이 없으므로 운영 실행도 현재는 `tsx`로 `src/main.ts`를 실행하는 방식이다(배포 구성은 미정).

### 환경변수

| 변수 | 기본값 | 설명 |
|---|---|---|
| `PORT` | `8080` | 리슨 포트(`Number(process.env.PORT ?? 8080)`). `0`이면 임의 포트이며 시작 로그에 실제 포트가 출력된다 |

그 밖의 값(타임아웃, 한도 등)은 환경변수가 아니라 `createGameServer` 옵션으로만 바꾼다(아래 "옵션").

### 테스트 환경변수

| 변수 | 설명 |
|---|---|
| `STRESS=1` | 퍼즈/부하 테스트의 긴 버전(반복 수 확대). 기본은 짧은 버전. 예(bash): `STRESS=1 npm test -w @mahjong/server` |
| `FUZZ_SEED=n` | 퍼즈의 기준 시드를 `n`으로 고정해 실패를 재현한다. 테스트가 `[seed] ... (재현: FUZZ_SEED=n ...)` 로그를 출력한다 |

PowerShell 예: `$env:STRESS=1; npm test -w @mahjong/server`. PowerShell의 `$env:` 설정은 해당 세션에 남으므로 끝나면 `Remove-Item Env:STRESS`로 지운다(`FUZZ_SEED`도 같다).

## 프로토콜

WebSocket 텍스트 프레임에 JSON 메시지 한 개씩을 싣는다. 바이너리 프레임은 거부된다(위반 +1).

### 클라이언트 -> 서버

| type | 필드 | 설명 |
|---|---|---|
| `join` | `roomId?`, `name?` | `roomId`가 없으면 새 방을 만들고, 있으면 그 방의 가장 낮은 빈 좌석에 앉는다. `name`은 1~32자이며 저장만 되고 뷰에는 나가지 않는다 |
| `rejoin` | `roomId`, `seatToken` | 좌석 토큰으로 끊긴(또는 기존) 연결을 대체한다 |
| `start` | (없음) | 방에 앉은 아무 좌석이나 게임을 시작할 수 있다. 빈 좌석은 봇으로 채워진다 |
| `action` | `seq`, `action` | 행동 제출. `seq`는 0 이상 안전 정수. `action`은 core `Action`에서 `seat`를 뺀 형태 |
| `ping` | (없음) | `pong` 응답. 참가 전에도 보낼 수 있다 |

- `roomId`, `seatToken`은 1~64자 문자열. 문자열 메시지 전체는 최대 2048자(`MAX_MESSAGE_LENGTH`). 초과/JSON 오류/알 수 없는 type은 `bad_message`.
- 좌석은 클라이언트가 지정하지 않는다. 메시지 최상위의 `seat`는 무시되고, `action.seat`는 형식(0~3 정수)만 검사한 뒤 버린다.
  서버는 소켓에 묶인 좌석의 `legalActions`와 구조적으로 같은 행동만 받아들인다(필드 순서, `riichi` 생략 여부, `chi`/`pon`의 `use` 순서는 무관).
- 행동 종류(`action.type`): `discard`(`tile`, `riichi?`), `ankan`/`shouminkan`(`tile`), `chi`/`pon`(`use`: 패 2장),
  `tsumo`, `ron`, `kyuushu`, `daiminkan`, `pass`. 패 표현은 core `Tile`과 같다
  (`{kind:"number",suit:"man"|"pin"|"sou",rank:1-9,isRedFive:boolean}`, `{kind:"wind",wind:"east"|...}`, `{kind:"dragon",dragon:"white"|"green"|"red"}`).
  보통은 `view.legalActions`의 원소를 그대로(또는 `seat`만 빼서) 보내면 된다.

### 서버 -> 클라이언트

| type | 필드 | 설명 |
|---|---|---|
| `joined` | `roomId`, `seat`, `seatToken` | join/rejoin 성공. rejoin이면 `seatToken`은 클라이언트가 보낸 값 그대로(재발급 없음) |
| `view` | `view`, `deadlineMs?` | 좌석별 뷰(`SeatView`, 아래 "뷰 정책"). `deadlineMs`는 본인이 행동해야 하고 일반 마감이 걸려 있을 때만 붙는 "마감까지 남은 ms" |
| `error` | `code`, `message`, `seq?` | 오류. 게임 행동 오류(`not_your_turn`, `illegal_action`, `bad_seq` 등)에는 요청의 `seq`가 되돌아온다. 형식 오류와 방에 앉지 않은 연결의 `action`(`bad_message`)에는 `seq`가 없다. 메시지는 고정 문구이며 내부 상태를 담지 않는다 |
| `ack` | `seq` | 응답 구간 중 사람의 응답이 접수됨(해당 좌석에만) |
| `notice` | `code`: `"timeout"` \| `"auto_mode"` | 행동 시간 초과로 자동 처리됨 / 연속 3회 마감으로 자동 모드 전환(본인에게만) |
| `pong` | (없음) | `ping`에 대한 응답 |

### 오류 코드

| 코드 | 발생 조건 |
|---|---|
| `bad_message` | 형식 오류(JSON/필드/길이/알 수 없는 type), 바이너리 프레임, 방에 앉지 않고 `start`/`action`, 이미 방에 앉은 연결의 `join`/`rejoin` |
| `not_your_turn` | 지금 행동할 수 없는 좌석, 이미 이 응답 구간에서 응답함, 응답 구간 중 비응답 단계, 게임 종료 후 |
| `illegal_action` | 합법 행동 목록에 없는 행동 |
| `bad_seq` | `seq`가 좌석별 마지막 값 이하이거나 `마지막 값 + 1000`(`MAX_SEQ_JUMP`)을 초과 |
| `unknown_room` | `join`/`rejoin`의 `roomId`가 없는 방, 서버 종료 후의 참가 |
| `bad_token` | `rejoin`의 좌석 토큰 불일치 |
| `room_full` | 방이 가득 참(게임 시작 후 빈 좌석 없음 포함), 서버의 방 수가 한도(1000)에 도달 |
| `game_not_started` | 게임 시작 전 `action` |
| `game_already_started` | 이미 시작된 방에서 `start` |
| `server_error` | 봇이 연속으로 진행에 실패해 방이 중단됨(이후 `action`도 이 코드), 예상 밖 서버 내부 오류(이 경우 해당 연결은 종료) |
| `not_supported` | 예약 코드. 현재 서버가 보내는 경로는 없다 |

### 예시 (클라이언트 메시지)

```json
{ "type": "join", "name": "park" }
```

```json
{ "type": "join", "roomId": "K7M2Q9XA" }
```

```json
{ "type": "rejoin", "roomId": "K7M2Q9XA", "seatToken": "Zx3hQ0n1c8v5u2y7t4r6e9w1a3s5d7f9" }
```

```json
{ "type": "start" }
```

```json
{ "type": "action", "seq": 1, "action": { "type": "discard", "tile": { "kind": "number", "suit": "man", "rank": 5, "isRedFive": true } } }
```

```json
{ "type": "action", "seq": 2, "action": { "type": "discard", "tile": { "kind": "wind", "wind": "east" }, "riichi": true } }
```

```json
{ "type": "action", "seq": 3, "action": { "type": "chi", "use": [{ "kind": "number", "suit": "pin", "rank": 3, "isRedFive": false }, { "kind": "number", "suit": "pin", "rank": 4, "isRedFive": false }] } }
```

```json
{ "type": "action", "seq": 4, "action": { "type": "pass" } }
```

```json
{ "type": "ping" }
```

### 예시 (서버 메시지)

(방 ID와 토큰은 임의 값이다. 방 ID는 8자, 토큰은 base64url 32자.)

```jsonc
{ "type": "joined", "roomId": "K7M2Q9XA", "seat": 0, "seatToken": "Zx3hQ0n1c8v5u2y7t4r6e9w1a3s5d7f9" }
{ "type": "view", "view": { /* SeatView */ }, "deadlineMs": 27450 }
{ "type": "ack", "seq": 4 }
{ "type": "notice", "code": "timeout" }
{ "type": "error", "code": "illegal_action", "message": "허용되지 않는 행동입니다", "seq": 3 }
{ "type": "pong" }
```

### 흐름

1. 연결 후 **10초 안에** `join` 또는 `rejoin`을 보낸다(아니면 연결 종료). `join`이 성공하면 `joined`를 받는다. 새 방이면 `roomId`와 `seatToken`을
   안전한 곳(예: 로컬 저장소)에 보관한다. 다른 사람은 그 `roomId`로 `join`한다. 게임 시작 전에는 `view`가 오지 않는다.
2. 방에 앉은 누군가 `start`를 보낸다. 빈 좌석은 봇이 되고, 모든 사람 좌석에 첫 `view`가 전송된다. 이후 상태가 바뀔 때마다 `view`가 온다.
   국이 끝나면 5초 뒤 서버가 자동으로 다음 국을 시작하고(클라이언트 메시지 없음), 게임이 끝나면(`phase: "gameEnd"`) 정지한다. 종료 조건은 core 기준으로, 누군가의 점수가 0 미만이 되거나(마이너스), 동풍전 마지막 국(4국)에서 친이 연장하지 못하고 끝나는 경우다.
3. `view.awaitingYou`가 `true`일 때 `view.legalActions` 중 하나를 `action`으로 보낸다. `seq`는 좌석별로 증가하는 값(예: 1, 2, 3...)을 쓴다.
   응답 구간(아래 "타임아웃") 중 응답은 `ack`로 접수 확인되며, 같은 구간에서 다시 보내면 `not_your_turn`이다. `ack`를 받으면 재전송하지 않는다.
4. 연결이 끊기면 새 연결에서 `rejoin`(`roomId`, 보관한 `seatToken`)을 보낸다. `joined`를 받고, 게임이 시작된 뒤라면 이어서 현재 `view`가 와서 그대로 진행한다(게임 시작 전에는 `view`가 없다. 응답 구간 중이면 응답 대상이 아닌 좌석은 구간 종료 때 `view`를 받는다).
   오류 응답을 받은 `seq`도 소비된다. `seq` 검증을 통과하면 `not_your_turn`/`illegal_action`이어도 마지막 값이 갱신되므로, 같은 `seq` 재전송은 `bad_seq`이고 다음 행동은 더 큰 `seq`를 써야 한다.
   새 클라이언트가 마지막 `seq`를 모르면 충분히 큰 `seq`로 점프해야 한다(마지막 값 + 1000 이내). 서버는 마지막 `seq`를 알려주지 않는다.

## 뷰 정책

`viewFor(state, seat)`는 허용 목록 방식이다(모든 필드를 명시해 새 객체를 만들며, 스프레드/전체 복사를 쓰지 않는다. `GameState`에 새 필드가 생겨도
`view.ts`에 추가하지 않으면 나가지 않는다). 반환값은 원본 상태와 참조를 공유하지 않는다.

| 구분 | 내용 |
|---|---|
| 본인에게만 | 손패 전체(`hand`), 뽑은 패(`drawnTile`, 본인 차례일 때만), 후리텐 여부(`furiten`), 쿠이가에시 금지패(`kuikae`, 본인 차례일 때만, 아니면 빈 배열), 합법 행동(`legalActions`), `awaitingYou`, `deadlineMs`(view 봉투), `ack`/`notice` |
| 모두에게 공개 | 좌석별 점수·리치 여부·자풍·멜드·버림패(`players[]`), 상대 손패는 장수(`handCount`)만, 도라 표시패(공개분), 남은 산패 장수(`liveWallCount`), 차례·`phase`·국/본장/리치봉, 응답 대기 중인 버림패(`pending`: `discarder`, `tile`, 창깡 대기일 때만 `chankan`: `"shouminkan"` 또는 `"ankan"`) |
| 절대 제외 | 산패·왕패의 내용, 상대의 손패·뽑은 패·후리텐·합법 행동, 론 가능 좌석(`ronEligible`)·다른 좌석의 응답(`responses`)·응답 대기 좌석 목록(`awaiting`), 시드/RNG 상태, 좌석 토큰, `name` |

- **`awaitingYou`**: 본인이 지금 행동/응답해야 하는지만 알려 준다. 상대가 응답해야 하는지, 이미 응답했는지는 어떤 필드로도 알 수 없다.
- **`deadlineMs`**: `view` 메시지 봉투에만, 행동해야 하는 본인에게만 붙는다(`viewFor` 결과에는 없다). 서버 시각이 아닌 "남은 ms" 상대값이라 시계 편차가 없다.
  일반(`normal`) 마감일 때만 붙으며, 자동 모드/끊김 마감, 응답 구간 중, 마감 비활성(`Infinity`)일 때는 없다.
- **안깡**: 선언 시 4장이 공개되므로 패 종류와 적5 여부가 상대에게도 보인다.
- **국 종료 결과(`result`)**: 국이 끝난 `phase`(`roundEnd`/`gameEnd`)에서만 non-null.
  - 전원에게 공개: 결과 종류(`tsumo`/`ron`/`exhaustive`/`abortive`), `deltas`, `dealerContinues`, 유국 사유(`reason`), 황패평국의 좌석별 텐파이 여부(`tenpai`), 유국만관 달성 좌석(`nagashiMangan`, 달성자가 있을 때만 키가 존재).
  - 화료자(`wins`)의 손패·멜드·화료패·점수 내역(역, 판수, 부수, 지불)은 공개된다(화료 시 패를 오픈하는 규칙).
  - 뒷도라 표시패(`uraDoraIndicators`)는 화료자 중 리치한 사람이 있을 때만 공개되고, 아니면 빈 배열이다.
  - 비화료자의 손패, 텐파이자의 손패, 구종구패 선언자의 손패, 패산·왕패는 국 종료 후에도 비공개다.

## 방 / 토큰 / 재접속 모델

- **방**: `join`에 `roomId`가 없으면 서버가 새 방을 만든다(방 수 상한 1000). 방 ID는 8자이며 혼동 문자(0/O, 1/I/L)를 뺀 32자 알파벳(`23456789ABCDEFGHJKMNPQRSTUVWXYZ_`)에서
  `crypto.randomBytes`로 뽑는다(40비트). 방당 사람 최대 4명이고 먼저 온 순서로 낮은 번호 좌석에 앉는다.
- **좌석 토큰**: 참가 시 발급되는 24바이트(192비트) base64url 32자 문자열. **로그인이 없으므로 토큰을 가진 쪽이 곧 그 좌석의 권한자**다.
  `joined`로 한 번 내려가고 다른 곳(뷰, 오류, 로그)에는 나가지 않는다. `rejoin` 성공 시에도 재발급하지 않으며, 서버가 저장소의 값이 아니라
  클라이언트가 보낸 값을 되돌려 준다. 토큰 값 비교는 `timingSafeEqual`이며 길이가 다르면 먼저 거부한다(토큰 길이는 고정 32). `rejoin`은 좌석 전체를 순회하되, 사람이 아닌(봇) 좌석은 비교를 생략한다.
- **끊김**: 좌석은 사람(human)으로 유지되고 `connected: false`가 된다(봇으로 바뀌지 않는다). 끊긴 좌석의 차례는 3초 뒤 자동 처리된다(아래).
- **전원 이탈**: 방에 연결된 사람이 0이 되면 게임이 **일시정지**된다(타이머와 마감을 모두 버리고 봇 포함 진행 중지). 동시에 빈 방 삭제 타이머(TTL 5분)가 걸린다.
  TTL 안에 누군가 `rejoin`하면 타이머가 취소되고 재개되며, 마감은 재접속 시점부터 새로 계산된다(정지 중 시간은 소모되지 않음).
  응답 구간 중 정지됐다면 구간 시간은 처음부터 다시 잰다. TTL이 지나면 방과 게임 상태가 삭제되어 이후 `rejoin`은 `unknown_room`이다.
- **좌석별 `seq`**: 정지/재접속과 무관하게 서버가 유지하므로 옛 `seq`를 재전송해도 `bad_seq`다.
- **중복 rejoin**: 같은 토큰으로 새 연결이 `rejoin`하면 새 연결이 좌석을 가져가고 이전 연결은 종료된다(close 1008, 500ms 뒤 강제 종료).
  같은 토큰을 가진 사람이 둘이면 마지막 `rejoin`이 이긴다. 끊기지 않은 채 연결만 교체한 경우에는 마감, 연속 타임아웃 횟수, 자동 모드를 건드리지 않는다
  (자기 차례 직전 반복 `rejoin`으로 마감을 연장하는 것을 막기 위함). 실제로 끊겼다가 돌아온 경우에는 자동 모드가 해제되고 카운터가 0이 되며 마감이 일반 시간으로 다시 시작된다.
  이미 방에 앉은 연결이 다시 `join`/`rejoin`하면 `bad_message`.
- 게임이 시작된 방에는 새로 `join`할 수 없다(빈 좌석이 없으므로 `room_full`). 시작 후 복귀는 `rejoin`만 가능하다.

## 타임아웃 / 자동 모드

사람 좌석이 행동하거나 응답할 차례가 되면 좌석별 마감이 걸린다. 값은 `GameSessionOptions`로 바꿀 수 있다(아래 "옵션").

| 마감 | 기본값 | 상수 | 적용 |
|---|---|---|---|
| 내 턴(`turn` 단계) | 30초 | `TURN_TIMEOUT_MS` | 연결된 일반 좌석 |
| 응답(`response` 단계: 론/부로 선택) | 15초 | `RESPONSE_TIMEOUT_MS` | 연결된 일반 좌석 |
| 끊긴 좌석 | 3초 | `DISCONNECTED_TIMEOUT_MS` | `connected:false` 좌석. 이미 걸려 있던 마감보다 짧아질 때만 단축. 타임아웃 횟수로 세지 않음 |
| 자동 모드 좌석 | 600ms | `AUTO_DELAY_MS` | 자동 모드로 전환된 좌석(봇 지연과 같은 값) |

- **응답 구간**: 모든 타패 직후(응답 가능한 사람이 없어도) `responseWindowMs`(기본 1000ms) 동안 구간이 열린 뒤 해결된다.
  구간 중 사람의 응답은 검증만 하고 큐에 쌓은 뒤 구간 종료 때 한꺼번에 적용하며(일찍 패스해도 종료가 앞당겨지지 않음), 접수되면 해당 좌석에 `ack`를 보낸다.
  봇 응답도 구간 종료 때 적용된다. 구간 중에는 뷰 전송을 보류하고(응답 대상인 사람 좌석만 예외), 종료 시 전원에게 최종 뷰를 보낸다.
  **마감은 구간이 끝나고 실제 행동 기회가 생긴 뒤에 시작**한다.
- **자동 행동**(마감 도달 시, 항상 서버가 만든 `legalActions` 원소만 사용): 내 턴이면 뽑은 패를 그대로 버림(쯔모기리), 불가하면 합법 비리치 타패 중 마지막 것.
  응답 단계이면 `pass`. 화료(쯔모/론), 리치, 깡, 부로(치/펑)는 절대 자동으로 하지 않는다.
- **알림**: 일반 마감이 지나면 본인에게 `notice: "timeout"`. 상대에게는 일반 타패/패스로만 보인다.
- **자동 모드 진입**: 연속 3회(`MAX_CONSECUTIVE_TIMEOUTS`) 일반 마감을 넘기면(3회째 마감에서 진입) `notice: "auto_mode"`를 보내고 이후 같은 규칙으로 600ms 뒤 자동 행동한다.
- **해제**: 그 좌석이 유효한 행동을 제출하거나(응답 구간 중 접수된 응답 포함), 끊겼다가 `rejoin`하면 해제되고 연속 횟수가 0이 된다.
- **봇**: 봇 차례는 600ms(`BOT_DELAY_MS`) 뒤에 한 수씩 진행한다. 봇이 연속 3회(`MAX_BOT_FAILURES`) 상태를 진행시키지 못하면 방을 중단하고 사람에게 `server_error`를 한 번 보낸다.
- 국이 끝나면 5초(`NEXT_ROUND_DELAY_MS`) 뒤 다음 국이 자동 시작된다.

## 연결 보호 한도

`createSession`(연결별)과 `createGameServer`가 적용한다. 위반 연결은 `close(1008)` 후 500ms 뒤 강제 종료된다(오류 응답이 먼저 전달되도록).

| 항목 | 기본값 | 상수 | 동작 |
|---|---|---|---|
| 프레임 최대 크기 | 8192바이트 | `MAX_PAYLOAD_BYTES` (= `MAX_MESSAGE_LENGTH` 2048 x 4) | 초과하면 ws가 직접 연결을 닫는다 |
| 메시지 최대 길이 | 2048자 | `MAX_MESSAGE_LENGTH` | 초과 시 `bad_message` |
| 위반 점수 한도 | 5 | `MAX_CONSECUTIVE_VIOLATIONS` | 형식 위반/바이너리 +1, 형식이 올바른 메시지가 오면 -1(0 미만으로는 안 내려감). 한도를 **초과**(6 이상)하면 종료 |
| 게임 오류 가중 | +2 | (코드 내) | `illegal_action`/`not_your_turn`/`bad_seq`는 +2(유효 메시지 감쇠 -1과 합쳐 순증 +1). `game_not_started`/`game_already_started`와 방 오류는 점수 없음 |
| 식별 실패 한도 | 5 | `MAX_IDENTIFY_FAILURES` | `unknown_room`/`bad_token` 누적이 한도를 **초과**(6번째)하면 종료. 성공해도 초기화되지 않음 |
| 속도 제한(토큰 버킷) | 초당 20, 버스트 40 | `RATE_PER_SECOND`, `RATE_BURST` | 메시지마다 1개 소모. 부족하면 응답 없이 종료 |
| 참가 제한 시간 | 10초 | `JOIN_TIMEOUT_MS` | 연결 후 `join` 시도가 없거나 `rejoin`이 성공하지 못한 채 만료되면 종료(`join`은 시도 즉시 타이머가 해제되고, `rejoin`은 성공해야 해제됨) |
| keepalive | 30초 | `KEEPALIVE_INTERVAL_MS` | 서버가 ping, 한 주기 안에 pong이 없으면 종료 |
| 방 수 상한 | 1000 | `MAX_ROOMS` | 초과 시 `room_full` |
| 방당 연결 수 | 4 | `MAX_CONNECTIONS_PER_ROOM` | |
| 빈 방 TTL | 5분 | `EMPTY_ROOM_TTL_MS` | 연결된 사람이 0이 된 뒤 방·게임 삭제 |
| seq 점프 상한 | 1000 | `MAX_SEQ_JUMP` | 마지막 값 + 1000 초과/이하는 `bad_seq`(마지막 값은 갱신하지 않음) |

서버 내부에서 예상 밖 예외가 나면 스택/원문 없이 `server_error`("서버 내부 오류가 발생했습니다")를 보내고 그 연결만 종료한다(프로세스와 다른 연결은 계속 동작).

## 옵션

### `createGameServer(options): Promise<{ port, rooms, close() }>`

`close()`는 멱등이다(같은 Promise 반환). `port: 0`이면 임의 포트이고 실제 포트는 반환값의 `port`에 있다.

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `port` | (필수) | 리슨 포트 |
| `room` | — | `RoomManagerOptions` |
| `session` | — | `SessionOptions` |
| `keepaliveIntervalMs` | `30000` | keepalive 주기 |

### `RoomManagerOptions` (`options.room`)

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `maxRooms` | `1000` | 방 수 상한 |
| `emptyRoomTtlMs` | `300000` (5분) | 빈 방 삭제까지의 시간 |
| `randomBytes` | `crypto.randomBytes` | 방 ID/토큰 난수 소스(테스트용) |
| `game` | — | `GameSessionOptions` |

### `SessionOptions` (`options.session`)

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `maxViolations` | `5` | 위반 점수 한도 |
| `maxIdentifyFailures` | `5` | 식별 실패 한도 |
| `ratePerSecond` | `20` | 토큰 버킷 보충 속도 |
| `rateBurst` | `40` | 토큰 버킷 크기 |
| `joinTimeoutMs` | `10000` | 참가 제한 시간 |
| `now` | `Date.now` | 시간 소스(테스트용) |

### `GameSessionOptions` (`options.room.game`)

| 옵션 | 기본값 | 설명 |
|---|---|---|
| `turnTimeoutMs` | `30000` | 내 턴 마감 |
| `responseTimeoutMs` | `15000` | 응답 마감 |
| `disconnectedTimeoutMs` | `3000` | 끊긴 좌석 마감 |
| `autoDelayMs` | `600` | 자동 모드 지연. `Infinity`/`NaN`이면 기본값(영구 정지 방지) |
| `maxConsecutiveTimeouts` | `3` | 자동 모드 진입 연속 횟수. 내림 후 1 이상으로 보정, `NaN`은 기본값, `Infinity`는 자동 모드 없음 |
| `botDelayMs` | `600` | 봇 차례 지연 |
| `responseWindowMs` | `1000` | 타패 후 응답 구간 길이 |
| `nextRoundDelayMs` | `5000` | 국 종료 후 다음 국까지 |
| `maxSeqJump` | `1000` | seq 점프 상한 |
| `maxBotFailures` | `3` | 봇 연속 진행 실패 한도 |
| `gameOptions` | core 기본값 | `createGame`에 전달(`tripleRon` 기본 `"abort"`, `startingScore` 기본 25000, `useRedFives` 기본 `true`) |
| `rng` | `secureRandom` | 난수 주입(테스트용) |
| `scheduler`, `now`, `botDecide`, `initialState` | — | 테스트용 주입 |

시간 옵션 규칙(`turn`/`response`/`disconnected`): 미지정이면 기본값, `Infinity`/`NaN`이면 "마감 없음", 0 이하는 0(즉시 발동), 유한 양수는 `setTimeout` 안전 상한(2^31-1 ms)으로 제한한다.

## 알려진 한계와 보안 메모

- **진행 시간으로 드러나는 정보**: 응답 구간(기본 1초)이 지난 뒤에도 진행이 멈춰 있으면 "어떤 사람이 응답 대기 중"임을 추측할 수 있다(사람의 응답 시간에 진행이 의존).
  누구인지/무엇이 가능한지는 `awaitingYou`로 본인만 안다. 자동 모드·끊김은 짧은 마감이라 타이밍으로 일부 추측될 수 있고, 쯔모기리가 반복되면 방치 중임을 짐작할 수 있다.
- **게임 속도**: 모든 타패(봇 포함)마다 응답 구간 때문에 최소 1초가 걸린다(`responseWindowMs`로 조정 가능). 타이밍 균일화를 위한 의도된 비용이다.
- **안깡 시 적5 공개**: 안깡 선언으로 패 종류와 적5 여부가 상대에게 보인다. 또 뽑은 직후 14장 상태의 후리텐 표시는 임시 후리텐 플래그만 반영한다(core `isFuriten` 동작 그대로).
- **IP/연결 수 제한 없음**: 한도는 연결 단위뿐이다. 방 수 상한(1000)과 참가 제한 시간(10초)만 있으며, 한 번 `join`한 유휴 연결은 keepalive가 살아 있는 한 유지된다. 방 만들기 폭주는 방 상한까지 방이 만들어질 수 있다.
- **backpressure 없음**: 느린 소비자의 ws 전송 버퍼(`bufferedAmount`)를 제한하지 않는다. 게임 길이가 유한하고 타임아웃/서버 close에서 연결을 끊어 누수는 관찰되지 않았지만 메모리 한도는 보장하지 않는다.
- **이벤트 루프 지연**: 단일 프로세스·단일 스레드다. 대량 연결(300연결 x 2KB 폭주 실험에서 최대 지연 약 0.5초)에서는 지연이 생길 수 있다.
- **rejoin 브루트포스**: 방어는 연결 단위(식별 실패 5회 초과 시 종료)뿐이라 새 연결로 계속 시도할 수 있다. 실제 방어는 토큰 엔트로피(192비트)와 방 ID 공간(32^8)에 의존한다.
- **토큰 = 권한**: 탈취되면 좌석을 빼앗기고, 분실하면 복구할 수 없으며, 다른 기기로 좌석을 옮길 수도 없다(토큰을 복사해야 함). 토큰을 URL/로그에 남기지 말 것.
- **영속화 없음**: 게임 상태는 서버 메모리에만 있다. 서버 재시작 또는 전원 이탈 후 TTL(5분) 경과 시 소멸한다.
- **방 존재 여부 구분**: `unknown_room`과 `bad_token`이 구분되므로 방 ID의 존재 여부를 알 수 있다(식별 실패 한도로 완화, 방 ID 공간 32^8).
- **시드 기록 없음**: 시드/RNG 상태는 서버 메모리에만 있고 기록하지 않는다. 리플레이나 분쟁 조사용 기록은 5단계에서 별도 설계가 필요하다.
- **교체 사유 미통지**: 중복 `rejoin`으로 밀려난 이전 연결은 사유 없이 1008로 닫힌다.
- **종료 후 잔여 타이머**: 서버 `close()` 뒤에도 연결 강제 종료(terminate) 유예 타이머(500ms, `unref`)가 최대 0.5초 남을 수 있다. 프로세스 종료를 막지는 않는다.
- 테스트 중 실제 타이머를 쓰는 통합 테스트는 시간 의존적이라 매우 느린 환경에서는 한도 여유가 줄 수 있다.

## 로그인이 생기면 바뀔 부분

- 좌석 토큰 발급을 인증 뒤로 옮긴다(인증된 계정만 `join`/`rejoin` 가능). 토큰이 "곧 권한"인 현재 모델에서 "계정이 좌석의 소유자"인 모델로 바뀐다.
- 기기 간 좌석 이어받기: 계정으로 인증하면 토큰 없이도 같은 계정의 새 기기가 좌석을 이어받을 수 있고, 토큰 분실/탈취 문제가 줄어든다.
- 계정 단위 연결·방 수 제한, `rejoin` 브루트포스 방어, 전적 연동은 이와 함께 설계한다(ROADMAP 5단계).
