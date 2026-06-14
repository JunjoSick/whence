// Build and copy a Wordle-style shareable result for the daily run.

const SITE = 'https://junjosick.github.io/whence/'; // GitHub Pages URL

// guessesUsed (1..6) or null (failed) -> emoji bucket
function emojiFor(g) {
  if (g == null) return '⬛';
  if (g <= 1) return '🟩';
  if (g <= 2) return '🟢';
  if (g <= 4) return '🟨';
  return '🟧';
}

export function buildShare(dateKey, results, score) {
  const grid = results.map(emojiFor).join('');
  const n = results.length;
  const solved = results.filter((g) => g != null).length;
  return [
    `Whence ${dateKey}`,
    `${grid}  ${solved}/${n}`,
    `Score ${score.toLocaleString()}`,
    SITE,
  ].join('\n');
}

export async function copyShare(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    // Fallback for non-secure contexts.
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  }
}
