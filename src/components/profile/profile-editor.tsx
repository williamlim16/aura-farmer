"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition, type FormEvent } from "react";
import {
  Briefcase,
  Building2,
  Calendar,
  Check,
  GraduationCap,
  Loader2,
  MapPin,
  Pencil,
  Plus,
  Sparkles,
  Trash2,
  UserRound,
  X,
} from "lucide-react";

import {
  deleteEducationAction,
  deleteExperienceAction,
  saveEducationAction,
  saveExperienceAction,
  upsertUserProfileAction,
} from "~/app/profile/actions";
import { FormAlert } from "~/components/form-alert";
import { Badge } from "~/components/ui/badge";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import { Textarea } from "~/components/ui/textarea";
import type { Education, Experience, UserProfile } from "~/server/db/schema";

interface ProfileEditorProps {
  initialProfile: UserProfile | null;
  initialExperiences: Experience[];
  initialEducations: Education[];
  dbAvailable: boolean;
}

interface ProfileFormState {
  fullName: string;
  headline: string;
  location: string;
  phone: string;
  websiteUrl: string;
  linkedinUrl: string;
  githubUrl: string;
  skills: string;
  summary: string;
}

interface ExperienceFormState {
  id?: string;
  jobTitle: string;
  company: string;
  employmentType: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
}

interface EducationFormState {
  id?: string;
  school: string;
  degree: string;
  fieldOfStudy: string;
  grade: string;
  location: string;
  startDate: string;
  endDate: string;
  isCurrent: boolean;
  description: string;
}

function emptyProfileState(profile: UserProfile | null): ProfileFormState {
  return {
    fullName: profile?.fullName ?? "",
    headline: profile?.headline ?? "",
    location: profile?.location ?? "",
    phone: profile?.phone ?? "",
    websiteUrl: profile?.websiteUrl ?? "",
    linkedinUrl: profile?.linkedinUrl ?? "",
    githubUrl: profile?.githubUrl ?? "",
    skills: profile?.skills ?? "",
    summary: profile?.summary ?? "",
  };
}

function emptyExperienceState(item?: Experience): ExperienceFormState {
  return {
    id: item?.id,
    jobTitle: item?.jobTitle ?? "",
    company: item?.company ?? "",
    employmentType: item?.employmentType ?? "",
    location: item?.location ?? "",
    startDate: item?.startDate ?? "",
    endDate: item?.endDate ?? "",
    isCurrent: item?.isCurrent ?? false,
    description: item?.description ?? "",
  };
}

function emptyEducationState(item?: Education): EducationFormState {
  return {
    id: item?.id,
    school: item?.school ?? "",
    degree: item?.degree ?? "",
    fieldOfStudy: item?.fieldOfStudy ?? "",
    grade: item?.grade ?? "",
    location: item?.location ?? "",
    startDate: item?.startDate ?? "",
    endDate: item?.endDate ?? "",
    isCurrent: item?.isCurrent ?? false,
    description: item?.description ?? "",
  };
}

function parseSkills(raw: string): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const part of raw.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(trimmed);
  }

  return result;
}

function formatDateRange(
  startDate: string,
  endDate: string | null,
  isCurrent: boolean,
): string {
  const end = isCurrent ? "Present" : (endDate ?? "Present");
  return `${startDate} — ${end}`;
}

