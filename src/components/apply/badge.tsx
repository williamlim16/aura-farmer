import { cn } from "~/lib/utils";

const TONES = {
  neutral: "bg-muted text-muted-foreground",
  progress: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  success: "bg-green-100 text-green-800 dark:bg-green-950 dark:text-green-200",
  warning: "bg-amber-100 text-amber-900 dark:bg-amber-950 dark:text-amber-200",
  danger: "bg-red-100 text-red-800 dark:bg-red-950 dark:text-red-200",
  rule: "bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-200",
  jev: "bg-violet-100 text-violet-800 dark:bg-violet-950 dark:text-violet-200",
  llm: "bg-pink-100 text-pink-800 dark:bg-pink-950 dark:text-pink-200",
  guard: "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-200",
} as const;

export type BadgeTone = keyof typeof TONES;

export function Badge({ tone = "neutral", className, children }: { tone?: BadgeTone; className?: string; children: React.ReactNode }) {
  return <span className={cn("inline-flex items-center rounded-full px-2 py-0.5 text-xs font-medium whitespace-nowrap", TONES[tone], className)}>{children}</span>;
}
