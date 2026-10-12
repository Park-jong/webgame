// README용 스크린샷 캡처 스크립트 (일회성 도구, 빌드·테스트와 무관)
//
//   node scripts/capture-screenshots.mjs
//
// 웹 vite 개발 서버를 빈 포트로 띄우고, puppeteer-core + 시스템 Edge/Chrome(E2E_BROWSER로 지정 가능)으로
// 로컬 모드 화면을 docs/screenshots/ 에 PNG로 저장한 뒤 서버·브라우저를 정리한다.
// 로컬 모드의 시드를 바꿔 가며 "텐파이를 거쳐 화료로 끝나는 판"을 찾고, 그 시드로 데스크톱·모바일을 다시 재현한다.
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const webDir = path.join(root, "packages", "web");
const outDir = path.join(root, "docs", "screenshots");
const require = createRequire(path.join(webDir, "package.json"));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const puppeteer = (await import(pathToFileURL(require.resolve("puppeteer-core")).href)).default;

function findBrowser() {
  const explicit = process.env.E2E_BROWSER?.trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) throw new Error(`E2E_BROWSER 경로가 없습니다: ${explicit}`);
    return explicit;
  }
  return [
    "C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Microsoft/Edge/Application/msedge.exe",
    "C:/Program Files/Google/Chrome/Application/chrome.exe",
    "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
    "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/usr/bin/microsoft-edge",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].find((p) => fs.existsSync(p));
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.once("error", reject);
    s.listen(0, () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function startVite(port) {
  const viteBin = path.join(path.dirname(require.resolve("vite/package.json")), "bin", "vite.js");
  const child = spawn(process.execPath, [viteBin, "--port", String(port), "--strictPort"], {
    cwd: webDir,
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  return new Promise((resolve, reject) => {
    const log = [];
    const timer = setTimeout(() => reject(new Error(`vite 준비 시간 초과\n${log.join("\n")}`)), 30_000);
    const onData = (b) => {
      const t = b.toString().replace(/[[0-9;]*m/g, "");
      log.push(t);
      if (/Local:\s+http/.test(t)) (clearTimeout(timer), resolve(child));
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (c) => reject(new Error(`vite가 종료됨 (code=${c})\n${log.join("\n")}`)));
  });
}

// 페이지 안에서 실행: 화면 버튼만으로 한 걸음 진행한다.
// 화료는 항상 하고, 부로는 하지 않으며, 버릴 패는 '버리면 텐파이' 힌트를 우선하고 없으면 연결이 약한 패를 고른다.
function playOnce() {
  if (document.querySelector("[role=dialog]")) return "dialog";
  const btns = [...document.querySelectorAll(".action-bar .action-btn")].filter((b) => !b.disabled);
  const by = (re) => btns.find((b) => re.test(b.textContent.trim()));
  const win = by(/^(츠모|론)/);
  if (win) return (win.click(), "win");
  const pass = by(/^패스/);
  if (pass) return (pass.click(), "pass");
  const tiles = [...document.querySelectorAll(".hand button:not([disabled])")];
  if (!tiles.length) return "idle";
  const labels = tiles.map((t) => t.getAttribute("aria-label"));
  const hint = document.querySelector("[data-testid=discard-hint] [role=img]");
  let idx = -1;
  if (hint) idx = labels.indexOf(hint.getAttribute("aria-label"));
  if (idx < 0 && document.querySelector(".badge-tenpai")) idx = tiles.length - 1; // 텐파이면 뽑은 패 그대로
  if (idx < 0) {
    const parse = (l) => {
      const m = /^(\d)(만|통|삭)/.exec(l);
      return m ? { r: Number(m[1]), s: m[2] } : null;
    };
    const score = labels.map((l, i) => {
      const me = parse(l);
      let v = 0;
      labels.forEach((o, j) => {
        if (i === j) return;
        if (o === l) v += 2;
        else if (me) {
          const p = parse(o);
          if (p && p.s === me.s) {
            const d = Math.abs(p.r - me.r);
            if (d === 1) v += 1.5;
            else if (d === 2) v += 1;
          }
        }
      });
      if (me && me.r >= 3 && me.r <= 7) v += 0.5;
      if (!me) v -= 0.2; // 연결 없는 자패는 우선 버린다
      return v + (i === tiles.length - 1 ? -0.05 : 0);
    });
    idx = score.indexOf(Math.min(...score));
  }
  tiles[idx].click();
  return "discard";
}

/** 시드로 로컬 대국을 시작한다. 반환: 페이지 */
async function openGame(browser, url, viewport, seed) {
  const ctx = await browser.createBrowserContext();
  const page = await ctx.newPage();
  await page.setViewport(viewport);
  await page.goto(url, { waitUntil: "networkidle0" });
  await clickByText(page, "혼자 연습");
  await page.waitForSelector(".board");
  // 봇 지연 끄기, 시드 입력 후 새 게임
  await page.evaluate(() => {
    const cb = document.querySelector(".delay-toggle input");
    if (cb && cb.checked) cb.click();
  });
  const input = await page.$("input[aria-label='시드']");
  await input.click({ clickCount: 3 });
  await input.type(String(seed));
  await clickByText(page, "새 게임");
  await page.waitForSelector(".hand button");
  return { page, ctx };
}

function clickByText(page, text) {
  return page.evaluate((t) => {
    const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(t) && !x.disabled);
    if (!b) throw new Error(`버튼 없음: ${t}`);
    b.click();
  }, text);
}

/**
 * 한 판을 진행하며 장면을 수집한다.
 * board: 버림 6번째, tenpai: 텐파이 배지가 처음 보인 때(버림 3번 이후), result: 결과 모달
 */
async function playScenes(page, { fullPage }) {
  const scenes = {};
  let discards = 0;
  const snap = async () => Buffer.from(await page.screenshot({ fullPage }));
  for (let i = 0; i < 400; i++) {
    const r = await page.evaluate(playOnce);
    if (r === "discard") discards++;
    if (r === "dialog") {
      await sleep(250);
      const hasWin = await page.evaluate(() => document.querySelector(".win-block") !== null);
      scenes.resultIsWin = hasWin;
      scenes.result = await snap();
      return scenes;
    }
    if (r === "idle") {
      await sleep(40);
      continue;
    }
    await sleep(25);
    if (!scenes.board && discards >= 6) scenes.board = await snap();
    if (!scenes.tenpai && discards >= 3 && (await page.$(".badge-tenpai"))) scenes.tenpai = await snap();
  }
  return scenes;
}

const browserPath = findBrowser();
if (!browserPath) throw new Error("Edge/Chrome 실행 파일을 찾지 못했습니다 (E2E_BROWSER 지정)");
fs.mkdirSync(outDir, { recursive: true });

let vite;
let browser;
try {
  const port = await freePort();
  vite = await startVite(port);
  console.log(`vite pid=${vite.pid} port=${port}`);
  const url = `http://localhost:${port}/`;
  browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox"] });
  const save = (name, buf) => {
    fs.writeFileSync(path.join(outDir, name), buf);
    console.log(`저장: docs/screenshots/${name} (${(buf.length / 1024).toFixed(0)}KB)`);
  };

  // 1. 모드 선택 화면
  {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport({ width: 1280, height: 640 });
    await page.goto(url, { waitUntil: "networkidle0" });
    await page.waitForSelector("[aria-label='모드 선택']");
    save("mode-select.png", await page.screenshot());
    await ctx.close();
  }

  // 2. 데스크톱: 텐파이와 화료 결과가 나오는 시드를 찾는다
  let found = null;
  for (let seed = 1; seed <= 60 && !found; seed++) {
    const { page, ctx } = await openGame(browser, url, { width: 1280, height: 900 }, seed);
    const scenes = await playScenes(page, { fullPage: false });
    await ctx.close();
    console.log(`seed ${seed}: board=${!!scenes.board} tenpai=${!!scenes.tenpai} result=${!!scenes.result} win=${scenes.resultIsWin}`);
    if (scenes.board && scenes.tenpai && scenes.result && scenes.resultIsWin) found = { seed, scenes };
  }
  if (!found) throw new Error("조건에 맞는 시드를 찾지 못했습니다");
  console.log(`선택한 시드: ${found.seed}`);
  save("local-board-desktop.png", found.scenes.board);
  save("local-tenpai-desktop.png", found.scenes.tenpai);
  save("result-modal-desktop.png", found.scenes.result);

  // 3. 모바일 390px: 같은 시드를 다시 진행해 대국 화면을 저장한다
  {
    const { page, ctx } = await openGame(browser, url, { width: 390, height: 844 }, found.seed);
    const scenes = await playScenes(page, { fullPage: false });
    await ctx.close();
    if (!scenes.board) throw new Error("모바일 대국 화면을 얻지 못했습니다");
    save("local-board-mobile.png", scenes.tenpai ?? scenes.board);
  }
} finally {
  if (browser) await browser.close().catch(() => {});
  if (vite && vite.exitCode === null) {
    vite.kill("SIGTERM");
    await sleep(1500);
    if (vite.exitCode === null) vite.kill("SIGKILL");
  }
}
