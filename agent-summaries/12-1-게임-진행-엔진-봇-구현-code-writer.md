# 게임 진행 엔진 + 봇 구현 - code-writer

## 한 일
2단계(로컬 프로토타입)의 기반으로, UI가 그대로 쓸 수 있는 순수/불변 상태 머신과 단순 봇을 `packages/core`에 추가. 기존 모듈은 수정하지 않고(`index.ts` re-export만 추가) 기존 API를 재사용.

## 변경 파일 (packages/core/src)
- `game.ts` (신규): `GameState`, `createGame(rng, options)`, `legalActions(state, seat)`, `dispatch(state, action)`, `awaitingSeats(state)`, `startNextRound(state, rng)`, 헬퍼(`isFuriten`, `waitingTileTypes`, `shantenWithMelds`, `seatWindOf`, `doraIndicatorsOf`, `IllegalActionError`).
- `bot.ts` (신규): `decideAction(state, seat, rng?)`.
- `game.test.ts` (신규, 36개): 규칙 단위 테스트. `sim.test.ts` (신규, 2개): 봇 4명 시뮬레이션.
- `index.ts`: `game`, `bot` re-export.

## 설계 요약
- phase: `turn`(행동자 1명) / `response`(버림패 응답 대기, 행동 가능한 좌석만 `pending.awaiting`) / `roundEnd` / `gameEnd`.
- 손패는 멜드 제외, 뽑은 패는 손패 맨 뒤 + `drawnTile`. 왕패 [0..3] 영상패, [4..8] 도라, [9..13] 뒷도라. 깡 시 산패 마지막 1장이 왕패로 이동(14장 유지).
- 리치는 `{type:"discard", riichi:true}` 액션. 리치봉은 그 버림패가 론당하지 않을 때(통과/부로) 지불.
- 응답 해결: 론(더블론 허용, 삼가화는 옵션) > 도중유국(사가리치/사풍연타/사개깡) > 펑·대명깡 > 치 > 전원 통과(황패 또는 다음 좌석 츠모).
- 화료: `calculateScore` + `countTotalDora({includeRedFives:true})`, 뒷도라는 리치일 때만. 더블론은 머리박음(첫 화료자만 본장/리치봉).
- 역 없는 화료는 합법 행동에서 제외, 강제로 dispatch하면 `IllegalActionError(reason: "noYaku"|"furiten"|...)`.

## 룰 선택/미구현 (game.ts 상단 주석에도 기재)
- 리치 후 깡 금지(대기 불변 조건 안깡 미구현), 창깡 없음, 일발/해저/영상개화/더블리치/천지화 등 상황 역 없음(역 자체가 미구현).
- 후리텐: 자기 버림패(부로된 것 포함), 동순, 리치 후 영구 구현. 국사무쌍은 isAgari 미지원.
- 쿠이가에시 미구현. 해저 버림패는 부로 불가. 깡도라: 안깡 즉시, 명깡/가깡은 다음 타패 직후.
- 나가시만관 미구현. 게임 종료: 동풍전 4국에서 친 연장 실패 또는 점수 < 0. 종료 시 남은 리치봉은 정산하지 않음. 올라스 연장 없음.
- 봇: 부로/깡/구종구패 안 함, 텐파이 시 리치, 샹텐 최소 타패(동률은 쓸모없는 패 우선), 방어 없음. 리치 사전 검사는 14장 샹텐 ≤ 0이라 국사무쌍 텐파이 리치는 제외.

## 검증
- `npm test --workspace=@mahjong/core`: 14개 파일 331개 통과 (기존 293 + 신규 38). `npm run build --workspace=@mahjong/core` 통과.
- 시뮬레이션(30게임, 시드 고정): 매 스텝 패 136장/점수+공탁 100000 보존, 스텝 상한, 화료 국의 점수 결과·수령액 일치. 사전 확인 시 40게임 234국에서 츠모 51/론 144/황패 36/도중유국 3/더블론 1 (봇은 부로를 안 해 부로 화료는 0 - 부로 경로는 단위 테스트로만 검증).
