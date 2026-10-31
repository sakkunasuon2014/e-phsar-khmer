import Image from "next/image";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
export default function SafetyTips() {
  return (
    <div className="h-[calc(100vh-144px)] mx-auto w-full bg-muted">
      <div className="px-4 bg-muted">
        <div className="max-w-7xl mx-auto w-full pb-2 pt-4">
          <Breadcrumbs
            items={[{ label: "Home", href: "/" }, { label: "Safety Tips" }]}
          />
        </div>
      </div>
      <div className="max-w-lg mx-auto">
        <div className="bg-card rounded-sm border border-border p-4 shadow-sm">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Image
              src="/user-img/warning.png"
              alt="warning icon"
              width={32}
              height={32}
              unoptimized
            />
            <h2 className="type-section-title text-[#e3281b]">
              Safety Tips for Buyers
            </h2>
          </div>
          <ol className="space-y-3 type-body text-foreground/80 list-decimal pl-6">
            <li>Do not send money before receiving the goods</li>
            <li>Check the item before you buy</li>
            <li>Payment after receiving the goods</li>
            <li>Meet the seller at a safe location</li>
          </ol>
        </div>
      </div>
    </div>
  );
}
