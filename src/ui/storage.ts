// Best-height persistence. Wrapped in try/catch: private-mode / disabled
// storage must never crash the game, it just means "no best score shown".

const KEY = 'materia.bestHeightM';
const MUTED_KEY = 'materia.muted';
const VIBRATION_KEY = 'materia.vibrationEnabled';

export function loadBestHeight(): number {
  try {
    const raw = localStorage.getItem(KEY);
    const n = raw ? parseFloat(raw) : 0;
    return Number.isFinite(n) ? n : 0;
  } catch {
    return 0;
  }
}

export function saveBestHeight(heightM: number): void {
  try {
    localStorage.setItem(KEY, String(heightM));
  } catch {
    // ignore — storage unavailable
  }
}

export function loadMuted(): boolean {
  try {
    return localStorage.getItem(MUTED_KEY) === '1';
  } catch {
    return false;
  }
}

export function saveMuted(muted: boolean): void {
  try {
    localStorage.setItem(MUTED_KEY, muted ? '1' : '0');
  } catch {
    // ignore — storage unavailable
  }
}

export function loadVibrationEnabled(): boolean {
  try {
    const raw = localStorage.getItem(VIBRATION_KEY);
    return raw === null ? true : raw === '1';
  } catch {
    return true;
  }
}

export function saveVibrationEnabled(on: boolean): void {
  try {
    localStorage.setItem(VIBRATION_KEY, on ? '1' : '0');
  } catch {
    // ignore — storage unavailable
  }
}
