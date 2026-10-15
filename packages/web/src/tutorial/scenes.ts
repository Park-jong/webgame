// 튜토리얼 전용 장면 데이터. 시드 탐색 없이 패를 직접 지정하며, 올바른지는 scenes.test.ts가 core 함수로 검증한다.
// 기존 로컬/온라인 게임 상태와 완전히 분리되어 있다.
import { calculateWaits } from "@mahjong/core";
import type { Tile, WaitTile } from "@mahjong/core";

const WINDS = ["east", "south", "west", "north"] as const;
const DRAGONS = ["white", "green", "red"] as const;

/** "123m 456p 789s 11z" 형태의 문자열을 패 배열로 바꾼다 (z: 1~4 동남서북, 5~7 백발중). 적5는 쓰지 않는다. */
export function parseTiles(text: string): Tile[] {
  const tiles: Tile[] = [];
  let digits = "";
  for (const ch of text.replace(/\s+/g, "")) {
    if (ch >= "0" && ch <= "9") {
      digits += ch;
      continue;
    }
    for (const d of digits) {
      const n = Number(d);
      if (ch === "z") {
        if (n >= 1 && n <= 4) tiles.push({ kind: "wind", wind: WINDS[n - 1]! });
        else if (n >= 5 && n <= 7) tiles.push({ kind: "dragon", dragon: DRAGONS[n - 5]! });
        else throw new Error(`잘못된 자패 번호: ${d}`);
      } else if (ch === "m" || ch === "p" || ch === "s") {
        if (n < 1) throw new Error(`잘못된 숫자: ${d}`);
        const suit = ch === "m" ? "man" : ch === "p" ? "pin" : "sou";
        tiles.push({ kind: "number", suit, rank: n as 1, isRedFive: false });
      } else {
        throw new Error(`알 수 없는 표기: ${ch}`);
      }
    }
    digits = "";
  }
  if (digits !== "") throw new Error("종류 표기(m/p/s/z)가 빠졌습니다");
  return tiles;
}

export type CallKind = "chi" | "pon";

/** 단계별 연습 목표. 패는 손패 배열 위치(뽑은 패는 hand.length)로 지정한다. */
export type TutorialGoal =
  | { type: "none" }
  | { type: "tile"; index: number }
  | { type: "riichi"; index: number }
  | { type: "call"; calls: readonly CallKind[] }
  | { type: "reveal" }
  | { type: "tsumo" };

export interface CallResult {
  /** 가져온 뒤 남은 손패 */
  hand: Tile[];
  /** 만든 몸통 (가져온 패 포함) */
  meld: Tile[];
  text: string;
}

export interface TutorialScene {
  id: string;
  title: string;
  /** 말풍선 문구 (문단 단위) */
  bubble: string[];
  /** 손패 (뽑은 패 제외) */
  hand: Tile[];
  /** 방금 뽑은 패 */
  drawn: Tile | null;
  /** 손패를 몸통/머리 묶음으로 나눠 보여 줄 장수 목록 (합이 hand 길이와 같아야 함) */
  groups?: number[];
  /** 패 종류 소개 줄 (1단계) */
  kinds?: { label: string; tiles: Tile[] }[];
  /** 손패 아래 설명 한 줄 */
  caption?: string;
  /** 왼쪽 사람(상가)이 방금 버린 패. 기본 버림패 4장 뒤에 5번째로 놓인다 */
  opponentDiscard?: Tile;
  /** 내가 이미 리치한 상태로 보드에 리치 표시를 한다 (리치 선언 연습은 달성 후에 표시) */
  riichi?: boolean;
  goal: TutorialGoal;
  /** 목표와 다른 것을 눌렀을 때의 짧은 안내 */
  wrongHint: string;
  /** 목표 달성 후 안내 */
  doneText: string;
  /** 달성 후 손패 (지정하지 않으면 그대로) */
  doneHand?: Tile[];
  /** 달성 후 뽑은 패 (doneHand를 지정하면 없음으로 본다) */
  doneDrawn?: Tile | null;
  /** 치/퐁 결과 */
  callResults?: Record<CallKind, CallResult>;
  /** 대기패 표시 시점: afterDone은 목표 달성 후 */
  waitsMode?: "afterDone";
  /** 대기패 계산에 쓸 13장 */
  waitsHand?: Tile[];
  /** 결과 카드 (7단계) */
  resultCard?: { yaku: string[] };
}

