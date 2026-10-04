/**
 * 예측 불가 난수: core의 RandomFn([0,1) 실수)을 crypto.randomBytes로 만든다.
 * Math.random은 사용하지 않는다. 시드/상태는 서버 메모리에만 두고 메시지에 싣지 않는다.
 */

import { randomBytes } from "node:crypto";
import type { RandomFn } from "@mahjong/core";

/** 53비트 정밀도의 [0, 1) 실수: (상위 27비트 x 2^26 + 하위 26비트) / 2^53 */
export const secureRandom: RandomFn = () => {
  const b = randomBytes(8);
  const hi = b.readUInt32BE(0) >>> 5;
  const lo = b.readUInt32BE(4) >>> 6;
  return (hi * 67108864 + lo) / 9007199254740992;
};
