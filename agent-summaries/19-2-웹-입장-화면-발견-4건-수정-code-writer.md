# 19-2 웹 입장 화면 발견 4건 수정 (code-writer)

## 변경
- useServerGame.ts: `joinTimeoutMs` 옵션과 `JOIN_TIMEOUT_MS`(12초), `JOIN_TIMEOUT_MESSAGE` 추가. requestJoin에서 타이머 시작. joined, error, closed, leave, 언마운트, join 전송 실패에서 해제. 만료 시 intent 비움, client.close(), "서버 응답이 없습니다. 다시 시도해 주세요" 오류, joining false. roomId는 null 유지, status는 idle(폼 복귀).
- entry.ts: idle+joining이면 `canLeave: joining`(취소 활성). ROOM_ID_HINT와 검증 오류에 밑줄(_) 추가. errorText는 코드가 있고 매핑이 없으면 "요청을 처리하지 못했습니다 (코드: <code>)", 코드 null이면 원문 유지.
- wsClient.ts(최소 연관 변경): `defaultTimers`를 export만 함. 훅이 timers 미주입 시 같은 기본 타이머를 쓰기 위함.
- 테스트: useServerGame.test.tsx에 12개 추가(joining 해제 경로 3, join 타임아웃 9), entry.test.tsx에 표 갱신 1행, 불변식(showConnecting이면 canLeave) 1개, 방 ID/오류 문구 2개 추가.

## 타임아웃 기본값 근거
서버 JOIN_TIMEOUT_MS는 10초(packages/server/src/session.ts:23, README 242행)이므로 클라이언트는 12초(+2초 여유)로 정했다. 서버가 먼저 닫을 기회를 주기 위해서다. 다만 README상 join은 시도 즉시 서버 타이머가 해제되므로, join 송신 뒤 침묵하는 서버는 서버 타이머로 닫히지 않는다. 이 경우를 막는 것이 클라이언트 타임아웃의 몫이다.

## 변이 확인 (모두 원복)
| 변이 | 결과 |
|---|---|
| closed 핸들러 joining:false 삭제 | 실패 2건 검출 |
| error 핸들러 joining:false 삭제 | 실패 1건 검출 |
| joined / error / closed / 언마운트의 타이머 해제 삭제 | 각 1건 검출 |
| 만료 시 client.close() 삭제 | 2건 검출 |
| idle canLeave:joining를 false로 | 2건 검출 |
| errorText 폴백 분기 제거, 힌트 밑줄 제거 | 각 1건 검출 |
| leave의 타이머 해제 삭제 | 생존 (등가 변이) |
| 만료 patch의 joining:false 삭제 | 생존 (등가 변이) |

생존 2건은 중복 방어 때문이다. leave의 client.close()가 closed 핸들러를 거쳐 타이머를 해제하고, 만료 시 client.close()가 closed 핸들러로 joining을 해제한다. 동작 차이가 없어 테스트로 구분할 수 없다.

## 검증
- web tsc: 오류 없음
- `npm test -w @mahjong/web`: 226개 통과 (기존 211 + 신규 15)
- `npm run build -w @mahjong/web`: 성공
- 커밋 안 함, server/core 미수정
