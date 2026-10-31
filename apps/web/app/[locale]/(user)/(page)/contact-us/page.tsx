import ContactUsPage from "@/components/page/Contact-Us";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Contact Us",
  description: "Contact Us",
};
export default function Page() {
  return <ContactUsPage />;
}
