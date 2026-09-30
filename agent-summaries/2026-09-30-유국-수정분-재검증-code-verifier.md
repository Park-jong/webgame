# 유국 수정분 재검증 (code-verifier)

## 결과: 통과 (신규 문제 없음)

- npx vitest run: 11 파일 / 258 테스트 전부 통과 (ryuukyoku 41개 포함)
- npx tsc --noEmit: 에러 없음
- 임시 프로브 파일(src/zz_probe.test.ts) 실행 후 삭제 확인

## 프로브 결과 (isTenpaiWithMelds)
- 국사 13면: true / 12종+1장 중복(1m 또는 중 중복): true
- 요구패 13장이나 11종(1m x3 등), 10종: false
- 12종 + 비요구패(5m): false, 11종 + 비요구패 + 1m: false
- 부로(펑/안깡) + 요구패 10장 국사형: false (부로 있으면 국사 미판정)
- 장수 불일치(14장, 12장, 13장+멜드1): 예외
- resolveExhaustiveDraw: dealer NaN/4 예외, 정상 입력 및 meldsBySeat 항목 undefined(?? 처리)도 정상
- isSanchaHou: NaN/Infinity/4/-1/2.5 예외, 3=true(abort)/false(allow), 2=false

## 테스트 품질
추가 테스트는 13면, 12종+중복, 11종/비요구패 혼입 노텐, 국사 좌석 집계, 입력 검증 예외, 경계값을 실제로 검증한다. 헤더 주석(13-16행)도 구현과 일치한다.

## 참고 (경미, 조치 불필요)
- 동일 패 13장(예: 동풍x13) 같은 물리적으로 불가능한 입력은 shanten 쪽에서 true가 나옴. 패 4장 제한 검증은 이 모듈 범위 밖.
