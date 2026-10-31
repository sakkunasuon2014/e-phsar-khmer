"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { IconArrowRight, IconPencil } from "@tabler/icons-react";
import {
  deleteResumeEntry,
  saveResumeDocument,
  saveResumeEntry,
  saveResumePersonal,
} from "@/actions/resume";
import type {
  ResumeEntry as ResumeEntryPayload,
  ResumeEntrySection,
} from "@/actions/resume";
import { toast } from "@/components/ui/sonner";
import { ResumeCareerSummaryDialog } from "@/components/profile/ResumeCareerSummaryDialog";
import { ResumeEducationsDialog } from "@/components/profile/ResumeEducationsDialog";
import { ResumeExperiencesDialog } from "@/components/profile/ResumeExperiencesDialog";
import { ResumeHobbiesDialog } from "@/components/profile/ResumeHobbiesDialog";
import {
  ResumeJobPreferencesDialog,
  type PreferenceOptions,
} from "@/components/profile/ResumeJobPreferencesDialog";
import { ResumeLanguagesDialog } from "@/components/profile/ResumeLanguagesDialog";
import { ResumePersonalDetailsDialog } from "@/components/profile/ResumePersonalDetailsDialog";
import {
  ResumePreview,
  type EducationEntry,
  type EntryListStep,
  type ExperienceEntry,
  type JobPreferenceEntry,
  type LanguageEntry,
  type ReferenceEntry,
  type ResumeAttachment,
  type ResumeDocumentData,
  type ResumeEntry,
  type ResumePersonalData,
  type SkillEntry,
} from "@/components/profile/ResumePreview";
import { ResumeReferencesDialog } from "@/components/profile/ResumeReferencesDialog";
import { ResumeSkillsDialog } from "@/components/profile/ResumeSkillsDialog";

/**
 * The resume builder's state machine, and the owner of the resume document
 * itself. Before anything is done it renders the "Create a New Resume(CV)"
 * card; once anything has been saved (or the resume already exists in the
 * database) it renders the finished view, which shows every section from this
 * state.
 *
 * Section forms submit one entry on their valid action (wizard "Next" or the
 * view's orange Save) via `onSubmit`, and the entry is written through to the
 * API — awaited BEFORE the dialog advances or closes, so a failed save leaves
 * the form open with its data intact instead of a UI running ahead of the
 * stored document. The write is id-keyed (upsert) — a wizard step re-entered
 * with "Back" replaces its own entry rather than duplicating it — and "Edit"
 * from the ⋮ menu loads the entry back into the form pre-filled (`initial`).
 * Skip submits nothing, leaving the section unfilled. The Job Preferences form
 * is deliberately NOT a wizard step — its own dialog and its own slot in the
 * document. Chips and the completion percent derive from this data.
 *
 * `done` is true from the first successful write on, which is what makes the
 * wizard reachable only from the "nothing saved yet" state: an abandoned
 * wizard reopens on the preview over the stored document, never on a blank
 * Step 1 that could overwrite it. Showing the preview, though, also waits for
 * the wizard to close (`showPreview`) — saving Step 1 must not fill the page
 * behind the open dialog.
 *
 * `lastOpen` keeps a dialog in the mode it was opened in until the close
 * animation ends, so X doesn't flash the wizard chrome back.
 */

const RESUME_STEPS = [
  "form.titles.personalWizard",
  "form.titles.summaryWizard",
  "form.titles.experiencesWizard",
  "form.titles.educationsWizard",
  "form.titles.skillsWizard",
  "form.titles.languagesWizard",
  "form.titles.hobbiesWizard",
  "form.titles.referencesWizard",
] as const;

/** The wizard step numbers that correspond to the five list sections. */
const ENTRY_SECTIONS: Record<3 | 4 | 5 | 6 | 8, ResumeEntrySection> = {
  3: "experiences",
  4: "educations",
  5: "skills",
  6: "languages",
  8: "references",
};

const upsert = <T extends { id: string }>(list: T[], entry: T): T[] => [
  ...list.filter((x) => x.id !== entry.id),
  entry,
];

