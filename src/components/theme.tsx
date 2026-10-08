"use client";

import { Moon, Sun } from "lucide-react";
import { useEffect, useState } from "react";
import { BAR, KEY, type Theme } from "./theme-script";

function apply(t: Theme) {
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[t]);
  try {
    localStorage.setItem(KEY, t);
  } catch {
    // storage blocked: the theme still changes for this page
  }
}

/** Sun/moon button: switches light and dark, remembered per browser (localStorage). */
export function ThemeToggle({ className }: { className?: string }) {
  const [theme, setTheme] = useState<Theme | null>(null);

  useEffect(() => {
    const t: Theme = document.documentElement.dataset.theme === "light" ? "light" : "dark";
    setTheme(t);
    // the head script can run before Next adds the theme-color tag
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR[t]);
    // another tab switched: follow it
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      const t: Theme = e.newValue === "light" ? "light" : "dark";
      document.documentElement.dataset.theme = t;
      setTheme(t);
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const next: Theme = theme === "light" ? "dark" : "light";
  return (
    <button
      type="button"
      aria-label={`Switch to ${next} mode`}
      title={`Switch to ${next} mode`}
      onClick={() => {
        apply(next);
        setTheme(next);
      }}
      className={className ?? "rounded p-1.5 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-400 dark:hover:bg-zinc-800"}
    >
      {theme === "light" ? <Moon size={18} aria-hidden /> : <Sun size={18} aria-hidden />}
    </button>
  );
}
