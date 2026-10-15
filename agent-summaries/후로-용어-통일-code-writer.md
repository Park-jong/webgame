# 후로 용어 통일

- 변경 파일: 47개 (README.md, ROADMAP.md, docs/yaku-spec.md, packages/*/README.md 일부, core/server/web 소스·테스트의 한글 주석·설명·화면 문구, scripts/capture-screenshots.mjs)
- 방식: 한글 '멜드', '부로'(앞 글자가 한글이 아닌 경우)를 '후로'로 치환. 활용형은 접미 그대로 유지(부로되지 -> 후로되지, 멜드가 -> 후로가, 멜드를 -> 후로를 등). 조사 받침이 같아 조사 변경 불필요.
- 후처리: '부로 멜드'가 '후로 후로'가 된 곳은 '후로'로, '멜드수'는 '후로 수'로 정리.
- 남긴 항목: '여부로'(여부 + 로) 3곳은 단어 일부라 제외 (docs/yaku-spec.md, core/src/ryuukyoku.ts 2곳). 코드 식별자(meld 등)·파일명(buro.test.ts, meld.ts)·영어 주석·agent-summaries·git 이력은 변경 없음.
- 테스트: core 611, server 204, web 390 통과(개수 변동 없음), core/web 빌드 통과.
