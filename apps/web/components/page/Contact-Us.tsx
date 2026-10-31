import Link from "next/link";
import Image from "next/image";
import { CONTACT_EMAIL } from "@/lib/site";
import { Mail, Phone, Clock8 } from "lucide-react";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/components/ui/accordion";

const CONTACTS = [
  {
    label: "Cellcard",
    number: "092724724",
    icon: "/contact/cellcard.png",
    color: "text-[#00a0e9]",
  },
  {
    label: "Smart",
    number: "081724724",
    icon: "/contact/smart.png",
    color: "text-[#00a0e9]",
  },
  {
    label: "Smart",
    number: "093724724",
    icon: "/contact/smart.png",
    color: "text-[#00a0e9]",
  },
];

const BUSINESS_HOURS = [
  { day: "Monday", time: "08:00AM - 05:00PM" },
  { day: "Tuesday", time: "08:00AM - 05:00PM" },
  { day: "Wednesday", time: "08:00AM - 05:00PM" },
  { day: "Thursday", time: "08:00AM - 05:00PM" },
  { day: "Friday", time: "08:00AM - 05:00PM" },
  { day: "Saturday", time: "08:00AM - 12:00PM" },
  { day: "Sunday", time: "Close" },
];

export default function ContactUs() {
  return (
    <div className="h-[calc(100vh-140px)] mx-auto w-full bg-muted">
      <div className="px-4 py-4 bg-muted">
        <div className="max-w-4xl mx-auto w-full px-4 pb-2">
          <Breadcrumbs
            items={[{ label: "Home", href: "/" }, { label: "Contact Us" }]}
          />
        </div>
      </div>

      <main className="max-w-4xl mx-auto px-4 pb-20">
        <div className="bg-card rounded-sm shadow-sm  overflow-hidden">
          <div className="p-6">
            <h1 className="type-page-title mb-6 text-foreground">Contact Us</h1>
            <div className="flex flex-wrap gap-6 mb-2">
              {CONTACTS.map((contact, index) => (
                <div key={index} className="flex items-center gap-2">
                  <div className="relative w-10 h-10 rounded-full overflow-hidden border border-gray-100 ">
                    <Image
                      src={contact.icon}
                      alt={contact.label}
                      fill
                      className="object-cover"
                    />
                  </div>
                  <div className="flex flex-col">
                    <span className="type-meta text-muted-foreground">
                      {contact.label}
                    </span>
                    <Link
                      href={`tel:${contact.number}`}
                      className="text-[#00a0e9] type-nav cursor-pointer hover:underline"
                    >
                      {contact.number}
                    </Link>
                  </div>
                </div>
              ))}
            </div>
            <div className="border-t border-gray-200 dark:border-muted my-4" />
            <div className="flex items-center gap-3 mb-2">
              <Mail size={18} className="text-foreground" />
              <Link
                href={`mailto:${CONTACT_EMAIL}`}
                className="text-[#00a0e9] hover:underline"
              >
                {CONTACT_EMAIL}
              </Link>
            </div>
            <div className="border-t border-gray-200 dark:border-muted my-4" />
            <Accordion type="single" collapsible className="w-full border-none">
              <AccordionItem value="hours" className="border-none">
                <AccordionTrigger className="hover:no-underline py-0 group cursor-pointer">
                  <div className="flex items-center gap-2 type-body-sm">
                    <Clock8 size={18} className="text-gray-400" />
                    <span className="text-[#00a0e9] font-medium">Open</span>
                    <span className="text-gray-400 mx-1">•</span>
                    <span className="text-gray-600 dark:text-gray-300">
                      08:00AM - 05:00PM
                    </span>
                  </div>
                </AccordionTrigger>
                <AccordionContent className="pt-4 pb-0 px-3">
                  <div className="space-y-3 max-w-auto">
                    {BUSINESS_HOURS.map((item) => (
                      <div
                        key={item.day}
                        className="flex justify-between items-center"
                      >
                        <span className="type-nav text-foreground">
                          {item.day}
                        </span>
                        <span className="type-body-sm text-foreground">
                          {item.time}
                        </span>
                      </div>
                    ))}
                  </div>
                </AccordionContent>
              </AccordionItem>
            </Accordion>
            <div className="flex flex-col sm:flex-row gap-3 mt-6 ">
              <Link
                href={`mailto:${CONTACT_EMAIL}`}
                className="flex-1 bg-[#00a0e9] hover:bg-[#008ccb] text-white py-2 rounded-sm transition-all flex items-center justify-center gap-2 type-nav tracking-wide cursor-pointer"
              >
                <Mail size={24} /> Email
              </Link>
              <Link
                href="tel:092724724"
                className="flex-1 bg-[#f7941d] hover:bg-[#e68512] text-white py-2 rounded-sm transition-all flex items-center justify-center gap-2 type-nav tracking-wide cursor-pointer"
              >
                <Phone size={24} /> Call
              </Link>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
