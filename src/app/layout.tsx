import type { Metadata } from "next";
import "@fullcalendar/react/skeleton.css";
import "@fullcalendar/react/themes/classic/theme.css";
import "@fullcalendar/react/themes/classic/palette.css";
import "./globals.css";
import "./theme.css";
import "./workspace-reference.css";
import { ThemeController } from "@/components/theme-controller";
import { themeBootstrap } from "@/components/theme";
export const metadata: Metadata = { title: "One Better", description: "Make room for meaningful progress." };
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en" data-theme="light" data-theme-preference="light" suppressHydrationWarning><head><script dangerouslySetInnerHTML={{ __html: themeBootstrap }}/></head><body><ThemeController/>{children}</body></html>;
}
