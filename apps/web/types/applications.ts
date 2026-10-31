/**
 * Wire types for the job-applications API (`/api/v1/users/me/applications/*`
 * and `POST /api/v1/listings/:id/applications`). They mirror
 * `apps/backend/src/applications/applications.types.ts`, with `Date` columns
 * narrowed to the ISO strings they arrive as over JSON.
 */

import type { ChatMessage, ChatUserSummary, ListingStatus } from "@/types/chat";

export type JobApplicationStatus = "pending" | "viewed" | "hired" | "rejected";

/** The job a row is about — the chat's listing card plus the employer's name. */
export interface ApplicationListing {
  id: string;
  title: string;
  price: string | null;
  currency: string;
  status: ListingStatus;
  thumbnailUrl: string | null;
  company: string | null;
}

/** What a list row says about the attached résumé. */
export interface ApplicationResumeSummary {
  hasResume: boolean;
  summary: string | null;
  cv: { fileName: string; size: number } | null;
}

/** One row of `/me/applied-jobs`. */
export interface AppliedJob {
  id: string;
  status: JobApplicationStatus;
  coverNote: string | null;
  createdAt: string;
  updatedAt: string;
  listing: ApplicationListing;
  poster: ChatUserSummary;
  /**
   * The encrypted chat delivery, on the POST response only. Null when the
   * poster had no encrypted-chat devices and the application was recorded
   * without a message. The list endpoints omit the field entirely.
   */
  chat?: { conversationId: string; message: ChatMessage } | null;
}

/** One row of `/me/job-applications`. */
export interface ReceivedApplication {
  id: string;
  status: JobApplicationStatus;
  coverNote: string | null;
  createdAt: string;
  updatedAt: string;
  viewedAt: string | null;
  decidedAt: string | null;
  listing: ApplicationListing;
  applicant: ChatUserSummary;
  resume: ApplicationResumeSummary;
}

// ── The frozen résumé snapshot ───────────────────────────────────────────────
// A copy of what the resume module assembles (`ResumeDocumentWire`), declared
// locally the way every other cross-boundary wire type in this app is: the web
// app is standalone and never imports backend types.

interface SnapshotPlace {
  id: string;
  name: string;
  slug: string;
}

export interface SnapshotLocation {
  province: SnapshotPlace | null;
  district: SnapshotPlace | null;
  commune: SnapshotPlace | null;
}

export interface SnapshotPersonal {
  firstName: string;
  lastName: string;
  gender: string | null;
  dob: string | null;
  nationality: string | null;
  email: string | null;
  educationLevel: string | null;
  maritalStatus: string | null;
  place: SnapshotLocation;
  address: string | null;
  position: string | null;
  yearsOfExperience: number | null;
  phones: string[];
  photoUrl: string | null;
}

export interface SnapshotExperience {
  id: string;
  company: string;
  position: string;
  place: SnapshotLocation;
  startDate: string;
  endDate: string | null;
  current: boolean;
  description: string;
}

export interface SnapshotEducation {
  id: string;
  school: string;
  degree: string;
  major: string;
  place: SnapshotLocation;
  startDate: string;
  endDate: string | null;
  current: boolean;
  description: string;
}

export interface SnapshotSkill {
  id: string;
  title: string;
  level: string;
}

export interface SnapshotLanguage {
  id: string;
  title: string;
  level: string;
}

export interface SnapshotReference {
  id: string;
  name: string;
  company: string;
  position: string;
  phones: string[];
  email: string | null;
}

export interface SnapshotJobPreference {
  openJob: boolean;
  position: string | null;
  category: string[];
  location: string[];
  jobType: string[];
}

/** The CV file's metadata — the file itself is a private object behind a signed URL. */
export interface SnapshotAttachment {
  id: string;
  fileName: string;
  size: number;
  uploadedAt: string;
}

export interface ApplicationResumeSnapshot {
  exists: boolean;
  personal: SnapshotPersonal | null;
  summary: string;
  hobbies: string;
  experiences: SnapshotExperience[];
  educations: SnapshotEducation[];
  skills: SnapshotSkill[];
  languages: SnapshotLanguage[];
  references: SnapshotReference[];
  jobPreference: SnapshotJobPreference | null;
  attachment: SnapshotAttachment | null;
}

/** One application in full — the row that was opened. */
export interface ApplicationDetail {
  id: string;
  status: JobApplicationStatus;
  coverNote: string | null;
  createdAt: string;
  updatedAt: string;
  viewedAt: string | null;
  decidedAt: string | null;
  listing: ApplicationListing;
  applicant: ChatUserSummary;
  poster: ChatUserSummary;
  /** The résumé as it stood at apply time, or null when there was none. */
  resume: ApplicationResumeSnapshot | null;
}

export interface ApplicationPage<T> {
  items: T[];
  hasMore: boolean;
}

/**
 * Discriminated result for every applications server action — server actions
 * cannot throw structured errors across the RSC boundary, so the HTTP status
 * travels in the payload (`ChatActionResult`'s rule).
 */
export type ApplicationActionResult<T> =
  | { ok: true; data: T }
  | {
      ok: false;
      status: number;
      code: string;
      message: string;
      details?: unknown;
    };