export function ResumeStartBuilding({
  initial,
  firstName,
  lastName,
  preferenceOptions,
}: {
  /** The stored document, or null when this user has no resume yet. */
  initial: ResumeDocumentData | null;
  firstName?: string | null;
  lastName?: string | null;
  preferenceOptions: PreferenceOptions;
}) {
  const t = useTranslations("Resume");
  const [step, setStep] = useState<1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | null>(null);
  const [editing, setEditing] = useState<number | null>(null);
  const [editInitial, setEditInitial] = useState<ResumeEntry | null>(null);
  const [focusField, setFocusField] = useState<string | null>(null);
  const [lastOpen, setLastOpen] = useState<{
    id: number;
    mode: "wizard" | "edit";
  } | null>(null);
  const [done, setDone] = useState(initial !== null);
  const [jobPrefOpen, setJobPrefOpen] = useState(false);

  // The resume document — seeded from the stored one and kept in step with
  // every successful write.
  const [personal, setPersonal] = useState<ResumePersonalData | null>(
    initial?.personal ?? null,
  );
  const [summary, setSummary] = useState(initial?.summary ?? "");
  const [hobbies, setHobbies] = useState(initial?.hobbies ?? "");
  const [experiences, setExperiences] = useState<ExperienceEntry[]>(
    initial?.experiences ?? [],
  );
  const [educations, setEducations] = useState<EducationEntry[]>(
    initial?.educations ?? [],
  );
  const [skills, setSkills] = useState<SkillEntry[]>(initial?.skills ?? []);
  const [languages, setLanguages] = useState<LanguageEntry[]>(
    initial?.languages ?? [],
  );
  const [references, setReferences] = useState<ReferenceEntry[]>(
    initial?.references ?? [],
  );
  const [jobPreference, setJobPreference] = useState<JobPreferenceEntry | null>(
    initial?.jobPreference ?? null,
  );
  const [attachment, setAttachment] = useState<ResumeAttachment | null>(
    initial?.attachment ?? null,
  );

  const finish = () => {
    setDone(true);
    setStep(null);
    setEditing(null);
    setFocusField(null);
    setJobPrefOpen(false);
  };

  // Each handler resolves `true` only after the API accepted the write; the
  // dialog advances on `true` and stays put on `false` (the toast is here, so
  // a failure reads the same whichever form produced it).
  const savePersonal = async (data: ResumePersonalData): Promise<boolean> => {
    if (!(await saveResumePersonal(data))) {
      toast.error(t("form.saveFailed"));
      return false;
    }
    setPersonal(data);
    setDone(true);
    return true;
  };
  const saveSummary = async (text: string): Promise<boolean> => {
    if (!(await saveResumeDocument({ summary: text }))) {
      toast.error(t("form.saveFailed"));
      return false;
    }
    setSummary(text);
    setDone(true);
    return true;
  };
  const saveHobbies = async (text: string): Promise<boolean> => {
    if (!(await saveResumeDocument({ hobbies: text }))) {
      toast.error(t("form.saveFailed"));
      return false;
    }
    setHobbies(text);
    setDone(true);
    return true;
  };
  const saveJobPreference = async (
    entry: JobPreferenceEntry,
  ): Promise<boolean> => {
    if (!(await saveResumeDocument({ jobPreferences: entry }))) {
      toast.error(t("form.saveFailed"));
      return false;
    }
    setJobPreference(entry);
    setDone(true);
    return true;
  };
  const saveEntry = async (
    section: ResumeEntrySection,
    entry: ResumeEntryPayload,
  ): Promise<boolean> => {
    if (!(await saveResumeEntry(section, entry))) {
      toast.error(t("form.saveFailed"));
      return false;
    }
    if (section === "experiences")
      setExperiences((prev) => upsert(prev, entry as ExperienceEntry));
    else if (section === "educations")
      setEducations((prev) => upsert(prev, entry as EducationEntry));
    else if (section === "skills")
      setSkills((prev) => upsert(prev, entry as SkillEntry));
    else if (section === "languages")
      setLanguages((prev) => upsert(prev, entry as LanguageEntry));
    else setReferences((prev) => upsert(prev, entry as ReferenceEntry));
    setDone(true);
    return true;
  };
  const closeDialogs = () => {
    setStep(null);
    setEditing(null);
    setFocusField(null);
    setJobPrefOpen(false);
  };
  const openWizard = () => {
    setStep(1);
    setLastOpen({ id: 1, mode: "wizard" });
  };
  const openAdd = (n: 2 | 3 | 4 | 5 | 6 | 7 | 8) => {
    setEditing(n);
    setEditInitial(null);
    setFocusField(null);
    setLastOpen({ id: n, mode: "edit" });
  };
  const openEditEntry = (n: 2 | 3 | 4 | 5 | 6 | 7 | 8, entry: ResumeEntry) => {
    setEditing(n);
    setEditInitial(entry);
    setFocusField(null);
    setLastOpen({ id: n, mode: "edit" });
  };
  const openEditPersonal = () => {
    setEditing(1);
    setEditInitial(null);
    setFocusField(null);
    setLastOpen({ id: 1, mode: "edit" });
  };
  const openEditField = (field: string) => {
    setEditing(1);
    setEditInitial(null);
    setFocusField(field);
    setLastOpen({ id: 1, mode: "edit" });
  };
  /**
   * The ⋮ menu's Delete. Only the five list sections have one (the single-text
   * cards are edited, never removed), so the section number is narrowed here
   * rather than carried as a bare step.
   */
  const deleteEntry = async (n: EntryListStep, id: string): Promise<void> => {
    if (!(await deleteResumeEntry(ENTRY_SECTIONS[n], id))) {
      toast.error(t("form.deleteFailed"));
      return;
    }
    if (n === 3) setExperiences((prev) => prev.filter((x) => x.id !== id));
    else if (n === 4) setEducations((prev) => prev.filter((x) => x.id !== id));
    else if (n === 5) setSkills((prev) => prev.filter((x) => x.id !== id));
    else if (n === 6) setLanguages((prev) => prev.filter((x) => x.id !== id));
    else setReferences((prev) => prev.filter((x) => x.id !== id));
  };
  const modeFor = (n: number): "wizard" | "edit" =>
    lastOpen?.id === n && lastOpen.mode === "edit" ? "edit" : "wizard";

  /**
   * The preview is the *finished* CV, so it must not show behind the wizard
   * while the user is still filling it in — the first step saves immediately,
   * which used to make the filled preview appear mid-flow. `step` is the wizard
   * only (the edit dialogs use `editing`), so the preview swaps in exactly when
   * the wizard closes, whether that is Finish or X.
   */
  const showPreview = done && step === null;

  return (
    <>
      {showPreview ? (
        <ResumePreview
          doc={{
            personal,
            summary,
            experiences,
            educations,
            skills,
            languages,
            hobbies,
            references,
            jobPreference,
            attachment,
          }}
          fallbackFirstName={firstName ?? ""}
          fallbackLastName={lastName ?? ""}
          onEdit={openEditPersonal}
          onEditField={openEditField}
          onAdd={openAdd}
          onEditEntry={openEditEntry}
          onDeleteEntry={deleteEntry}
          onJobPreference={() => setJobPrefOpen(true)}
          onAttachmentChange={setAttachment}
        />
      ) : (
        <div className="max-w-7xl mx-auto w-full px-4 pt-4">
          <div className="rounded-2xl bg-card p-6 sm:p-10">
            <h1 className="type-page-title text-center text-foreground">
              {t("form.startTitle")}
            </h1>

            <div className="mx-auto mt-8 max-w-[560px]">
              <div className="rounded-2xl border bg-card p-6 shadow-sm">
                <div className="flex items-start gap-4">
                  <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-[#00a0e9]/10 text-[#00a0e9]">
                    <IconPencil size={24} />
                  </div>
                  <div>
                    <h2 className="type-section-title text-foreground">
                      {t("form.createTitle")}
                    </h2>
                    <p className="mt-1 type-body-sm text-muted-foreground">
                      {t("form.createDesc")}
                    </p>
                  </div>
                </div>

                <ul className="mt-6 flex flex-wrap gap-2.5">
                  {RESUME_STEPS.map((label, i) => (
                    <li
                      key={label}
                      className="flex items-center gap-2 rounded-full border bg-background px-3.5 py-1.5 type-body-sm text-foreground/80"
                    >
                      <span className="flex h-5 w-5 items-center justify-center rounded-full border type-discount text-muted-foreground">
                        {i + 1}
                      </span>
                      {t(label)}
                    </li>
                  ))}
                </ul>

                <button
                  type="button"
                  onClick={openWizard}
                  className="mt-6 inline-flex h-12 w-full cursor-pointer items-center justify-center gap-2 rounded-xl bg-[#00a0e9] type-nav text-white transition-colors hover:bg-[#00a0e9]/90"
                >
                  {t("form.startBuilding")}
                  <IconArrowRight size={20} />
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ResumePersonalDetailsDialog
        open={step === 1 || editing === 1}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
        defaultFirstName={firstName ?? ""}
        defaultLastName={lastName ?? ""}
        onNext={() => setStep(2)}
        initial={editing === 1 ? personal : null}
        onSubmit={savePersonal}
        mode={modeFor(1)}
        focusField={focusField}
        onSave={() => setEditing(null)}
      />
      <ResumeCareerSummaryDialog
        open={step === 2 || editing === 2}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
        onBack={() => setStep(1)}
        onNext={() => setStep(3)}
        onSkip={() => setStep(3)}
        mode={modeFor(2)}
        initial={editing === 2 ? (editInitial as string | null) : null}
        onSubmit={saveSummary}
        onSave={() => setEditing(null)}
      />
      <ResumeExperiencesDialog
        open={step === 3 || editing === 3}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
        onBack={() => setStep(2)}
        onNext={() => setStep(4)}
        onSkip={() => setStep(4)}
        mode={modeFor(3)}
        initial={editing === 3 ? (editInitial as ExperienceEntry | null) : null}
        onSubmit={(entry) =>
          saveEntry(ENTRY_SECTIONS[3], entry as ExperienceEntry)
        }
        onSave={() => setEditing(null)}
      />
      <ResumeEducationsDialog
        open={step === 4 || editing === 4}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
        onBack={() => setStep(3)}
        onNext={() => setStep(5)}
        onSkip={() => setStep(5)}
        mode={modeFor(4)}
        initial={editing === 4 ? (editInitial as EducationEntry | null) : null}
        onSubmit={(entry) =>
          saveEntry(ENTRY_SECTIONS[4], entry as EducationEntry)
        }
        onSave={() => setEditing(null)}
      />
      <ResumeSkillsDialog
        open={step === 5 || editing === 5}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
        onBack={() => setStep(4)}
        onNext={() => setStep(6)}
        onSkip={() => setStep(6)}
        mode={modeFor(5)}
        initial={editing === 5 ? (editInitial as SkillEntry | null) : null}
        onSubmit={(entry) => saveEntry(ENTRY_SECTIONS[5], entry as SkillEntry)}
        onSave={() => setEditing(null)}
      />
      <ResumeLanguagesDialog
        open={step === 6 || editing === 6}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
        onBack={() => setStep(5)}
        onNext={() => setStep(7)}
        onSkip={() => setStep(7)}
        mode={modeFor(6)}
        initial={editing === 6 ? (editInitial as LanguageEntry | null) : null}
        onSubmit={(entry) =>
          saveEntry(ENTRY_SECTIONS[6], entry as LanguageEntry)
        }
        onSave={() => setEditing(null)}
      />
      <ResumeHobbiesDialog
        open={step === 7 || editing === 7}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
        onBack={() => setStep(6)}
        onNext={() => setStep(8)}
        onSkip={() => setStep(8)}
        mode={modeFor(7)}
        initial={editing === 7 ? (editInitial as string | null) : null}
        onSubmit={saveHobbies}
        onSave={() => setEditing(null)}
      />
      <ResumeReferencesDialog
        open={step === 8 || editing === 8}
        onOpenChange={(open) => {
          if (!open) closeDialogs();
        }}
        onBack={() => setStep(7)}
        onFinished={finish}
        onSkip={finish}
        mode={modeFor(8)}
        initial={editing === 8 ? (editInitial as ReferenceEntry | null) : null}
        onSubmit={(entry) =>
          saveEntry(ENTRY_SECTIONS[8], entry as ReferenceEntry)
        }
        onSave={() => setEditing(null)}
      />
      <ResumeJobPreferencesDialog
        open={jobPrefOpen}
        onOpenChange={(open) => {
          if (!open) setJobPrefOpen(false);
        }}
        initial={jobPreference}
        options={preferenceOptions}
        onSubmit={saveJobPreference}
        onSave={() => setJobPrefOpen(false)}
      />
    </>
  );
}
