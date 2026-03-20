/**
 * Line-based diff utility using Myers / LCS algorithm.
 * Produces unified-diff-like output suitable for git-style display.
 */

/**
 * Compute LCS table for two arrays of strings.
 * @returns {number[][]} dp table
 */
function buildLcsTable(a, b) {
  const m = a.length;
  const n = b.length;
  // Allocate flat Uint32Array for performance
  const dp = new Array(m + 1);
  for (let i = 0; i <= m; i++) dp[i] = new Uint32Array(n + 1);
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1]);
    }
  }
  return dp;
}

/**
 * Backtrack LCS table to produce diff operations.
 * @param {string[]} a - original lines
 * @param {string[]} b - new lines
 * @returns {Array<{type: 'same'|'add'|'remove', text: string, lineA?: number, lineB?: number}>}
 */
function backtrack(dp, a, b) {
  const ops = [];
  let i = a.length;
  let j = b.length;
  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      ops.push({ type: 'same', text: a[i - 1], lineA: i, lineB: j });
      i--; j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      ops.push({ type: 'add', text: b[j - 1], lineB: j });
      j--;
    } else {
      ops.push({ type: 'remove', text: a[i - 1], lineA: i });
      i--;
    }
  }
  return ops.reverse();
}

/**
 * Compute a line diff between two text strings.
 * @param {string} original
 * @param {string} edited
 * @returns {Array<{type: 'same'|'add'|'remove', text: string, lineA?: number, lineB?: number}>}
 */
export function diffLines(original, edited) {
  const a = original.split('\n');
  const b = edited.split('\n');

  // Fast path: identical
  if (original === edited) return a.map((text, i) => ({ type: 'same', text, lineA: i + 1, lineB: i + 1 }));

  const dp = buildLcsTable(a, b);
  return backtrack(dp, a, b);
}

/**
 * Produce unified diff hunks (context lines around changes), like `git diff -U3`.
 * @param {Array} ops - result of diffLines()
 * @param {number} context - number of context lines around changes (default 3)
 * @returns {Array<{header: string, lines: Array}>} hunks
 */
export function toUnifiedHunks(ops, context = 3) {
  // Find indices of changed lines
  const changedIdx = new Set();
  ops.forEach((op, i) => {
    if (op.type !== 'same') {
      for (let k = Math.max(0, i - context); k <= Math.min(ops.length - 1, i + context); k++) {
        changedIdx.add(k);
      }
    }
  });

  if (changedIdx.size === 0) return [];

  // Group contiguous indices into hunks
  const sortedIdx = [...changedIdx].sort((a, b) => a - b);
  const hunks = [];
  let hunkStart = sortedIdx[0];
  let hunkEnd = sortedIdx[0];

  for (let k = 1; k < sortedIdx.length; k++) {
    if (sortedIdx[k] <= hunkEnd + 1) {
      hunkEnd = sortedIdx[k];
    } else {
      hunks.push([hunkStart, hunkEnd]);
      hunkStart = sortedIdx[k];
      hunkEnd = sortedIdx[k];
    }
  }
  hunks.push([hunkStart, hunkEnd]);

  return hunks.map(([start, end]) => {
    const lines = ops.slice(start, end + 1);

    // Compute hunk header like @@ -a,b +c,d @@
    const removeLines = lines.filter(l => l.type !== 'add');
    const addLines = lines.filter(l => l.type !== 'remove');
    const startA = removeLines[0]?.lineA ?? 1;
    const startB = addLines[0]?.lineB ?? 1;
    const countA = removeLines.filter(l => l.type !== 'add').length;
    const countB = addLines.filter(l => l.type !== 'remove').length;

    const header = `@@ -${startA},${countA} +${startB},${countB} @@`;
    return { header, lines };
  });
}

/**
 * Summary stats for a diff.
 * @param {Array} ops - result of diffLines()
 * @returns {{ added: number, removed: number, changed: boolean }}
 */
export function diffStats(ops) {
  const added = ops.filter(o => o.type === 'add').length;
  const removed = ops.filter(o => o.type === 'remove').length;
  return { added, removed, changed: added > 0 || removed > 0 };
}
