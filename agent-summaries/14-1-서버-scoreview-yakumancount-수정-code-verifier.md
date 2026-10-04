# 14-1 서버 scoreView yakumanCount 수정 검증 (code-verifier)

- ScoreResult 12개 필드(kind, yaku, yakuHan, dora, han, fu, basePoints, limit, yakumanCount, isDealer, payment, total)가 모두 scoreView에 존재.
- 변이: yakumanCount 줄 제거 시 신규 테스트 포함 3개 실패 확인, 원복 후 git diff로 +1줄 복원 확인.
- typecheck(server) 통과, server 188 / core 595 / web 90 테스트 통과.
- 비공개 정보 누출 없음: yakumanCount는 점수 결과의 공개 숫자이며 좌석별 분기 없음. 허용 경로 목록(ALLOWED_PATHS)에도 추가됨.
