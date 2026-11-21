import "server-only";

import { redirect } from "next/navigation";

import { apiDeps, currentUserId } from "./next";

/** For server components: the signed-in user's id and server deps, or redirect to login. */
export async function requireUser() {
  const userId = await currentUserId();
  if (!userId) redirect("/auth/login");
  return { userId, deps: await apiDeps() };
}

/** Whether an LLM fallback tier is configured, and how to label it honestly. */
export function llmAvailability(env: NodeJS.ProcessEnv = process.env): { available: boolean; label: string } {
  const p = env.LLM_PROVIDER ?? "none";
  if (p === "mock") return { available: true, label: "Mock LLM (scripted, no API calls)" };
  if (p === "anthropic") return { available: true, label: "Claude (real API calls, metered)" };
  return { available: false, label: "Not configured" };
}
