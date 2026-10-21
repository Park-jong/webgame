import { afterEach, describe, expect, it, vi } from "vitest";
import { JOIN_TIMEOUT_MS } from "@mahjong/server-session";
import { createP2PTransport, generatePeerSafeRoomId, P2P_HOST_URL, peerIdOf, roomIdFromUrl } from "./transport";
import type { P2PTransport } from "./transport";
import { FakePeer, Hub, PEERJS_ID_RULE } from "./fakePeers";
import { generateRoomId } from "@mahjong/server-room";
import type { WebSocketLike } from "../game/wsClient";

// --- 테스트 도우미 ---

interface TestClient {
  sock: WebSocketLike;
  msgs: Record<string, unknown>[];
  closed: { code: number; reason?: string } | null;
  opened: boolean;
}

function attach(sock: WebSocketLike): TestClient {
  const c: TestClient = { sock, msgs: [], closed: null, opened: false };
  sock.onopen = () => {
    c.opened = true;
  };
  sock.onmessage = (ev) => c.msgs.push(JSON.parse(ev.data as string) as Record<string, unknown>);
  sock.onclose = (ev) => {
    c.closed = ev;
  };
  return c;
}

const until = async (cond: () => boolean, label: string): Promise<void> => {
  for (let i = 0; i < 400; i++) {
    if (cond()) return;
    await new Promise((r) => setTimeout(r, 5));
  }
  throw new Error(`시간 초과: ${label}`);
};

const send = (c: TestClient, msg: object): void => c.sock.send(JSON.stringify(msg));
const find = (c: TestClient, type: string): Record<string, unknown> | undefined => c.msgs.find((m) => m.type === type);

describe("roomIdFromUrl", () => {
  it("방 코드를 대문자로 꺼내고, 예약 주소나 잘못된 형식은 null", () => {
    expect(roomIdFromUrl("p2p://abc_23")).toBe("ABC_23");
    expect(roomIdFromUrl("p2p://host")).toBeNull();
    expect(roomIdFromUrl("p2p://idle")).toBeNull();
    expect(roomIdFromUrl("p2p://")).toBeNull();
    expect(roomIdFromUrl("p2p://a b")).toBeNull();
    expect(roomIdFromUrl("ws://localhost:8080")).toBeNull();
  });
});

describe("generatePeerSafeRoomId", () => {
  it("PeerJS id 규칙(맨 앞/뒤·연속 '_' 금지)에 맞을 때까지 다시 뽑는다", () => {
    const draws = ["_ABCDEFG", "ABC__DEF", "ABCDEFG_", "AB_CDEFG"];
    expect(generatePeerSafeRoomId(() => draws.shift()!)).toBe("AB_CDEFG");
    expect(draws).toEqual([]);
  });

  it("기본 생성기로 많이 뽑아도 항상 규칙에 맞고 서버 알파벳 형식을 유지한다", () => {
    for (let i = 0; i < 3000; i++) {
      const id = generatePeerSafeRoomId();
      expect(PEERJS_ID_RULE.test(peerIdOf(id))).toBe(true);
      expect(roomIdFromUrl(`p2p://${id}`)).toBe(id);
    }
  });

  it("(회귀) 서버 생성기를 그대로 쓰면 규칙 위반이 실제로 나온다", () => {
    let bad = 0;
    for (let i = 0; i < 3000; i++) if (!PEERJS_ID_RULE.test(peerIdOf(generateRoomId()))) bad++;
    expect(bad).toBeGreaterThan(0);
  });
});

