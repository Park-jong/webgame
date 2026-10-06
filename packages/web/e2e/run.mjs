// 브라우저 E2E: 사람 2명(브라우저 컨텍스트 2개) + 봇 2명이 서버 모드로 한 판을 끝까지 진행한다.
//
//   npm run e2e -w @mahjong/web                      # 1회
//   npm run e2e -w @mahjong/web -- --repeat 5        # 5회 반복(매 회 서버·vite·브라우저를 새로 띄우고 정리)
//   npm run e2e -w @mahjong/web -- --shots           # 주요 단계 스크린샷도 저장(기본은 실패 시에만)
//
// 환경변수: E2E_BROWSER(Chromium 계열 실행 파일 경로. 지정했는데 없으면 실패(종료 1), 미지정이면 시스템 Edge/Chrome 탐색), E2E_STARTING_SCORE(기본 9000)
// 기본 `npm test`에는 포함되지 않는다. puppeteer-core 또는 브라우저가 없으면 이유를 출력하고 건너뛴다(종료 코드 0).
// 서버·vite는 임의의 빈 포트로 띄우므로 개발 서버(8080/5173)와 충돌하지 않는다.
// 스크린샷은 packages/web/e2e/artifacts/ 에 저장된다(저장소에는 올리지 않음).
import { spawn } from "node:child_process";
import fs from "node:fs";
import net from "node:net";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const webDir = path.resolve(here, "..");
const ARTIFACTS = path.join(here, "artifacts");
const require = createRequire(import.meta.url);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const argv = process.argv.slice(2);
const repeat = argv.includes("--repeat") ? Math.max(1, Number(argv[argv.indexOf("--repeat") + 1]) || 1) : 1;
const saveShots = argv.includes("--shots");

// ---------------------------------------------------------------------------
// 사전 조건: puppeteer-core, 브라우저
// ---------------------------------------------------------------------------
function skip(msg) {
  console.log(`[e2e] 건너뜀: ${msg}`);
  process.exit(0);
}

let puppeteer;
try {
  puppeteer = (await import("puppeteer-core")).default;
} catch {
  skip("puppeteer-core를 불러올 수 없습니다 (저장소 루트에서 `npm install` 실행)");
}

function findBrowser() {
  // 사용자가 E2E_BROWSER를 명시했으면 그 경로만 쓴다. 없으면 다른 브라우저로 대체하지 않고 실패한다
  const explicit = process.env.E2E_BROWSER?.trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      console.error(`[e2e] 실패: E2E_BROWSER 경로가 존재하지 않습니다: ${explicit}`);
      process.exit(1);
    }
    return explicit;
  }
  const cands = [
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
  ];
  return cands.find((p) => p && fs.existsSync(p));
}
const browserPath = findBrowser();
if (!browserPath) skip("Edge/Chrome 실행 파일을 찾지 못했습니다 (E2E_BROWSER에 경로를 지정하세요)");

// ---------------------------------------------------------------------------
// 프로세스 관리
// ---------------------------------------------------------------------------
const procs = new Set();

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

function portOpen(port) {
  const probe = (host) =>
    new Promise((resolve) => {
      const s = net.connect({ port, host });
      s.once("connect", () => (s.destroy(), resolve(true)));
      s.once("error", () => resolve(false));
    });
  return Promise.all([probe("127.0.0.1"), probe("::1")]).then((r) => r.some(Boolean));
}

/** node 스크립트를 셸 없이 실행하고 readyRe가 출력에 나올 때까지 기다린다 */
function startProc(name, args, { cwd, env = {}, readyRe, timeoutMs = 30_000 }) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    windowsHide: true,
  });
  const entry = { name, child, log: [] };
  procs.add(entry);
  return new Promise((resolve, reject) => {
    let done = false;
    const onData = (buf) => {
      const text = buf.toString().replace(/[[0-9;]*m/g, "");
      for (const line of text.split(/\r?\n/)) if (line) entry.log.push(line);
      if (entry.log.length > 200) entry.log.splice(0, entry.log.length - 200);
      const m = !done && readyRe.exec(text);
      if (m) {
        done = true;
        clearTimeout(timer);
        entry.match = m;
        resolve(entry);
      }
    };
    child.stdout.on("data", onData);
    child.stderr.on("data", onData);
    child.on("exit", (code) => {
      if (!done) {
        done = true;
        clearTimeout(timer);
        reject(new Error(`${name}이(가) 준비 전에 종료됨 (code=${code})\n${entry.log.join("\n")}`));
      }
    });
    const timer = setTimeout(() => {
      if (!done) {
        done = true;
        reject(new Error(`${name} 준비 시간 초과\n${entry.log.join("\n")}`));
      }
    }, timeoutMs);
  });
}

