"use client";

export function FieldLabel({
  label,
  required,
}: {
  label: string;
  required?: boolean;
}) {
  return (
    <label className="block type-nav text-card-foreground mb-1.5">
      {label} {required && <span className="text-red-500">*</span>}
    </label>
  );
}