export function ProfileEditor({
  initialProfile,
  initialExperiences,
  initialEducations,
  dbAvailable,
}: ProfileEditorProps) {
  const router = useRouter();

  // Personal profile state
  const [profileForm, setProfileForm] = useState<ProfileFormState>(() =>
    emptyProfileState(initialProfile),
  );
  const [profileStatus, setProfileStatus] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);
  const [isSavingProfile, startProfileTransition] = useTransition();

  // Work experience state
  const [experienceItems, setExperienceItems] =
    useState<Experience[]>(initialExperiences);
  const [isExperienceFormOpen, setIsExperienceFormOpen] = useState(false);
  const [experienceForm, setExperienceForm] = useState<ExperienceFormState>(
    () => emptyExperienceState(),
  );
  const [experienceStatus, setExperienceStatus] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);
  const [deletingExperienceId, setDeletingExperienceId] = useState<
    string | null
  >(null);
  const [isSavingExperience, startExperienceTransition] = useTransition();

  // Education state
  const [educationItems, setEducationItems] =
    useState<Education[]>(initialEducations);
  const [isEducationFormOpen, setIsEducationFormOpen] = useState(false);
  const [educationForm, setEducationForm] = useState<EducationFormState>(() =>
    emptyEducationState(),
  );
  const [educationStatus, setEducationStatus] = useState<{
    variant: "success" | "error";
    message: string;
  } | null>(null);
  const [deletingEducationId, setDeletingEducationId] = useState<string | null>(
    null,
  );
  const [isSavingEducation, startEducationTransition] = useTransition();

  const skillTags = parseSkills(profileForm.skills);

  const handleProfileSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setProfileStatus(null);

    startProfileTransition(async () => {
      const result = await upsertUserProfileAction(profileForm);
      if (!result.ok) {
        setProfileStatus({ variant: "error", message: result.error });
        return;
      }

      setProfileForm(emptyProfileState(result.data));
      setProfileStatus({
        variant: "success",
        message: "Personal details and summary saved.",
      });
      router.refresh();
    });
  };

  const openNewExperienceForm = () => {
    setExperienceStatus(null);
    setExperienceForm(emptyExperienceState());
    setIsExperienceFormOpen(true);
  };

  const openEditExperienceForm = (item: Experience) => {
    setExperienceStatus(null);
    setExperienceForm(emptyExperienceState(item));
    setIsExperienceFormOpen(true);
  };

  const closeExperienceForm = () => {
    setIsExperienceFormOpen(false);
    setExperienceForm(emptyExperienceState());
  };

  const handleExperienceSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setExperienceStatus(null);

    startExperienceTransition(async () => {
      const result = await saveExperienceAction(experienceForm);
      if (!result.ok) {
        setExperienceStatus({ variant: "error", message: result.error });
        return;
      }

      const saved = result.data;
      setExperienceItems((prev) => {
        const exists = prev.some((item) => item.id === saved.id);
        return exists
          ? prev.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...prev];
      });
      setIsExperienceFormOpen(false);
      setExperienceForm(emptyExperienceState());
      setExperienceStatus({
        variant: "success",
        message: experienceForm.id
          ? "Work experience updated."
          : "Work experience added.",
      });
      router.refresh();
    });
  };

  const handleDeleteExperience = (id: string) => {
    setExperienceStatus(null);
    setDeletingExperienceId(id);

    startExperienceTransition(async () => {
      const result = await deleteExperienceAction(id);
      setDeletingExperienceId(null);

      if (!result.ok) {
        setExperienceStatus({ variant: "error", message: result.error });
        return;
      }

      setExperienceItems((prev) => prev.filter((item) => item.id !== id));
      if (experienceForm.id === id) {
        closeExperienceForm();
      }
      setExperienceStatus({
        variant: "success",
        message: "Work experience removed.",
      });
      router.refresh();
    });
  };

  const openNewEducationForm = () => {
    setEducationStatus(null);
    setEducationForm(emptyEducationState());
    setIsEducationFormOpen(true);
  };

  const openEditEducationForm = (item: Education) => {
    setEducationStatus(null);
    setEducationForm(emptyEducationState(item));
    setIsEducationFormOpen(true);
  };

  const closeEducationForm = () => {
    setIsEducationFormOpen(false);
    setEducationForm(emptyEducationState());
  };

  const handleEducationSubmit = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setEducationStatus(null);

    startEducationTransition(async () => {
      const result = await saveEducationAction(educationForm);
      if (!result.ok) {
        setEducationStatus({ variant: "error", message: result.error });
        return;
      }

      const saved = result.data;
      setEducationItems((prev) => {
        const exists = prev.some((item) => item.id === saved.id);
        return exists
          ? prev.map((item) => (item.id === saved.id ? saved : item))
          : [saved, ...prev];
      });
      setIsEducationFormOpen(false);
      setEducationForm(emptyEducationState());
      setEducationStatus({
        variant: "success",
        message: educationForm.id
          ? "Education entry updated."
          : "Education entry added.",
      });
      router.refresh();
    });
  };

  const handleDeleteEducation = (id: string) => {
    setEducationStatus(null);
    setDeletingEducationId(id);

    startEducationTransition(async () => {
      const result = await deleteEducationAction(id);
      setDeletingEducationId(null);

      if (!result.ok) {
        setEducationStatus({ variant: "error", message: result.error });
        return;
      }

      setEducationItems((prev) => prev.filter((item) => item.id !== id));
      if (educationForm.id === id) {
        closeEducationForm();
      }
      setEducationStatus({
        variant: "success",
        message: "Education entry removed.",
      });
      router.refresh();
    });
  };

  return (
    <div className="flex flex-col gap-6">
      {!dbAvailable && (
        <FormAlert
          variant="error"
          message="Database connection is currently unavailable. Start PostgreSQL and run your Drizzle push/migrations before saving profile changes."
        />
      )}

      {/* 1. Personal Summary & Details */}
      <Card>
        <CardHeader className="border-border/75 border-b">
          <div className="flex items-center gap-2.5">
            <span className="border-aura-primary/30 bg-primary/12 text-aura-primary inline-flex size-8 items-center justify-center rounded-lg border">
              <UserRound aria-hidden="true" className="size-4" />
            </span>
            <div>
              <CardTitle className="text-xl">
                Personal Summary &amp; Details
              </CardTitle>
              <CardDescription>
                Your core candidate identity used to curate roles and pre-fill
                application portals.
              </CardDescription>
            </div>
          </div>
        </CardHeader>

        <CardContent>
          <form onSubmit={handleProfileSubmit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="grid gap-2">
                <Label htmlFor="full-name">Full name</Label>
                <Input
                  id="full-name"
                  name="fullName"
                  autoComplete="name"
                  placeholder="Alex Rivera"
                  disabled={isSavingProfile}
                  value={profileForm.fullName}
                  onChange={(e) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      fullName: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="headline">Professional headline</Label>
                <Input
                  id="headline"
                  name="headline"
                  placeholder="Senior Software Engineer · Full-Stack & AI"
                  disabled={isSavingProfile}
                  value={profileForm.headline}
                  onChange={(e) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      headline: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="profile-location">Location</Label>
                <Input
                  id="profile-location"
                  name="location"
                  autoComplete="address-level2"
                  placeholder="Sydney, Australia · Remote"
                  disabled={isSavingProfile}
                  value={profileForm.location}
                  onChange={(e) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      location: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="phone">Phone number</Label>
                <Input
                  id="phone"
                  name="phone"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+61 400 000 000"
                  disabled={isSavingProfile}
                  value={profileForm.phone}
                  onChange={(e) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      phone: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-4 sm:grid-cols-3">
              <div className="grid gap-2">
                <Label htmlFor="website-url">Website / Portfolio</Label>
                <Input
                  id="website-url"
                  name="websiteUrl"
                  type="url"
                  autoComplete="url"
                  placeholder="https://alexrivera.dev"
                  disabled={isSavingProfile}
                  value={profileForm.websiteUrl}
                  onChange={(e) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      websiteUrl: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="linkedin-url">LinkedIn URL</Label>
                <Input
                  id="linkedin-url"
                  name="linkedinUrl"
                  type="url"
                  placeholder="https://linkedin.com/in/username"
                  disabled={isSavingProfile}
                  value={profileForm.linkedinUrl}
                  onChange={(e) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      linkedinUrl: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="grid gap-2">
                <Label htmlFor="github-url">GitHub URL</Label>
                <Input
                  id="github-url"
                  name="githubUrl"
                  type="url"
                  placeholder="https://github.com/username"
                  disabled={isSavingProfile}
                  value={profileForm.githubUrl}
                  onChange={(e) =>
                    setProfileForm((prev) => ({
                      ...prev,
                      githubUrl: e.target.value,
                    }))
                  }
                />
              </div>
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="skills">Skills</Label>
                <span className="text-muted-foreground font-mono text-[11px]">
                  Comma-separated
                </span>
              </div>
              <Input
                id="skills"
                name="skills"
                placeholder="TypeScript, React, Next.js, PostgreSQL, Node.js"
                disabled={isSavingProfile}
                value={profileForm.skills}
                onChange={(e) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    skills: e.target.value,
                  }))
                }
              />
              {skillTags.length > 0 && (
                <div
                  aria-label="Skills preview"
                  className="flex flex-wrap gap-1.5 pt-1"
                >
                  {skillTags.slice(0, 24).map((skill) => (
                    <Badge key={skill} variant="secondary" className="text-xs">
                      {skill}
                    </Badge>
                  ))}
                </div>
              )}
            </div>

            <div className="grid gap-2">
              <div className="flex items-center justify-between gap-2">
                <Label htmlFor="summary">Personal summary</Label>
                <span className="text-muted-foreground font-mono text-[11px]">
                  {profileForm.summary.length}/4000
                </span>
              </div>
              <Textarea
                id="summary"
                name="summary"
                rows={4}
                maxLength={4000}
                placeholder="Summarize your background, key strengths, and the types of roles you are targeting..."
                disabled={isSavingProfile}
                value={profileForm.summary}
                onChange={(e) =>
                  setProfileForm((prev) => ({
                    ...prev,
                    summary: e.target.value,
                  }))
                }
              />
            </div>

            {profileStatus && (
              <FormAlert
                variant={profileStatus.variant}
                message={profileStatus.message}
              />
            )}

            <div className="flex items-center justify-end gap-3 pt-1">
              <Button type="submit" disabled={isSavingProfile}>
                {isSavingProfile ? (
                  <>
                    <Loader2
                      aria-hidden="true"
                      className="size-4 animate-spin"
                    />
                    Saving details...
                  </>
                ) : (
                  <>
                    <Check aria-hidden="true" className="size-4" />
                    Save profile details
                  </>
                )}
              </Button>
            </div>
          </form>
        </CardContent>
      </Card>

      {/* 2. Work Experience */}
      <Card>
        <CardHeader className="border-border/75 border-b">
          <div className="flex items-center gap-2.5">
            <span className="border-aura-secondary/30 bg-aura-secondary/12 text-aura-secondary inline-flex size-8 items-center justify-center rounded-lg border">
              <Briefcase aria-hidden="true" className="size-4" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-xl">Work Experience</CardTitle>
                <Badge variant="teal" className="font-mono text-[11px]">
                  {experienceItems.length}{" "}
                  {experienceItems.length === 1 ? "role" : "roles"}
                </Badge>
              </div>
              <CardDescription>
                Add your past and current roles so portal forms and role
                matching reflect your real track record.
              </CardDescription>
            </div>
          </div>

          <CardAction>
            <Button
              type="button"
              size="sm"
              variant={isExperienceFormOpen ? "outline" : "default"}
              onClick={
                isExperienceFormOpen
                  ? closeExperienceForm
                  : openNewExperienceForm
              }
            >
              {isExperienceFormOpen ? (
                <>
                  <X aria-hidden="true" className="size-3.5" />
                  Close
                </>
              ) : (
                <>
                  <Plus aria-hidden="true" className="size-3.5" />
                  Add experience
                </>
              )}
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          {isExperienceFormOpen && (
            <form
              onSubmit={handleExperienceSubmit}
              className="border-aura-primary/30 bg-background/60 space-y-4 rounded-xl border p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-heading text-foreground text-sm font-semibold">
                  {experienceForm.id
                    ? "Edit work experience"
                    : "New work experience"}
                </p>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {experienceForm.id ? "Editing" : "Draft"}
                </Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="exp-job-title">
                    Job title <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="exp-job-title"
                    name="jobTitle"
                    required
                    placeholder="Software Engineer"
                    disabled={isSavingExperience}
                    value={experienceForm.jobTitle}
                    onChange={(e) =>
                      setExperienceForm((prev) => ({
                        ...prev,
                        jobTitle: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="exp-company">
                    Company <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="exp-company"
                    name="company"
                    required
                    placeholder="Acme Labs"
                    disabled={isSavingExperience}
                    value={experienceForm.company}
                    onChange={(e) =>
                      setExperienceForm((prev) => ({
                        ...prev,
                        company: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="exp-employment-type">Employment type</Label>
                  <Input
                    id="exp-employment-type"
                    name="employmentType"
                    list="employment-type-suggestions"
                    placeholder="Full-time, Contract, Internship..."
                    disabled={isSavingExperience}
                    value={experienceForm.employmentType}
                    onChange={(e) =>
                      setExperienceForm((prev) => ({
                        ...prev,
                        employmentType: e.target.value,
                      }))
                    }
                  />
                  <datalist id="employment-type-suggestions">
                    <option value="Full-time" />
                    <option value="Part-time" />
                    <option value="Contract" />
                    <option value="Internship" />
                    <option value="Freelance" />
                  </datalist>
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="exp-location">Location</Label>
                  <Input
                    id="exp-location"
                    name="location"
                    placeholder="Melbourne, AU · Hybrid"
                    disabled={isSavingExperience}
                    value={experienceForm.location}
                    onChange={(e) =>
                      setExperienceForm((prev) => ({
                        ...prev,
                        location: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="exp-start-date">
                    Start date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="exp-start-date"
                    name="startDate"
                    required
                    placeholder="Jan 2023"
                    disabled={isSavingExperience}
                    value={experienceForm.startDate}
                    onChange={(e) =>
                      setExperienceForm((prev) => ({
                        ...prev,
                        startDate: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="exp-end-date">End date</Label>
                  <Input
                    id="exp-end-date"
                    name="endDate"
                    placeholder={
                      experienceForm.isCurrent ? "Present" : "Nov 2025"
                    }
                    disabled={isSavingExperience || experienceForm.isCurrent}
                    value={
                      experienceForm.isCurrent ? "" : experienceForm.endDate
                    }
                    onChange={(e) =>
                      setExperienceForm((prev) => ({
                        ...prev,
                        endDate: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <label className="text-foreground flex cursor-pointer items-center gap-2.5 text-sm select-none">
                <input
                  type="checkbox"
                  className="border-input accent-primary focus-visible:ring-ring size-4 rounded focus-visible:ring-2 focus-visible:outline-none"
                  disabled={isSavingExperience}
                  checked={experienceForm.isCurrent}
                  onChange={(e) =>
                    setExperienceForm((prev) => ({
                      ...prev,
                      isCurrent: e.target.checked,
                      endDate: e.target.checked ? "" : prev.endDate,
                    }))
                  }
                />
                <span>I currently work in this role</span>
              </label>

              <div className="grid gap-2">
                <Label htmlFor="exp-description">
                  Responsibilities &amp; achievements
                </Label>
                <Textarea
                  id="exp-description"
                  name="description"
                  rows={3}
                  maxLength={4000}
                  placeholder="Describe impact, systems shipped, metrics improved, and tools used..."
                  disabled={isSavingExperience}
                  value={experienceForm.description}
                  onChange={(e) =>
                    setExperienceForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSavingExperience}
                  onClick={closeExperienceForm}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isSavingExperience}>
                  {isSavingExperience ? (
                    <>
                      <Loader2
                        aria-hidden="true"
                        className="size-3.5 animate-spin"
                      />
                      Saving...
                    </>
                  ) : experienceForm.id ? (
                    "Update experience"
                  ) : (
                    "Save experience"
                  )}
                </Button>
              </div>
            </form>
          )}

          {experienceStatus && (
            <FormAlert
              variant={experienceStatus.variant}
              message={experienceStatus.message}
            />
          )}

          {experienceItems.length === 0 ? (
            <div className="border-border bg-background/45 flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
              <span className="border-aura-secondary/25 bg-aura-secondary/10 text-aura-secondary inline-flex size-9 items-center justify-center rounded-xl border">
                <Sparkles aria-hidden="true" className="size-4" />
              </span>
              <div className="space-y-1">
                <p className="font-heading text-foreground text-sm font-medium">
                  No work experience added yet
                </p>
                <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
                  Add your roles, internships, or contract engagements so Aura
                  Farmer can populate application forms automatically.
                </p>
              </div>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Work experience entries">
              {experienceItems.map((item) => {
                const isDeleting = deletingExperienceId === item.id;
                return (
                  <li
                    key={item.id}
                    className="border-border/80 bg-background/50 hover:border-aura-primary/35 rounded-xl border p-4 transition-colors duration-200"
                  >
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-heading text-foreground text-base font-semibold">
                            {item.jobTitle}
                          </h3>
                          {item.isCurrent && (
                            <Badge variant="teal" className="text-[11px]">
                              Current
                            </Badge>
                          )}
                          {item.employmentType && (
                            <Badge variant="outline" className="text-[11px]">
                              {item.employmentType}
                            </Badge>
                          )}
                        </div>

                        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                          <span className="text-foreground/90 inline-flex items-center gap-1.5">
                            <Building2
                              aria-hidden="true"
                              className="text-aura-primary size-3.5"
                            />
                            {item.company}
                          </span>
                          <span className="inline-flex items-center gap-1.5 font-mono">
                            <Calendar aria-hidden="true" className="size-3.5" />
                            {formatDateRange(
                              item.startDate,
                              item.endDate,
                              item.isCurrent,
                            )}
                          </span>
                          {item.location && (
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin aria-hidden="true" className="size-3.5" />
                              {item.location}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${item.jobTitle} at ${item.company}`}
                          disabled={isSavingExperience}
                          onClick={() => openEditExperienceForm(item)}
                        >
                          <Pencil aria-hidden="true" className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:bg-destructive/12 hover:text-destructive"
                          aria-label={`Delete ${item.jobTitle} at ${item.company}`}
                          disabled={isSavingExperience}
                          onClick={() => handleDeleteExperience(item.id)}
                        >
                          {isDeleting ? (
                            <Loader2
                              aria-hidden="true"
                              className="size-3.5 animate-spin"
                            />
                          ) : (
                            <Trash2 aria-hidden="true" className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {item.description && (
                      <p className="text-muted-foreground mt-3 text-sm leading-relaxed whitespace-pre-line">
                        {item.description}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* 3. Education */}
      <Card>
        <CardHeader className="border-border/75 border-b">
          <div className="flex items-center gap-2.5">
            <span className="border-aura-primary/30 bg-primary/12 text-aura-primary inline-flex size-8 items-center justify-center rounded-lg border">
              <GraduationCap aria-hidden="true" className="size-4" />
            </span>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <CardTitle className="text-xl">Education</CardTitle>
                <Badge variant="default" className="font-mono text-[11px]">
                  {educationItems.length}{" "}
                  {educationItems.length === 1 ? "entry" : "entries"}
                </Badge>
              </div>
              <CardDescription>
                Degrees, certifications, and academic institutions associated
                with your profile.
              </CardDescription>
            </div>
          </div>

          <CardAction>
            <Button
              type="button"
              size="sm"
              variant={isEducationFormOpen ? "outline" : "default"}
              onClick={
                isEducationFormOpen ? closeEducationForm : openNewEducationForm
              }
            >
              {isEducationFormOpen ? (
                <>
                  <X aria-hidden="true" className="size-3.5" />
                  Close
                </>
              ) : (
                <>
                  <Plus aria-hidden="true" className="size-3.5" />
                  Add education
                </>
              )}
            </Button>
          </CardAction>
        </CardHeader>

        <CardContent className="space-y-4">
          {isEducationFormOpen && (
            <form
              onSubmit={handleEducationSubmit}
              className="border-aura-primary/30 bg-background/60 space-y-4 rounded-xl border p-5"
            >
              <div className="flex items-center justify-between gap-2">
                <p className="font-heading text-foreground text-sm font-semibold">
                  {educationForm.id ? "Edit education" : "New education"}
                </p>
                <Badge variant="outline" className="font-mono text-[11px]">
                  {educationForm.id ? "Editing" : "Draft"}
                </Badge>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="edu-school">
                    School / Institution{" "}
                    <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edu-school"
                    name="school"
                    required
                    placeholder="University of Sydney"
                    disabled={isSavingEducation}
                    value={educationForm.school}
                    onChange={(e) =>
                      setEducationForm((prev) => ({
                        ...prev,
                        school: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="edu-degree">
                    Degree / Program <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edu-degree"
                    name="degree"
                    required
                    placeholder="Bachelor of Science"
                    disabled={isSavingEducation}
                    value={educationForm.degree}
                    onChange={(e) =>
                      setEducationForm((prev) => ({
                        ...prev,
                        degree: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="edu-field">Field of study</Label>
                  <Input
                    id="edu-field"
                    name="fieldOfStudy"
                    placeholder="Computer Science"
                    disabled={isSavingEducation}
                    value={educationForm.fieldOfStudy}
                    onChange={(e) =>
                      setEducationForm((prev) => ({
                        ...prev,
                        fieldOfStudy: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="edu-grade">Grade / GPA</Label>
                  <Input
                    id="edu-grade"
                    name="grade"
                    placeholder="3.9 GPA / First Class Honours"
                    disabled={isSavingEducation}
                    value={educationForm.grade}
                    onChange={(e) =>
                      setEducationForm((prev) => ({
                        ...prev,
                        grade: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="edu-start-date">
                    Start date <span className="text-destructive">*</span>
                  </Label>
                  <Input
                    id="edu-start-date"
                    name="startDate"
                    required
                    placeholder="Feb 2020"
                    disabled={isSavingEducation}
                    value={educationForm.startDate}
                    onChange={(e) =>
                      setEducationForm((prev) => ({
                        ...prev,
                        startDate: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="grid gap-2">
                  <Label htmlFor="edu-end-date">End date</Label>
                  <Input
                    id="edu-end-date"
                    name="endDate"
                    placeholder={
                      educationForm.isCurrent ? "Present" : "Nov 2023"
                    }
                    disabled={isSavingEducation || educationForm.isCurrent}
                    value={educationForm.isCurrent ? "" : educationForm.endDate}
                    onChange={(e) =>
                      setEducationForm((prev) => ({
                        ...prev,
                        endDate: e.target.value,
                      }))
                    }
                  />
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div className="grid gap-2">
                  <Label htmlFor="edu-location">Location</Label>
                  <Input
                    id="edu-location"
                    name="location"
                    placeholder="Sydney, Australia"
                    disabled={isSavingEducation}
                    value={educationForm.location}
                    onChange={(e) =>
                      setEducationForm((prev) => ({
                        ...prev,
                        location: e.target.value,
                      }))
                    }
                  />
                </div>

                <div className="flex items-end pb-2">
                  <label className="text-foreground flex cursor-pointer items-center gap-2.5 text-sm select-none">
                    <input
                      type="checkbox"
                      className="border-input accent-primary focus-visible:ring-ring size-4 rounded focus-visible:ring-2 focus-visible:outline-none"
                      disabled={isSavingEducation}
                      checked={educationForm.isCurrent}
                      onChange={(e) =>
                        setEducationForm((prev) => ({
                          ...prev,
                          isCurrent: e.target.checked,
                          endDate: e.target.checked ? "" : prev.endDate,
                        }))
                      }
                    />
                    <span>Currently studying here</span>
                  </label>
                </div>
              </div>

              <div className="grid gap-2">
                <Label htmlFor="edu-description">
                  Coursework, thesis &amp; activities
                </Label>
                <Textarea
                  id="edu-description"
                  name="description"
                  rows={3}
                  maxLength={4000}
                  placeholder="Relevant coursework, research focus, awards, or societies..."
                  disabled={isSavingEducation}
                  value={educationForm.description}
                  onChange={(e) =>
                    setEducationForm((prev) => ({
                      ...prev,
                      description: e.target.value,
                    }))
                  }
                />
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2.5 pt-1">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  disabled={isSavingEducation}
                  onClick={closeEducationForm}
                >
                  Cancel
                </Button>
                <Button type="submit" size="sm" disabled={isSavingEducation}>
                  {isSavingEducation ? (
                    <>
                      <Loader2
                        aria-hidden="true"
                        className="size-3.5 animate-spin"
                      />
                      Saving...
                    </>
                  ) : educationForm.id ? (
                    "Update education"
                  ) : (
                    "Save education"
                  )}
                </Button>
              </div>
            </form>
          )}

          {educationStatus && (
            <FormAlert
              variant={educationStatus.variant}
              message={educationStatus.message}
            />
          )}

          {educationItems.length === 0 ? (
            <div className="border-border bg-background/45 flex flex-col items-start gap-3 rounded-xl border border-dashed p-6">
              <span className="border-aura-primary/25 bg-primary/10 text-aura-primary inline-flex size-9 items-center justify-center rounded-xl border">
                <GraduationCap aria-hidden="true" className="size-4" />
              </span>
              <div className="space-y-1">
                <p className="font-heading text-foreground text-sm font-medium">
                  No education added yet
                </p>
                <p className="text-muted-foreground max-w-md text-xs leading-relaxed">
                  Add your degrees, bootcamps, or certifications so job portals
                  requiring academic history are filled accurately.
                </p>
              </div>
            </div>
          ) : (
            <ul className="space-y-3" aria-label="Education entries">
              {educationItems.map((item) => {
                const isDeleting = deletingEducationId === item.id;
                return (
                  <li
                    key={item.id}
                    className="border-border/80 bg-background/50 hover:border-aura-primary/35 rounded-xl border p-4 transition-colors duration-200"
                  >
                    <div className="flex flex-col justify-between gap-3 sm:flex-row sm:items-start">
                      <div className="space-y-1.5">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="font-heading text-foreground text-base font-semibold">
                            {item.degree}
                            {item.fieldOfStudy ? ` · ${item.fieldOfStudy}` : ""}
                          </h3>
                          {item.isCurrent && (
                            <Badge variant="teal" className="text-[11px]">
                              Current
                            </Badge>
                          )}
                          {item.grade && (
                            <Badge variant="outline" className="text-[11px]">
                              {item.grade}
                            </Badge>
                          )}
                        </div>

                        <div className="text-muted-foreground flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
                          <span className="text-foreground/90 inline-flex items-center gap-1.5">
                            <GraduationCap
                              aria-hidden="true"
                              className="text-aura-primary size-3.5"
                            />
                            {item.school}
                          </span>
                          <span className="inline-flex items-center gap-1.5 font-mono">
                            <Calendar aria-hidden="true" className="size-3.5" />
                            {formatDateRange(
                              item.startDate,
                              item.endDate,
                              item.isCurrent,
                            )}
                          </span>
                          {item.location && (
                            <span className="inline-flex items-center gap-1.5">
                              <MapPin aria-hidden="true" className="size-3.5" />
                              {item.location}
                            </span>
                          )}
                        </div>
                      </div>

                      <div className="flex shrink-0 items-center gap-1.5">
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          aria-label={`Edit ${item.degree} at ${item.school}`}
                          disabled={isSavingEducation}
                          onClick={() => openEditEducationForm(item)}
                        >
                          <Pencil aria-hidden="true" className="size-3.5" />
                        </Button>
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon-sm"
                          className="text-destructive hover:bg-destructive/12 hover:text-destructive"
                          aria-label={`Delete ${item.degree} at ${item.school}`}
                          disabled={isSavingEducation}
                          onClick={() => handleDeleteEducation(item.id)}
                        >
                          {isDeleting ? (
                            <Loader2
                              aria-hidden="true"
                              className="size-3.5 animate-spin"
                            />
                          ) : (
                            <Trash2 aria-hidden="true" className="size-3.5" />
                          )}
                        </Button>
                      </div>
                    </div>

                    {item.description && (
                      <p className="text-muted-foreground mt-3 text-sm leading-relaxed whitespace-pre-line">
                        {item.description}
                      </p>
                    )}
                  </li>
                );
              })}
            </ul>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