describe("P2P 전송 계층", () => {
  let transports: P2PTransport[] = [];
  const make = (hub: Hub): P2PTransport => {
    const t = createP2PTransport({ createPeer: hub.create });
    transports.push(t);
    return t;
  };
  afterEach(() => {
    for (const t of transports) t.dispose();
    transports = [];
  });

  it("호스트가 방을 만들고, 참가자가 방 코드로 들어와 함께 게임을 시작한다", async () => {
    const hub = new Hub();
    const host = make(hub);
    const guestSide = make(hub);

    const h = attach(host.createSocket(P2P_HOST_URL));
    await until(() => h.opened, "호스트 소켓 열림");
    send(h, { type: "join", name: "호스트" });
    await until(() => find(h, "joined") !== undefined, "호스트 joined");
    const joined = find(h, "joined") as { roomId: string; seat: number; seatToken: string };
    expect(joined.seat).toBe(0);
    expect(hub.peers.has(peerIdOf(joined.roomId))).toBe(true);

    const g = attach(guestSide.createSocket(`p2p://${joined.roomId}`));
    await until(() => g.opened, "참가자 소켓 열림");
    send(g, { type: "join", roomId: joined.roomId, name: "손님" });
    await until(() => find(g, "joined") !== undefined, "참가자 joined");
    expect((find(g, "joined") as { seat: number }).seat).toBe(1);

    send(h, { type: "start" });
    await until(() => find(g, "view") !== undefined && find(h, "view") !== undefined, "양쪽 view");
    const hostView = find(h, "view") as { view: { mySeat?: number } };
    const guestView = find(g, "view") as { view: { mySeat?: number } };
    expect(hostView.view).toBeDefined();
    expect(guestView.view).toBeDefined();
    // 참가자에게는 자기 좌석 기준의 뷰만 간다 (다른 좌석의 손패는 포함되지 않는다)
    expect(JSON.stringify(guestView)).not.toBe(JSON.stringify(hostView));
  });

  it("존재하지 않는 방 코드로 접속하면 오류와 함께 닫힌다", async () => {
    const hub = new Hub();
    const g = attach(make(hub).createSocket("p2p://NOSUCHRM"));
    await until(() => g.closed !== null, "닫힘");
    expect(g.closed?.code).toBe(4001); // 호스트 없음 (재접속 중이면 방이 닫힌 것으로 처리된다)
    expect(g.opened).toBe(false);
  });

  it("형식이 잘못된 방 코드는 바로 닫힌다", async () => {
    const hub = new Hub();
    const g = attach(make(hub).createSocket("p2p://bad code"));
    await until(() => g.closed !== null, "닫힘");
    expect(g.closed?.code).toBe(1006);
  });

  it("호스트 id가 이미 쓰이고 있으면 새 방 코드로 다시 시도한다", async () => {
    const hub = new Hub();
    const created: string[] = [];
    const t = createP2PTransport({
      createPeer: (id) => {
        if (id) created.push(id);
        return hub.create(id);
      },
    });
    transports.push(t);
    // 첫 호스트 id를 다른 피어가 이미 점유한 상황
    const origCreate = hub.create;
    let first = true;
    hub.create = (id?: string) => {
      if (first && id) {
        first = false;
        hub.peers.set(id, { destroyed: false, emit() {} } as unknown as FakePeer);
      }
      return origCreate(id);
    };
    const h = attach(t.createSocket(P2P_HOST_URL));
    await until(() => h.opened || h.closed !== null, "호스트 열림");
    expect(h.opened).toBe(true);
    expect(created.length).toBeGreaterThanOrEqual(2);
    expect(created[0]).not.toBe(created[created.length - 1]);
  });

  it("호스트가 소켓을 닫으면 방이 사라지고 참가자 연결도 끊긴다", async () => {
    const hub = new Hub();
    const host = make(hub);
    const h = attach(host.createSocket(P2P_HOST_URL));
    await until(() => h.opened, "호스트 열림");
    send(h, { type: "join", name: "호스트" });
    await until(() => find(h, "joined") !== undefined, "호스트 joined");
    const roomId = (find(h, "joined") as { roomId: string }).roomId;

    const g = attach(make(hub).createSocket(`p2p://${roomId}`));
    await until(() => g.opened, "참가자 열림");

    h.sock.close();
    await until(() => g.closed !== null, "참가자 닫힘");
    expect(hub.peers.has(peerIdOf(roomId))).toBe(false);
  });

  it("호스트 id가 PeerJS 규칙에 어긋나(invalid-id) 거부되면 새 방 코드로 다시 시도한다", async () => {
    const hub = new Hub();
    const created: string[] = [];
    let calls = 0;
    const t = createP2PTransport({
      createPeer: (id) => {
        calls += 1;
        if (id) created.push(id);
        // 첫 시도는 규칙에 어긋나는 id로 만들어져 invalid-id 오류가 난 것처럼 만든다
        return hub.create(calls === 1 ? "bad__id" : id);
      },
    });
    transports.push(t);
    const h = attach(t.createSocket(P2P_HOST_URL));
    await until(() => h.opened || h.closed !== null, "호스트 열림");
    expect(h.opened).toBe(true);
    expect(created.length).toBe(2);
  });

  it("방 코드가 PeerJS 규칙에 어긋나게 뽑혀도 호스트는 규칙에 맞는 id만 쓴다", async () => {
    const hub = new Hub();
    const draws = ["_ABCDEFG", "ABC__DEF", "ABCDEFG_", "AB_CDEFG"];
    const created: string[] = [];
    const t = createP2PTransport({
      newRoomId: () => draws.shift() ?? "ZZZZZZZZ",
      createPeer: (id) => {
        if (id) created.push(id);
        return hub.create(id);
      },
    });
    transports.push(t);
    const h = attach(t.createSocket(P2P_HOST_URL));
    await until(() => h.opened || h.closed !== null, "호스트 열림");
    expect(h.opened).toBe(true);
    expect(created).toEqual(["mjk-AB_CDEFG"]);
    expect(PEERJS_ID_RULE.test(created[0]!)).toBe(true);
  });

  it("unavailable-id 재시도를 5회 모두 소진하면 호스트 시작에 실패한다", async () => {
    const hub = new Hub();
    const created: string[] = [];
    const t = createP2PTransport({
      createPeer: (id) => {
        // 요청된 id를 항상 다른 피어가 점유하고 있는 상황
        if (id) {
          created.push(id);
          hub.peers.set(id, { destroyed: false, emit() {} } as unknown as FakePeer);
        }
        return hub.create(id);
      },
    });
    transports.push(t);
    const h = attach(t.createSocket(P2P_HOST_URL));
    await until(() => h.closed !== null, "호스트 실패");
    expect(h.opened).toBe(false);
    expect(h.closed?.code).toBe(1006);
    expect(created.length).toBe(6); // 첫 시도 + 재시도 5회
  });

  it("원격 연결은 정확히 16개까지 받고 17번째부터 거부한다 (호스트 본인은 세지 않는다)", async () => {
    const hub = new Hub();
    const h = attach(make(hub).createSocket(P2P_HOST_URL));
    await until(() => h.opened, "호스트 열림");
    send(h, { type: "join", name: "호스트" });
    await until(() => find(h, "joined") !== undefined, "호스트 joined");
    const roomId = (find(h, "joined") as { roomId: string }).roomId;

    const guestSide = make(hub);
    const guests: TestClient[] = [];
    for (let i = 0; i < 17; i++) guests.push(attach(guestSide.createSocket(`p2p://${roomId}`)));
    await until(() => guests[16]!.closed !== null, "17번째 거부");
    for (let i = 0; i < 16; i++) {
      expect(guests[i]!.opened).toBe(true);
      expect(guests[i]!.closed).toBeNull();
    }

    // 한 자리가 비면 다시 받는다
    guests[0]!.sock.close();
    await new Promise((r) => setTimeout(r, 30));
    const again = attach(guestSide.createSocket(`p2p://${roomId}`));
    await until(() => again.opened, "빈 자리에 재입장");
    await new Promise((r) => setTimeout(r, 30));
    expect(again.closed).toBeNull();
  });

  it("참가자 소켓 close()는 DataChannel을 닫고 peer.destroy까지 이어진다", async () => {
    const hub = new Hub();
    const h = attach(make(hub).createSocket(P2P_HOST_URL));
    await until(() => h.opened, "호스트 열림");
    send(h, { type: "join", name: "호스트" });
    await until(() => find(h, "joined") !== undefined, "호스트 joined");
    const roomId = (find(h, "joined") as { roomId: string }).roomId;

    const g = attach(make(hub).createSocket(`p2p://${roomId}`));
    await until(() => g.opened, "참가자 열림");
    const guestPeer = hub.all.find((p) => p.id.startsWith("anon-"))!;
    expect(guestPeer.destroyed).toBe(false);

    g.sock.close();
    expect(guestPeer.destroyed).toBe(true);
    await until(() => g.closed !== null, "참가자 닫힘");
    expect(g.closed?.code).toBe(1000);
  });

  it("transport.dispose()를 부르면 참가자 소켓이 닫히고 호스트 피어가 파괴된다", async () => {
    const hub = new Hub();
    const host = make(hub);
    const h = attach(host.createSocket(P2P_HOST_URL));
    await until(() => h.opened, "호스트 열림");
    send(h, { type: "join", name: "호스트" });
    await until(() => find(h, "joined") !== undefined, "호스트 joined");
    const roomId = (find(h, "joined") as { roomId: string }).roomId;
    const g = attach(make(hub).createSocket(`p2p://${roomId}`));
    await until(() => g.opened, "참가자 열림");

    host.dispose();
    await until(() => g.closed !== null, "참가자 닫힘");
    expect(hub.peers.has(peerIdOf(roomId))).toBe(false);
    expect(hub.all.find((p) => p.id === peerIdOf(roomId))?.destroyed).toBe(true);
  });

  it("호스트가 문자열이 아닌 data를 받으면 해당 연결에 오류만 보내고 연결은 유지한다", async () => {
    const hub = new Hub();
    const h = attach(make(hub).createSocket(P2P_HOST_URL));
    await until(() => h.opened, "호스트 열림");
    send(h, { type: "join", name: "호스트" });
    await until(() => find(h, "joined") !== undefined, "호스트 joined");
    const roomId = (find(h, "joined") as { roomId: string }).roomId;

    const conns: unknown[] = [];
    const guestSide = createP2PTransport({
      createPeer: (id) => {
        const p = hub.create(id) as FakePeer;
        const orig = p.connect.bind(p);
        p.connect = (cid: string) => {
          const c = orig(cid);
          conns.push(c);
          return c;
        };
        return p;
      },
    });
    transports.push(guestSide);
    const g = attach(guestSide.createSocket(`p2p://${roomId}`));
    await until(() => g.opened, "참가자 열림");

    (conns[0] as { send(d: unknown): void }).send({ not: "a string" });
    await until(() => find(g, "error") !== undefined, "오류 응답");
    expect((find(g, "error") as { code: string }).code).toBe("bad_message");
    expect(g.closed).toBeNull();

    // 이후 정상 메시지는 계속 처리된다
    send(g, { type: "join", roomId, name: "손님" });
    await until(() => find(g, "joined") !== undefined, "참가자 joined");
  });

  it("(회귀) 호스트 시그널링이 끊겼다 재연결돼 'open'이 다시 와도 10초 뒤 호스트 소켓이 1008로 끊기지 않는다", async () => {
    const hub = new Hub();
    const h = attach(make(hub).createSocket(P2P_HOST_URL));
    await until(() => h.opened, "호스트 열림");
    send(h, { type: "join", name: "호스트" });
    await until(() => find(h, "joined") !== undefined, "호스트 joined");
    const roomId = (find(h, "joined") as { roomId: string }).roomId;
    const hostPeer = hub.all[0]!;

    vi.useFakeTimers();
    try {
      hostPeer.dropSignaling(); // transport가 reconnect()를 부르고, PeerJS처럼 'open'이 한 번 더 발생한다
      await vi.advanceTimersByTimeAsync(50);
      expect(hostPeer.signalingDown).toBe(false);
      // 참가 제한 시간(10초)을 넘겨도 호스트 소켓은 살아 있어야 한다
      await vi.advanceTimersByTimeAsync(JOIN_TIMEOUT_MS + 1000);
      expect(h.closed).toBeNull();
    } finally {
      vi.useRealTimers();
    }

    // 재연결 뒤에도 새 참가자가 들어올 수 있고 호스트는 계속 방을 진행한다
    const g = attach(make(hub).createSocket(`p2p://${roomId}`));
    await until(() => g.opened, "참가자 열림");
    send(g, { type: "join", roomId, name: "손님" });
    await until(() => find(g, "joined") !== undefined, "참가자 joined");
    send(h, { type: "start" });
    await until(() => find(h, "view") !== undefined && find(g, "view") !== undefined, "양쪽 view");
    expect(h.closed).toBeNull();
  });

  it("참가자가 재접속(rejoin)하면 같은 좌석으로 돌아온다", async () => {
    const hub = new Hub();
    const h = attach(make(hub).createSocket(P2P_HOST_URL));
    await until(() => h.opened, "호스트 열림");
    send(h, { type: "join", name: "호스트" });
    await until(() => find(h, "joined") !== undefined, "호스트 joined");
    const roomId = (find(h, "joined") as { roomId: string }).roomId;

    const guest = make(hub);
    const g1 = attach(guest.createSocket(`p2p://${roomId}`));
    await until(() => g1.opened, "참가자 열림");
    send(g1, { type: "join", roomId, name: "손님" });
    await until(() => find(g1, "joined") !== undefined, "참가자 joined");
    const j = find(g1, "joined") as { seat: number; seatToken: string };

    send(h, { type: "start" }); // 시작 전에는 나가면 좌석이 비므로, 시작한 뒤의 재접속을 확인한다
    await until(() => find(g1, "view") !== undefined, "게임 시작");
    g1.sock.close();
    const g2 = attach(guest.createSocket(`p2p://${roomId}`));
    await until(() => g2.opened, "재접속 열림");
    send(g2, { type: "rejoin", roomId, seatToken: j.seatToken });
    await until(() => find(g2, "joined") !== undefined, "재접속 joined");
    expect((find(g2, "joined") as { seat: number }).seat).toBe(j.seat);
  });
});
