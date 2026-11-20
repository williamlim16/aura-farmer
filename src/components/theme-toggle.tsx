"use client";

import { Moon, Sun } from "lucide-react";

import { useTheme } from "~/components/theme-provider";
import { Button } from "~/components/ui/button";
import { cn } from "~/lib/utils";

interface ThemeToggleProps {
  className?: string;
}

/** Accessible light/dark mode switch using semantic theme tokens. */
export function ThemeToggle({ className }: ThemeToggleProps) {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === "dark";

  return (
    <Button
      type="button"
      variant="outline"
      size="icon"
      onClick={toggleTheme}
      aria-label={isDark ? "Switch to light theme" : "Switch to dark theme"}
      aria-pressed={isDark}
      title={isDark ? "Switch to light mode" : "Switch to dark mode"}
      className={cn(
        "relative size-9 rounded-full border-border/80 bg-card/70 backdrop-blur-md hover:border-aura-primary/40 hover:bg-muted/80",
        className,
      )}
    >
      <Sun
        aria-hidden="true"
        className="size-4 scale-100 rotate-0 text-foreground transition-transform duration-200 dark:scale-0 dark:-rotate-90"
      />
      <Moon
        aria-hidden="true"
        className="absolute size-4 scale-0 rotate-90 text-foreground transition-transform duration-200 dark:scale-100 dark:rotate-0"
      />
    </Button>
  );
}
