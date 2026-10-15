# 튜토리얼 모드 구현 (code-writer)

- App.tsx: AppMode에 "tutorial" 추가. 모드 선택 화면에서 튜토리얼 진입, 종료하면 모드 선택으로 복귀. components/OnlineEntry.tsx ModeSelect에 선택적 onTutorial prop(없으면 버튼 없음)과 튜토리얼 버튼 추가.
- packages/web/src/tutorial/: scenes.ts(장면 데이터, parseTiles), tutorialReducer.ts(순수 reducer), useTutorial.ts(useReducer 래퍼), TutorialPage.tsx, 테스트 3개(scenes/reducer/page).
- styles.css 끝에 .tutorial-* 클래스만 추가(기존 규칙 변경 없음).
- 7단계: 목표, 버리기(북), 치/펑, 텐파이(3삭 대기), 리치(9삭), 츠모, 역(리치) 요약. 장면 패는 직접 지정, core의 isAgari/calculateWaits/findDiscardCandidates/calculateScore/hasYakuForWait로 테스트 검증.
- 검증: web 테스트 376개(기존 353 + 신규 23) 통과, `npm run build -w @mahjong/web` 통과, headless Edge로 1280/390px 전 단계 클릭 확인(콘솔 오류 0, 가로 스크롤 0).

## 검증 지적 수정
- 7단계 결과 카드 yaku를 ["리치","멘젠쯔모"]로 수정(core calculateScore 결과와 일치), 말풍선을 두 역이 붙었다는 설명 + "이 장면 기준으로" 한정으로 변경. scenes.test.ts는 calculateScore 이름과 카드 표기를 비교, 론 테스트에 seatWind=동 가정 주석.
- 2단계 wrongHint를 "이번에는 북을 눌러 보세요. 홀로 떨어진 패를 버립니다."로 일반화.
- 3단계 치/펑 완료 문구에 14장 되어 한 장 버려야 함, 부로하면 멘젠이 깨져 리치 불가 안내 추가.
- 페이지 테스트: 치 결과(몸통 3장, 5통 한 쌍 잔존), 3단계 완료 전 '다음' 차단 추가.
- 접근성: 비목표 패 tabIndex=-1, 단계 변경 시 제목(h2, tabIndex=-1)으로 포커스 이동(role=status 중복 없음).
- 검증: web 테스트 378개 통과, 빌드 통과, 390px에서 3·7단계 가로 넘침 없음.
