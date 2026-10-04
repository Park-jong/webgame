/**
 * 서(西) 쌍패 샤본 대기의 론 가능 여부 회귀 테스트 (12-4 조사 결과 고정).
 * 응답 단계에서 사람 좌석 0의 legalActions를 검사한다. 엔진은 정상이며 이 테스트는 그 동작을 고정한다.
 */
import { describe, expect, it } from "vitest";
import type { Tile } from "./tiles.js";
import type { Action, GameState } from "./game.js";
import { awaitingSeats, createGame, dispatch, legalActions } from "./game.js";
import { isAgari } from "./agari.js";

function seeded(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const HONORS: Tile[] = [
  { kind: "wind", wind: "east" },
  { kind: "wind", wind: "south" },
  { kind: "wind", wind: "west" },
  { kind: "wind", wind: "north" },
  { kind: "dragon", dragon: "white" },
  { kind: "dragon", dragon: "green" },
  { kind: "dragon", dragon: "red" },
];

/** "123m456p1z" 표기법 파서 (z: 1~4 동남서북, 5~7 백발중) */
function T(notation: string): Tile[] {
  const out: Tile[] = [];
  let digits: string[] = [];
  for (const ch of notation) {
    if (/[0-9]/.test(ch)) {
      digits.push(ch);
      continue;
    }
    for (const d of digits) {
      if (ch === "z") {
        out.push(HONORS[Number(d) - 1]!);
      } else {
        const suit = ch === "m" ? "man" : ch === "p" ? "pin" : "sou";
        out.push({ kind: "number", suit, rank: Number(d) as 1, isRedFive: false });
      }
    }
    digits = [];
  }
  return out;
}

const JUNK = "1379m1379p1379s2z"; // 13장, 텐파이/부로/화료 없음
/** 서 샤본 대기 (1m / 3z): 234m 567p 789s 11m 33z */
const SHANPON = "234m567p789s11m33z";
/** 서 쌍 + 23m 양면 대기 (1m / 4m): 서는 대기패가 아님 */
const RYANMEN = "23m567p789s234p33z";
const PAD = "4z".repeat(6);

const WEST = T("3z")[0]!;
const types = (actions: Action[]): string[] => actions.map((a) => a.type);

interface Scene {
  hand0: string;
  /** 친 좌석 */
  dealer: 0 | 1 | 2 | 3;
  roundWind?: "east" | "south" | "west" | "north";
  /** 좌석 0이 이미 버린 패 */
  discards0?: string;
  furitenTemp?: boolean[];
}

/** 좌석 1이 서(3z)를 츠모해 버린 직후의 응답 단계 상태. 좌석 0이 사람. */
function afterSeat1DiscardsWest(scene: Scene): GameState {
  const base = createGame(seeded(1));
  const s0: GameState = {
    ...base,
    players: base.players.map((p, i) => ({
      hand: T(i === 0 ? scene.hand0 : i === 1 ? JUNK + "3z" : JUNK),
      melds: [],
      discards:
        i === 0 && scene.discards0
          ? T(scene.discards0).map((tile) => ({ tile, riichi: false, tsumogiri: false, calledBy: null }))
          : [],
      riichi: false,
    })),
    liveWall: T("3z" + "4z".repeat(8)),
    deadWall: T("5s6s7s8s" + "7z".repeat(10)),
    doraCount: 1,
    drawnTile: WEST,
    turn: 1,
    anyCalls: true,
    dealer: scene.dealer,
    roundWind: scene.roundWind ?? "east",
    ...(scene.furitenTemp ? { furitenTemp: scene.furitenTemp } : {}),
  };
  return dispatch(s0, { type: "discard", seat: 1, tile: WEST });
}

const seat0Types = (s: GameState): string[] => types(legalActions(s, 0));

describe("서 쌍패 샤본 대기 론", () => {
  it("자풍 서(친=좌석2): 상대가 서를 버리면 ron과 pon이 모두 있다", () => {
    expect(isAgari([...T(SHANPON), WEST])).toBe(true);
    const s = afterSeat1DiscardsWest({ hand0: SHANPON, dealer: 2 });
    expect(awaitingSeats(s)).toContain(0);
    const t = seat0Types(s);
    expect(t).toContain("ron");
    expect(t).toContain("pon");
  });

  it("후리텐: 자신이 서를 이미 버렸으면 ron 없음, pon은 있음", () => {
    expect(isAgari([...T(SHANPON), WEST])).toBe(true);
    const s = afterSeat1DiscardsWest({ hand0: SHANPON, dealer: 2, discards0: "3z" });
    const t = seat0Types(s);
    expect(t).not.toContain("ron");
    expect(t).toContain("pon");
  });

  it("후리텐: 다른 쪽 대기패(1m)를 이미 버렸어도 ron 없음, pon은 있음", () => {
    expect(isAgari([...T(SHANPON), WEST])).toBe(true);
    expect(isAgari([...T(SHANPON), ...T("1m")])).toBe(true);
    const s = afterSeat1DiscardsWest({ hand0: SHANPON, dealer: 2, discards0: "1m" });
    const t = seat0Types(s);
    expect(t).not.toContain("ron");
    expect(t).toContain("pon");
  });

  it("서가 자풍도 장풍도 아님: 친=좌석0(동장 동가)이면 역이 없어 ron 없음, pon은 있음", () => {
    expect(isAgari([...T(SHANPON), WEST])).toBe(true);
    const s = afterSeat1DiscardsWest({ hand0: SHANPON, dealer: 0 });
    const t = seat0Types(s);
    expect(t).not.toContain("ron");
    expect(t).toContain("pon");
  });

  it("서가 자풍도 장풍도 아님: 친=좌석1(좌석0 자풍 북)이면 ron 없음, pon은 있음", () => {
    expect(isAgari([...T(SHANPON), WEST])).toBe(true);
    const s = afterSeat1DiscardsWest({ hand0: SHANPON, dealer: 1 });
    const t = seat0Types(s);
    expect(t).not.toContain("ron");
    expect(t).toContain("pon");
  });

  it("장풍=서 겹침(자풍은 동): ron 있음", () => {
    expect(isAgari([...T(SHANPON), WEST])).toBe(true);
    const s = afterSeat1DiscardsWest({ hand0: SHANPON, dealer: 0, roundWind: "west" });
    expect(seat0Types(s)).toContain("ron");
  });

  it("서 쌍 + 양면(23m) 대기: 서는 대기패가 아니므로 ron 없음, pon은 있음", () => {
    expect(isAgari([...T(RYANMEN), ...T("1m")])).toBe(true);
    expect(isAgari([...T(RYANMEN), ...T("4m")])).toBe(true);
    expect(isAgari([...T(RYANMEN), WEST])).toBe(false);
    const s = afterSeat1DiscardsWest({ hand0: RYANMEN, dealer: 2 });
    const t = seat0Types(s);
    expect(t).not.toContain("ron");
    expect(t).toContain("pon");
  });

  it("동순 후리텐: 같은 순에 다른 론을 패스하면 다음 서 버림에 ron 없음, pon은 있음", () => {
    expect(isAgari([...T(SHANPON), WEST])).toBe(true);
    // 좌석 1이 서를 버림 -> 좌석 0이 론 가능한 상태에서 패스
    let s = afterSeat1DiscardsWest({ hand0: SHANPON, dealer: 2 });
    expect(seat0Types(s)).toContain("ron");
    expect(s.furitenTemp[0]).toBe(false);
    s = dispatch(s, { type: "pass", seat: 0 });
    expect(s.furitenTemp[0]).toBe(true);
    // 좌석 2가 다음 패(서)를 츠모해 버림: 같은 서이지만 동순 후리텐으로 ron 불가
    expect(s.turn).toBe(2);
    expect(s.drawnTile).toEqual(WEST);
    s = dispatch(s, { type: "discard", seat: 2, tile: WEST });
    expect(awaitingSeats(s)).toContain(0);
    const t = seat0Types(s);
    expect(t).not.toContain("ron");
    expect(t).toContain("pon");
  });
});
