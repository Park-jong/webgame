// E2E 전용 서버: 한 판이 짧게 끝나도록 점수·마감·지연을 줄인 설정으로 createGameServer를 실행한다.
// 실행기(run.mjs)가 `node --import tsx e2e/test-server.mts`로 띄우며, 준비되면 `E2E_SERVER_READY <port>`를 출력한다.
// 환경변수: E2E_PORT(기본 0 = 임의 포트), E2E_STARTING_SCORE(기본 9000)
import { createGameServer } from "../../server/src/index";

const port = Number(process.env.E2E_PORT ?? 0);
const startingScore = Number(process.env.E2E_STARTING_SCORE ?? 9000);

const server = await createGameServer({
  port,
  room: {
    game: {
      gameOptions: { startingScore },
      botDelayMs: 40,
      responseWindowMs: 250,
      autoDelayMs: 100,
      turnTimeoutMs: 12_000,
      responseTimeoutMs: 8_000,
      disconnectedTimeoutMs: 2_000,
      // nextRoundDelayMs는 일부러 기본값(5000)을 쓴다: 웹의 '다음 국 약 N초' 추정이 이 값을 가정한다
    },
  },
});
console.log(`E2E_SERVER_READY ${server.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
