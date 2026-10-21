import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { RenderResult } from "@testing-library/react";
import { App } from "../App";
import { createMemoryPrefsStore } from "../game/prefs";
import { Hub } from "./fakePeers";
import { createP2PTransport } from "./transport";
import type { P2PTransport } from "./transport";

afterEach(cleanup);

// 대기실 착석 현황(A)과 브라우저 종료 처리(B) 회귀 테스트. 가짜 PeerJS 네트워크 위에서 앱 전체를 돌린다.

interface Browser {
  app: RenderResult;
  view: ReturnType<typeof within>;
  transport: P2PTransport;
}

function open(hub: Hub): Browser {
  const transport = createP2PTransport({ createPeer: hub.create });
  const app = render(
    <App
      prefsStore={createMemoryPrefsStore()}
      p2pTransport={transport}
      serverOptions={{ clientOptions: { baseDelayMs: 5, maxDelayMs: 20 } }}
    />,
  );
  fireEvent.click(app.getByRole("button", { name: /P2P 멀티플레이/ }));
  return { app, view: within(app.container), transport };
}

async function host(hub: Hub): Promise<{ b: Browser; roomId: string }> {
  const b = open(hub);
  fireEvent.click(b.view.getByRole("button", { name: /방 만들기/ }));
  const roomId = (await b.view.findByTestId("room-id")).textContent ?? "";
  return { b, roomId };
}

async function guest(hub: Hub, roomId: string): Promise<Browser> {
  const b = open(hub);
  fireEvent.change(b.view.getByLabelText("방 코드"), { target: { value: roomId } });
  fireEvent.click(b.view.getByRole("button", { name: "입장" }));
  await b.view.findByTestId("my-seat", undefined, { timeout: 3000 });
  return b;
}

const seatState = (b: Browser, i: number): string | null => b.view.getByTestId(`lobby-seat-${i}`).getAttribute("data-state");
const count = (b: Browser): string => b.view.getByTestId("lobby-count").textContent ?? "";

describe("P2P 대기실 착석 현황", () => {
  it("호스트와 참가자 모두 몇 명이 대기 중인지, 어느 자리가 사람/빈 자리인지, 내 자리가 어디인지 본다", async () => {
    const hub = new Hub();
    const { b: h, roomId } = await host(hub);
    await waitFor(() => expect(count(h)).toBe("1"));
    expect(h.view.getByTestId("lobby-seat-0").textContent).toContain("나");
    expect(seatState(h, 1)).toBe("empty");

    const g = await guest(hub, roomId);
    await waitFor(() => expect(count(h)).toBe("2"));
    await waitFor(() => expect(count(g)).toBe("2"));
    expect(seatState(h, 1)).toBe("human");
    expect(h.view.getByTestId("lobby-seat-1").textContent).toContain("참가자");
    expect(g.view.getByTestId("lobby-seat-1").textContent).toContain("나");
    expect(g.view.getByTestId("lobby-seat-0").textContent).toContain("참가자");
  });
});

describe("P2P 브라우저 종료 처리", () => {
  it("(회귀) 참가자가 시작 전에 탭을 닫으면 좌석이 비어 호스트 화면에 반영되고, 다음 사람이 입장할 수 있다", async () => {
    const hub = new Hub();
    const { b: h, roomId } = await host(hub);
    const first = await guest(hub, roomId);
    await waitFor(() => expect(count(h)).toBe("2"));

    first.app.unmount(); // 탭 종료: 언마운트 정리가 연결을 닫는다
    await waitFor(() => expect(count(h)).toBe("1"));
    expect(seatState(h, 1)).toBe("empty");

    // 정원(4명)을 넘겨 들락거려도 계속 입장할 수 있다
    for (let i = 0; i < 5; i++) {
      const next = await guest(hub, roomId);
      expect(next.view.getByTestId("my-seat").textContent).toContain("좌석 2");
      next.app.unmount();
      await waitFor(() => expect(count(h)).toBe("1"));
    }
  });

  it("탭을 닫을 때(pagehide) 호스트는 PeerJS id를 반납하고 방을 닫는다", async () => {
    const hub = new Hub();
    const { roomId } = await host(hub);
    expect(hub.peers.size).toBe(1);
    window.dispatchEvent(new Event("pagehide"));
    expect(hub.all.every((p) => p.destroyed)).toBe(true);
    expect(hub.peers.size).toBe(0);
    const late = open(hub);
    fireEvent.change(late.view.getByLabelText("방 코드"), { target: { value: roomId } });
    fireEvent.click(late.view.getByRole("button", { name: "입장" }));
    await waitFor(() => expect(late.view.queryByTestId("my-seat")).toBeNull());
  });

  it("호스트가 사라지면 참가자 화면에 '호스트가 방을 닫았습니다' 안내가 뜬다 (재접속을 반복하지 않는다)", async () => {
    const hub = new Hub();
    const { b: h, roomId } = await host(hub);
    const g = await guest(hub, roomId);
    await waitFor(() => expect(count(g)).toBe("2"));

    h.transport.dispose(); // 호스트 탭 종료
    const banner = await g.view.findByText("호스트가 방을 닫았습니다", undefined, { timeout: 3000 });
    expect(banner).toBeTruthy();
    expect(g.view.getByText(/호스트가 탭을 닫거나 나가면 방이 사라집니다/)).toBeTruthy();
    expect(g.view.queryByRole("button", { name: /다시 연결/ })).toBeNull();
    expect(g.view.getAllByRole("button", { name: "나가기" }).length).toBeGreaterThan(0);
  });

  it("게임 시작 뒤에 호스트가 사라져도 참가자에게 같은 안내가 뜬다", async () => {
    const hub = new Hub();
    const { b: h, roomId } = await host(hub);
    const g = await guest(hub, roomId);
    await waitFor(() => expect(count(h)).toBe("2"));
    fireEvent.click(h.view.getByRole("button", { name: "시작" }));
    await waitFor(() => expect(screen.queryAllByTestId("lobby-seats").length).toBe(0));
    h.transport.dispose();
    await g.view.findByText("호스트가 방을 닫았습니다", undefined, { timeout: 3000 });
  });
});
