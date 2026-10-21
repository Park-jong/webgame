import { describe, expect, it } from "vitest";
import { randomBytes, timingSafeEqual } from "./cryptoShim";

describe("cryptoShim", () => {
  it("randomBytes는 요청한 길이의 Uint8Array를 돌려주고, 0바이트도 허용한다", () => {
    const b = randomBytes(24);
    expect(b).toBeInstanceOf(Uint8Array);
    expect(b.length).toBe(24);
    expect(randomBytes(0).length).toBe(0);
  });

  it("readUInt32BE는 빅엔디언으로 읽고, 부분 뷰(byteOffset)에서도 올바르다", () => {
    const b = randomBytes(8);
    b.set([0x01, 0x02, 0x03, 0x04, 0xff, 0xff, 0xff, 0xff]);
    expect(b.readUInt32BE(0)).toBe(0x01020304);
    expect(b.readUInt32BE(4)).toBe(0xffffffff);
    expect(b.readUInt32BE(1)).toBe(0x020304ff);
    // 큰 버퍼의 일부를 가리키는 뷰
    const base = new Uint8Array([9, 9, 0x0a, 0x0b, 0x0c, 0x0d]);
    const view = Object.setPrototypeOf(base.subarray(2), Object.getPrototypeOf(b)) as typeof b;
    expect(view.readUInt32BE(0)).toBe(0x0a0b0c0d);
  });

  it("timingSafeEqual은 같으면 true, 다르면 false, 길이가 다르면 예외", () => {
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    expect(timingSafeEqual(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    expect(timingSafeEqual(new Uint8Array(0), new Uint8Array(0))).toBe(true);
    expect(() => timingSafeEqual(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toThrow(RangeError);
  });
});
