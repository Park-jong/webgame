# 12-4 서풍 쌍패 론 미활성 원인 조사 (code-verifier)

## 결론
정상 동작 (엔진 버그 아님, UI 버그 아님). 저장소 파일은 수정하지 않았다.

## 확인한 것
- game.ts: winContext가 seatWind=seatWindOf(state, seat), roundWind=state.roundWind를 전달한다 (337~361줄). canRon은 isAgari, scoreWin(역 유무), 안깡 제한, !isFuriten 순으로 판정한다 (396~409줄). 자풍 누락 없음.
- 임시 복사본(%TEMP%/gcopy)에서 vitest로 재현. 친=좌석2(좌석0 자풍 서)에서 234m567p789s11m33z 샤본 대기 시 서 론 가능. 장풍=서도 론 가능.
- 론 불가인 경우: 서가 자풍도 장풍도 아닐 때(역 없음), 서를 이미 버린 후리텐, 다른 대기패(1m)를 버린 후리텐, 서가 대기패가 아닐 때(양면/변짱 대기 + 서 쌍).
- 랜덤 1500판 퍼즈에서 자풍 서 화료 가능 + 후리텐 아님인 16건 모두 ron 제공 (누락 0).
- web: ActionBar.tsx는 legalActions의 ron을 그대로 버튼으로 표시. controller.ts에 론을 숨기거나 자동 패스하는 로직 없음.

## 추정 원인
(c) 후리텐(자신이 서를 버렸거나 동순 후리텐) 또는 (d) 서가 실제 대기패가 아니었음. UI에 후리텐/대기 표시가 없어 사용자가 알기 어렵다.

## 제안
UI에 후리텐 표시(isFuriten, furitenTemp 노출)를 추가하는 개선을 고려. 엔진 회귀 테스트로 자풍 서 샤본 론 가능, 서 후리텐 시 불가 케이스를 추가할 수 있다.
