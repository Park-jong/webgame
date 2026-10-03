import { createGameServer } from "./index";

const port = Number(process.env.PORT ?? 8080);
const server = await createGameServer({ port });
console.log(`mahjong server listening on :${server.port}`);

process.on("SIGINT", () => {
  void server.close().then(() => process.exit(0));
});
