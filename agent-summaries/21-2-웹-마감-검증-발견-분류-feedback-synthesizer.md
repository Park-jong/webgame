# 21-2 웹 마감(결과·종료 UI) 검증 발견 분류 (feedback-synthesizer)

> feedback-synthesizer에는 Write 도구가 없어 메인 세션이 보고 내용을 저장했다.
> 종합 에이전트는 21-1 code-writer/code-verifier 요약 문서를 읽지 않고 코드·테스트만 읽고 판단했다.

## 요약
검증 발견 5건과 통합 테스트 간헐 실패 1건을 분류했다.
- 이 단계에서 고칠 것: M3 회귀 테스트(중), M5 테스트 보강(저), 통합 테스트 안정화(중)
- 다음 단계(마무리 4번)로 넘길 것: 재접속 배너가 결과 모달 제목을 가림(저), 새로고침 후 카운트다운 오차(저, 한계로 문서화)
- 고치지 않을 것: gameEnd 화면의 나가기 전용 구성(설계대로)

## 수정 지시
1. `deadlineUx.test.tsx`: resultDismissed 순환 테스트 추가 — 결과 열림 → 닫기 → result null 새 국 view → 다음 roundEnd에서 다시 열림, 같은 국 재수신은 닫힘 유지. 변이: `useServerGame.ts:288`을 `prev.resultDismissed`로 바꾸면 실패해야 함.
2. `deadlineUx.test.tsx:405` 부근: ack 전에도 '처리 중…'이 정확히 보이는지, ack 전에는 중립 문구('응답이 접수되었습니다' 등)가 없는지 단언. 변이: `messages.ts:223` sending 문구를 '다른 플레이어 확인 중…'으로 바꾸면 실패해야 함.
3. `useServerGame.integration.test.tsx` 안정화: 실패 시 status/conn/error/view.phase를 진단 메시지에 포함, waitFor 타임아웃 8000→20000·15000→30000, 69~70행 단언을 waitFor 안으로, 76행 waitingAck 즉시 단언을 waitFor로 감싸거나 제거. 20회 반복과 전체 병렬 5회 이상으로 확인. 원인 후보(미확인): 즉시 단언 타이밍, stale view 읽기, 병렬 부하 타임아웃.

## 이월
- 재접속 배너와 결과 모달 겹침(390x844, 768x500): 마무리 4번 E2E 스크린샷으로 확인 후 필요하면 `.status-stack` 높이를 CSS 변수로 전달해 modal-backdrop 상단 패딩 완화.
- 새로고침 후 카운트다운이 실제보다 최대 약 5초 길게 표시될 수 있음: 서버가 시각을 제공하지 않는 한계로 문서화. sessionStorage 보정은 비용 대비 효과가 낮아 비권장.

## 패턴·재발 위험
- 상태 플래그 경로를 단일 시점만 검사하는 테스트가 변이에서 생존
- 실서버 + 실시간 + RNG 통합 테스트의 간헐 실패 재발
- z-index 계층(헤더 40 / 모달 60 / 배너 70) 문서화 필요
- NEXT_ROUND_ESTIMATE_MS와 서버 값의 일치 근거 기록 필요
