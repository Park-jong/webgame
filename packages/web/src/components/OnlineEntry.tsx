// 온라인 대전의 입장 폼과 대기실. 컨트롤러가 가공한 값(status/roomId/mySeat)만 받는다.
import { useState } from "react";
import type { Seat } from "@mahjong/core";
import { ROOM_ID_HINT, seatLabel } from "../game/entry";

export interface EntryFormProps {
  name: string;
  onNameChange: (v: string) => void;
  urlInput: string;
  onUrlChange: (v: string) => void;
  roomInput: string;
  onRoomChange: (v: string) => void;
  /** 방 만들기/입장 버튼 활성 여부 (entryPlan 결과) */
  canCreate: boolean;
  canJoin: boolean;
  onCreate: () => void;
  onJoin: () => void;
  /** 검증 실패 메시지 (입력은 유지된다) */
  errors: { name?: string; url?: string; room?: string };
  /** P2P 멀티플레이: 서버 주소 입력을 숨기고 호스트 중심 안내를 보여 준다 */
  p2p?: boolean;
}

export function EntryForm(p: EntryFormProps) {
  return (
    <section className="entry" aria-label={p.p2p ? "P2P 입장" : "온라인 입장"}>
      <h2>{p.p2p ? "P2P 멀티플레이" : "온라인 대전"}</h2>
      {p.p2p && (
        <p className="field-help">
          방을 만든 사람(호스트)의 브라우저가 서버 역할을 합니다. 연결을 맺을 때만 외부 중계 서비스(PeerJS)를 거치고, 대국 중에는
          브라우저끼리 직접 통신합니다. 호스트가 나가면 방이 사라집니다.
        </p>
      )}
      <form
        className="entry-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (p.canCreate) p.onCreate();
        }}
      >
        <label className="field">
          <span>이름</span>
          <input
            type="text"
            value={p.name}
            autoComplete="nickname"
            aria-invalid={p.errors.name ? true : undefined}
            aria-describedby="entry-name-help"
            onChange={(e) => p.onNameChange(e.target.value)}
          />
        </label>
        <p id="entry-name-help" className="field-help">
          {p.p2p ? "1~32자. 이름은 이 브라우저에 저장됩니다." : "1~32자. 서버에는 이름만 전달되며 다른 사람에게 보이지 않습니다."}
        </p>
        {p.errors.name && (
          <p className="field-error" role="alert">
            {p.errors.name}
          </p>
        )}
        {!p.p2p && (
          <>
        <label className="field">
          <span>서버 주소</span>
          <input
            type="text"
            value={p.urlInput}
            inputMode="url"
            autoCapitalize="off"
            spellCheck={false}
            aria-invalid={p.errors.url ? true : undefined}
            aria-describedby="entry-url-help"
            onChange={(e) => p.onUrlChange(e.target.value)}
          />
        </label>
        <p id="entry-url-help" className="field-help">
          ws:// 또는 wss:// 로 시작합니다. 이름과 서버 주소는 이 브라우저에 저장됩니다.
        </p>
        {p.errors.url && (
          <p className="field-error" role="alert">
            {p.errors.url}
          </p>
        )}
          </>
        )}
        <h3>새 방 만들기</h3>
        <button type="submit" className="primary" disabled={!p.canCreate}>
          {p.p2p ? "방 만들기 (내가 호스트)" : "방 만들기"}
        </button>
      </form>

      <form
        className="entry-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (p.canJoin && p.roomInput.trim() !== "") p.onJoin();
        }}
      >
        <h3>{p.p2p ? "방 코드로 입장" : "방 ID로 입장"}</h3>
        <label className="field">
          <span>{p.p2p ? "방 코드" : "방 ID"}</span>
          <input
            type="text"
            value={p.roomInput}
            autoCapitalize="characters"
            autoComplete="off"
            spellCheck={false}
            aria-invalid={p.errors.room ? true : undefined}
            aria-describedby="entry-room-help"
            onChange={(e) => p.onRoomChange(e.target.value)}
          />
        </label>
        <p id="entry-room-help" className="field-help">
          {ROOM_ID_HINT}
        </p>
        {p.errors.room && (
          <p className="field-error" role="alert">
            {p.errors.room}
          </p>
        )}
        <button type="submit" disabled={!p.canJoin || p.roomInput.trim() === ""}>
          입장
        </button>
      </form>
    </section>
  );
}