const t = parseTiles;

/** 장면과 무관한 도라 표시패: 임의 1장 */
export const DORA_INDICATOR: Tile = parseTiles("6p")[0]!;

/** 보드 좌석 위치 (내 기준) */
export type PondSeat = "self" | "right" | "across" | "left";

export interface PondTile {
  tile: Tile;
  /** 뽑은 패를 그대로 버렸으면 true (쯔모기리), 손패에서 골라 버렸으면 false (테다시) */
  tsumogiri: boolean;
}

/** "9m 2z*" 형태: 별표(*)가 붙은 패는 쯔모기리 */
function pond(text: string): PondTile[] {
  return text
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ({ tile: parseTiles(w.replace("*", ""))[0]!, tsumogiri: w.endsWith("*") }));
}

/**
 * 모든 장면에서 보이는 좌석별 기본 버림패(4장씩, 버린 순서). 쯔모기리와 테다시가 섞여 있다.
 * 내 버림패에는 4단계 이후의 대기패(3삭)를 넣지 않는다 (후리텐이 되지 않게).
 */
export const BASE_DISCARDS: Record<PondSeat, readonly PondTile[]> = {
  self: pond("9m 2z* 7z 1p"),
  right: pond("9s 7z 1p* 9m"),
  across: pond("5z* 1m 8p 2z"),
  left: pond("1s 3z* 9p 6z"),
};

/** 4단계 이후 공통: 텐파이 손패 13장 (3삭 한 장 대기) */
export const TENPAI_HAND = "123m 456m 789p 24s 44z";

