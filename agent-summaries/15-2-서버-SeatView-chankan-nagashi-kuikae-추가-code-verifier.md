# 15-2 서버 SeatView chankan/nagashiMangan/kuikae 검증 (code-verifier)

결과: 문제 없음.

- 누출: view.ts는 명시 구성(스프레드 없음). kuikae는 phase==="turn" && turn===본인일 때만 노출, 그 외 []. chankan(깡 선언)·nagashiMangan(공개된 버림패로 결정)은 공개 정보. 배열은 복사(tilesView, [...]). viewFor 호출 경로는 game-session sendViewTo 하나(broadcast, 재접속 모두 경유).
- 값: core releaseIfDeadlocked가 손패 전부 금지 시 kuikae를 []로 풀어 멈춤 없음. 임시 오라클(60~80시드, 4인 사람 좌석, game-session 경유, 135k view): 불일치 0, 누출 0, 멈춤 0, kuikae 비어있지 않은 view 1612건 전부 본인 차례, 합법 타패와 겹침 0. 무작위 플레이에서는 chankan/nagashi가 0회 관측되어 단위 테스트(실제 dispatch 가깡)로만 확인됨.
- 변이 5종(turn==본인 조건 제거 2종, chankan 반전, nagashi 참조 공유, nagashi 미전달) 모두 신규 테스트가 실패, 원복 확인.
- 실행: typecheck 통과, server 테스트 13파일 202개 통과. core/web 미변경(git diff --stat 확인).
