# 19-1 웹 입장 화면 구현 (W-7, code-writer)

## 변경 파일
- `packages/web/src/App.tsx`: 모드 선택(select/local/online), 서버 모드를 입장 폼 -> 대기실 -> 대국으로 재구성. MinimalEntry 삭제.
  - 시작 모드 결정: `online` prop 지정 시 그대로, 없으면 `?online=1` -> 온라인, `initialSeed`/`initialSession` 지정 -> 로컬(기존 테스트 호환), 그 외 -> 모드 선택 화면. 선택 화면에서 시작한 경우에만 '처음으로' 버튼.
  - 입력(이름·서버 주소·방 ID)은 훅 위(ServerApp)에 두어 오류·세션 교체 후에도 유지.
  - 서버 주소를 바꿔 제출하면 `key`로 세션(훅)을 새로 만들고, 마운트 직후 입장 요청을 보낸다(이때 저장 세션 복원은 끔).
  - GameScreen: 서버 모드 게임 종료는 '나가기 (입장 화면으로)' + "온라인 대전에는 새 게임이 없습니다" 문구.
- `packages/web/src/components/OnlineEntry.tsx` (신규): EntryForm, Lobby, ModeSelect.
- `packages/web/src/game/entry.ts` (신규): validateName/validateServerUrl/normalizeRoomId/validateRoomId, seatLabel, `entryPlan`(상태별 버튼 규칙), errorText(오류 코드 -> 한글).
- `packages/web/src/game/prefs.ts` (신규): 이름·서버 주소 저장소(localStorage, 접근 실패 무시) + 메모리 구현.
- `packages/web/src/game/useServerGame.ts`, `types.ts`: 컨트롤러에 `joining` 추가(입장 요청~joined 사이). create/join 이중 전송 방지용. 기존 동작은 변경 없음.
- `packages/web/src/components/ResultModal.tsx`: GameEndScreen에 `actionLabel`, `note` 선택 prop(기본값은 기존 '새 게임').
- `packages/web/src/styles.css`: 모드 선택·입장·대기실 스타일, 포커스 링, 모바일 보정.
- `packages/web/src/game/entry.test.tsx` (신규, 34개).

## 상태 x 버튼 표 (컨트롤러의 status/roomId/joining만 사용)
| status (roomId) | 화면 | 방 만들기/입장 | 시작 | 나가기·취소 |
|---|---|---|---|---|
| idle (null) | 입장 폼 | 활성 | 없음 | 없음 |
| idle, joining | 입장 폼 + 연결 중 안내 | 비활성 | 없음 | 없음 |
| connecting (null, 자동 resume 포함) | 입장 폼(비활성) + '이어서 접속 중…'/'서버에 연결 중…' | 비활성 | 없음 | 활성 (취소(나가기)/취소) |
| waiting | 대기실 | 없음 | 활성 | 활성 |
| playing / ended | 대국(+결과/종료 화면) | 없음 | 없음 | 활성 (헤더, 종료 화면은 '나가기 (입장 화면으로)') |
| reconnecting (방 있음) | 대국/안내 + '다시 접속하는 중' | 없음 | 없음 | 활성 (헤더) |
| reconnecting (null) | resume 중과 동일 | 비활성 | 없음 | 활성 (취소) |
| closed (null) | 입장 폼 + 오류 | 활성 | 없음 | 없음 |
| closed (방 있음) | '연결이 끊겼습니다. 나가기를 눌러 주세요' | 없음 | 없음 | 활성 |

참고: 컨트롤러에 "connected(미입장)" 상태가 따로 없어 idle(+joining)로 표현된다.

## 검증
- web tsc 통과, `npm test -w @mahjong/web` 211개 통과(기존 177 수정 없이 + 신규 34), web build 성공.
- 변이 확인(원복 완료): connecting 중 활성화 -> 4개 실패, 방 ID 정규화 제거 -> 3개 실패, leave 시 세션 삭제 제거 -> 3개 실패.

## 서버 한계로 못 한 것
- 대기실 착석 현황(몇 명 앉았는지, 이름): 서버가 시작 전 view/현황을 보내지 않고 이름은 뷰에 나가지 않는다. UI 문구로 "확인할 수 없습니다"를 명시.
- 시작 권한자 구분 없음: 누구나 시작 가능, 시작 후 무응답 표시 없음.
- 서버 오류 문구는 코드별 한글 매핑이 없는 경우 서버 원문을 그대로 보임.

## 한계·후속 제안
- 브라우저(headless Edge)에서 실제로 열어 보는 확인과 GameEnd 순위 화면의 실제 화면 확인은 하지 않았다(테스트는 phase를 gameEnd로 바꾼 view로 대체). 18-1 B 항목 "GameEnd 브라우저 확인"은 아직 남음.
- 방 ID 형식 검증은 느슨함(영문 대문자·숫자·_, 최대 64). 서버 생성 형식은 8자.
- 이름·서버 주소 Enter 제출은 '방 만들기'로 동작(방 ID 입력칸 Enter는 입장).
- notice 자동 소멸, closed 재접속 재시도 UI, rejoinTimeout 실서버 검증은 W-12 그대로.
- 후속: 방 ID 공유 링크(`?room=`), 시작 버튼 연타 방지 표시, 서버 주소 접근성 문구 다듬기.
