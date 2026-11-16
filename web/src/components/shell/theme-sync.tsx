"use client";

import { useLayoutEffect } from "react";
import { applyTheme, readTheme } from "@/lib/theme";

/**
 * The inline script in <head> sets the theme before the first paint (ADR-058). This re-applies it once React has
 * taken over the page: in development Strict Mode remounts the tree and resets <html> to the classes in the JSX,
 * which drops the theme class. Before paint, and nothing changes when the class is already right.
 */
export function ThemeSync() {
  useLayoutEffect(() => {
    const theme = readTheme();
    if (!document.documentElement.classList.contains(theme)) applyTheme(theme);
  }, []);
  return null;
}
