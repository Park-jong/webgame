// wsClient 테스트용 모의 소켓/타이머
import type { Timers, WebSocketLike } from "./wsClient";

export class MockSocket implements WebSocketLike {
  onopen: ((ev: unknown) => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: ((ev: { code: number; reason?: string }) => void) | null = null;
  onerror: ((ev: unknown) => void) | null = null;
  sent: Array<Record<string, unknown>> = [];
  closed = false;
  throwOnSend = false;

  send(data: string): void {
    if (this.throwOnSend) throw new Error("send failed");
    this.sent.push(JSON.parse(data) as Record<string, unknown>);
  }
  close(): void {
    this.closed = true;
  }
  open(): void {
    this.onopen?.({});
  }
  receive(msg: unknown): void {
    this.onmessage?.({ data: typeof msg === "string" ? msg : JSON.stringify(msg) });
  }
  drop(code = 1006): void {
    this.onclose?.({ code });
  }
}

export class FakeTimers implements Timers {
  time = 1000;
  private seq = 0;
  private tasks = new Map<number, { at: number; fn: () => void }>();
  setTimeout(fn: () => void, ms: number): unknown {
    const id = ++this.seq;
    this.tasks.set(id, { at: this.time + ms, fn });
    return id;
  }
  clearTimeout(handle: unknown): void {
    this.tasks.delete(handle as number);
  }
  now(): number {
    return this.time;
  }
  pending(): number[] {
    return [...this.tasks.values()].map((t) => t.at - this.time).sort((a, b) => a - b);
  }
  advance(ms: number): void {
    const end = this.time + ms;
    for (;;) {
      const next = [...this.tasks.entries()].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      this.tasks.delete(next[0]);
      this.time = next[1].at;
      next[1].fn();
    }
    this.time = end;
  }
}
