# vite base 설정 (code-writer)

- packages/web/vite.config.ts: defineConfig(vitest/config 유지)를 함수형으로 바꿔 `base = command === "build" ? (VITE_BASE || "/webgame/") : "/"`.
- README.md "GitHub Pages 배포" 절, packages/web/README.md 한 단락 추가.
- 검증: 기본 빌드 `/webgame/assets/...`, `VITE_BASE=/`(MSYS_NO_PATHCONV=1) 빌드 `/assets/...`, dev 서버 5199 `/`에서 index.html 응답(PID 지정 종료), web 테스트 353개 통과.
- 주의: Git Bash에서 VITE_BASE=/ 는 경로 변환으로 `/Program Files/Git/`이 됨.
