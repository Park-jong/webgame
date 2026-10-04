# S-8 재접속(rejoin) (code-writer)

## 변경 파일 (packages/server/src)
- `room.ts`: `Room.rejoin(conn, token)`(전 좌석 끝까지 timing-safe 비교 -> 연결 교체, 이전 연결 반환), `RoomManager.rejoin(conn, roomId, token)`, `disconnect` 수정(전원 이탈 시 `game.pause()` + TTL 예약), 주석 갱신
- `game-session.ts`: `pause()`, `paused` 플래그, `onSeatReconnected`가 일시정지를 재개, `step`/`onSeatDisconnected`의 pause 가드, 문서 주석
- `session.ts`: `rejoin` 케이스 구현 (joined -> seatReconnected 훅 -> sendViewTo)
- `protocol.ts`: `joined` 주석(rejoin 시 기존 토큰), `not_supported`는 예약 코드로 표기
- `index.ts`: 주석만
- 테스트: `rejoin.test.ts` 신규 20개. 기존 수정: `room.test.ts`(rejoin 없는 방 -> unknown_room), `game-timeout.test.ts`(전원 이탈이 이제 일시정지이므로 "끊긴 좌석" 3개는 사람 2명 중 1명만 끊도록, TTL 타이머 수 2->1, "전원 끊김 완주"는 "4명 중 3명 끊김"), `game-ws.test.ts`(부하 시 5초 한도에 근접하던 "여러 시드" 테스트에 타임아웃 20초)

## 설계 판단
- **흐름**: `RoomManager.rejoin`이 슬롯(conn 교체, `connected=true`)만 복구 -> 세션이 `joined` 전송 -> `seatReconnected`(훅) -> `sendViewTo`. 훅이 `joined`보다 먼저 뷰를 보내는 일(즉시 스케줄러 등)이 없도록 순서를 고정. `connected=true`가 훅보다 먼저라 마감이 `normal` 종류로 걸린다(S-7 메모 반영).
- **이전 연결 처리**: 교체 시 `byConn`에서 이전 연결을 먼저 지우고 `terminate()`(죽은 소켓이 close 핸드셰이크로 매달리지 않게). 이후 이전 연결의 close는 `disconnect`에서 `byConn`에 없어 no-op이므로 새 연결의 `connected`/`conn`을 건드리지 못하고, 이전 세션의 뒤늦은 action은 `find` 실패로 `bad_message`.
- **토큰 재노출**: 회전/재발급 없음. `joined`는 형식 일관성을 위해 클라이언트가 방금 보낸 토큰을 그대로 되돌린다(서버가 저장소에서 꺼내 내보내지 않음, 새 노출 없음). 토큰 회전은 클라이언트 저장 흐름 변경이 필요해 하지 않음.
- **자동 모드**: 재접속하면 해제 + 연속 타임아웃 카운트 0(`onSeatReconnected`의 기존 의도 "재접속(S-8)은 자동 모드를 풀고", S-7 테스트와 동일). 근거: 자동 모드는 "사람이 안 보고 있다"는 추정이므로 돌아온 사람에게는 정상 마감을 준다. 끊김 마감은 원래 카운트하지 않는다.
- **seq**: `lastSeq`는 `GameSession`의 좌석별 상태라 재접속과 무관하게 유지 -> 옛 seq 재생은 `bad_seq`. 새 연결은 마지막 seq보다 큰 값을 보내야 하며(최대 +1000, 클라이언트가 마지막 seq를 잃었다면 큰 값으로 점프 가능), 이전 연결 메시지는 연결 동일성 확인(`find`)으로 아예 처리되지 않는다.
- **실패 처리**: 없는 방 `unknown_room`, 토큰 불일치 `bad_token`(타 방 토큰/좌석 없음/길이 다름 모두 동일 응답). 둘 다 세션의 기존 catch에서 `failures`에 합산되어 `maxIdentifyFailures` 초과 시 연결 종료(브루트포스 방어). 이미 참가한 연결의 rejoin은 `bad_message`(중복 identify 거부, 위반 점수 정책 그대로). rejoin 실패 시에는 참가 제한 시간 타이머를 해제하지 않고 성공 시에만 해제(실패 후 무한 유휴 방지; join은 기존대로). 방 존재 여부가 `unknown_room`/`bad_token`으로 구분되는 것은 요구사항과 기존 join 방식에 따른 것(실패 횟수 제한으로 열거 방어).
- **전원 이탈**: `disconnect`에서 사람 연결이 0이면 `GameSession.pause()`: 타이머 취소(+세대 증가로 낡은 콜백 무시), 마감 전체 폐기, `step`이 진행을 거부. 봇도 멈춘다. TTL(5분) 경과 시 기존대로 방 삭제 + 게임 close. 한 명이라도 남아 있으면 기존 `onSeatDisconnected`(끊김 마감) 경로. 재접속 시 `onSeatReconnected`가 pause를 풀고 마감을 모두 지운 뒤 `retime`: 응답 구간이면 구간 타이머를 처음부터, 사람 대기면 재접속 시점부터 정상 마감(뷰 `deadlineMs`는 전체 값). 정지 중에는 타이머/스케줄러 항목이 없다(실제 타이머 수 테스트: TTL 1개뿐, 재접속 시 0개 + 마감 1개, close 시 0).
- **응답 구간**: `sendViewTo`의 기존 정책 그대로(구간 중 응답 대상이 아니면 뷰 보류, 구간 종료 시 전원 뷰). 재접속 시 `joined`만 즉시 가고 뷰는 구간 종료 때 도착.
- **보안**: 뷰는 `viewFor` 재사용(+ `deadlineMs` 봉투). 테스트로 금지 키 목록(view.test와 동일) 부재 확인.

