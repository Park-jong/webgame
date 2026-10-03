# 유국 처리 검증 (code-verifier)

## 수행
- vitest 전체 실행: 11 파일 / 241 테스트 통과 (ryuukyoku 24개 포함). tsc --noEmit: 오류 없음 (exit 0).
- ryuukyoku.ts / ryuukyoku.test.ts / index.ts export(1줄 추가) 리뷰, 임시 프로브 테스트로 경계 입력 확인 (프로브 파일은 삭제함, 코드 수정 없음).

## 발견 (심각도 순)
1. 버그(상위 의존): 국사무쌍 텐파이가 노텐으로 판정됨. 국사 13면 대기 13장(1m9m1p9p1s9s 동남서북백발중)에 대해 isTenpaiWithMelds -> false. 원인은 shanten.ts:10에서 국사 샹텐을 제외했기 때문. 황패평국에서 국사 텐파이자에게 텐파이료가 지급되지 않고 렌짱도 오판됨. ryuukyoku.ts:81 헤더 주석에도 언급 없음.
2. 입력 검증 부족: resolveExhaustiveDraw가 meldsBySeat 길이/dealer 범위를 검증하지 않음. meldsBySeat=[[]]이면 나머지 좌석이 부로 없음으로 처리됨. dealer=5이면 조용히 renchan=false. isSanchaHou(4)도 true, isSuukaikan은 5 초과도 true. 
3. 규칙 확인(문제 없음): 노텐 벌부 1/2/3명 (3000/1500/1000 수령, -1000/-1500/-3000), 0/4명 0, 친 텐파이 렌짱, 구종구패 9종+첫순+무부로+14장, 사풍연타(동일 풍패 4장, 부로 없음), 사개깡(4깡 동일인 제외, 5 이상 true), 사가리치, 삼가화 abort/allow 모두 정상.
4. 규칙 해석 차이(문서화됨): 카라텐(4장 모두 본인 보유)과 역 없음 텐파이를 텐파이로 인정 (예: 1111m 2-9m 조합 프로브 true). 일부 룰은 카라텐을 노텐 취급. 부로 텐파이는 멜드 3장 보정으로 깡(4장 멜드)도 정상, 부로 시 치토이 제외는 올바름. 풀 부로 4개 + 단기도 true.
5. 테스트 부족:
   - 국사 텐파이, 치토이 텐파이(부로 없음), 깡 멜드 손패, 치(chi) 멜드 케이스 없음.
   - resolveExhaustiveDraw의 meldsBySeat 사용 경로, 텐파이 2/3명 통합 경로 없음.
   - isSuukaikan 5회 이상 케이스, 4깡 다인 순서 케이스, isSanchaHou(4) 없음.
   - 요구패 판정에서 붉은 5 등 tileToIndex 경계, 사풍연타 4장 다른 풍/공백 배열 없음. 
   - 렌짱 테스트는 친 인덱스 0 위주 (dealer!=0 텐파이 렌짱은 isDealerRenchan 단위로만).
6. 사소: 도중유국 타이밍(사개깡/사가리치 시점, 론 우선)은 호출자 책임으로 주석에만 있음. 구종구패의 "다른 누구의 부로도 없음"은 isFirstTurn 인자에 위임. RyuukyokuOptions는 삼가화 전용인데 이름이 범용적. 코드 스타일(한글 JSDoc, 순수 함수, .js import, type import)은 기존 call.ts와 일관됨.
