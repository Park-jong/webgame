# @mahjong/web

리치마작 브라우저 클라이언트 (React + Vite + TypeScript). 두 가지 모드가 있다.

- **로컬 모드**: 서버 없이 사람(좌석 0) 1명 + 봇 3명. 진행/판정은 `@mahjong/core`가 브라우저에서 수행하고 이 패키지는 UI와 컨트롤러(`src/controller.ts`)만 가진다.
- **온라인 모드**: `@mahjong/server`에 WebSocket으로 연결해 서버 권위로 진행(방 만들기·방 ID 입장·재접속). 실행법은 저장소 루트 [`README.md`](../../README.md) 참고. 서버 주소 기본값은 `ws://localhost:8080`이며 빌드/개발 서버 환경변수 `VITE_SERVER_URL`로 바꾼다.

## 실행

저장소 루트에서:

```bash
npm install                 # 의존성 설치 (워크스페이스 전체)
npm run dev -w @mahjong/web # 개발 서버 (http://localhost:5173)
npm run build               # core -> web 순으로 빌드 (web 결과물은 packages/web/dist)
npm test                    # core + server + web 테스트
npm run preview -w @mahjong/web  # 빌드 결과 미리보기
```

빌드의 vite `base`는 GitHub Pages용 `/webgame/`이고 dev/test는 `/`이다. `VITE_BASE`로 빌드 base를 바꾼다(루트 README "GitHub Pages 배포" 참고).

`@mahjong/core`는 `dist`가 아닌 `../core/src`를 vite alias / tsconfig paths로 직접 참조하므로
core를 먼저 빌드하지 않아도 dev/build/test가 동작한다.

`npm run e2e -w @mahjong/web`은 시스템 Edge/Chrome으로 온라인 모드 한 판을 끝까지 진행하는 브라우저 E2E다(기본 `npm test`에는 포함되지 않음). 자세한 내용은 루트 README의 "E2E" 절.

## 구조

- `src/controller.ts` — UI 무관 컨트롤러: 시드 RNG, `newSession`/`advance`/`stepAuto`/`applyAction`,
  `beginNextRound`, 결과 요약(`summarizeRound`), `finalRanking`
- `src/components/` — `TileView`, `Hand`, `ActionBar`, `SeatPanel`, `Board`, `ResultModal`
- `src/App.tsx` — 상태/봇 진행(지연 설정)/모달/시드 입력

## 조작

- 패를 클릭하면 타패. 리치는 "리치" 버튼 -> 텐파이가 유지되는 패 선택.
- 액션 버튼은 합법 행동만 활성화. 치/펑/깡에 선택지가 여러 개면 선택지별 버튼이 나온다.
- 상단에서 시드를 입력하고 "새 게임"을 누르면 같은 배패로 재현할 수 있다 (봇 행동도 같은 시드 RNG 사용).
- "봇 지연" 체크를 끄면 봇이 지연 없이 진행한다.