export const TUTORIAL_SCENES: readonly TutorialScene[] = [
  {
    id: "goal",
    title: "1. 목표: 14장을 완성하기",
    bubble: [
      "마작은 패 14장을 '몸통 4개 + 머리 1개'로 만드는 게임입니다.",
      "몸통은 같은 패 3장, 또는 같은 종류의 연속된 숫자 3장입니다. 머리는 같은 패 2장입니다.",
    ],
    kinds: [
      { label: "만수", tiles: t("159m") },
      { label: "통수", tiles: t("159p") },
      { label: "삭수", tiles: t("159s") },
      { label: "자패", tiles: t("1234567z") },
    ],
    hand: t("123m 456m 777p 234s 11z"),
    drawn: null,
    groups: [3, 3, 3, 3, 2],
    caption: "완성 예시: 1-2-3만(연속) · 4-5-6만(연속) · 7통 3장(같은 패) · 2-3-4삭(연속) · 머리는 동 2장",
    goal: { type: "none" },
    wrongHint: "",
    doneText: "",
  },
  {
    id: "discard",
    title: "2. 패 버리기",
    bubble: [
      "내 차례에는 패를 한 장 뽑고, 필요 없는 패를 한 장 버립니다.",
      "다른 패와 어울리지 않는 '북'(오른쪽에 따로 뽑은 패)을 눌러 버려 보세요.",
      "버린 패는 각자 앞의 버림패에 놓입니다. 어두운 패는 뽑자마자 버린 쯔모기리, 밝은 패는 손패에서 골라 버린 테다시예요.",
    ],
    hand: t("123m 456m 789p 234s 5s"),
    drawn: t("4z")[0]!,
    goal: { type: "tile", index: 13 },
    wrongHint: "이번에는 북을 눌러 보세요. 홀로 떨어진 패를 버립니다.",
    doneText: "잘했어요! 쓸모없는 패를 버려 손패를 정리했습니다.",
    doneHand: t("123m 456m 789p 234s 5s"),
  },
  {
    id: "call",
    title: "3. 몸통 만들기: 치와 퐁",
    bubble: [
      "다른 사람이 버린 패를 가져와 몸통을 만들 수 있습니다.",
      "치: 왼쪽 사람이 버린 패로 연속된 숫자 3장을 만듭니다. 퐁: 같은 패 3장을 만듭니다.",
      "왼쪽 사람이 5통을 버렸습니다. 치 또는 퐁 버튼을 눌러 보세요.",
    ],
    hand: t("123m 4556p 234s 789s"),
    drawn: null,
    opponentDiscard: t("5p")[0]!,
    goal: { type: "call", calls: ["chi", "pon"] },
    wrongHint: "패스하면 가져오지 않습니다. 이번에는 치 또는 퐁을 눌러 보세요.",
    doneText: "",
    callResults: {
      chi: {
        hand: t("123m 55p 234s 789s"),
        meld: t("456p"),
        text: "치! 4-5-6통 몸통을 만들었습니다. 가져온 몸통은 공개됩니다. 후로하면 패가 14장이 되니 한 장을 버려야 합니다. 또 후로하면 멘젠이 깨져 리치를 할 수 없습니다.",
      },
      pon: {
        hand: t("123m 46p 234s 789s"),
        meld: t("555p"),
        text: "퐁! 5통 3장 몸통을 만들었습니다. 가져온 몸통은 공개됩니다. 후로하면 패가 14장이 되니 한 장을 버려야 합니다. 또 후로하면 멘젠이 깨져 리치를 할 수 없습니다.",
      },
    },
  },
  {
    id: "tenpai",
    title: "4. 텐파이와 대기패",
    bubble: [
      "손패 13장이 '딱 한 장만 더 있으면 완성'인 상태를 텐파이라고 합니다.",
      "몸통 3개와 머리(북 2장)는 이미 있고, 2삭-4삭 사이의 3삭만 오면 몸통이 완성됩니다.",
      "'대기패 보기'를 눌러 확인해 보세요.",
    ],
    hand: t(TENPAI_HAND),
    drawn: null,
    goal: { type: "reveal" },
    wrongHint: "이 단계에서는 패를 버리지 않습니다. '대기패 보기'를 눌러 주세요.",
    doneText: "텐파이! 3삭이 오면 완성됩니다. 이렇게 기다리는 패를 대기패라고 합니다.",
    waitsMode: "afterDone",
    waitsHand: t(TENPAI_HAND),
  },
  {
    id: "riichi",
    title: "5. 리치",
    bubble: [
      "텐파이일 때 '리치'를 선언하면, 이후 손패를 바꾸지 않는 대신 '리치'라는 역이 생깁니다.",
      "먼저 리치 버튼을 누르고, 반짝이는 9삭을 버려 선언해 보세요.",
    ],
    hand: t(TENPAI_HAND),
    drawn: t("9s")[0]!,
    goal: { type: "riichi", index: 13 },
    wrongHint: "그 패를 버리면 텐파이가 깨져요. 반짝이는 9삭을 눌러 주세요.",
    doneText: "리치 선언! 이제 손패는 바꿀 수 없고, 3삭을 기다립니다.",
    doneHand: t(TENPAI_HAND),
    doneDrawn: null,
    waitsMode: "afterDone",
    waitsHand: t(TENPAI_HAND),
  },
  {
    id: "win",
    title: "6. 화료: 쯔모와 론",
    bubble: [
      "대기패 3삭을 뽑았습니다! 스스로 뽑아 완성하는 것을 '쯔모', 남이 버린 패로 완성하는 것을 '론'이라고 합니다.",
      "쯔모 버튼을 눌러 화료해 보세요.",
    ],
    hand: t(TENPAI_HAND),
    drawn: t("3s")[0]!,
    riichi: true,
    goal: { type: "tsumo" },
    wrongHint: "이미 완성된 손패입니다. 쯔모 버튼을 눌러 주세요.",
    doneText: "화료! 몸통 4개와 머리 1개로 14장이 완성되었습니다.",
    doneHand: t("123m 456m 789p 234s 44z"),
    doneDrawn: null,
  },
  {
    id: "yaku",
    title: "7. 역과 점수",
    bubble: [
      "이 장면에서는 '리치'와 '멘젠쯔모' 두 역이 붙었습니다. 역이 하나라도 있어야 화료할 수 있습니다.",
      "이 장면 기준으로, 리치 없이 이 손패로 론하면 역이 없어 화료할 수 없습니다.",
      "역이 많고 몸통이 좋을수록 점수가 높아집니다. 자세한 계산은 대국을 하며 익혀 보세요.",
    ],
    hand: t("123m 456m 789p 234s 44z"),
    drawn: null,
    groups: [3, 3, 3, 3, 2],
    riichi: true,
    goal: { type: "none" },
    wrongHint: "",
    doneText: "",
    resultCard: { yaku: ["리치", "멘젠쯔모"] },
  },
];

/** 장면의 대기패(표시용). waitsHand가 없으면 빈 배열 */
export function sceneWaits(scene: TutorialScene): WaitTile[] {
  return scene.waitsHand ? calculateWaits(scene.waitsHand) : [];
}
