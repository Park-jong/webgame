// 튜토리얼 화면: 실제 대국 화면(BoardView)에 장면 데이터로 만든 SeatView를 넣고,
// 일부 패/버튼만 조작 가능한 연습을 한다. 게임 상태·컨트롤러와 독립이다.
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, ReactNode } from "react";
import type { Action, CalledMeld, Seat, Tile, Wind } from "@mahjong/core";
import { BoardView } from "../components/BoardView";
import { TileView } from "../components/TileView";
import type { TenpaiView } from "../controller";
import { seatLayout } from "../model/fromView";
import type { DiscardView, PlayerView, SeatView } from "../model/seatView";
import { tileLabel } from "../tileText";
import { BASE_DISCARDS, DORA_INDICATOR, parseTiles, sceneWaits } from "./scenes";
import type { PondSeat } from "./scenes";
import type { TutorialScene } from "./scenes";
import { infoIdOf, markInfoTargets } from "./boardInfo";
import { INFO_TEXTS } from "./infoTexts";
import { firstTermSteps, glossaryEntry, splitTerms } from "./glossary";
import type { InfoId } from "./infoTexts";
import { computePopoverPosition } from "./popoverPosition";
import type { PopoverPosition } from "./popoverPosition";
import { isLastStep } from "./tutorialReducer";
import { useTutorial } from "./useTutorial";

const MY_SEAT: Seat = 0;
const SEAT_WINDS: readonly Wind[] = ["east", "south", "west", "north"];
const NO_LOG: readonly string[] = [];
const noop = (): void => {};

export interface TutorialPageProps {
  /** 튜토리얼에서 나가기 (모드 선택으로 복귀) */
  onExit: () => void;
  /** 테스트용: 장면 데이터 교체 */
  scenes?: readonly TutorialScene[];
}

interface PracticeTileProps {
  tile: Tile;
  index: number;
  target: boolean;
  /** 연습 중이면 true (누를 수 있음), 끝났으면 정적 표시 */
  active: boolean;
  onPress: (index: number) => void;
}

/** 조작 가능한 패. 목표가 아닌 패는 aria-disabled로 흐리게 하고, 눌러도 안내만 보여 준다. */
function PracticeTile({ tile, index, target, active, onPress }: PracticeTileProps) {
  if (!active) return <TileView tile={tile} size="lg" />;
  return (
    <button
      type="button"
      className={`tutorial-tilebtn${target ? " is-target" : " is-off"}`}
      aria-label={tileLabel(tile)}
      aria-disabled={!target}
      tabIndex={target ? 0 : -1}
      onClick={() => onPress(index)}
    >
      <TileView tile={tile} size="lg" highlight={target} />
    </button>
  );
}

