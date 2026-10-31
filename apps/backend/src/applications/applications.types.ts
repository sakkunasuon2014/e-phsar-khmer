import type {
  ChatUserSummary,
  ListingContext,
  MessageWithListing,
} from '../chat/chat.types';
import type { ResumeDocumentWire } from '../resume/resume.service';

export type JobApplicationStatus = 'pending' | 'viewed' | 'hired' | 'rejected';

/** The statuses a poster may set. `pending` is only ever the initial state. */
export const POSTER_SETTABLE_STATUSES = [
  'viewed',
  'hired',
  'rejected',
] as const satisfies readonly JobApplicationStatus[];

/**
 * The job a row is about: the chat's listing card plus the two job-specific
 * bits the /me rows print (`company` rides in `attributes`, and a job seeker
 * reads the employer before the ad title).
 */
export interface ApplicationListing extends ListingContext {
  company: string | null;
}

/**
 * What a list row says about the attached résumé — deliberately not the whole
 * document: a page of applications must not ship N résumé blobs, so the list
 * carries the summary line and the CV's name, and the full snapshot is one
 * `GET /users/me/applications/:id` away.
 */
export interface ApplicationResumeSummary {
  hasResume: boolean;
  summary: string | null;
  cv: { fileName: string; size: number } | null;
}

/** One row of `/me/applied-jobs` — the seeker's side. */
export interface AppliedJobView {
  id: string;
  status: JobApplicationStatus;
  coverNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  listing: ApplicationListing;
  poster: ChatUserSummary;
}

/**
 * The chat delivery an apply produced, when the applicant's browser could
 * encrypt to at least one of the poster's devices. `message` is the stored
 * ciphertext row — the server never sees the plaintext.
 */
export interface ApplyChatDelivery {
  conversationId: string;
  message: MessageWithListing;
}

/**
 * `POST /listings/:id/applications` result: the row plus its chat delivery.
 * `chat` is null when the poster had no devices registered for encrypted chat
 * and the application was recorded without a message (the poster still gets
 * the row and its notification).
 */
export interface ApplyResultView extends AppliedJobView {
  chat: ApplyChatDelivery | null;
}

/** One row of `/me/job-applications` — the poster's side. */
export interface ReceivedApplicationView {
  id: string;
  status: JobApplicationStatus;
  coverNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  viewedAt: Date | null;
  decidedAt: Date | null;
  listing: ApplicationListing;
  applicant: ChatUserSummary;
  resume: ApplicationResumeSummary;
}

/**
 * One application in full, for the row that was opened. `resume` is the frozen
 * snapshot (never a live read of the applicant's CV) and is null when they had
 * none at apply time.
 */
export interface ApplicationDetail {
  id: string;
  status: JobApplicationStatus;
  coverNote: string | null;
  createdAt: Date;
  updatedAt: Date;
  viewedAt: Date | null;
  decidedAt: Date | null;
  listing: ApplicationListing;
  applicant: ChatUserSummary;
  poster: ChatUserSummary;
  resume: ResumeDocumentWire | null;
}
