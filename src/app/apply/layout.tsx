import Link from "next/link";

import { LogoutButton } from "~/components/logout-button";

export default function ApplyLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="bg-background text-foreground min-h-svh font-sans">
      <header className="border-b">
        <nav aria-label="Main" className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-6 gap-y-2 px-6 py-3 text-sm">
          <Link href="/apply" className="font-semibold">Aura Farmer</Link>
          <Link href="/apply/profile" className="text-muted-foreground hover:text-foreground">Profile</Link>
          <Link href="/apply/jobs" className="text-muted-foreground hover:text-foreground">Jobs</Link>
          <Link href="/apply/new" className="text-muted-foreground hover:text-foreground">Test application</Link>
          <span className="ml-auto"><LogoutButton /></span>
        </nav>
      </header>
      <main className="mx-auto max-w-5xl px-6 py-8">{children}</main>
    </div>
  );
}
