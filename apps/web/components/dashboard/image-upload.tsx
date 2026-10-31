"use client";

import { useRef, useState } from "react";
import { ImagePlus, Loader2, X } from "lucide-react";
import DbImage, { isStorageObjectUrl } from "@/components/common/DbImage";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { signUpload, type UploadScope } from "@/actions/files";
import { cn } from "@/lib/utils";

// Mirrors backend FilesService.validateImage (5MB, image/*).
const MAX_SIZE = 5 * 1024 * 1024;

interface ImageUploadProps {
  scope: UploadScope;
  value: string;
  onChange: (url: string) => void;
  label?: string;
  accept?: string;
  className?: string;
  /** Size classes for the preview box (default: 160 px square). */
  previewClassName?: string;
  /** `cover` crops to the box; `contain` shows the whole image. */
  imageFit?: "cover" | "contain";
  /** Called after a successful upload — lets the parent track uploads so it
   *  can clean up files abandoned on cancel (the `path` is what `DELETE /files`
   *  needs; the `url` identifies the upload in the form state). */
  onUpload?: (upload: { path: string; url: string }) => void;
}

/**
 * Single-image uploader. Picks a file, obtains a Supabase signed upload URL via
 * the `signUpload` server action, PUTs the bytes directly to Supabase, then
 * calls `onChange` with the resulting public URL. Render it inside any form
 * (TanStack Form `AppField` or plain `useState`) — it only needs `value` +
 * `onChange`.
 */
export function ImageUpload({
  scope,
  value,
  onChange,
  label = "Image",
  accept = "image/png,image/jpeg,image/webp",
  className,
  previewClassName = "h-40 w-40",
  imageFit = "cover",
  onUpload,
}: ImageUploadProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are allowed");
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error("Image must be 5MB or smaller");
      return;
    }

    setUploading(true);
    try {
      const signed = await signUpload(file.name, scope);
      if (!signed.success) {
        toast.error(signed.error);
        return;
      }

      const res = await fetch(signed.data.signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });
      if (!res.ok) {
        toast.error("Upload failed");
        return;
      }

      onChange(signed.data.publicUrl);
      onUpload?.({ path: signed.data.path, url: signed.data.publicUrl });
      toast.success("Image uploaded");
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  const open = () => inputRef.current?.click();

  // Same rule as the grids: a Storage object URL is the only image source. A
  // stored value that is not one — a leftover bundled `/sub-img` path, or an
  // object that is gone — must not render here either, or the edit dialog
  // would show an image the table and the storefront refuse to show.
  const storedImage = value && isStorageObjectUrl(value) ? value : null;

  const emptySlot = (caption: string) => (
    <button
      type="button"
      onClick={open}
      disabled={uploading}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-2 rounded border border-dashed border-border text-muted-foreground transition-colors hover:border-sky-500 hover:text-sky-500 disabled:opacity-50",
        previewClassName,
      )}
    >
      {uploading ? (
        <Loader2 className="size-6 animate-spin" />
      ) : (
        <ImagePlus className="size-6" />
      )}
      <span className="type-meta">{uploading ? "Uploading..." : caption}</span>
    </button>
  );

  return (
    <div className={className}>
      {value ? (
        <div className="relative inline-block">
          {storedImage ? (
            <DbImage
              src={storedImage}
              alt={label}
              width={160}
              height={160}
              className={cn(
                "cursor-pointer rounded border border-border",
                previewClassName,
                imageFit === "contain"
                  ? "object-contain bg-muted/40"
                  : "object-cover",
              )}
              onClick={open}
              fallback={emptySlot(`No ${label} stored`)}
            />
          ) : (
            emptySlot(`No ${label} stored`)
          )}
          <Button
            type="button"
            variant="destructive"
            size="icon"
            className="absolute -right-2 -top-2 h-6 w-6 rounded-full"
            onClick={(e) => {
              e.stopPropagation();
              onChange("");
            }}
            disabled={uploading}
            aria-label={`Remove ${label}`}
          >
            <X className="size-3" />
          </Button>
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center rounded bg-black/40">
              <Loader2 className="size-6 animate-spin text-white" />
            </div>
          )}
        </div>
      ) : (
        emptySlot(label)
      )}
      <input
        ref={inputRef}
        type="file"
        accept={accept}
        className="hidden"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handleFile(file);
          e.target.value = "";
        }}
      />
    </div>
  );
}
