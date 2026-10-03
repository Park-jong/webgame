# 15-1 상황 역 구현 (code-writer)

대상: 일발, 더블리치, 창깡, 영상개화, 해저로월, 하저로어, 천화, 지화. `역.txt`/`server/`는 읽기만 했고 커밋/ROADMAP 수정은 하지 않았다.

## 변경 파일
- `packages/core/src/yaku.ts`: `WinContext`에 선택 플래그 8개(`isIppatsu/isDoubleRiichi/isRinshan/isChankan/isHaitei/isHoutei/isTenhou/isChiihou`), `YakuId`/`YAKU_NAMES`/`YAKU_HAN`/`YAKUMAN_COUNT` 확장. 문맥 역은 `detectContextYaku`, 천화/지화는 `yakumanCandidates`에서 처리.
- `packages/core/src/score.ts`, `bot.ts`: 주석만 갱신 (`calculateScore`는 `detectYaku`와 같은 `detectContextYaku`/`yakumanCandidates`를 쓰므로 로직 변경 없음).
- `packages/core/src/game.ts`: 상태 추적 필드, 창깡 응답 단계, `winContext` 플래그 계산.
- `packages/web/src/components/Board.tsx`: 창깡 응답 안내 문구, 버림패 강조 제외.
- 테스트: `situational.test.ts`(27), `situational-game.test.ts`(38), `packages/web/src/situational.test.tsx`(6) 신규. `game.test.ts`, `sim.test.ts`, `web/controller.test.ts` 수정.

## 설계 결정
- 판수 표현: 기존 단일 숫자 `YAKU_HAN` 유지(일발 1, 더블리치 2, 창깡/영상개화/해저로월/하저로어 1, 천화/지화 0 + 역만 1배). `{ menzen, open }` 구조는 17번 작업으로 미룸. 일발/더블리치는 `isContextConcealed`로 멘젠 전용 처리, 나머지 1판 역은 후로에서도 1판.
- 더블리치: `isDoubleRiichi`가 있으면 `riichi` 대신 `doubleRiichi`만 부여. `isRiichi` 없이 `isDoubleRiichi`만 줘도 리치 상태로 간주(일발도 `isRiichi || isDoubleRiichi` 필요).
- 창깡/하저로어는 론 전용, 영상개화/해저로월은 츠모 전용(반대 winType이면 무시). 창깡이면 하저로어 없음, 영상개화면 해저로월 없음.
- 천화/지화: 멘젠 + 츠모일 때 문맥 역만 후보. 형태 역만(스안커 등)이 있으면 합산(천화+스안커 = 2배), 없으면 단독 1배. 일반 역/도라는 기존 역만 규칙대로 무시.
- 상태 추적(모두 JSON 직렬화 가능): `GameState.ippatsu: boolean[]`(리치 타패 시 켜짐, 자기 타패/누군가의 부로·깡 시 꺼짐), `doubleRiichi: boolean[]`(`!anyCalls && 버림 0회`에 리치), `rinshanDraw: boolean`(영상패 뽑기 직후). 천화/지화는 `!anyCalls && 버림 0회` + 친/자 구분, 해저는 `liveWall.length === 0 && !rinshanDraw`, 하저는 론 시 `liveWall.length === 0`(창깡 제외)로 `winContext`에서 계산.
- 창깡 응답 단계: `PendingDiscard`에 선택 필드 `chankan?: "shouminkan" | "ankan"` 추가. 깡 선언 시 `beginChankan`이 `phase: "response"`로 전환(`discarder` = 깡 선언자, `tile` = 깡 패). 론할 수 있는 좌석(가깡은 일반 론 조건, 안깡은 국사무쌍 역만 한정)만 `awaiting`에 들어가고 합법 행동은 `[ron, pass]`. 없으면 즉시 깡 적용(기존과 동일 결과). 깡 선언자 상태는 응답 중 불변, `resolveChankan`에서 론이 있으면 깡 취소 + `finishRon`(깡 선언자가 지불, 더블론/삼가화는 기존 로직), 없으면 동순 후리텐 적용 후 `applyKan`(영상패, 깡도라, 일발 소멸은 이 시점).
- 불법 론 진단: 안깡에 국사무쌍이 아닌 론은 `IllegalActionError("illegal")`.
- 웹: `Board`가 `pending.chankan`이면 "{좌석}의 가깡/안깡 패 X에 대한 응답 (창깡)"을 표시하고 버림패 강조(`data-response-target`)를 하지 않는다. `ActionBar`/`controller`/`ResultModal`은 수정 불필요(론/패스 버튼, 정지/자동 진행, `YAKU_NAMES` 표시가 그대로 동작).

## 룰 선택 / 미구현
- 하저로어: 산패 0장일 때의 버림패 론이면 성립(영상개화로 산패가 0이 된 뒤 버림패도 포함). 인화는 미구현.
- 영상개화 시 `liveWall`이 0이 돼도 해저로월 아님. 창깡 패스 시 동순 후리텐 적용.
- 리치 후 깡은 기존대로 금지.

## 기존 테스트 정정 (정당한 사유)
- `game.test.ts`의 `build` 헬퍼: 새 규칙에서 "친의 첫 츠모 + 부로 없음"은 천화(역만)가 되므로, 헬퍼 기본값에 `anyCalls: true` 추가(첫 순 테스트인 구종구패/사풍연타 2건은 `anyCalls: false` 지정). 기대값은 그대로.
- `web/controller.test.ts`의 국사무쌍 13면 요약 테스트: 같은 이유로 픽스처에 `anyCalls: true` 추가.

## 테스트 결과
- 루트 `npm test`: core 471 passed (기존 406 + 신규 65), web 65 passed (기존 59 + 6). `npm run build` 통과.
- 시뮬레이션(봇 30게임) 역 통계: 일발 46, 더블리치 1, 해저로월 1 발생. 영상개화/창깡/천화/지화/하저로어는 봇 시뮬레이션에서는 발생하지 않음(봇이 깡을 하지 않고 희귀). 무작위 합법 행동 퍼즈에서는 창깡 응답 단계가 한 번도 선택되지 않았고, 대신 `situational-game.test.ts`에서 창깡 응답 이후 봇으로 끝까지 진행(론/패스 양쪽)하며 교착·점수 보존을 확인.
