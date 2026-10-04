"use client";
import { useEffect } from "react";
import { watchTheme } from "./theme";

export function ThemeController() {
  useEffect(watchTheme, []);
  return null;
}