async function stopProc(entry) {
  const { child } = entry;
  if (child.exitCode === null && child.signalCode === null) {
    const exited = new Promise((r) => child.once("exit", r));
    child.kill("SIGTERM");
    const ok = await Promise.race([exited.then(() => true), sleep(4000).then(() => false)]);
    if (!ok) {
      child.kill("SIGKILL");
      await Promise.race([exited, sleep(2000)]);
    }
  }
  procs.delete(entry);
}

process.on("exit", () => {
  for (const e of procs) if (e.child.exitCode === null) e.child.kill("SIGKILL");
});
for (const sig of ["SIGINT", "SIGTERM"]) {
  process.on(sig, () => {
    for (const e of procs) if (e.child.exitCode === null) e.child.kill("SIGKILL");
    process.exit(130);
  });
}

// ---------------------------------------------------------------------------
// 브라우저 쪽 보조
// ---------------------------------------------------------------------------
/** 페이지가 만드는 WebSocket을 기록하고, 차단 중에는 열리지 않는 가짜 소켓을 돌려준다(네트워크 오류 로그 없이 '연결 안 됨'을 재현) */
function installWsHooks() {
  window.__ws = [];
  window.__stubs = [];
  window.__wsBlock = false;
  const Orig = window.WebSocket;
  function Hooked(url, protocols) {
    if (window.__wsBlock) {
      const stub = {
        readyState: 0,
        onopen: null,
        onmessage: null,
        onclose: null,
        onerror: null,
        send() {
          throw new Error("stub socket");
        },
        close() {
          this.readyState = 3;
        },
        fail() {
          const h = this.onclose;
          this.readyState = 3;
          if (h) h({ code: 1006, reason: "" });
        },
      };
      window.__stubs.push(stub);
      return stub;
    }
    const ws = new Orig(url, protocols);
    window.__ws.push(ws);
    return ws;
  }
  Hooked.prototype = Orig.prototype;
  Object.assign(Hooked, { CONNECTING: 0, OPEN: 1, CLOSING: 2, CLOSED: 3 });
  window.WebSocket = Hooked;
}

/** 화면의 버튼만으로 한 걸음 진행한다. policy: { win, calls } */
function playOnce(policy) {
  if (document.querySelector("[role=dialog]")) return "dialog";
  const btns = [...document.querySelectorAll(".action-bar .action-btn")].filter((b) => !b.disabled);
  const by = (re) => btns.find((b) => re.test(b.textContent.trim()));
  if (policy.win) {
    const b = by(/^(츠모|론)/);
    if (b) return b.click(), "win";
  }
  if (policy.calls) {
    const b = by(/^(펑|치|대명깡|안깡|가깡)/);
    if (b) return b.click(), "call";
  }
  const pass = by(/^패스/);
  if (pass) return pass.click(), "pass";
  const tiles = [...document.querySelectorAll(".hand button:not([disabled])")];
  if (tiles.length) return tiles[tiles.length - 1].click(), "discard";
  return "idle";
}

class RetryRound extends Error {}

