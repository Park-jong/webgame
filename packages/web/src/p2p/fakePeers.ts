// 테스트용 PeerJS 대체: 같은 프로세스 안의 가짜 시그널링 + DataChannel
import type { DataConnectionLike, PeerLike } from "./transport";

type Listener = (...args: never[]) => void;

class Emitter {
  private handlers = new Map<string, Listener[]>();
  on(event: string, cb: Listener): void {
    this.handlers.set(event, [...(this.handlers.get(event) ?? []), cb]);
  }
  emit(event: string, ...args: unknown[]): void {
    for (const cb of this.handlers.get(event) ?? []) (cb as (...a: unknown[]) => void)(...args);
  }
}

class FakeConn extends Emitter {
  open = false;
  peer: FakeConn | null = null;
  closed = false;
  send(data: string): void {
    const other = this.peer;
    // JSON 직렬화 왕복: 실제 DataChannel처럼 값이 복사되어 전달된다
    if (other && !other.closed) setTimeout(() => other.emit("data", JSON.parse(JSON.stringify(data))), 0);
  }
  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit("close");
    const other = this.peer;
    if (other && !other.closed) setTimeout(() => other.closeFromRemote(), 0);
  }
  closeFromRemote(): void {
    if (this.closed) return;
    this.closed = true;
    this.open = false;
    this.emit("close");
  }
}

export class Hub {
  peers = new Map<string, FakePeer>();
  counter = 0;
  /** 만들어진 모든 피어 (destroy 여부 확인용) */
  all: FakePeer[] = [];
  create = (id?: string): PeerLike => {
    const peer = new FakePeer(this, id);
    this.all.push(peer);
    return peer;
  };
}

/** PeerJS 1.5.x util.validateId와 같은 규칙: 위반하면 Peer가 'invalid-id' 오류를 낸다 */
export const PEERJS_ID_RULE = /^[A-Za-z0-9]+(?:[ _-][A-Za-z0-9]+)*$/;

export class FakePeer extends Emitter implements PeerLike {
  id: string;
  destroyed = false;
  signalingDown = false;
  constructor(
    private hub: Hub,
    id?: string,
  ) {
    super();
    this.id = id ?? `anon-${++hub.counter}`;
    setTimeout(() => {
      if (this.destroyed) return;
      if (id !== undefined && !PEERJS_ID_RULE.test(id)) {
        this.emit("error", { type: "invalid-id" });
        return;
      }
      if (hub.peers.has(this.id)) {
        this.emit("error", { type: "unavailable-id" });
        return;
      }
      hub.peers.set(this.id, this);
      this.emit("open", this.id);
    }, 0);
  }
  connect(id: string): DataConnectionLike {
    const mine = new FakeConn();
    setTimeout(() => {
      const target = this.hub.peers.get(id);
      if (!target || target.destroyed) {
        this.emit("error", { type: "peer-unavailable" });
        return;
      }
      const theirs = new FakeConn();
      mine.peer = theirs;
      theirs.peer = mine;
      target.emit("connection", theirs);
      mine.open = true;
      theirs.open = true;
      mine.emit("open");
      theirs.emit("open");
    }, 0);
    return mine as unknown as DataConnectionLike;
  }
  /** 시그널링 서버와의 연결이 끊긴 상황 (실제 PeerJS의 disconnected). 맺은 DataChannel은 유지된다 */
  dropSignaling(): void {
    this.signalingDown = true;
    if (this.hub.peers.get(this.id) === this) this.hub.peers.delete(this.id);
    this.emit("disconnected", this.id);
  }
  /** 실제 PeerJS 1.5.x와 같이, 끊긴 뒤 reconnect()하면 서버가 다시 OPEN을 보내 'open'이 한 번 더 발생한다 */
  reconnect(): void {
    if (!this.signalingDown || this.destroyed) return;
    this.signalingDown = false;
    setTimeout(() => {
      if (this.destroyed) return;
      this.hub.peers.set(this.id, this);
      this.emit("open", this.id);
    }, 0);
  }
  destroy(): void {
    this.destroyed = true;
    if (this.hub.peers.get(this.id) === this) this.hub.peers.delete(this.id);
  }
}

