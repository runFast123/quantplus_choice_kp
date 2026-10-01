"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useState } from "react";

export function ThemeToggle({ initial }: { initial: "light" | "dark" }) {
  const [theme, setTheme] = useState(initial);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        const root = document.documentElement;
        root.classList.remove(theme);
        root.classList.add(next);
        root.style.colorScheme = next;
        document.cookie = `qp_theme=${next}; path=/; max-age=31536000; samesite=lax`;
        setTheme(next);
      }}
      className="grid size-9 place-items-center rounded-md text-muted-foreground transition-colors hover:bg-foreground/[0.06] hover:text-foreground"
      aria-label={`Switch to ${next} theme`}
      title={`Switch to ${next} theme`}
    >
      {theme === "dark" ? <SunIcon size={18} aria-hidden /> : <MoonIcon size={18} aria-hidden />}
    </button>
  );
}
