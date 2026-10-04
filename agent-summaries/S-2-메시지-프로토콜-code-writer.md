# S-2 메시지 프로토콜 (code-writer)

## 한 일
- `packages/server/src/protocol.ts` 신규: 메시지 타입, 오류 코드(`ERROR_CODES`: bad_message, not_your_turn, illegal_action, unknown_room, bad_token, room_full), 크기 상수, `parseClientMessage(raw)` (예외 없음, 실패는 모두 `bad_message`).
- 클라이언트 메시지: `join`(roomId?, name?), `rejoin`(roomId, seatToken), `action`(seq, action), `ping`.
- 서버 메시지: `joined`, `view`, `error`(seq 선택), `pong`. 뷰는 `ServerMessage<V = unknown>` 타입 파라미터로 두어 S-3에서 교체.
- `protocol.test.ts` 18개: 정상/거부/정규화, 40개 시드 시뮬레이션에서 `legalActions`의 모든 Action이 통과하고 seat만 제거된 형태로 돌아오는지 확인, 시드와 무관한 variant 고정 테스트 6개(riichi discard, 적5 discard, ankan, shouminkan, daiminkan, kyuushu).
- `index.ts` re-export, `main.ts` SIGTERM 처리, `server.test.ts`에 포트 충돌 reject / 연결 중 close 테스트 2개 추가.

## 설계 판단
- seat: 메시지 최상위 seat는 허용 목록에 없어 조용히 제거. `action.seat`는 core `legalActions` 결과를 그대로 보내도 통과하도록 0~3 정수인지 형식만 검증하고 결과에서는 항상 제거 (`ClientAction` = Action에서 seat 제외). 서버가 소켓 좌석을 주입해 legalActions와 비교해야 한다.
- 정규화: 허용 목록 방식으로 새 객체를 만들어 추가 필드 제거. 적5 플래그는 rank 5에서만 허용.
- 한도: raw 문자열 2048자, id/token 64자, name 32자, seq는 안전 정수 이내. 이미 파싱된 객체 입력은 문자열 길이 한도 대상이 아님.

## 결과
- 루트 `npm test`: core 337, server 22, web 51 통과. `npm run build` 에러 없음.
- 커밋/add 하지 않음.
