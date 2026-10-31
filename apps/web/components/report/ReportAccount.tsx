"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { Field, FieldLabel } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Separator } from "@/components/ui/separator";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { Images, X, ImagePlus } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import type { User } from "@/lib/user";
import { signUploadUser } from "@/actions/files";
import { reportUser } from "@/actions/reports";
import { REAL_ID, useReportReasons } from "./use-report-reasons";

// Mirrors the backend: REPORT_MAX_IMAGES and the 5 MB image cap.
const MAX_FILES = 6;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif";

interface ReportAccountProps {
  user: User;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
export function ReportAccount({
  user,
  open,
  onOpenChange,
}: ReportAccountProps) {
  const router = useRouter();
  const locale = useLocale();
  const { reasons, isLoading } = useReportReasons("user", open);
  const [files, setFiles] = useState<File[]>([]);
  const [reasonId, setReasonId] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const previews = useMemo(
    () => files.map((f) => URL.createObjectURL(f)),
    [files],
  );
  useEffect(
    () => () => previews.forEach((u) => URL.revokeObjectURL(u)),
    [previews],
  );

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const selected = Array.from(e.target.files || []);
    if (selected.some((f) => f.size > MAX_BYTES))
      toast.error("Each photo must be 5 MB or smaller");
    const ok = selected.filter((f) => f.size <= MAX_BYTES);
    setFiles((prev) => [...prev, ...ok].slice(0, MAX_FILES));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index));

  const close = () => {
    setFiles([]);
    setReasonId("");
    setDescription("");
    onOpenChange(false);
  };

  /** Signed upload into the caller's own `report/{userId}/` folder. */
  const uploadAll = async (): Promise<string[] | null> => {
    const paths: string[] = [];
    for (const file of files) {
      const signed = await signUploadUser(file.name, "report");
      if (!signed.success) {
        toast.error(signed.error);
        return null;
      }
      const res = await fetch(signed.data.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!res.ok) {
        toast.error("Failed to upload a photo");
        return null;
      }
      paths.push(signed.data.path);
    }
    return paths;
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonId) {
      toast.error("Please select a reason");
      return;
    }
    if (!REAL_ID.test(user?.userId ?? "")) {
      toast.success("Thanks — this demo account can't be reported.");
      close();
      return;
    }
    setSubmitting(true);
    const imagePaths = await uploadAll();
    if (imagePaths === null) {
      setSubmitting(false);
      return;
    }
    const res = await reportUser({
      targetUserId: user.userId,
      reasonId,
      description: description.trim() || undefined,
      imagePaths,
    });
    setSubmitting(false);
    if (res.success) {
      toast.success("Report sent. Our team will review it.");
      close();
      return;
    }
    toast.error(res.error);
    if (res.code === "AUTH") router.push(`/${locale}/login`);
    if (res.code === "DUPLICATE") close();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-2xl">
        <form onSubmit={submit} className="contents">
          <DialogHeader>
            <DialogTitle>
              Report {user?.name?.toUpperCase() || "ACCOUNT"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Tell us why you are reporting this account.
            </DialogDescription>
          </DialogHeader>
          <Separator className="my-1" />
          <h2 className="text-sm">
            Photo ({files.length}/{MAX_FILES})
          </h2>
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept={ACCEPT}
            onChange={handleFileChange}
            className="hidden"
          />
          <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide">
            {Array.from({ length: MAX_FILES }).map((_, index) => {
              const preview = previews[index];
              const isNextSlot = index === files.length;

              return (
                <div key={index} className="relative w-20 h-16 shrink-0">
                  {preview ? (
                    <div className="relative w-full h-full">
                      {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
                      <img
                        src={preview}
                        alt="upload"
                        className="w-full h-full object-cover rounded-md"
                      />
                      <Button
                        type="button"
                        onClick={() => removeFile(index)}
                        className="absolute -top-0 -right-0 bg-red-500 text-card rounded-full w-5 h-5 flex items-center justify-center z-10 shadow-sm border-none cursor-pointer"
                      >
                        <X size={12} strokeWidth={3} />
                      </Button>
                    </div>
                  ) : (
                    <div
                      onClick={() => fileInputRef.current?.click()}
                      className="flex flex-col items-center justify-center w-full h-full rounded-md cursor-pointer transition-all border bg-muted hover:bg-card/70"
                    >
                      {isNextSlot ? (
                        <>
                          <Images className="w-8 h-8 text-muted-foreground " />
                          <span className="text-xs text-muted-foreground mt-1">
                            Upload
                          </span>
                        </>
                      ) : (
                        <ImagePlus className="w-6 h-6 text-muted-foreground" />
                      )}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <FieldGroup>
            <Field>
              <FieldLabel className="text-sm">
                Reason<span className="text-red-500">*</span>
              </FieldLabel>
              <Select value={reasonId} onValueChange={setReasonId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={isLoading ? "Loading…" : "Select a reason"}
                  />
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    {reasons.map((r) => (
                      <SelectItem key={r.id} value={r.id}>
                        {r.reason}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <Field>
                <FieldLabel>Description</FieldLabel>
                <Textarea
                  id="message"
                  placeholder="Enter your message..."
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="min-h-[200px]"
                />
              </Field>
            </Field>
          </FieldGroup>
          <DialogFooter className="flex flex-row justify-between">
            <DialogClose asChild>
              <Button
                type="button"
                variant="outline"
                onClick={close}
                className="rounded-sm cursor-pointer h-10  text-foreground bg-muted-foreground/10 hover:bg-muted-foreground/20 w-1/2"
              >
                Cancel
              </Button>
            </DialogClose>
            <Button
              type="submit"
              disabled={submitting}
              className="rounded-sm cursor-pointer h-10 text-card bg-orange-400 hover:bg-orange-500 w-2/3"
            >
              {submitting ? "Sending…" : "Submit"}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
