// 서버(기본 8080)와 웹(vite)을 한 명령으로 실행한다. 새 의존성 없이 node만 쓴다.
//   npm run dev:all
// 환경변수: PORT(서버 포트, 기본 8080), VITE_SERVER_URL(웹이 기본으로 쓰는 서버 주소, 기본 ws://localhost:$PORT)
// 셸을 거치지 않고 node로 tsx/vite 진입점을 직접 실행하므로 자식이 한 프로세스씩이라
// Windows(cmd/PowerShell)와 bash에서 똑같이 동작하고, Ctrl+C나 한쪽 종료 시 둘 다 정리된다.
import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import net from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const require = createRequire(import.meta.url);
const webDir = path.join(root, "packages/web");
// vite는 bin/vite.js를 exports로 공개하지 않으므로 package.json 위치에서 경로를 만든다
const viteBin = path.join(path.dirname(require.resolve("vite/package.json", { paths: [webDir] })), "bin", "vite.js");
// PORT가 비었거나 공백뿐이면 기본 8080으로 본다(Number("")=0이 되어 서버·웹 주소가 어긋나는 것을 막는다)
const rawPort = process.env.PORT?.trim();
const port = rawPort ? Number(rawPort) : 8080;

/** 포트가 비어 있으면 true. 서버가 바인딩하는 주소(전체 인터페이스)로 확인한다 */
function portFree(p) {
  return new Promise((resolve) => {
    const s = net.createServer();
    s.once("error", () => resolve(false));
    s.once("listening", () => s.close(() => resolve(true)));
    s.listen(p);
  });
}

if (!Number.isInteger(port) || port < 0 || port > 65535) {
  console.error(`[dev:all] PORT 값이 올바르지 않습니다: ${rawPort}`);
  process.exit(1);
}
if (port !== 0 && !(await portFree(port))) {
  console.error(
    `[dev:all] 포트 ${port}을 이미 사용 중입니다. 다른 포트로 실행하세요.\n` +
      `  bash:        PORT=9090 npm run dev:all\n` +
      `  PowerShell:  $env:PORT=9090; npm run dev:all   (끝나면 Remove-Item Env:PORT)\n` +
      `  cmd:         set PORT=9090 && npm run dev:all\n` +
      `웹의 기본 서버 주소는 ws://localhost:$PORT로 자동 맞춰집니다. 직접 정하려면 VITE_SERVER_URL을 지정하세요.`,
  );
  process.exit(1);
}

const serverUrl = process.env.VITE_SERVER_URL ?? `ws://localhost:${port}`;
const children = [];
let stopping = false;
let exitCode = 0;

function run(name, cwd, args, env) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const tag = `[${name}] `;
  for (const [stream, out] of [
    [child.stdout, process.stdout],
    [child.stderr, process.stderr],
  ]) {
    let rest = "";
    stream.on("data", (buf) => {
      const lines = (rest + buf.toString()).split(/\r?\n/);
      rest = lines.pop() ?? "";
      for (const l of lines) out.write(`${tag}${l}\n`);
    });
    stream.on("end", () => {
      if (rest) out.write(`${tag}${rest}\n`);
    });
  }
  child.on("exit", (code, signal) => {
    if (!stopping) {
      console.error(`[dev:all] ${name}이(가) 종료되었습니다 (code=${code ?? signal}). 나머지도 종료합니다.`);
      exitCode = code ?? 1;
      stop();
    }
  });
  child.on("error", (e) => {
    console.error(`[dev:all] ${name} 실행 실패: ${e.message}`);
    exitCode = 1;
    stop();
  });
  children.push(child);
}

function stop() {
  if (stopping) return;
  stopping = true;
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGTERM");
  const force = setTimeout(() => {
    for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
  }, 3000);
  Promise.all(children.map((c) => new Promise((r) => (c.exitCode !== null || c.signalCode !== null ? r() : c.once("exit", r))))).then(
    () => {
      clearTimeout(force);
      process.exit(exitCode);
    },
  );
}

for (const sig of ["SIGINT", "SIGTERM", "SIGBREAK"]) process.on(sig, () => stop());

process.on("exit", () => {
  for (const c of children) if (c.exitCode === null && c.signalCode === null) c.kill("SIGKILL");
});

console.log(`[dev:all] 서버 :${port}, 웹 기본 서버 주소 ${serverUrl} (종료: Ctrl+C)`);
run("server", path.join(root, "packages/server"), ["--import", "tsx", "src/main.ts"], { PORT: String(port) });
run("web", webDir, [viteBin], { VITE_SERVER_URL: serverUrl });
