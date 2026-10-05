# 18-1 웹 GameController 서버 컨트롤러 검증 (code-verifier)

## 결론
치명/높은 심각도 문제 없음. 통과.

## 실행 결과
- tsc(web) 오류 0, `npm test -w @mahjong/web` 17파일 172개 통과, `npm run build` 성공
- server/core 소스 미변경 (git diff --stat 비어 있음)
- 통합 테스트(useServerGame.integration + wsClient.integration) 5회 반복 모두 통과 (각 약 3~5초)
- 실브라우저(headless Edge + puppeteer-core, 실서버 8080 + vite 5173): 콘솔 에러/경고/미처리 예외 0건
  - 로컬 모드: 한 국 진행 -> 론 결과 모달 -> 다음 국 정상
  - 서버 모드: 방 만들기 -> 시작 -> 사람1+봇3 진행, 새로고침 후 자동 rejoin 복원, 소켓 강제 close 후 "재접속 중" -> 3초 내 "진행 중" 복귀(보드 유지), 나가기 시 localStorage 비움, 새로고침해도 입장 전
  - 4개 브라우저 컨텍스트(사람 4명): mySeat 0~3 모두 위치 0=아래/1=오른쪽(하가)/2=위(대면)/3=왼쪽(상가), 자풍 배지, 현재 차례(*) 표시 일치. 5번째 입장은 "방이 가득 찼습니다"
  - 사람 4명 유국(황패평국) 결과: 모달 이름/표 순서가 좌석별로 올바름 (좌석 순서대로 나열)
  - 같은 localStorage 컨텍스트에서 두 탭 -> 먼저 연 탭은 displaced "연결 끊김"+사유 표시
  - 존재하지 않는 방 세션 복원 -> "존재하지 않는 방입니다", 저장 세션 삭제
- 토큰: localStorage에만 존재, DOM/URL/콘솔에 없음. view.furiten 직접 사용 없음(TenpaiInfo의 furiten은 계산된 TenpaiView 값). 서버 모드 컴포넌트는 SeatView(handCount만)만 사용.

## 변이 검증 (모두 원복, sha1 확인)
| 변이 | 결과 |
|---|---|
| deadlineAt 갱신 제거 | 검출 (useServerGame 전체 흐름) |
| 언마운트 client.close 제거 | 검출 (2개) |
| leave 시 store.clear 제거 | 검출 (단위+통합) |
| SeatPanel isHuman=seat===0 | 검출 (mySeat=2 회전 렌더) |
| act 중복 전송 가드 제거 | 검출 |

## 발견 사항 (낮음, 모두 개발용 최소 UI/W-7 범위)
1. (낮음) closed 상태(displaced, retries_exhausted 등)에서 roomId가 남아 "방 만들기/입장" 버튼이 보이지만 누르면 "이미 방에 입장해 있습니다" 오류. 나가기를 눌러야 함. W-7 입장 화면에서 정리 필요.
2. (낮음) closed 상태에서도 마지막 view의 패 버튼이 활성처럼 보임(클릭 시 "연결이 끊겨 행동을 보내지 못했습니다" 오류). 재접속 중에는 비활성(회색)으로 보임.
3. (낮음) view 이벤트가 오면 inFlight를 해제하므로, 내 action 전송 직후 무관한 view가 먼저 오면 같은 구간에 중복 클릭이 가능(서버가 거부할 것). 실사용에서 재현 못 함.
4. (정보) 서버 모드에서 "다음 국"은 모달 닫기만 수행(서버가 진행). GameEnd 순위 화면은 브라우저로 끝까지 가지 않고 코드 리뷰(seatName(r.seat, mySeat))만 확인.
5. (정보) 타패 방향(리치/멜드/버림패 회전 방향)은 기존 로컬 UI와 동일하게 패널별 고정이며 좌석별 회전 표현은 없음(요구에 없음).

## 스크린샷
C:\Users\park\.claude\jobs\1ef5b1fa\tmp\pp\shots\ : local-start.png, local-result.png, on1-entry/waiting/playing/reload/dropped/after.png, on4-p0~p3.png(좌석 회전), on4b-p0~p3.png(결과 모달), displaced-A.png
