"use client";
import { useEffect, useRef } from "react";
import { SignOutButton } from "./sign-out-button";

export function AccountMenu({ accountName }: { accountName?: string }) {
  const menu = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const dismiss = (event: PointerEvent) => {
      if (menu.current?.open && event.target instanceof Node && !menu.current.contains(event.target)) menu.current.open = false;
    };
    const escape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && menu.current?.open) {
        menu.current.open = false;
        menu.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", escape);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", escape);
    };
  }, []);
  const initials = accountName?.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]).join("").toUpperCase() || "Me";
  return <details ref={menu} className="settings-menu account-menu">
    <summary aria-label="Account menu" title={accountName || "Account menu"}>{initials}</summary>
    <div className="account-menu-content">
      <p className="account-menu-name">{accountName || "Your workspace"}</p>
      <nav aria-label="More destinations">
        <a href="/planning">Weekly planning</a><a href="/today">Today</a>
        <a href="/availability">Availability</a><a href="/integrations">Integrations</a><a href="/settings/account">Account</a>
      </nav>
      <SignOutButton />
    </div>
  </details>;
}
