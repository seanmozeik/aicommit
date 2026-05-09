export const validateMessage = (msg: string): string => {
  const cleaned = msg
    .replace(/^\s+/u, '')
    .replace(/^```\w*\n?/u, '')
    .replace(/\n?```$/u, '');

  const conventionalPattern =
    /^(feat|fix|refactor|style|docs|test|build|chore|perf|ci|revert)(\(.+?\))?:/u;

  const lines = cleaned.split('\n').map((line) => {
    let l = line.trim();
    while (l.startsWith('"') || l.endsWith('"')) {
      l = l.replace(/^"/u, '').replace(/"$/u, '');
      l = l.trim();
    }
    return l;
  });

  const validLines = lines.filter((line) => line.length > 0);
  const commitLine = validLines.find((line) => conventionalPattern.test(line)) ?? validLines[0];
  return commitLine.trim();
};
