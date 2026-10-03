import { createGameServer } from "./index";

const port = Number(process.env.PORT ?? 8080);
const server = await createGameServer({ port });
console.log(`mahjong server listening on :${server.port}`);

for (const signal of ["SIGINT", "SIGTERM"] as const) {
  process.on(signal, () => {
    void server.close().then(() => process.exit(0));
  });
}
