/**
 * Keeps a half-filled form alive across a trip to another page.
 *
 * Sending someone to the catalogue to create a missing product is only helpful
 * if their half-typed order is still there when they come back. Session storage
 * is the right lifetime for this: it survives the navigation, it is private to
 * the tab, and it disappears when the tab does — nobody wants yesterday's
 * abandoned draft reappearing.
 */
const key = (name: string) => `pgp:draft:${name}`;

export function saveDraft<T>(name: string, value: T): void {
  try {
    sessionStorage.setItem(key(name), JSON.stringify(value));
  } catch {
    /* private mode, or storage disabled — the trip still works, the draft is just lost */
  }
}

export function takeDraft<T>(name: string): T | null {
  try {
    const raw = sessionStorage.getItem(key(name));
    if (raw === null) return null;
    sessionStorage.removeItem(key(name));
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

export function hasDraft(name: string): boolean {
  try {
    return sessionStorage.getItem(key(name)) !== null;
  } catch {
    return false;
  }
}
