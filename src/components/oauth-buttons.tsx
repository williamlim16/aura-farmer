"use client";

import { useState } from "react";

import { Button } from "~/components/ui/button";
import { safeNextPath } from "~/lib/safe-next-path";
import { createClient } from "~/lib/supabase/client";

type OAuthProvider = "google";

const PROVIDERS: Array<{ id: OAuthProvider; label: string }> = [
  { id: "google", label: "Continue with Google" },
];

interface OAuthButtonsProps {
  disabled?: boolean;
  onError?: (message: string | null) => void;
}

/** Renders the Google OAuth sign-in button with a divider. */
export function OAuthButtons({ disabled, onError }: OAuthButtonsProps) {
  const [loadingProvider, setLoadingProvider] = useState<OAuthProvider | null>(
    null,
  );
  const [localError, setLocalError] = useState<string | null>(null);

  const handleOAuthLogin = async (provider: OAuthProvider) => {
    const supabase = createClient();
    setLoadingProvider(provider);
    setLocalError(null);
    onError?.(null);

    try {
      const next = new URLSearchParams(window.location.search).get("next");
      const { error } = await supabase.auth.signInWithOAuth({
        provider,
        options: {
          redirectTo: `${window.location.origin}/auth/oauth?next=${encodeURIComponent(safeNextPath(next, "/protected"))}`,
        },
      });
      if (error) throw error;
    } catch (error: unknown) {
      const message =
        error instanceof Error ? error.message : "An error occurred";
      if (onError) {
        onError(message);
      } else {
        setLocalError(message);
      }
      setLoadingProvider(null);
    }
  };

  const isBusy = Boolean(disabled) || loadingProvider !== null;

  return (
    <div className="flex flex-col gap-4">
      <div className="relative flex items-center text-xs uppercase">
        <span className="w-full border-t" />
        <span className="bg-card text-muted-foreground shrink-0 px-2">
          Or continue with
        </span>
        <span className="w-full border-t" />
      </div>
      {localError && <p className="text-sm text-red-500">{localError}</p>}
      <div className="flex flex-col gap-2">
        {PROVIDERS.map(({ id, label }) => (
          <Button
            key={id}
            type="button"
            variant="outline"
            className="w-full"
            disabled={isBusy}
            onClick={() => void handleOAuthLogin(id)}
          >
            {loadingProvider === id ? "Redirecting..." : label}
          </Button>
        ))}
      </div>
    </div>
  );
}