class Player {
  constructor(name, page) {
    this.name = name;
    this.page = page;
    this.errors = [];
    this.acts = { win: 0, call: 0, pass: 0, discard: 0 };
    page.on("console", (m) => {
      if (m.type() !== "error") return;
      const u = m.location()?.url ?? "";
      if (/favicon\.ico$/.test(u)) return; // vite 개발 서버에 favicon이 없다
      this.errors.push(`console.error: ${m.text()}`);
    });
    page.on("pageerror", (e) => this.errors.push(`pageerror: ${e.message}`));
  }
  get actCount() {
    return Object.values(this.acts).reduce((a, b) => a + b, 0);
  }
  async tick(policy) {
    const r = await this.page.evaluate(playOnce, policy);
    if (r in this.acts) this.acts[r]++;
    return r;
  }
  text(sel) {
    return this.page.$eval(sel, (e) => e.innerText).catch(() => null);
  }
  has(sel) {
    return this.page.$(sel).then((e) => e !== null);
  }
  click(label) {
    return this.page.evaluate((t) => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(t) && !x.disabled);
      if (!b) return false;
      b.click();
      return true;
    }, label);
  }
  banner() {
    return this.text("[data-testid=connection-banner]");
  }
  status() {
    return this.text("[data-testid=server-status]");
  }
  dialog() {
    return this.page.evaluate(() => {
      const d = document.querySelector("[role=dialog]");
      if (!d) return null;
      return {
        label: d.getAttribute("aria-label"),
        footer: [...d.querySelectorAll(".modal-footer button")].map((b) => b.textContent.trim()),
        auto: d.querySelector("[data-testid=auto-next]")?.innerText ?? null,
      };
    });
  }
}

async function waitFor(fn, { timeoutMs = 10_000, every = 80, label }) {
  const t0 = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t0 > timeoutMs) throw new Error(`시간 초과: ${label}`);
    await sleep(every);
  }
}

function assert(cond, msg) {
  if (!cond) throw new Error(`단언 실패: ${msg}`);
}

/** 결과 모달 제목·푸터 버튼·배너 나가기 버튼이 가려지지 않고 눌릴 수 있는지(elementFromPoint) */
function reachability() {
  const hit = (el) => {
    if (!el) return null;
    const r = el.getBoundingClientRect();
    const x = Math.min(Math.max(r.left + r.width / 2, 0), innerWidth - 1);
    const y = Math.min(Math.max(r.top + r.height / 2, 0), innerHeight - 1);
    const top = document.elementFromPoint(x, y);
    return top === el || el.contains(top);
  };
  const d = document.querySelector("[role=dialog]");
  const box = (el) => (el ? el.getBoundingClientRect().toJSON() : null);
  const title = d?.querySelector("h2");
  const foot = d?.querySelector(".modal-footer button");
  const bl = document.querySelector("[data-testid=banner-leave]");
  return {
    vw: innerWidth,
    vh: innerHeight,
    title: hit(title),
    footer: hit(foot),
    bannerLeave: hit(bl),
    titleBox: box(title),
    bannerBox: box(document.querySelector("[data-testid=connection-banner]")),
  };
}

