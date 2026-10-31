import PrivacyPolicy from "@/components/page/Privacy-Policy";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy Policy - PhsarKhmer",
};
export default function PrivacyPolicyPage() {
  return <PrivacyPolicy />;
}
