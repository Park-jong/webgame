# 웹 UI(packages/web) 검증 - code-verifier

## 수행
- 루트 npm test (core 337 + web 36 통과, 약 45초), npm run build (약 4.6초, core tsc -> web tsc + vite build 성공), web 단독 test/build 성공.
- git status/.gitignore 점검: dist, node_modules는 ignore됨. tsbuildinfo 없음. core src 변경은 index.ts의 game/bot re-export 2줄뿐(이전 작업분, web과 무관).
- 임시 폴더 복사본에서 무작위 합법 행동(치/펑/깡/구종구패/리치 편향) 120게임 677국, 봇을 사람 정책으로 쓴 120게임(리치 262회): 교착/예외/점수 불변식 위반 0.
- 리치 후 츠모 기회 29회 모두 자동 타패되지 않고 정지 확인.
- StrictMode vs 일반 렌더 초기 상태 동일(30시드). 변이 테스트 16종 수행(아래 발견 참고).
- 프로젝트 파일 무수정, 임시 폴더 삭제 완료. dev 서버는 띄우지 않음. 실제 브라우저 확인은 못 함.

## 발견
- [낮음] 테스트 검출력 공백: autoRiichiAction이 츠모 선택지까지 자동 타패하도록 바꿔도 web 테스트 36개 전부 통과. 리치 후 츠모 정지 회귀 테스트 없음.
- [낮음] stepAuto의 humanMustAct 정지 조건 제거도 테스트가 못 잡음(봇이 사람보다 먼저 응답해 RNG 순서만 바뀜, 사람은 여전히 멈춤).
- [정보] App의 delay=0 effect는 정리 없이 rng를 소비하지만, StrictMode 이중 실행은 마운트 시에만이고 마운트 시엔 autoPending이 false라 실제 문제 없음.
