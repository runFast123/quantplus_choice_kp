"use client";

import { MoonIcon, SunIcon } from "@phosphor-icons/react";
import { useState } from "react";
import { saveTheme, type Theme } from "@/lib/theme";

export function ThemeToggle({ initial }: { initial: Theme }) {
  const [theme, setTheme] = useState(initial);
  const next = theme === "dark" ? "light" : "dark";
  return (
    <button
      type="button"
      onClick={() => {
        saveTheme(next);
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