// ---------------------------------------------------------------------------
// 시나리오
// ---------------------------------------------------------------------------
async function scenario({ browser, webUrl, serverUrl, tag, log, shot }) {
  const mk = async (name, vp) => {
    const ctx = await browser.createBrowserContext();
    const page = await ctx.newPage();
    await page.setViewport(vp);
    await page.evaluateOnNewDocument(installWsHooks);
    return { ctx, player: new Player(name, page) };
  };
  // A는 모바일 폭, B는 데스크톱 폭
  const a = await mk("A", { width: 390, height: 844 });
  const b = await mk("B", { width: 1280, height: 900 });
  const A = a.player;
  const B = b.player;
  const players = [A, B];
  const ctxs = [a.ctx, b.ctx];
  scenario.players = players;
  try {
    // 1. 모드 선택 -> 온라인
    log("1 모드 선택 -> 온라인");
    for (const p of players) await p.page.goto(webUrl, { waitUntil: "networkidle0" });
    for (const p of players) assert(await p.has("[aria-label='모드 선택']"), `${p.name} 모드 선택 화면`);
    for (const p of players) assert(await p.click("온라인"), `${p.name} 온라인 버튼`);
    for (const p of players) await waitFor(() => p.has("[aria-label='온라인 입장']"), { label: `${p.name} 입장 화면` });

    // 2. 이름 입력 + 방 만들기(A)
    log("2 이름 입력, 방 만들기");
    const setField = async (p, label, value) => {
      const input = await p.page.evaluateHandle((l) => {
        const f = [...document.querySelectorAll("label.field")].find((x) => x.querySelector("span")?.textContent === l);
        return f?.querySelector("input") ?? null;
      }, label);
      const el = input.asElement();
      assert(el, `${p.name} '${label}' 입력칸`);
      await el.click({ clickCount: 3 });
      await el.press("Backspace");
      await el.type(value);
    };
    await setField(A, "이름", "에이");
    await setField(B, "이름", "비");
    for (const p of players) {
      const url = await p.page.evaluate(() => {
        const f = [...document.querySelectorAll("label.field")].find((x) => x.querySelector("span")?.textContent === "서버 주소");
        return f?.querySelector("input")?.value ?? null;
      });
      assert(url === serverUrl, `${p.name} 서버 주소 기본값이 ${serverUrl} (실제 ${url})`);
    }
    assert(await A.click("방 만들기"), "방 만들기 버튼");
    await waitFor(() => A.has("[aria-label='대기실']"), { label: "A 대기실" });
    const roomId = (await A.text("[data-testid=room-id]"))?.trim();
    assert(/^[A-Z0-9_]{8}$/.test(roomId ?? ""), `방 ID 형식(8자): ${roomId}`);
    const seatA = (await A.text("[data-testid=my-seat]"))?.trim();
    await shot(A, "02-lobby-A");

    // 3. B가 방 ID로 입장
    log("3 B 방 ID 입장");
    await setField(B, "방 ID", roomId);
    assert(await B.click("입장"), "입장 버튼");
    await waitFor(() => B.has("[aria-label='대기실']"), { label: "B 대기실" });
    assert((await B.text("[data-testid=room-id]"))?.trim() === roomId, "B 대기실 방 ID가 같음");
    const seatB = (await B.text("[data-testid=my-seat]"))?.trim();
    assert(seatA && seatB && seatA !== seatB, `좌석이 서로 다름 (A ${seatA}, B ${seatB})`);

    // 4. 시작
    log("4 시작");
    assert(await A.click("시작"), "시작 버튼");
    for (const p of players) {
      await waitFor(() => p.has(".board"), { label: `${p.name} 대국 화면` });
      await waitFor(async () => /진행 중/.test((await p.status()) ?? ""), { label: `${p.name} 상태 진행 중` });
    }
    await shot(B, "04-board-B");

    // 5. 합법 행동으로 진행(UI 클릭만 사용). 1국이 끝날 때까지 사람은 화료하지 않는다(1국에서 게임이 끝나지 않게)
    log("5 진행 + B 소켓 강제 종료/자동 재접속");
    const policyFor = (p) => ({ win: scenario.allowWin, calls: p === B });
    scenario.allowWin = false;
    const pump = async (until, { timeoutMs, label }) => {
      const t0 = Date.now();
      for (;;) {
        const v = await until();
        if (v) return v;
        if (Date.now() - t0 > timeoutMs) throw new Error(`시간 초과: ${label}`);
        const rs = await Promise.all(players.map((p) => p.tick(policyFor(p))));
        await sleep(rs.some((r) => r !== "idle" && r !== "dialog") ? 90 : 160);
      }
    };
    await pump(async () => B.actCount >= 4 && A.actCount >= 3, { timeoutMs: 90_000, label: "초반 행동" });
    const stored = () => B.page.evaluate(() => localStorage.getItem("mahjong.session.v1"));
    const before = await stored();
    assert(before !== null, "B 세션이 저장돼 있음");
    const actsBefore = B.actCount;
    await B.page.evaluate(() => window.__ws.at(-1).close());
    const bannerText = await waitFor(() => B.banner(), { timeoutMs: 4000, every: 25, label: "B 재접속 배너 표시" });
    assert(/재접속|연결/.test(bannerText), `B 배너 문구: ${bannerText}`);
    await shot(B, "05-reconnect-banner-B");
    await waitFor(
      async () => (await B.banner()) === null && /진행 중/.test((await B.status()) ?? ""),
      { timeoutMs: 20_000, label: "B 자동 재접속 완료(배너 소멸, 진행 중)" },
    );
    assert((await stored()) === before, "재접속 후 B 저장 세션(방·좌석 토큰)이 그대로");
    await pump(async () => B.actCount >= actsBefore + 3, { timeoutMs: 90_000, label: "재접속 후 B가 다시 행동" });

    // 6. 1국 결과: B는 카운트다운과 자동 닫힘, A는 재접속 배너와 모달 겹침 확인
    log("6 결과 모달(카운트다운·자동 닫힘) + 재접속 배너 겹침");
    await pump(async () => (await A.dialog()) || (await B.dialog()), { timeoutMs: 180_000, label: "1국 결과 모달" });
    const first = (await B.dialog()) ?? (await A.dialog());
    if (first.footer.some((t) => t.startsWith("최종 결과")) || first.label === "게임 종료") {
      throw new RetryRound("1국에서 게임이 끝나 자동 진행 모달을 볼 수 없음");
    }
    assert(first.label === "국 결과", `첫 모달 종류: ${first.label}`);

    const observeB = async () => {
      await waitFor(() => B.dialog(), { timeoutMs: 8000, label: "B 결과 모달" });
      const t0 = Date.now();
      const seen = [];
      let closedAt = null;
      while (Date.now() - t0 < 12_000) {
        const d = await B.dialog();
        if (!d) {
          closedAt = Date.now() - t0;
          break;
        }
        const m = /약 (\d+)초/.exec(d.auto ?? "");
        if (m && seen.at(-1) !== Number(m[1])) seen.push(Number(m[1]));
        if (seen.length === 1) await shot(B, "06-result-countdown-B");
        await sleep(100);
      }
      return { seen, closedAt };
    };

    const overlapA = async () => {
      await waitFor(() => A.dialog(), { timeoutMs: 8000, label: "A 결과 모달" });
      await A.page.evaluate(() => {
        window.__wsBlock = true;
        window.__ws.at(-1).close();
      });
      await waitFor(() => A.banner(), { timeoutMs: 4000, every: 25, label: "A 재접속 배너(모달 위)" });
      const out = [];
      for (const vp of [
        { width: 390, height: 844 },
        { width: 390, height: 500 },
        { width: 768, height: 500 },
      ]) {
        await A.page.setViewport(vp);
        await sleep(250);
        const r = await A.page.evaluate(reachability);
        out.push(r);
        await shot(A, `06-overlap-${vp.width}x${vp.height}-A`);
      }
      await A.page.setViewport({ width: 390, height: 844 });
      await A.page.evaluate(() => {
        window.__wsBlock = false;
        for (const s of window.__stubs) if (s.onclose) s.fail();
      });
      return out;
    };

    const [obs, overlaps] = await Promise.all([observeB(), overlapA()]);
    log(`  B 카운트다운 ${obs.seen.join("->")}, 자동 닫힘 ${obs.closedAt}ms, A 겹침 ${JSON.stringify(overlaps.map((o) => [o.vw, o.vh, o.title, o.footer, o.bannerLeave]))}`);
    assert(obs.seen.length >= 3, `카운트다운 값이 줄어드는 것을 3개 이상 관찰: ${obs.seen}`);
    assert(obs.seen.every((v, i) => i === 0 || v < obs.seen[i - 1]), `카운트다운이 감소: ${obs.seen}`);
    assert(obs.seen[0] <= 5, `카운트다운 시작값이 5 이하: ${obs.seen[0]}`);
    assert(obs.closedAt !== null, "결과 모달이 클릭 없이 자동으로 닫힘");
    for (const o of overlaps) {
      assert(o.title === true, `재접속 배너가 있어도 결과 모달 제목이 보임 (${o.vw}x${o.vh}) ${JSON.stringify(o)}`);
      assert(o.footer === true, `모달 푸터 버튼이 눌림 (${o.vw}x${o.vh})`);
      assert(o.bannerLeave === true, `배너 나가기가 눌림 (${o.vw}x${o.vh})`);
    }
    await waitFor(
      async () => (await A.banner()) === null && /진행 중/.test((await A.status()) ?? ""),
      { timeoutMs: 25_000, label: "A 자동 재접속 완료" },
    );

    // 7. 게임 끝까지: 이제 사람도 화료한다. 중간 국 모달은 자동으로 닫히고, 마지막 국 모달은 '최종 결과'로 넘긴다
    log("7 게임 종료까지 진행");
    scenario.allowWin = true;
    await pump(
      async () => {
        for (const p of players) {
          const d = await p.dialog();
          if (d?.label === "국 결과" && d.footer.some((t) => t.startsWith("최종 결과"))) await p.click("최종 결과");
        }
        const ends = await Promise.all(players.map((p) => p.has("[aria-label='게임 종료']")));
        return ends.every(Boolean);
      },
      { timeoutMs: 480_000, label: "게임 종료 화면" },
    );

    // 8. 게임 종료 순위 화면
    log("8 게임 종료 화면 단언");
    const ranks = [];
    for (const p of players) {
      const info = await p.page.evaluate(() => {
        const d = document.querySelector("[aria-label='게임 종료']");
        const rows = [...d.querySelectorAll("ol.ranking li")].map((li) => li.innerText.replace(/\s+/g, " ").trim());
        return {
          rows,
          me: d.querySelectorAll("li.ranking-me").length,
          note: d.querySelector(".modal-note")?.innerText ?? "",
          buttons: [...d.querySelectorAll("button")].map((x) => x.textContent.trim()),
          scores: [...d.querySelectorAll("ol.ranking li span:last-child")].map((s) => Number(s.textContent)),
        };
      });
      assert(info.rows.length === 4, `${p.name} 순위 4줄 (${info.rows.length})`);
      assert(info.me === 1, `${p.name} 내 줄 강조 1개`);
      assert(/새 게임이 없습니다/.test(info.note), `${p.name} 새 게임 없음 안내`);
      assert(info.buttons.length === 1 && /나가기/.test(info.buttons[0]), `${p.name} 나가기만 표시: ${info.buttons}`);
      ranks.push(info.scores.slice().sort((x, y) => x - y));
    }
    assert(JSON.stringify(ranks[0]) === JSON.stringify(ranks[1]), `두 화면의 최종 점수가 같음 ${ranks[0]} / ${ranks[1]}`);
    await shot(A, "08-gameend-A");
    await shot(B, "08-gameend-B");

    // 9. 나가기
    log("9 나가기");
    for (const p of players) assert(await p.click("나가기"), `${p.name} 나가기`);
    for (const p of players) {
      await waitFor(() => p.has("[aria-label='온라인 입장']"), { label: `${p.name} 입장 화면으로 복귀` });
      assert(/입장 전/.test((await p.status()) ?? ""), `${p.name} 상태 입장 전: ${await p.status()}`);
      assert((await p.page.evaluate(() => localStorage.getItem("mahjong.session.v1"))) === null, `${p.name} 저장 세션이 지워짐`);
    }

    // 10. 콘솔 에러 0
    log("10 콘솔 에러 0");
    for (const p of players) assert(p.errors.length === 0, `${p.name} 콘솔 에러 ${p.errors.length}건: ${p.errors.slice(0, 3).join(" | ")}`);
    return { roomId, acts: { A: A.acts, B: B.acts } };
  } finally {
    // 실패 분석을 위해 호출자가 스크린샷을 찍을 수 있게 컨텍스트 닫기는 호출자에서 한다
    scenario.ctxs = ctxs;
  }
}

