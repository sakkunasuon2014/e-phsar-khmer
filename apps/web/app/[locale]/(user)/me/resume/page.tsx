import Resume from "@/components/profile/Resume";

import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Resume (CV)",
  description: "Resume (CV)",
};

export default function ResumePage() {
  return <Resume />;
}
