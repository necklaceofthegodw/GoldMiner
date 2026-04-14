const SAVE_KEY = "binary-miner-save-v1";

export function loadGameSave() {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveGameSave(saveData) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(SAVE_KEY, JSON.stringify(saveData));
  } catch {
    // Ignore storage quota/permissions issues and continue.
  }
}

export function clearGameSave() {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.removeItem(SAVE_KEY);
  } catch {
    // Ignore storage permissions issues and continue.
  }
}
