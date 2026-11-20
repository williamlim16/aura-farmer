import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import {
  Briefcase,
  CheckCircle2,
  FileText,
  GraduationCap,
  Home,
  KeyRound,
  ShieldCheck,
} from "lucide-react";

import { AuraBackdrop } from "~/components/aura-backdrop";
import { BrandLogo } from "~/components/brand-logo";
import { LogoutButton } from "~/components/logout-button";
import { ProfileEditor } from "~/components/profile/profile-editor";
import { ThemeToggle } from "~/components/theme-toggle";
import { Badge } from "~/components/ui/badge";
import { buttonVariants } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { createClient } from "~/lib/supabase/server";
import { db } from "~/server/db";
import {
  educations,
  experiences,
  userProfiles,
  type Education,
  type Experience,
  type UserProfile,
} from "~/server/db/schema";

export const metadata: Metadata = {
  title: "Profile",
  description:
    "Manage your personal summary, work experience, education, and account security.",
};

export default async function ProfilePage() {
  const supabase = await createClient();

  const { data, error } = await supabase.auth.getClaims();
  if (error || !data?.claims) {
    redirect("/auth/login");
  }

  let userId = typeof data.claims.sub === "string" ? data.claims.sub : null;
  if (!userId) {
    const { data: userData } = await supabase.auth.getUser();
    userId = userData.user?.id ?? null;
  }

  if (!userId) {
    redirect("/auth/login");
  }

  const email =
    typeof data.claims.email === "string"
      ? data.claims.email
      : "Authenticated user";
  const handle = email.includes("@") ? (email.split("@")[0] ?? email) : email;

  let profile: UserProfile | null = null;
  let userExperiences: Experience[] = [];
  let userEducations: Education[] = [];
  let dbAvailable = true;

  try {
    const [profileRows, experienceRows, educationRows] = await Promise.all([
      db
        .select()
        .from(userProfiles)
        .where(eq(userProfiles.userId, userId))
        .limit(1),
      db
        .select()
        .from(experiences)
        .where(eq(experiences.userId, userId))
        .orderBy(desc(experiences.startDate), desc(experiences.createdAt)),
      db
        .select()
        .from(educations)
        .where(eq(educations.userId, userId))
        .orderBy(desc(educations.startDate), desc(educations.createdAt)),
    ]);

    profile = profileRows[0] ?? null;
    userExperiences = experienceRows;
    userEducations = educationRows;
  } catch (err) {
    dbAvailable = false;
    console.error("Failed to load profile data:", err);
  }

  const trimmedName = profile?.fullName?.trim();
  const displayName =
    trimmedName && trimmedName.length > 0 ? trimmedName : handle;
  const hasSummary = Boolean(profile?.summary?.trim());
  const hasCoreDetails = Boolean(
    profile?.fullName?.trim() && profile?.headline?.trim(),
  );
  const summaryStatusLabel =
    hasSummary && hasCoreDetails
      ? "Ready"
      : hasSummary || hasCoreDetails
        ? "In progress"
        : "Needs details";

  return (
    <div className="relative flex min-h-svh flex-col overflow-x-clip">
      <AuraBackdrop variant="subtle" />

      {/* Top Workspace Header */}
      <header className="glass-nav sticky top-0 z-40">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-5 sm:px-8">
          <div className="flex items-center gap-3">
            <BrandLogo href="/" showTag />
            <span
              aria-hidden="true"
              className="text-border hidden sm:inline-block"
            >
              /
            </span>
            <span className="text-muted-foreground hidden font-mono text-xs sm:inline-block">
              Profile
            </span>
          </div>

          <div className="flex items-center gap-2.5">
            <Badge
              variant="outline"
              className="hidden max-w-[220px] truncate font-mono text-xs md:inline-flex"
            >
              {email}
            </Badge>
            <ThemeToggle />
            <LogoutButton size="sm" variant="outline" />
          </div>
        </div>
      </header>

      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-8 px-5 py-10 sm:px-8 md:py-12">
        {/* Welcome Strip */}
        <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
          <div className="space-y-2">
            <Badge variant="teal">
              <CheckCircle2 aria-hidden="true" className="size-3.5" />
              Session active
            </Badge>
            <h1 className="font-heading text-foreground text-3xl font-semibold tracking-tight sm:text-4xl">
              Welcome back,{" "}
              <span className="text-aura-gradient">{displayName}</span>
            </h1>
            <p className="text-muted-foreground max-w-2xl text-sm sm:text-base">
              Keep your personal summary, work experience, and education up to
              date so Aura Farmer can curate tailored roles and complete
              applications for you.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Link
              href="/"
              className={buttonVariants({ variant: "outline", size: "sm" })}
            >
              <Home aria-hidden="true" className="size-3.5" />
              Landing page
            </Link>
            <Link
              href="/auth/update-password"
              className={buttonVariants({ variant: "secondary", size: "sm" })}
            >
              <KeyRound aria-hidden="true" className="size-3.5" />
              Update password
            </Link>
          </div>
        </section>

        {/* Summary Status Cards */}
        <section
          aria-label="Candidate profile overview"
          className="grid gap-4 sm:grid-cols-3"
        >
          <Card size="sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardDescription className="font-mono text-xs uppercase">
                  Personal Summary
                </CardDescription>
                <FileText
                  aria-hidden="true"
                  className="text-aura-primary size-4"
                />
              </div>
              <CardTitle className="text-xl">{summaryStatusLabel}</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">
                {hasSummary
                  ? "Your summary and candidate bio are saved to your profile."
                  : "Add your headline, skills, and personal summary below."}
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardDescription className="font-mono text-xs uppercase">
                  Work Experience
                </CardDescription>
                <Briefcase
                  aria-hidden="true"
                  className="text-aura-secondary size-4"
                />
              </div>
              <CardTitle className="text-xl">
                {userExperiences.length}{" "}
                {userExperiences.length === 1 ? "role" : "roles"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">
                {userExperiences.length > 0
                  ? "Stored in your candidate experience timeline."
                  : "Add past or current roles to improve role matching."}
              </p>
            </CardContent>
          </Card>

          <Card size="sm">
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardDescription className="font-mono text-xs uppercase">
                  Education
                </CardDescription>
                <GraduationCap
                  aria-hidden="true"
                  className="text-aura-primary size-4"
                />
              </div>
              <CardTitle className="text-xl">
                {userEducations.length}{" "}
                {userEducations.length === 1 ? "entry" : "entries"}
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-muted-foreground text-xs">
                {userEducations.length > 0
                  ? "Academic history ready for portal auto-fill."
                  : "Add your schools, degrees, or certifications."}
              </p>
            </CardContent>
          </Card>
        </section>

        {/* Main Candidate Profile Editor & Account Sidebar */}
        <section className="grid items-start gap-6 lg:grid-cols-[1.8fr_0.95fr]">
          <ProfileEditor
            initialProfile={profile}
            initialExperiences={userExperiences}
            initialEducations={userEducations}
            dbAvailable={dbAvailable}
          />

          <div className="flex flex-col gap-6 lg:sticky lg:top-24">
            <Card>
              <CardHeader>
                <div className="flex items-center justify-between">
                  <Badge variant="outline" className="font-mono uppercase">
                    Completeness
                  </Badge>
                  <CheckCircle2
                    aria-hidden="true"
                    className="text-aura-secondary size-4"
                  />
                </div>
                <CardTitle className="text-xl">Profile Checklist</CardTitle>
                <CardDescription>
                  Complete these sections to prepare your profile for curated
                  job applications.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <ul className="space-y-3 text-sm">
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Identity &amp; headline
                    </span>
                    <Badge
                      variant={hasCoreDetails ? "teal" : "outline"}
                      className="font-mono text-[11px]"
                    >
                      {hasCoreDetails ? "Done" : "Pending"}
                    </Badge>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Personal summary
                    </span>
                    <Badge
                      variant={hasSummary ? "teal" : "outline"}
                      className="font-mono text-[11px]"
                    >
                      {hasSummary ? "Done" : "Pending"}
                    </Badge>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">
                      Work experience
                    </span>
                    <Badge
                      variant={userExperiences.length > 0 ? "teal" : "outline"}
                      className="font-mono text-[11px]"
                    >
                      {userExperiences.length > 0 ? "Added" : "Pending"}
                    </Badge>
                  </li>
                  <li className="flex items-center justify-between gap-2">
                    <span className="text-muted-foreground">Education</span>
                    <Badge
                      variant={userEducations.length > 0 ? "teal" : "outline"}
                      className="font-mono text-[11px]"
                    >
                      {userEducations.length > 0 ? "Added" : "Pending"}
                    </Badge>
                  </li>
                </ul>
              </CardContent>
            </Card>

            
          </div>
        </section>
      </main>
    </div>
  );
}
