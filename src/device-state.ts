/**
 * Persistent shadow state for supplied-driver firmware, whose configuration
 * protocol has writes but no matching reads. Values stored here are always
 * labelled "last applied by AJAZZ macOS" in the UI, never "current".
 */

const PREFIX = "ajazz-macos:last-applied:";

interface StoredValue<T> {
  value: T;
  savedAt: string;
}

export function loadLastApplied<T>(feature: string): StoredValue<T> | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + feature);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredValue<T>;
    if (!parsed || typeof parsed.savedAt !== "string" || parsed.value === undefined) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function saveLastApplied<T>(feature: string, value: T): StoredValue<T> {
  const stored = { value, savedAt: new Date().toISOString() };
  try {
    window.localStorage.setItem(PREFIX + feature, JSON.stringify(stored));
  } catch {
    // Configuration still succeeded; unavailable local persistence must not
    // turn a successful hardware operation into an error.
  }
  return stored;
}
