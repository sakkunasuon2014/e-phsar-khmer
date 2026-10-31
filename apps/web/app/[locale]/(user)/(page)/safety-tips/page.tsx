import SafetyTips from "@/components/page/Safety-Tips";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Safety Tips",
  description: "Safety Tips",
};
export default function SafetyTipsPage() {
  return <SafetyTips />;
}