export interface LobbyProps {
  roomId: string;
  mySeat: Seat;
  canStart: boolean;
  canLeave: boolean;
  onStart: () => void;
  onLeave: () => void;
  /** P2P 멀티플레이: 호스트 중심 안내 문구 */
  p2p?: boolean;
}

/** 대기실: 서버는 시작 전 착석 현황을 보내지 않으므로 다른 참가자 목록은 표시하지 않는다 */
export function Lobby({ roomId, mySeat, canStart, canLeave, onStart, onLeave, p2p }: LobbyProps) {
  const [copy, setCopy] = useState<"idle" | "ok" | "fail">("idle");
  const doCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(roomId);
      setCopy("ok");
    } catch {
      setCopy("fail");
    }
  };
  return (
    <section className="lobby" aria-label="대기실">
      <h2>대기실</h2>
      <p className="field-help">방 ID</p>
      <div className="room-id" data-testid="room-id">
        {roomId}
      </div>
      <div className="lobby-row">
        <button type="button" onClick={() => void doCopy()}>
          방 ID 복사
        </button>
        {copy === "ok" && <span role="status">복사했습니다</span>}
      </div>
      {copy === "fail" && (
        <div className="lobby-fallback" role="status">
          <label className="field">
            <span>복사하지 못했습니다. 아래 방 ID를 직접 선택해 복사해 주세요</span>
            <input type="text" readOnly value={roomId} autoFocus onFocus={(e) => e.currentTarget.select()} />
          </label>
        </div>
      )}
      <p>
        내 좌석: <strong data-testid="my-seat">{seatLabel(mySeat)}</strong>
      </p>
      {p2p ? (
        <ul className="lobby-notes">
          <li>시작하면 비어 있는 좌석은 봇이 채웁니다.</li>
          <li>다른 사람과 함께 하려면 방 코드를 알려 주고, 그 사람이 입장한 뒤에 시작하세요.</li>
          <li>이 방은 호스트 브라우저에서 돌아갑니다. 호스트는 모든 패를 알 수 있으니 믿을 수 있는 사람끼리 하세요.</li>
          <li>호스트가 탭을 닫거나 나가면 대국이 끝납니다. 호스트 탭은 백그라운드로 두지 않는 것이 좋습니다.</li>
        </ul>
      ) : (
        <ul className="lobby-notes">
          <li>시작하면 비어 있는 좌석은 봇이 채웁니다.</li>
          <li>다른 사람과 함께 하려면 방 ID를 알려 주고, 그 사람이 입장한 뒤에 시작하세요.</li>
          <li>시작 전에는 지금 몇 명이 앉아 있는지 이 화면에서 확인할 수 없습니다 (서버가 알려 주지 않습니다).</li>
        </ul>
      )}
      <div className="lobby-row">
        <button type="button" className="primary" disabled={!canStart} onClick={onStart}>
          시작
        </button>
        <button type="button" disabled={!canLeave} onClick={onLeave}>
          나가기
        </button>
      </div>
    </section>
  );
}

export function ModeSelect({
  onLocal,
  onOnline,
  onP2P,
  onTutorial,
}: {
  onLocal: () => void;
  onOnline: () => void;
  /** 지정하면 'P2P 멀티플레이' 버튼을 보여 준다 */
  onP2P?: () => void;
  /** 지정하면 '튜토리얼' 버튼을 보여 준다 */
  onTutorial?: () => void;
}) {
  return (
    <div className="app">
      <section className="mode-select" aria-label="모드 선택">
        <h1>리치마작</h1>
        <p className="field-help">플레이 방식을 선택해 주세요.</p>
        <ul className="lobby-notes">
          <li>혼자 연습: 서버 없이 이 브라우저에서 봇과 대국합니다.</li>
          <li>온라인 대전: 별도 게임 서버가 판정합니다 (서버 주소 필요).</li>
          {onP2P && <li>P2P 멀티플레이: 방을 만든 사람의 브라우저가 서버 역할을 하고, 외부 중계 서비스는 연결할 때만 거칩니다.</li>}
        </ul>
        <div className="mode-buttons">
          <button type="button" className="primary" onClick={onLocal}>
            혼자 연습 (로컬 봇 대전)
          </button>
          <button type="button" className="primary" onClick={onOnline}>
            온라인 대전
          </button>
          {onP2P && (
            <button type="button" className="primary" onClick={onP2P}>
              P2P 멀티플레이 (호스트 중심)
            </button>
          )}
          {onTutorial && (
            <button type="button" onClick={onTutorial}>
              튜토리얼 (마작을 처음 접한다면)
            </button>
          )}
        </div>
      </section>
    </div>
  );
}
