// 브라우저용 node:crypto 대체. 서버의 방/RNG 코드(room.ts, rng.ts)를 번들에 넣기 위해 vite alias로 연결한다.
// 서버 코드가 쓰는 부분(randomBytes, timingSafeEqual)만 구현한다.

/** rng.ts가 Buffer처럼 읽는 readUInt32BE만 덧붙인 Uint8Array */
class Bytes extends Uint8Array {
  readUInt32BE(offset: number): number {
    return new DataView(this.buffer, this.byteOffset, this.byteLength).getUint32(offset, false);
  }
}

export function randomBytes(size: number): Bytes {
  const bytes = new Bytes(size);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

/** 길이가 같은 두 바이트열을 처음부터 끝까지 비교한다(조기 종료 없음) */
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) throw new RangeError("길이가 다릅니다");
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
