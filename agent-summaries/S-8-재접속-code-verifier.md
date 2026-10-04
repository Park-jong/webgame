# S-8 재접속 검증 요약 (code-verifier)

- 테스트: core 337 / server 164 / web 51 통과 (exit 0). server 3회 반복 모두 164 통과, tsc 0, build 0.
- 변이 테스트 13종 중 11종 검출. 생존 2종(byConn.delete(previous) 제거, 주석만 바꾼 변이)은 동치에 가까움.
- 치명 없음. 중요 없음. 경미: (1) rejoin이 마감/타임아웃 카운터를 매번 리셋 -> 반복 재접속으로 지연(stall) 가능,
  (2) rejoin 브루트포스는 새 연결로 무제한 시도 가능(알려진 한계, 토큰 엔트로피에 의존),
  (3) byConn.delete(previous) 제거를 잡는 테스트 없음, (4) game-timeout '전원 끊김 -> 끝까지 진행' 케이스가 '3명 끊김'으로 축소,
  (5) game-ws 퍼즈 테스트 timeout 20000으로 상향(실측 약 3.6초, 의미 변화는 없음).
- 소스 파일은 변이 후 전부 원복 확인(diff 일치).
