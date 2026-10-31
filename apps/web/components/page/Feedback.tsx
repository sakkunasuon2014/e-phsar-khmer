"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Field, FieldGroup, FieldLabel, FieldSet } from "@/components/ui/field";
import { Textarea } from "@/components/ui/textarea";
import { Input } from "@/components/ui/input";
import { Button } from "../ui/button";
import { X, ImagePlus, Images } from "lucide-react";
import { toast } from "@/components/ui/sonner";
import { submitFeedback } from "@/actions/feedback";

// Mirrors the backend: FEEDBACK_MAX_IMAGES and the 5 MB per-file cap.
const MAX_FILES = 6;
const MAX_BYTES = 5 * 1024 * 1024;
const ACCEPT = "image/jpeg,image/png,image/webp,image/gif,image/avif";

export default function Feedback() {
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [description, setDescription] = useState("");
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [isSubmitting, setIsSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // One object URL per file, revoked when the set changes — creating them
  // inline in render leaked a blob URL on every re-render.
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
    const tooBig = selected.filter((f) => f.size > MAX_BYTES);
    if (tooBig.length) toast.error("Each photo must be 5 MB or smaller");
    const ok = selected.filter((f) => f.size <= MAX_BYTES);
    setFiles((prev) => [...prev, ...ok].slice(0, MAX_FILES));
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const removeFile = (index: number) =>
    setFiles((prev) => prev.filter((_, i) => i !== index));

  const validate = () => {
    const next: Record<string, string> = {};
    if (!name.trim()) next.name = "Name is required";
    if (!phone.trim()) next.phone = "Phone is required";
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim()))
      next.email = "Enter a valid email";
    if (!description.trim()) next.description = "Please tell us something";
    setErrors(next);
    return Object.keys(next).length === 0;
  };

  const handleSubmit = async () => {
    if (isSubmitting || !validate()) return;
    setIsSubmitting(true);
    const fd = new FormData();
    fd.append("name", name.trim());
    fd.append("phone", phone.trim());
    if (email.trim()) fd.append("email", email.trim());
    fd.append("description", description.trim());
    files.forEach((f) => fd.append("images", f));

    const res = await submitFeedback(fd);
    setIsSubmitting(false);
    if (!res.success) {
      toast.error(res.error);
      return;
    }
    toast.success("Thanks — your feedback was sent.");
    setFiles([]);
    setName("");
    setPhone("");
    setEmail("");
    setDescription("");
    setErrors({});
  };

  const fieldError = (key: string) =>
    errors[key] ? (
      <p className="text-xs text-red-500 mt-1">{errors[key]}</p>
    ) : null;

  return (
    <div className="min-h-screen bg-muted pb-10">
      <div className="max-w-4xl mx-auto py-6 px-2">
        <h1 className="type-page-title text-foreground">Feedback</h1>

        <div className="bg-card rounded-sm border p-4 mt-4 ">
          Give feedback about your PhsarKhmer experience.
        </div>
        <div className="bg-card rounded-sm border p-4 mt-3">
          <h2 className="text-base">
            Photo ({files.length}/{MAX_FILES})
          </h2>
          <div className="border-t border-muted-foreground/20 mt-2" />
          <input
            type="file"
            ref={fileInputRef}
            multiple
            accept={ACCEPT}
            onChange={handleFileChange}
            className="hidden"
          />

          <div className="flex gap-2 overflow-x-auto pb-4 mt-2 scrollbar-hide">
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
        </div>
        <div className="bg-card rounded-sm border p-4 mt-4">
          <FieldSet>
            <FieldGroup className="space-y-1">
              <Field>
                <FieldLabel htmlFor="name">
                  Name<span className="text-red-500">*</span>
                </FieldLabel>
                <Input
                  id="name"
                  placeholder="Your Name"
                  className="rounded-sm"
                  maxLength={150}
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                />
                {fieldError("name")}
              </Field>
              <Field>
                <FieldLabel htmlFor="phone">
                  Phone<span className="text-red-500">*</span>
                </FieldLabel>
                <Input
                  id="phone"
                  type="tel"
                  placeholder="Your Phone Number"
                  className="rounded-sm"
                  maxLength={32}
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
                {fieldError("phone")}
              </Field>
              <Field>
                <FieldLabel htmlFor="email">Email</FieldLabel>
                <Input
                  id="email"
                  type="email"
                  placeholder="Your Email Address"
                  className="rounded-sm"
                  maxLength={255}
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
                {fieldError("email")}
              </Field>
              <Field>
                <FieldLabel htmlFor="feedback">
                  Tell us how we can improve here
                  <span className="text-red-500">*</span>
                </FieldLabel>
                <Textarea
                  id="feedback"
                  className="h-40 rounded-sm"
                  placeholder="Your feedback helps us improve..."
                  maxLength={5000}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                />
                {fieldError("description")}
              </Field>
            </FieldGroup>
          </FieldSet>
        </div>
        <div className="bg-card rounded-sm border p-4 mt-4 text-center md:text-left">
          <p className="text-sm text-foreground">
            Thanks for taking the time to give us feedback. Though we can&apos;t
            review every submission, we use your input to improve the experience
            for everyone.
          </p>
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={isSubmitting}
            className="bg-orange-500 hover:bg-orange-600 text-card rounded-sm h-10 mt-4 w-full text-sm font-medium transition-all cursor-pointer"
          >
            {isSubmitting ? "Sending…" : "Submit"}
          </Button>
        </div>
      </div>
    </div>
  );
}
