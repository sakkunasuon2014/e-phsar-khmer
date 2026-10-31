import { useRef } from "react";
import { useTranslations } from "next-intl";
import { Upload, X } from "lucide-react";
import { signUpload, type UploadSignFn } from "@/actions/files";
import { toast } from "@/components/ui/sonner";

/**
 * Drag/drop + click photo picker. Signs a Supabase upload via a
 * `/files/sign` server action — admin session by default; pass
 * `signFn={signUploadUser}` for the user session — then uploads the bytes
 * directly to the signed URL. Reports the public URL through `onUploaded`
 * and/or the full `{ url, path }` pair through `onSigned` (the storage path
 * is required when creating a listing).
 *
 * The heading and cap come from the subcategory's own `field_schema` via the
 * post form: the jobs forms declare a single "Logo" slot (`max: 1`) while
 * every other photo-bearing form declares 8, so neither is a constant here.
 */
export default function ImageUpload({
  images,
  onChange,
  onUploaded,
  signFn = signUpload,
  onSigned,
  title = "Photos",
  max = 8,
}: {
  images: File[];
  onChange: (files: File[]) => void;
  onUploaded?: (url: string) => void;
  signFn?: UploadSignFn;
  onSigned?: (photo: { url: string; path: string }) => void;
  /** Bold heading above the dropzone (the schema's `photos` label). */
  title?: string;
  /** How many photos this subcategory accepts (the schema's `photos.max`). */
  max?: number;
}) {
  const t = useTranslations("PostForm");
  const inputRef = useRef<HTMLInputElement>(null);

  // Upload a single new file via /files/sign (scope=listing) and surface the
  // resulting public URL (+ storage path). The parent collects URLs for the
  // eventual submit; removal reconciliation is a tracked follow-up.
  const uploadOne = async (file: File) => {
    const signed = await signFn(file.name, "listing");
    if (!signed.success) {
      toast.error(signed.error);
      return;
    }
    const res = await fetch(signed.data.signedUrl, {
      method: "PUT",
      body: file,
      headers: { "Content-Type": file.type },
    });
    if (res.ok) {
      onUploaded?.(signed.data.publicUrl);
      onSigned?.({ url: signed.data.publicUrl, path: signed.data.path });
    } else toast.error(t("uploadFailed"));
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files).filter((f) =>
      f.type.startsWith("image/"),
    );
    const room = Math.max(0, max - images.length);
    const newFiles = files.slice(0, room);
    onChange([...images, ...newFiles].slice(0, max));
    void Promise.all(newFiles.map(uploadOne));
  };

  const handleFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    const room = Math.max(0, max - images.length);
    const newFiles = files.slice(0, room);
    onChange([...images, ...newFiles].slice(0, max));
    void Promise.all(newFiles.map(uploadOne));
  };

  const remove = (i: number) => onChange(images.filter((_, idx) => idx !== i));

  return (
    <div>
      <div className="flex justify-between items-center mb-2">
        <label className="type-card-heading text-foreground">{title}</label>
        <span className="type-meta text-muted-foreground">
          {t("maxPhotos", { count: images.length, max })}
        </span>
      </div>

      {images.length > 0 && (
        <div className="flex flex-wrap gap-2 mb-3">
          {images.map((f, i) => (
            <div
              key={i}
              className="relative w-20 h-20 rounded-lg overflow-hidden border border-gray-200 group"
            >
              {/* eslint-disable-next-line @next/next/no-img-element -- client-side object URL preview */}
              <img
                src={URL.createObjectURL(f)}
                alt=""
                className="w-full h-full object-cover"
              />
              <button
                onClick={() => remove(i)}
                className="absolute top-1 right-1 w-5 h-5 rounded-sm bg-black/60 text-white flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
              >
                <X className="w-3 h-3" />
              </button>
              {i === 0 && (
                <span className="absolute bottom-0 left-0 right-0 bg-[#00a0e9] text-white type-discount text-center py-0.5">
                  {t("cover")}
                </span>
              )}
            </div>
          ))}
          {images.length < max && (
            <button
              onClick={() => inputRef.current?.click()}
              className="w-20 h-20 rounded-sm border-2 border-dashed border-muted flex items-center justify-center text-gray-400 hover:border-[#00a0e9] hover:text-[#00a0e9] transition-colors"
            >
              +
            </button>
          )}
        </div>
      )}

      {images.length === 0 && (
        <div
          onDrop={handleDrop}
          onDragOver={(e) => e.preventDefault()}
          onClick={() => inputRef.current?.click()}
          className="border-2 border-dashed border-gray-200 bg-gray-50 rounded-sm p-12 flex flex-col items-center gap-2 cursor-pointer hover:border-[#00a0e9] hover:bg-[#e1f3fb] transition-all"
        >
          <Upload className="w-10 h-10 text-[#00a0e9]" />
          <p className="type-body-sm text-gray-500">
            {t("dropTitle")}{" "}
            <span className="text-[#00a0e9] font-semibold underline">
              {t("browse")}
            </span>
          </p>
          <p className="type-meta text-gray-400">{t("supported")}</p>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        multiple
        accept="image/*"
        className="hidden"
        onChange={handleFile}
      />
    </div>
  );
}
