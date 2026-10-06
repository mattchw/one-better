"use client";
import { useSyncExternalStore } from "react";
import { saveTheme, subscribeTheme } from "./theme";

export function ThemeToggle() {
  const dark = useSyncExternalStore(subscribeTheme, () => document.documentElement.dataset.theme === "dark", () => false);
  const label = dark ? "Switch to light mode" : "Switch to dark mode";
  return <button className="header-theme-toggle" aria-label={label} title={label} onClick={() => saveTheme(dark ? "light" : "dark")}>
    {dark ? <svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></svg> : <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M20 15.5A8.5 8.5 0 0 1 8.5 4a8.5 8.5 0 1 0 11.5 11.5Z"/></svg>}
  </button>;
}
