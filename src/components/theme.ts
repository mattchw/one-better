export type ThemePreference = "light" | "dark" | "system";
const storageKey = "one-better-theme";
const changeEvent = "one-better-theme-change";

export function themePreference(value: string | null | undefined): ThemePreference {
  return value === "dark" || value === "system" ? value : "light";
}

export function applyTheme(preference: ThemePreference) {
  const root = document.documentElement;
  root.dataset.themePreference = preference;
  root.dataset.theme = preference === "system"
    ? (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light")
    : preference;
  window.dispatchEvent(new Event(changeEvent));
}

export function saveTheme(preference: ThemePreference) {
  applyTheme(preference);
  try { localStorage.setItem(storageKey, preference); return true; }
  catch { return false; }
}

export function subscribeTheme(callback: () => void) {
  window.addEventListener(changeEvent, callback);
  return () => window.removeEventListener(changeEvent, callback);
}

export function currentTheme() {
  return themePreference(document.documentElement.dataset.themePreference);
}

export function watchTheme() {
  const media = window.matchMedia("(prefers-color-scheme: dark)");
  const systemChanged = () => { if (currentTheme() === "system") applyTheme("system"); };
  const storedChanged = (event: StorageEvent) => {
    try {
      if (event.storageArea === localStorage && (event.key === storageKey || event.key === null)) applyTheme(themePreference(event.newValue));
    } catch { /* Storage restrictions do not prevent an in-memory theme change. */ }
  };
  media.addEventListener("change", systemChanged);
  window.addEventListener("storage", storedChanged);
  // Another tab may change storage between the initial script and hydration,
  // before this tab has a storage-event listener. Read its latest choice here.
  let preference = currentTheme();
  try { preference = themePreference(localStorage.getItem(storageKey)); } catch { /* Keep the initial preference. */ }
  applyTheme(preference);
  return () => { media.removeEventListener("change", systemChanged); window.removeEventListener("storage", storedChanged); };
}

// Fixed application code only; no user input is interpolated into the script.
// Runs in <head> before paint, following Next's theme hydration guidance.
export const themeBootstrap = `(function(){var p="light";try{var s=localStorage.getItem("${storageKey}");if(s==="dark"||s==="system")p=s}catch(e){}var r=document.documentElement;r.dataset.themePreference=p;r.dataset.theme=p==="system"?(matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light"):p})()`;
