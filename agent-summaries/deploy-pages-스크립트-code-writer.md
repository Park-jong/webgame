# deploy:pages 스크립트 추가 (code-writer)

- package.json: scripts에 `"deploy:pages": "npm run build -w @mahjong/web && npm run deploy -w @mahjong/web"` 추가(기존 스크립트 유지), 파일 끝 개행 1개 복원.
- README.md "GitHub Pages 배포" 절: "아직 배포 스크립트는 없다" 문구를 `npm run deploy:pages` 안내(원격 gh-pages 브랜치 push)와 Settings → Pages Source 1회 설정 안내로 교체.
- 검증: package.json 유효 JSON, `npm run build -w @mahjong/web` 성공 여부 확인. 실제 deploy는 실행하지 않음. 커밋 안 함.
