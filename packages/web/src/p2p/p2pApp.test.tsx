import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App } from "../App";
import { createMemoryPrefsStore } from "../game/prefs";
import { Hub } from "./fakePeers";
import { createP2PTransport } from "./transport";

afterEach(cleanup);

describe("P2P 모드", () => {
  it("모드 선택에 P2P 버튼이 있고, 입장 폼에는 서버 주소 입력이 없다", () => {
    render(<App prefsStore={createMemoryPrefsStore()} p2pTransport={createP2PTransport({ createPeer: new Hub().create })} />);
    fireEvent.click(screen.getByRole("button", { name: /P2P 멀티플레이/ }));
    expect(screen.getByRole("heading", { name: "P2P 멀티플레이" })).toBeTruthy();
    expect(screen.queryByText("서버 주소")).toBeNull();
    expect(screen.getByRole("button", { name: /방 만들기/ })).toBeTruthy();
    expect(screen.getByLabelText("방 코드")).toBeTruthy();
  });

  it("방을 만들면 호스트로 대기실에 들어가고, 다른 브라우저가 방 코드로 입장할 수 있다", async () => {
    const hub = new Hub();
    const hostApp = render(<App prefsStore={createMemoryPrefsStore()} p2pTransport={createP2PTransport({ createPeer: hub.create })} />);
    fireEvent.click(hostApp.getByRole("button", { name: /P2P 멀티플레이/ }));
    fireEvent.click(hostApp.getByRole("button", { name: /방 만들기/ }));
    const roomId = (await hostApp.findByTestId("room-id")).textContent ?? "";
    expect(roomId).toMatch(/^[A-Z0-9_]{8}$/);
    expect(hostApp.getByTestId("my-seat").textContent).toContain("좌석 1");

    // 다른 브라우저를 흉내 내는 두 번째 앱 (별도 transport, 같은 가짜 네트워크)
    const guestApp = render(<App prefsStore={createMemoryPrefsStore()} p2pTransport={createP2PTransport({ createPeer: hub.create })} />);
    fireEvent.click(guestApp.getByRole("button", { name: /P2P 멀티플레이/ }));
    fireEvent.change(guestApp.getByLabelText("방 코드"), { target: { value: roomId } });
    fireEvent.click(guestApp.getByRole("button", { name: "입장" }));
    // 두 앱이 같은 document에 있으므로 참가자 앱의 컨테이너 안에서만 찾는다
    const guestView = within(guestApp.container);
    const seat = await guestView.findByTestId("my-seat", undefined, { timeout: 3000 });
    expect(seat.textContent).toContain("좌석 2");
    expect(guestView.getByTestId("room-id").textContent).toBe(roomId);
  });
});
