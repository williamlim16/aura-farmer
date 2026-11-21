import { redirect } from "next/navigation";

import { createClient } from "~/lib/supabase/server";

/**
 * Returns the signed-in user's id and email, or redirects to the login page.
 * Use in server components and server actions that need a user.
 */
export async function requireUser() {
  const supabase = await createClient();
  const { data, error } = await supabase.auth.getClaims();
  const claims = data?.claims;

  if (error || !claims || typeof claims.sub !== "string") {
    redirect("/auth/login");
  }

  return {
    id: claims.sub,
    email: typeof claims.email === "string" ? claims.email : null,
  };
}
