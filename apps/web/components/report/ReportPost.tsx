"use client";

import { useState } from "react";
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
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { FieldGroup } from "@/components/ui/field";
import { toast } from "@/components/ui/sonner";
import type { Post } from "@/lib/posts";
import { reportListing } from "@/actions/reports";
import { REAL_ID, useReportReasons } from "./use-report-reasons";

interface ReportPostProps {
  post: Post;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}
export function ReportPost({ post, open, onOpenChange }: ReportPostProps) {
  const router = useRouter();
  const locale = useLocale();
  const { reasons, isLoading } = useReportReasons("listing", open);
  const [reasonId, setReasonId] = useState("");
  const [description, setDescription] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const listingId = String(post?.postId ?? "");

  const close = () => {
    setReasonId("");
    setDescription("");
    onOpenChange(false);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reasonId) {
      toast.error("Please choose a reason");
      return;
    }
    // Mock cards carry numeric ids and have no row to report — inert, like
    // the demo hearts.
    if (!REAL_ID.test(listingId)) {
      toast.success("Thanks — this demo listing can't be reported.");
      close();
      return;
    }
    setSubmitting(true);
    const res = await reportListing({
      listingId,
      reasonId,
      description: description.trim() || undefined,
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
            <DialogTitle className="text-lg">
              Report {post?.title ? post.title.toUpperCase() : "Post"}
            </DialogTitle>
            <DialogDescription className="sr-only">
              Please provide details about why you are reporting this post.
            </DialogDescription>
          </DialogHeader>
          <Separator />
          <FieldGroup>
            <Field>
              <FieldLabel className="text-sm">
                Reason <span className="text-red-500">*</span>
              </FieldLabel>
              <Select value={reasonId} onValueChange={setReasonId}>
                <SelectTrigger>
                  <SelectValue
                    placeholder={isLoading ? "Loading…" : "Choose Reason"}
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
                <FieldLabel className="text-sm">Description</FieldLabel>
                <Textarea
                  id="message"
                  placeholder="Enter your message..."
                  maxLength={2000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="h-[180px] overflow-y-auto resize-none rounded-sm"
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
                className="rounded-sm cursor-pointer h-10 text-foreground bg-muted-foreground/10 hover:bg-muted-foreground/20 w-1/3"
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