// ---------------------------------------------------------------------------
// 한 회 실행(서버·vite·브라우저를 띄우고 모두 정리)
// ---------------------------------------------------------------------------
async function runOnce(n) {
  const t0 = Date.now();
  const tag = `run${n}`;
  fs.mkdirSync(ARTIFACTS, { recursive: true });
  if (n === 1) {
    // 이전 실행의 오래된 스크린샷(FAIL 포함)을 지운다
    for (const f of fs.readdirSync(ARTIFACTS)) if (/.png$/i.test(f)) fs.rmSync(path.join(ARTIFACTS, f), { force: true });
  }
  const log = (m) => console.log(`[e2e ${tag} +${((Date.now() - t0) / 1000).toFixed(1)}s] ${m}`);
  const result = { n, ok: false, attempts: 0, retryReasons: [], error: null, cleaned: false };
  let server, vite, browser, browserPid, serverPort, vitePort;
  try {
    const serverCwd = webDir;
    server = await startProc("server", ["--import", "tsx", "e2e/test-server.mts"], {
      cwd: serverCwd,
      env: { E2E_PORT: "0" },
      readyRe: /E2E_SERVER_READY (\d+)/,
    });
    serverPort = Number(server.match[1]);
    vitePort = await freePort();
    const viteBin = path.join(path.dirname(require.resolve("vite/package.json", { paths: [webDir] })), "bin", "vite.js");
    vite = await startProc("vite", [viteBin, "--port", String(vitePort), "--strictPort"], {
      cwd: webDir,
      env: { VITE_SERVER_URL: `ws://localhost:${serverPort}` },
      readyRe: /Local:\s+http/,
    });
    log(`서버 :${serverPort}, vite :${vitePort}`);
    browser = await puppeteer.launch({ executablePath: browserPath, headless: true, args: ["--no-sandbox"] });
    browserPid = browser.process()?.pid;

    const shot = async (p, name) => {
      if (saveShots) await p.page.screenshot({ path: path.join(ARTIFACTS, `${tag}-${name}.png`) });
    };
    for (let attempt = 1; attempt <= 3; attempt++) {
      result.attempts = attempt;
      scenario.ctxs = [];
      scenario.players = [];
      try {
        const out = await scenario({
          browser,
          webUrl: `http://localhost:${vitePort}/`,
          serverUrl: `ws://localhost:${serverPort}`,
          tag,
          log,
          shot,
        });
        result.ok = true;
        result.detail = out;
        break;
      } catch (e) {
        if (e instanceof RetryRound) {
          result.retryReasons.push(e.message);
          log(`재시도(${attempt}/3): ${e.message}`);
          continue;
        }
        // 실패: 스크린샷과 로그 저장
        for (const p of scenario.players) {
          await p.page.screenshot({ path: path.join(ARTIFACTS, `${tag}-FAIL-${p.name}.png`) }).catch(() => {});
        }
        result.error = e;
        break;
      } finally {
        for (const c of scenario.ctxs ?? []) await c.close().catch(() => {});
      }
    }
    if (!result.ok && !result.error) result.error = new Error("1국에서 게임이 끝나는 경우가 3번 연속 발생해 자동 진행 모달을 확인하지 못함");
  } catch (e) {
    result.error = e;
  } finally {
    if (result.error) {
      console.log(`[e2e ${tag}] 실패: ${result.error.message}`);
      console.log(`[e2e ${tag}] 스크린샷: ${ARTIFACTS}`);
      for (const e of [server, vite]) if (e) console.log(`--- ${e.name} 로그(끝 15줄)\n${e.log.slice(-15).join("\n")}`);
    }
    // 정리: 브라우저 -> vite -> 서버. 이후 포트 해제와 브라우저 종료를 확인한다.
    if (browser) await Promise.race([browser.close().catch(() => {}), sleep(10_000)]);
    // 준비 전에 실패한 프로세스도 포함해 이 회에 띄운 것을 모두 정리한다
    for (const e of [...procs].reverse()) await stopProc(e);
    await sleep(300);
    const leftovers = [];
    for (const [name, port] of [["서버", serverPort], ["vite", vitePort]]) {
      if (port && (await portOpen(port))) leftovers.push(`${name} 포트 ${port}이 아직 열려 있음`);
    }
    if (browserPid) {
      try {
        process.kill(browserPid, 0);
        leftovers.push(`브라우저 프로세스 ${browserPid}이 아직 살아 있음`);
      } catch {
        /* 종료됨 */
      }
    }
    result.cleaned = leftovers.length === 0;
    if (!result.cleaned) {
      console.log(`[e2e ${tag}] 정리 실패: ${leftovers.join(", ")}`);
      result.ok = false;
      result.error ??= new Error("정리 실패");
    }
  }
  result.ms = Date.now() - t0;
  return result;
}

const results = [];
for (let i = 1; i <= repeat; i++) {
  const r = await runOnce(i);
  results.push(r);
  console.log(`[e2e run${i}] ${r.ok ? "통과" : "실패"} (${(r.ms / 1000).toFixed(0)}초, 시나리오 시도 ${r.attempts}회${r.retryReasons.length ? `, 재시도 사유: ${r.retryReasons.join("; ")}` : ""})`);
}
const pass = results.filter((r) => r.ok).length;
console.log(`[e2e] 결과: ${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
