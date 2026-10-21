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
  create = (id?: string): PeerLike => new FakePeer(this, id);
}

export class FakePeer extends Emitter implements PeerLike {
  id: string;
  destroyed = false;
  constructor(
    private hub: Hub,
    id?: string,
  ) {
    super();
    this.id = id ?? `anon-${++hub.counter}`;
    setTimeout(() => {
      if (this.destroyed) return;
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
  reconnect(): void {}
  destroy(): void {
    this.destroyed = true;
    if (this.hub.peers.get(this.id) === this) this.hub.peers.delete(this.id);
  }
}

