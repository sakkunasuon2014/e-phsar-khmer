import { cn } from "@/lib/utils";

/** PhsarKhmer wordmark: "Khmer" is the only accented segment. */
export function BrandWordmark({ className }: { className?: string }) {
  return (
    <span className={cn("whitespace-nowrap tracking-tight", className)}>
      <span className="text-foreground">Phsar</span>
      <span className="text-[#00a0e9]">Khmer</span>
    </span>
  );
}
