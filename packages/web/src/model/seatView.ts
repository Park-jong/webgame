// 서버 프로토콜/좌석 뷰 타입 re-export와 상대 좌석 헬퍼.
// 주의: 서버 패키지 index.ts(ws 의존)는 절대 import 하지 않는다. protocol.ts / view.ts 파일만 alias로 참조한다.
import type { Seat } from "@mahjong/core";

export type * from "@mahjong/server-protocol";
export type * from "@mahjong/server-view";
// 값 import가 필요한 것은 viewFor 뿐
export { viewFor } from "@mahjong/server-view";

/** mySeat 기준 상대 좌석 (0=나, 1=下家, 2=对面, 3=上家) */
export function relativeSeat(seat: Seat, mySeat: Seat): Seat {
  return (((seat - mySeat + 4) % 4) as Seat);
}
