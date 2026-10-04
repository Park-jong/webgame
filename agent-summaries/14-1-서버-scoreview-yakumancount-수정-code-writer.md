# 14-1 서버 scoreView yakumanCount 수정

- packages/server/src/view.ts: scoreView가 ScoreResult의 필수 필드 yakumanCount를 누락하던 것을 보정 (`yakumanCount: s.yakumanCount`). 다른 필드 누락은 없음.
- packages/server/src/view.test.ts: allowlist 키 목록에 `score.yakumanCount` 추가, 더블 역만(yakumanCount 2) 값 보존 테스트 1개 추가.
- 다른 변환 점검: grep 결과 ScoreResult를 재구성하는 곳은 scoreView뿐. web은 필요한 필드만 골라 쓰며 yakumanCount를 쓰지 않음.
- 검증: server typecheck 통과, server 테스트 188개 통과, core 테스트 595개 통과. 커밋 안 함.
