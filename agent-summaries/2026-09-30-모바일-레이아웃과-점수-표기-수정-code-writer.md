# 모바일 레이아웃과 점수 표기 수정 (code-writer)

## 변경 파일 (packages/web/src)
- styles.css: 모바일 컴팩트 레이아웃, 버림패 min-height 축소, 멜드 줄 예약, 라벨 글자 확대
- components/Board.tsx: 내 멜드 줄(.melds-own)을 항상 렌더 (aria-label "내 멜드")
- components/SeatPanel.tsx: 상대 패널 헤더에 손패 개수 배지(.hand-count, 데스크톱은 CSS로 숨김)
- components/ResultModal.tsx: 점수 라벨 정정과 분리 표시
- controller.ts: WinSummary에 handPoints/honbaPoints/riichiPoints/basePoints 추가, splitPoints(), 로그 문구 수정
- components.test.tsx, controller.test.ts: 테스트 정정과 추가

## 결정
1. 레이아웃 (760px 이하): 상대 손패 뒷면은 숫자 배지로 대체, 중앙 정보는 한 줄로 압축하고 로그는 마지막 줄만 표시, 헤더와 여백 축소.
   420px 이하는 버림패 예약을 한 줄로 줄임. sticky bottom은 쓰지 않았고 CSS 위주로 처리.
   34px 패, 뽑은 패 분리, 7열 그리드는 그대로 유지. 데스크톱 1024/1280의 모양은 유지.
   추정 세로 합계는 390x844에서 약 750px이지만 실측은 못 했다.
2. 점수 분리는 가능. core ScoreResult에 honba/riichiSticks 필드는 없다. 대신 payment와 basePoints로 역산한다.
   기본 지불액을 다시 계산해 그 차이를 본장으로 보고, total - 지불합계를 리치봉으로 본다. core는 수정하지 않았다.
   모달은 "N판 M부 [한도] (기본점 B)"와 "화료 점수 X + 본장 Y + 리치봉 Z = 수령 합계 T점"으로 표시한다.
   값이 0인 본장/리치봉 항목은 숨기고, 다중 론도 화료자별로 같은 형식을 쓴다.
3. 내 멜드 줄은 min-height 1.4*tw로 항상 예약.
4. 버림패 min-height는 3줄에서 2줄로 줄였고, 폭이 넓은 위/아래 패널(seat-0, seat-2)은 1줄로 줄였다. 모바일 760px 이하에서는 seat-0/2도 2줄, 420px 이하에서는 전 패널 1줄.
5. 멜드 출처 라벨과 리치 표식은 0.75rem(12px)으로 키웠고, 출처 라벨은 대비도 높였다.

## 기존 테스트 정정
"총 N점" 문자열 기대값을 새 라벨 기준으로 바꿨다. 이는 의도된 변경이다. 테스트 리터럴 winSummary의 total은 5800에서 6800으로 바꿨고, 이에 맞춰 deltas와 scores도 정정했다.

## 신규 테스트
- 점수 내역(리치봉 / 본장) 렌더
- 한도와 기본점 표시
- 멜드 줄 예약과 상대 손패 배지
- 수령 합계 = 손 점수 + 본장 + 리치봉 불변식 (controller.test)

## 결과
- 루트 npm test: core 337, web 51 통과.
- npm run build: 통과.
- 브라우저 실측(뷰포트, scrollWidth, 액션바 이동)은 하지 못함. verifier가 재확인해야 한다.
