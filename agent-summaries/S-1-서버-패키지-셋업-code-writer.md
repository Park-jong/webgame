# S-1 서버 패키지 셋업 (code-writer)

## 한 일
- `packages/server` 신규 (`@mahjong/server`, private, ESM). web 구성 방식을 따라 core는 vitest alias + tsconfig paths로 `../core/src/index.ts` 직접 참조.
- 파일: package.json, tsconfig.json, vitest.config.ts, src/index.ts(`createGameServer({port})` -> `{port, close()}`), src/main.ts(PORT 기본 8080), src/server.test.ts(스모크 2개).
- scripts: dev(tsx), build/typecheck(tsc --noEmit), test(vitest run).
- package-lock.json 갱신 (ws, tsx, @types/ws, @types/node 등).

## 결과
- 루트 `npm test`: core 337, server 2, web 51 통과. `npm run build` 에러 없음.

## 참고
- createGame은 `(rng, options)` 시그니처라 테스트에서 `createGame()`으로 호출.
- `createGameServer`는 listening 이후 resolve하는 Promise를 반환(포트 0 지원 위해 실제 포트 노출).
- 커밋/add 하지 않음.
