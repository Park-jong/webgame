# 17-1 웹 SeatView 뷰 어댑터 검증 (code-verifier)

결론: 결함 없음. 소스 변경 없음(변이는 모두 cmp로 원복 확인). 임시 테스트는 삭제함.

1. 리팩터링: controller.ts diff 정독, 의미 변경 없음(13장 기준, 리치 14장 drawnTile 제외, furitenTemp, kuikae 필터, 론 화료패 제외/쯔모 포함 보존). web 전체 133개(기존 126 + 신규 7) 통과.
2. 독립 동치: 시드 1001~1024, 리치 위주/깡 위주(창깡 론 우선)/론 패스 정책, 좌석 0~3 전부. 11441 상태, 불일치 0. 커버: 텐파이 6795, 리치 중 14장 484, discardHints 1271, 쿠이가에시 551, 임시 후리텐 173, 요약 157(창깡 화료 1, 소민깡 창깡 대기 4). 안깡 창깡 대기와 유국만관은 미출현(커버리지 한계).
3. view.furiten 한계: 내 차례 14장 3918상태에서 view.furiten이 임시 플래그 없이 true인 경우 0. 어댑터는 후리텐을 calculateWaitInfo로 재계산하므로 UI 오표시 없음. 단 UI가 view.furiten을 직접 쓰면 14장 상태에서 버림패 후리텐을 놓친다(14장 힌트 표시에는 후리텐을 쓰지 않음).
4. 좌석: seatLayout(0)={top2,left3,right1}, Board 고정 배치와 동일. mySeat 1,2,3에서 right=(m+1)%4(core 하가), left=(m+3)%4(상가)로 core 순서와 일치. seatName도 일치.
5. clientActionFromView: 합법 아닌 행동(없는 타일, riichi 반전) null. 실제 서버(port 0, 사람 2 + 봇)에 변환 action 61개 전송, error 0(discard 51, chi 5, pon 2, pass 3). 한계: 비교가 use 순서에 민감해 use를 뒤집은 chi/pon은 null(7개 중 6). 서버는 순서 무관이므로 보수적 거부이며 core legalActions 순서 그대로 쓰면 문제 없음.
6. 변이: seatPosition 방향 반전(검출), clientActionFromView 합법성 검사 제거(검출), 뒷도라 무시(검출), 도라 표시패 누락(기존 테스트가 검출), discardHints 순서 reverse(생존: 양쪽이 공유 코드이고 기존 테스트도 순서를 고정하지 않음, 낮은 심각도).
