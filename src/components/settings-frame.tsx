import type { ReactNode } from "react";
import { AppHeader } from "./app-header";

type SettingsSection = "availability" | "integrations" | "account";
const sections = [
  { key: "availability", title: "Availability", detail: "Focusable hours, breathing room", href: "/availability" },
  { key: "integrations", title: "Integrations", detail: "Calendar and AI connections", href: "/integrations" },
  { key: "account", title: "Account", detail: "Profile, time zone", href: "/settings/account" },
] as const;

export function SettingsFrame({ section, accountName, children }: { section: SettingsSection; accountName: string; children: ReactNode }) {
  return <div className="workspace settings-page">
    <a className="skip-link" href="#main">Skip to content</a>
    <AppHeader section="settings" accountName={accountName} />
    <main id="main" className="settings-layout">
      <nav className="settings-sidebar" aria-label="Settings sections">
        <h1>Settings</h1>
        {sections.map(item => <a key={item.key} href={item.href} aria-current={section === item.key ? "page" : undefined}><strong>{item.title}</strong><span>{item.detail}</span></a>)}
        <p>Your preferences support the plan. You choose what to commit to each week.</p>
        <a className="settings-back" href="/calendar">← Back to calendar</a>
      </nav>
      <div className="settings-content">{children}</div>
    </main>
  </div>;
}