export function TutorialPage({ onExit, scenes }: TutorialPageProps) {
  const { state, dispatch, scene, scenes: all } = useTutorial(scenes);
  const titleRef = useRef<HTMLHeadingElement>(null);
  const firstRender = useRef(true);
  // 단계가 바뀌면 제목으로 포커스를 옮겨 스크린 리더가 새 단계를 읽게 한다(첫 진입은 제외)
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    titleRef.current?.focus();
  }, [state.step]);
  // 화면 설명: 연습 상태와 무관한 표시 전용 상태. 누른 요소 옆에 팝오버 하나만 뜬다.
  const [info, setInfo] = useState<{ id: string; el: HTMLElement } | null>(null);
  const [pos, setPos] = useState<PopoverPosition | null>(null);
  const boardRef = useRef<HTMLDivElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const infoElRef = useRef<HTMLElement | null>(null);
  infoElRef.current = info?.el ?? null;
  // 키보드로 연 경우에만 닫을 때 원래 요소로 포커스를 돌려 준다
  const restoreFocus = useRef(false);
  const closeInfo = (): void => {
    const el = infoElRef.current;
    if (restoreFocus.current && el?.isConnected) el.focus();
    restoreFocus.current = false;
    setInfo(null);
  };
  const closeRef = useRef(closeInfo);
  closeRef.current = closeInfo;
  // 보드가 다시 그려질 때마다 설명 대상에 접근성 속성을 붙인다
  useEffect(() => {
    const board = boardRef.current;
    if (!board) return;
    markInfoTargets(board);
    board.querySelectorAll("[aria-controls='tutorial-popover']").forEach((el) => {
      el.removeAttribute("aria-controls");
      el.removeAttribute("aria-expanded");
    });
    if (info?.el.isConnected) {
      info.el.setAttribute("aria-expanded", "true");
      info.el.setAttribute("aria-controls", "tutorial-popover");
    }
  });
  useEffect(() => setInfo(null), [state.step]);
  useEffect(() => {
    const onClick = (e: MouseEvent): void => {
      const t = e.target as Node;
      if (popRef.current?.contains(t)) return;
      const termEl = (e.target as Element).closest?.<HTMLElement>("[data-term]");
      if (termEl) {
        if (infoElRef.current === termEl) setInfo(null);
        else setInfo({ id: `term:${termEl.dataset.term}`, el: termEl });
        return;
      }
      const inBoard = boardRef.current?.contains(t) === true;
      const id = inBoard ? infoIdOf(e.target) : null;
      if (id) {
        const el = (e.target as Element).closest<HTMLElement>("[data-info]")!;
        if (infoElRef.current === el) setInfo(null);
        else setInfo({ id, el });
      } else setInfo(null);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        if (infoElRef.current) closeRef.current();
        return;
      }
      if (e.key !== "Enter" && e.key !== " ") return;
      const t = e.target as HTMLElement | null;
      if (!t || !boardRef.current?.contains(t) || t.getAttribute("role") !== "button" || !t.hasAttribute("data-info")) return;
      e.preventDefault();
      const id = infoIdOf(t);
      if (!id) return;
      if (infoElRef.current === t) setInfo(null);
      else setInfo({ id, el: t });
    };
    document.addEventListener("click", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("click", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, []);
  // 위치 계산: 열릴 때와 스크롤/리사이즈 때 다시 계산한다. 요소가 사라지면 닫는다.
  useLayoutEffect(() => {
    if (!info) {
      setPos(null);
      return;
    }
    const place = (): void => {
      const pop = popRef.current;
      if (!info.el.isConnected) {
        setInfo(null);
        return;
      }
      if (!pop) return;
      setPos(
        computePopoverPosition(
          info.el.getBoundingClientRect(),
          { width: document.documentElement.clientWidth, height: window.innerHeight },
          { width: pop.offsetWidth, height: pop.offsetHeight },
        ),
      );
    };
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [info]);
  // 키보드로 열었으면 팝오버의 닫기 버튼으로 포커스 이동
  useEffect(() => {
    if (!info) return;
    const fromKeyboard = document.activeElement === info.el;
    restoreFocus.current = fromKeyboard;
    if (fromKeyboard) popRef.current?.querySelector<HTMLElement>("button")?.focus();
  }, [info]);
  const infoText = info
    ? info.id.startsWith("term:")
      ? (glossaryEntry(info.id.slice(5)) ?? null)
      : INFO_TEXTS[info.id as InfoId]
    : null;
  // 용어 주석: 사전에 정해진 첫 등장 단계에서만, 화면 순서상 처음 나오는 곳 한 번만 붙인다
  const termSteps = useMemo(() => firstTermSteps(all), [all]);
  const termSeen = new Set<string>();
  const annotate = (text: string): ReactNode =>
    splitTerms(text, (id) => {
      if (termSteps.get(id) !== state.step || termSeen.has(id)) return false;
      termSeen.add(id);
      return true;
    }).map((part, i) =>
      typeof part === "string" ? (
        part
      ) : (
        <button
          key={i}
          type="button"
          className="tutorial-term"
          data-term={part.termId}
          aria-label={`'${part.label}' 뜻 보기`}
          aria-expanded={info?.id === `term:${part.termId}`}
          aria-controls={info?.id === `term:${part.termId}` ? "tutorial-popover" : undefined}
        >
          {part.label}
        </button>
      ),
    );
  const done = state.cleared[state.step] === true;
  const goal = scene.goal;
  const last = isLastStep(state, all);
  const choice = state.choice !== null ? scene.callResults?.[state.choice] : undefined;

  // 연습을 마친 뒤의 손패: 치/퐁 결과, 장면의 doneHand, 아니면 그대로
  let hand = scene.hand;
  let drawn = scene.drawn;
  let meld: Tile[] | null = null;
  if (done && choice) {
    hand = choice.hand;
    drawn = null;
    meld = choice.meld;
  } else if (done && scene.doneHand) {
    hand = scene.doneHand;
    drawn = scene.doneDrawn ?? null;
  }

  const waitsVisible = scene.waitsHand !== undefined && (scene.waitsMode !== "afterDone" || done);
  const waits = sceneWaits(scene);
  const targetIndex = goal.type === "tile" || goal.type === "riichi" ? goal.index : -1;
  const active = !done && goal.type !== "none";
  const press = (index: number): void => dispatch({ type: "tile", index });

  const doneText = done ? (choice ? choice.text : scene.doneText) : "";
  const statusText = state.hint ?? doneText;
  const riichiOn = state.riichiMode || (done && goal.type === "riichi");

  const renderTiles = (tiles: readonly Tile[], offset: number) =>
    tiles.map((tile, i) => (
      <PracticeTile
        key={`${offset + i}`}
        tile={tile}
        index={offset + i}
        target={offset + i === targetIndex}
        active={active}
        onPress={press}
      />
    ));

  let groupedHand: ReactNode;
  const grouped = scene.groups !== undefined && scene.groups.reduce((a, b) => a + b, 0) === hand.length;
  if (scene.groups && grouped) {
    let at = 0;
    groupedHand = scene.groups.map((n, gi) => {
      const slice = hand.slice(at, at + n);
      const node = (
        <div key={gi} className="tutorial-group">
          {renderTiles(slice, at)}
        </div>
      );
      at += n;
      return node;
    });
  } else {
    groupedHand = renderTiles(hand, 0);
  }

  // --- 실제 대국 화면(BoardView)에 넣을 SeatView 구성. 상대 손패는 만들지 않는다 ---
  const left = seatLayout(MY_SEAT).left;
  const opponentDiscard = scene.opponentDiscard;
  const meldView: CalledMeld[] =
    meld && opponentDiscard && state.choice !== null
      ? [
          state.choice === "chi"
            ? { type: "chi", tiles: [meld[0]!, meld[1]!, meld[2]!], calledTile: opponentDiscard, fromSeat: left, from: "left" }
            : { type: "pon", tiles: [meld[0]!, meld[1]!, meld[2]!], calledTile: opponentDiscard, fromSeat: left, from: "left" },
        ]
      : [];
  // 연습으로 버린 패는 내 버림패 영역에 표시 (리치 선언패는 가로로 눕는다)
  const discardedTile =
    done && (goal.type === "tile" || goal.type === "riichi")
      ? goal.index === scene.hand.length
        ? scene.drawn
        : (scene.hand[goal.index] ?? null)
      : null;
  const baseDiscards = (pos: PondSeat): DiscardView[] =>
    BASE_DISCARDS[pos].map((d) => ({ tile: d.tile, riichi: false, tsumogiri: d.tsumogiri, calledBy: null }));
  // 기본 버림패 4장 뒤에 방금 버린 패가 이어진다. 6단계 이후는 5단계에서 리치 선언한 9삭이 마지막에 남아 있다.
  const myDiscards: DiscardView[] = baseDiscards("self");
  if (discardedTile) {
    myDiscards.push({
      tile: discardedTile,
      riichi: goal.type === "riichi",
      tsumogiri: (goal.type === "tile" || goal.type === "riichi") && goal.index === scene.hand.length,
      calledBy: null,
    });
  } else if (scene.riichi) {
    myDiscards.push({ tile: parseTiles("9s")[0]!, riichi: true, tsumogiri: true, calledBy: null });
  }
  // 3단계: 상가의 기본 버림패 4장 위에 방금 버린 5통이 5번째로 놓인다. 치/퐁을 하면 내 후로로 옮겨 간다
  const seatPos = (seat: Seat): PondSeat =>
    seat === MY_SEAT ? "self" : seat === left ? "left" : seat === seatLayout(MY_SEAT).right ? "right" : "across";
  const pendingCall = opponentDiscard !== undefined && !done;
  const players: PlayerView[] = ([0, 1, 2, 3] as const).map((seat) => ({
    seat,
    seatWind: SEAT_WINDS[seat]!,
    score: 25000,
    riichi: seat === MY_SEAT && (scene.riichi === true || (done && goal.type === "riichi")),
    // 상대는 뒷면 13장 줄만 보인다 (실제 패 값은 없다)
    handCount: 13,
    melds: seat === MY_SEAT ? meldView : [],
    discards:
      seat === MY_SEAT
        ? myDiscards
        : seat === left && pendingCall
          ? [...baseDiscards("left"), { tile: opponentDiscard, riichi: false, tsumogiri: false, calledBy: null }]
          : baseDiscards(seatPos(seat)),
  }));
  const view: SeatView = {
    seat: MY_SEAT,
    phase: pendingCall ? "response" : "turn",
    turn: pendingCall ? left : MY_SEAT,
    dealer: MY_SEAT,
    roundWind: "east",
    kyoku: 1,
    honba: 0,
    riichiSticks: 0,
    doraIndicators: [DORA_INDICATOR],
    liveWallCount: 70,
    players,
    hand: drawn ? [...hand, drawn] : [...hand],
    drawnTile: drawn,
    furiten: false,
    kuikae: [],
    legalActions: [],
    awaitingYou: true,
    pending: pendingCall ? { discarder: left, tile: opponentDiscard } : null,
    result: null,
  };
  // BoardView는 행동이 하나 이상 있어야 응답 대상 버림패를 강조한다 (실제 버튼은 actionSlot이 그린다)
  const boardActions: readonly Action[] = pendingCall ? [{ type: "pass", seat: MY_SEAT }] : [];
  const tenpaiView: TenpaiView | null = waitsVisible
    ? { tenpai: waits.length > 0, waits, furiten: false, discardHints: [] }
    : null;

  const handSlot = (
    <div className="hand" aria-label="내 손패">
      <div className={`hand-tiles${grouped ? " tutorial-hand-grouped" : ""}`}>{groupedHand}</div>
      {drawn && (
        <div className="hand-drawn" aria-label="뽑은 패">
          <PracticeTile
            tile={drawn}
            index={hand.length}
            target={hand.length === targetIndex}
            active={active}
            onPress={press}
          />
        </div>
      )}
    </div>
  );

  const actionSlot = (
    <div className="action-bar tutorial-actions" role="group" aria-label="행동">
      {goal.type === "call" && (
        <>
          <button
            type="button"
            className="action-btn tutorial-target"
            disabled={done}
            onClick={() => dispatch({ type: "call", call: "chi" })}
          >
            치
          </button>
          <button
            type="button"
            className="action-btn tutorial-target"
            disabled={done}
            onClick={() => dispatch({ type: "call", call: "pon" })}
          >
            퐁
          </button>
          <button
            type="button"
            className="action-btn"
            disabled={done}
            onClick={() => dispatch({ type: "call", call: "pass" })}
          >
            패스
          </button>
        </>
      )}
      {goal.type === "reveal" && (
        <button
          type="button"
          className="action-btn tutorial-target"
          disabled={done}
          onClick={() => dispatch({ type: "reveal" })}
        >
          대기패 보기
        </button>
      )}
      {goal.type === "riichi" && (
        <button
          type="button"
          className={`action-btn${riichiOn ? " action-btn-active" : " tutorial-target"}`}
          disabled={done}
          aria-pressed={riichiOn}
          onClick={() => dispatch({ type: "toggleRiichi" })}
        >
          {riichiOn && !done ? "리치 취소" : "리치"}
        </button>
      )}
      {goal.type === "tsumo" && (
        <button
          type="button"
          className="action-btn action-btn-win tutorial-target"
          disabled={done}
          onClick={() => dispatch({ type: "tsumo" })}
        >
          쯔모
        </button>
      )}
    </div>
  );

  return (
    <div className="app tutorial">
      <header className="app-header">
        <h1>튜토리얼</h1>
        <span className="seed-shown" data-testid="tutorial-progress">
          {state.step + 1} / {all.length} 단계
        </span>
        <button type="button" onClick={onExit}>
          튜토리얼 종료
        </button>
      </header>

      <section className="tutorial-panel" aria-label={`튜토리얼 ${scene.title}`}>
        <h2 className="tutorial-title" ref={titleRef} tabIndex={-1}>
          {scene.title}
        </h2>
        <div className="tutorial-bubble" data-testid="tutorial-bubble">
          {scene.bubble.map((line, i) => (
            <p key={i}>{annotate(line)}</p>
          ))}
        </div>
        <p className="tutorial-info-hint" data-testid="tutorial-hint">
          도라 표시패, 점수, 버림패 같은 화면의 각 부분을 눌러 보면 설명이 나옵니다.
        </p>

        {scene.kinds && (
          <div className="tutorial-kinds" aria-label="패의 종류">
            {scene.kinds.map((k) => (
              <div key={k.label} className="tutorial-kind">
                <span className="tutorial-kind-label">{k.label}</span>
                <span className="tutorial-kind-tiles">
                  {k.tiles.map((tile, i) => (
                    <TileView key={i} tile={tile} size="md" />
                  ))}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      {infoText && (
        <div
          id="tutorial-popover"
          ref={popRef}
          className={`tutorial-popover${pos ? ` is-${pos.placement}` : ""}`}
          role="dialog"
          aria-labelledby="tutorial-popover-title"
          data-testid="tutorial-popover"
          style={
            pos
              ? ({ left: pos.left, top: pos.top, "--arrow-left": `${pos.arrowLeft}px` } as CSSProperties)
              : { left: 0, top: 0, visibility: "hidden" }
          }
        >
          <strong id="tutorial-popover-title">{infoText.title}</strong>
          <span>{infoText.text}</span>
          <button type="button" className="tutorial-info-close" onClick={closeInfo}>
            닫기
          </button>
        </div>
      )}

      <div className="tutorial-board" ref={boardRef}>
      <BoardView
        view={view}
        actions={boardActions}
        riichiMode={false}
        onToggleRiichi={noop}
        onAction={noop}
        log={NO_LOG}
        handSlot={handSlot}
        actionSlot={actionSlot}
        tenpai={tenpaiView}
      />
      </div>

      <section className="tutorial-foot" aria-label="안내">
        {scene.caption && <p className="tutorial-caption">{annotate(scene.caption)}</p>}
        {scene.resultCard && (
          <div className="tutorial-card" role="group" aria-label="화료 결과">
            <h3>화료 결과</h3>
            <p>
              역: <strong>{scene.resultCard.yaku.join(", ")}</strong>
            </p>
          </div>
        )}
        <p
          className={`tutorial-status${state.hint ? " tutorial-status-wrong" : done && doneText ? " tutorial-status-done" : ""}`}
          role="status"
        >
          {state.hint ? statusText : annotate(statusText)}
        </p>
      </section>

      <nav className="tutorial-nav" aria-label="단계 이동">
        <button type="button" onClick={() => dispatch({ type: "prev" })} disabled={state.step === 0}>
          이전
        </button>
        {last ? (
          <button type="button" className="primary" onClick={onExit}>
            마치고 처음으로
          </button>
        ) : (
          <button
            type="button"
            className={done ? "primary" : undefined}
            aria-disabled={!done}
            onClick={() => dispatch({ type: "next" })}
          >
            다음
          </button>
        )}
      </nav>
    </div>
  );
}
