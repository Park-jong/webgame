let data = '';
process.stdin.on('data', c => data += c);
process.stdin.on('end', () => {
  let input;
  try {
    input = JSON.parse(data);
  } catch (e) {
    process.exit(0);
  }
  const toolInput = input.tool_input || {};
  if (typeof toolInput.prompt !== 'string' || toolInput.prompt.includes('agent-summaries/')) {
    return;
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, '0');
  const date = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  const role = (toolInput.subagent_type || 'agent').toLowerCase();
  const slug = (toolInput.description || 'task')
    .trim()
    .replace(/[\\/:*?"<>|]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 50)
    .replace(/-+$/, '') || 'task';
  const filename = `agent-summaries/${date}-${slug}-${role}.md`;

  const note = `\n\n---\n작업 완료 후, 무엇을 했는지와 주요 변경/발견 사항을 요약해서 저장소 루트의 ${filename} 파일로 (경로/파일명 그대로, 다르게 바꾸지 말고) 작성해줘.`;
  const updatedInput = Object.assign({}, toolInput, { prompt: toolInput.prompt + note });
  console.log(JSON.stringify({
    hookSpecificOutput: {
      hookEventName: 'PreToolUse',
      permissionDecision: 'allow',
      updatedInput
    }
  }));
});