## 알려진 한계
- 방 존재 여부(`unknown_room` vs `bad_token`)가 구분됨(요구/기존 join과 동일, 실패 횟수 제한으로 완화). 방 ID 공간 32^8.
- 새 클라이언트가 마지막 seq를 모르면 큰 seq로 점프해야 하며(+1000 한도), 잃어버렸다면 클라이언트가 충분히 큰 값을 골라야 한다. 서버가 lastSeq를 알려주는 필드는 추가하지 않음.
- 이전 연결의 `terminate()`는 1008 close 코드로 나간다(교체 사유를 알리는 별도 코드/메시지 없음).
- 전원 이탈 후 TTL 안에 돌아오지 않으면 게임 상태는 사라진다(영속화 없음). 응답 구간 중 정지된 경우 구간 시간은 재개 시 처음부터 다시 잰다.
- 같은 토큰을 쥔 사람이 둘이면 마지막 rejoin이 좌석을 가져간다(토큰이 곧 권한).
- `game-ws.test.ts` "여러 시드" 테스트는 전체 병렬 실행 시 5초 한도에 근접해 한 번 실패한 적이 있어 타임아웃을 20초로 늘렸다(이번 변경과 무관한 기존 부하 민감성).

## 테스트 결과
- 루트 `npm test`: core 337 / server 164 / web 51 통과 (server는 기존 144 + rejoin 20). `packages/server` typecheck, `npm run build` 통과.
- `rejoin.test.ts` 20개: 정상 재접속(뷰 재전송/deadlineMs/이전 연결 종료/토큰 비노출, 끊긴 뒤 재접속 후 진행, 게임 시작 전, 중복 rejoin), 실패(없는 방/잘못된 토큰/길이 다름, 타 방 토큰, 실패 누적 종료, 참가 제한 시간 유지), 이전 연결 지연 close/뒤늦은 action, seq 유지(옛 seq 거부/더 큰 seq 허용), 끊김 중 자동 처리 후 재접속 뷰(금지 키 없음), 응답 구간 뷰 보류, 자동 모드 해제, 전원 이탈 정지/재개, 정지 중 시간 비소모, 타이머 누수, TTL 삭제/전 재접속 유지, 실제 ws 2개(끊김-재접속-행동, 토큰 브루트포스 종료).

## 피드백 반영

1. 마감 연장 악용 방지 ("리셋하지 않음" 방식 선택)
   - `Room.rejoin`이 돌려주던 `previous` 유무로 "연결이 유지된 채 교체"를 판별한다. `RoomManager.rejoin`은 `wasConnected`를 반환하고, session이 `seatReconnected(room, seat, wasConnected)`로 전달한다.
   - `GameSession.onSeatReconnected(seat, wasConnected = false)`: `wasConnected`이고 일시정지 상태가 아니면 마감/timeouts/auto를 건드리지 않고 반환한다(뷰 재전송은 기존대로 session이 sendViewTo). 끊겨 있다가(connected=false) 돌아온 경우와 전원 이탈 pause 재개는 기존대로 리셋/재계산한다.
   - 선택 근거: 상태 하나(boolean)로 끝나 구현이 단순하고, 별도 최소 간격 옵션/시계/신규 오류코드가 필요 없으며, 간격 제한 방식과 달리 느린 반복 rejoin으로도 연장이 불가능하다. 연결 유지 중 교체는 마감 단축 쪽 부작용도 없다(끊김 마감은 끊김 시점에 이미 적용됨).
   - 부수 변경: 자동 모드 좌석이 연결 유지 상태로 rejoin하면 자동 모드도 유지된다(정책상 의도). 기존 테스트 "자동 모드 좌석이 재접속하면..."은 먼저 onClose로 실제 끊김을 만든 뒤 rejoin하도록 수정했다.
   - 테스트(rejoin.test.ts "마감 연장 방지"): (a) 교체 rejoin 반복 시 deadlineMs가 800/600/400으로 줄고 타이머 due 불변, 원래 마감에 자동 쯔모기리 (b) 카운터/자동 모드 유지 (c) 실제 끊김 후 재접속은 deadlineMs=TURN으로 재시작.
2. byConn 누수 테스트: 테스트용 읽기 전용 getter `RoomManager.connectionCount` 추가. "교체 후 byConn에 이전 연결이 잔류하지 않는다" 테스트(교체 반복, 이전 연결 지연 close, 새 연결 close 후 개수 확인). `byConn.delete(previous)`를 임시 제거하자 이 테스트만 실패함을 확인하고 원복했다.
3. ERROR_CODES의 not_supported는 그대로 유지.

검증: 루트 npm test core 337 / server 168 / web 51 통과(exit 0), server typecheck 통과, npm run build 통과(exit 0).
