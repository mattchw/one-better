"use client";
import { useState, useSyncExternalStore } from "react";
import { currentTheme, saveTheme, subscribeTheme, type ThemePreference } from "./theme";

const choices = [
  { value: "light", title: "Light", description: "A warm, bright workspace." },
  { value: "dark", title: "Dark", description: "Soft contrast for quieter evenings." },
  { value: "system", title: "System", description: "Follow your device’s appearance." },
] as const;
const serverTheme = (): ThemePreference => "light";

export function AppearanceSettings() {
  const selected = useSyncExternalStore(subscribeTheme, currentTheme, serverTheme);
  const [storageUnavailable, setStorageUnavailable] = useState(false);
  return <section className="appearance-settings" aria-labelledby="appearance-title">
    <div className="settings-intro"><h2 id="appearance-title">Appearance</h2><p>Make your workspace comfortable to use.</p></div>
    <fieldset className="theme-picker">
      <legend>Color theme</legend>
      <p id="theme-description">Applies across One Better. You can change it anytime.</p>
      <div className="theme-choices">
        {choices.map(choice => <label key={choice.value} className="theme-choice">
          <input type="radio" name="theme" value={choice.value} checked={selected === choice.value} aria-describedby="theme-description" onChange={() => setStorageUnavailable(!saveTheme(choice.value))}/>
          <span className={`theme-preview theme-preview-${choice.value}`} aria-hidden="true"><i className="theme-preview-nav"/><span><i/><i/><i/></span></span>
          <strong>{choice.title}</strong><span className="theme-choice-caption">{choice.description}</span>
          <span className="theme-choice-check" aria-hidden="true">✓</span>
        </label>)}
      </div>
    </fieldset>
    <p className="small-note" role="status">{storageUnavailable ? "Theme applied for this visit. Allow browser storage to remember your choice." : "Your preference is saved automatically in this browser."}</p>
  </section>;
}
