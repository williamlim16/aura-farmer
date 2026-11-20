"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, LogOut } from "lucide-react";
import { type VariantProps } from "class-variance-authority";

import { Button, type buttonVariants } from "~/components/ui/button";
import { createClient } from "~/lib/supabase/client";

interface LogoutButtonProps extends VariantProps<typeof buttonVariants> {
  className?: string;
}

/** Signs the current user out and redirects cleanly to the sign-in screen. */
export function LogoutButton({
  variant = "outline",
  size = "default",
  className,
}: LogoutButtonProps) {
  const router = useRouter();
  const [isLoading, setIsLoading] = useState(false);

  const logout = async () => {
    setIsLoading(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.push("/auth/login");
      router.refresh();
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <Button
      type="button"
      variant={variant}
      size={size}
      className={className}
      disabled={isLoading}
      onClick={() => void logout()}
    >
      {isLoading ? (
        <Loader2 aria-hidden="true" className="size-4 animate-spin" />
      ) : (
        <LogOut aria-hidden="true" className="size-4" />
      )}
      <span>{isLoading ? "Signing out..." : "Sign out"}</span>
    </Button>
  );
}
