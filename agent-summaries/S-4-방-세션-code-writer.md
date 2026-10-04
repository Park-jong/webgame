# S-4 방 세션 관리 (code-writer)

## 파일
- 신규 `packages/server/src/room.ts`: Connection 인터페이스, Room, RoomManager, RoomError, generateRoomId/generateSeatToken/tokenEquals, 상수
- 신규 `packages/server/src/session.ts`: 연결별 메시지 처리(위반 카운트, join/ping/rejoin/action 분기)
- 수정 `packages/server/src/index.ts`: ws 연동, maxPayload, re-export, 핸들에 `rooms` 노출, `room` 옵션
- 수정 `packages/server/src/protocol.ts`: 오류 코드 `not_supported` 추가
- 신규 `packages/server/src/room.test.ts`

## 설계 판단
- 방 ID: 6자, 32자 알파벳(혼동 문자 제외), 바이트&31로 편향 없음. 토큰: 24바이트 base64url 32자.
- 난수는 `randomBytes` 주입 가능, 기본 crypto. Math.random 미사용.
- 연결 끊김: 좌석은 human 유지, `connected:false`, conn 참조 제거. 봇 전환 없음(S-8).
- 위반 정책: 연속 위반 5회 초과 시 close, 유효 메시지 1건이면 카운트 초기화. 바이너리 프레임도 위반으로 집계.
- 최대 방 수 초과는 기존 코드 중 `room_full` 사용. 중복 join은 `bad_message`.
- 빈 방 삭제: 연결된 사람이 0이 되면 TTL(기본 5분) 타이머, unref + manager.close()에서 정리, 재참가 시 취소.
- S-5/S-8: `session.ts`의 `dispatch`에서 action/rejoin 분기만 채우면 됨. Room.broadcast, verifyToken 준비됨.

## 2차 보강 (검증 권장 반영)
- 방 ID 8자(40비트), 알파벳 `-` 제거하고 `_`로 교체(32자 유지, `& 31` 무편향).
- 세션 방어: 위반 점수(위반 +1, 유효 메시지 -1 감쇠), 식별 실패(unknown_room/bad_token) 누적 한도, 토큰 버킷(초당 20, 버스트 40), 참가 제한 시간(10초). 모두 `SessionOptions`로 주입 가능.
- 종료는 `Connection.terminate()` (close(1008) 후 500ms 뒤 terminate). 종료 후 도착 메시지는 무시.
- RoomManager closed 플래그(close 후 join 거부, 타이머 재예약 없음). id/토큰 재생성 루프 상한 100회.
- 좌석 토큰은 Room의 `#tokens` 비공개 필드로 분리, `Room.toJSON`은 토큰/연결 제외.
- 서버 keepalive(기본 30초 ping, pong 없으면 terminate, unref, close에서 정리).
- 테스트 73개(server). tokenEquals는 node:crypto mock으로 timingSafeEqual 호출/길이 불일치 시 미호출 확인(상수 시간 성질 자체는 검증 불가).
