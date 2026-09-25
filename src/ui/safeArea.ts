// Reads the CSS env(safe-area-inset-*) values the platform shell (Android
// wrapper, iOS Safari, etc.) exposes for notches/gesture bars. The browser
// dev harness itself has none (env() resolves to 0), so this only matters
// once M2's native wrapper sets it — kept here now so the platform-framing
// math (GameScene's platform bottom margin) never needs to change again.

let cachedBottomPx: number | null = null;

/** Bottom inset in CSS px, read once and cached (it can't change mid-session). */
export function getSafeAreaBottomPx(): number {
  if (cachedBottomPx !== null) return cachedBottomPx;
  try {
    const probe = document.createElement('div');
    probe.style.position = 'fixed';
    probe.style.bottom = '0';
    probe.style.height = 'env(safe-area-inset-bottom, 0px)';
    probe.style.visibility = 'hidden';
    probe.style.pointerEvents = 'none';
    document.body.appendChild(probe);
    const px = parseFloat(getComputedStyle(probe).height) || 0;
    document.body.removeChild(probe);
    cachedBottomPx = px;
  } catch {
    cachedBottomPx = 0;
  }
  return cachedBottomPx;
}
