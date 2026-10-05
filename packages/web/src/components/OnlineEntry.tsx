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
}

export function EntryForm(p: EntryFormProps) {
  return (
    <section className="entry" aria-label="온라인 입장">
      <h2>온라인 대전</h2>
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
          1~32자. 서버에는 이름만 전달되며 다른 사람에게 보이지 않습니다.
        </p>
        {p.errors.name && (
          <p className="field-error" role="alert">
            {p.errors.name}
          </p>
        )}
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
        <h3>새 방 만들기</h3>
        <button type="submit" className="primary" disabled={!p.canCreate}>
          방 만들기
        </button>
      </form>

      <form
        className="entry-form"
        onSubmit={(e) => {
          e.preventDefault();
          if (p.canJoin && p.roomInput.trim() !== "") p.onJoin();
        }}
      >
        <h3>방 ID로 입장</h3>
        <label className="field">
          <span>방 ID</span>
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
}

/** 대기실: 서버는 시작 전 착석 현황을 보내지 않으므로 다른 참가자 목록은 표시하지 않는다 */
export function Lobby({ roomId, mySeat, canStart, canLeave, onStart, onLeave }: LobbyProps) {
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
      <ul className="lobby-notes">
        <li>시작하면 비어 있는 좌석은 봇이 채웁니다.</li>
        <li>다른 사람과 함께 하려면 방 ID를 알려 주고, 그 사람이 입장한 뒤에 시작하세요.</li>
        <li>시작 전에는 지금 몇 명이 앉아 있는지 이 화면에서 확인할 수 없습니다 (서버가 알려 주지 않습니다).</li>
      </ul>
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

export function ModeSelect({ onLocal, onOnline }: { onLocal: () => void; onOnline: () => void }) {
  return (
    <div className="app">
      <section className="mode-select" aria-label="모드 선택">
        <h1>리치마작</h1>
        <p className="field-help">플레이 방식을 선택해 주세요.</p>
        <div className="mode-buttons">
          <button type="button" className="primary" onClick={onLocal}>
            혼자 연습 (로컬 봇 대전)
          </button>
          <button type="button" className="primary" onClick={onOnline}>
            온라인 대전
          </button>
        </div>
      </section>
    </div>
  );
}
