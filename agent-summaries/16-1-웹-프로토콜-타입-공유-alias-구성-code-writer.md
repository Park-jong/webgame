# 16-1 웹 프로토콜 타입 공유 alias 구성 (W-1)

## 변경
- packages/web/vite.config.ts: alias `@mahjong/server-protocol`(server/src/protocol.ts), `@mahjong/server-view`(server/src/view.ts) 추가 (vite/vitest 공용)
- packages/web/tsconfig.json: 같은 이름의 paths 추가
- packages/web/src/model/seatView.ts (신규): 두 모듈 `export type *` + 값은 viewFor만 re-export, relativeSeat(seat, mySeat)
- packages/web/src/model/seatView.test.ts (신규): relativeSeat 2개, viewFor(createGame(),0) 스모크 1개

## 확인
- 서버 protocol.ts/view.ts의 import는 @mahjong/core와 서로(./view)뿐. ws/node 내장 없음. server index.ts 미참조.
- web tsc --listFiles: server 파일은 protocol.ts, view.ts 2개만 포함, ws 없음. @types/node는 포함되나 vitest(테스트 파일 import) 경유로 기존부터 있던 것이며 이번 변경 원인 아님.
- web 테스트 8파일 93개 통과, 빌드(tsc+vite) 성공, dist에 ws 관련 코드(WebSocketServer 등) grep 결과 없음.
- 참고: web에는 `typecheck` 스크립트가 없어 `npx tsc -p tsconfig.json`으로 검증.
- 서버/코어 소스 수정 없음, 커밋 없음.
