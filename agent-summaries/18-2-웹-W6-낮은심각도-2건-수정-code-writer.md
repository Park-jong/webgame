# 18-2 웹 W6 낮은 심각도 2건 수정 (code-writer)

## 변경
- `packages/web/src/game/useServerGame.ts`: `actions`에 `s.conn === "connected"` 조건 추가. closed/reconnecting/connecting에서는 마지막 view가 남아 있어도 빈 배열. `act` 오류 처리는 그대로.
- `packages/web/src/App.tsx`: MinimalEntry는 `idle` 또는 (`closed` 이면서 `roomId === null`)일 때만 노출. closed이면서 방에 남아 있으면 안내 한 줄 '연결이 끊겼습니다. 나가기를 눌러 주세요'만 표시(나가기 버튼은 기존 헤더 것 사용).
- `packages/web/src/game/useServerGame.test.tsx`: 테스트 5개 추가.
  - 1008 closed 후 actions [], retries_exhausted closed 후 actions [], reconnecting 중 [] 및 rejoin 후 새 view에서 복구
  - App: displaced closed -> 방 만들기/입장 없음, 나가기·안내 있음, 나가기 후 idle이면 입장 보임
  - App: 방 입장 전 unknown_room closed -> 입장 보임

## 검증
- web tsc 통과, web 테스트 177개 통과(기존 172 + 신규 5), web build 성공.
- 변이(두 조건 제거) 시 신규 4개 실패 확인 후 원복. unknown_room 테스트는 변이 전후 모두 통과(회귀 방지용 경계 테스트).
