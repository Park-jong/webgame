# 22-2 웹-서버 연결 마무리 검증 발견 수정 (code-writer)

커밋 없음, server/core 소스 수정 없음. 띄운 프로세스는 PID 기준으로만 종료했고 8080/5173 해제를 확인했다.

## 수정
- A (발견 2): README·ROADMAP을 정정했다. 짧은 모달에서는 390x844의 변별력이 약하고 낮은 뷰포트가 제목 가림을 잡는다고 적었다. 긴 모달에서 `--overlay-top` 유무로 제목 가림이 갈림은 22-1에서 수동 확인한 결과다. E2E 겹침 검사에 390x500 뷰포트를 추가했다(packages/web/e2e/run.mjs). 760px 이하 규칙의 `padding-top: calc(6px + var(--overlay-top...))` 변이로 E2E가 22초에 실패했고, 원복 후 sha256이 같고(2cab01e5...) 통과했다. 변이 실패의 단언 메시지는 확인하지 못했다.
- B (발견 3): E2E_BROWSER를 지정했는데 경로가 없으면 종료 코드 1과 메시지로 실패한다(`/nonexistent/x`로 확인). 환경변수가 없을 때만 자동 탐색하고, 실패하면 건너뛴다(종료 0). README를 갱신했다.
- C (발견 4): scripts/dev-all.mjs가 PORT를 trim하고 빈 값이면 8080으로 쓰며, 서버에 명시 전달한다. `PORT="  "`로 실행하면 서버 :8080과 웹 ws://localhost:8080으로 맞고 HTTP 200이었다.
- D (발견 6): ROADMAP의 seq 표기를 "seq 규약(서버가 마지막 seq를 알려 주지 않아 새로고침 복원은 저장 seq+11 추정에 의존)"으로 통일했다. E2E는 첫 회 시작 때 artifacts의 .png를 지운다(README에 기재).
- E (발견 1): build 직후 전체 web 테스트를 코어·서버 테스트와 동시 부하로 6회 돌렸더니 2회차에서 1회 재현됐다. 원인은 타임아웃이 아니었다. 메시지는 `expected 0 to be greater than or equal to 1`(integration 테스트 100행, `acked`)이었다. 행동이 10회 이상이었는데 사람이 응답 구간에서 행동한 적이 없어 서버 RNG에 따라 확률적으로 실패하는 테스트 가정 오류다. 부하·콜드 상태와는 무관하다. `acked >= 1` 필수 단언을 제거했고, 응답 구간을 거친 경우의 ack 해제·오류 없음 확인은 루프 안에 그대로 남겼다. ack 경로 자체는 useServerGame.test.tsx 단위 테스트가 다룬다. 수정 후 web 353개가 통과했다.

## 검증
- web `tsc -p tsconfig.json` 통과, `npm test -w @mahjong/web` 353개 통과.
- E2E `--repeat 1`은 3개 뷰포트 겹침이 모두 true였고 통과했다(104초). 원복 후 styles.css의 sha256이 원본과 같다.
