"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import Image from "next/image";
import { toast } from "@/components/ui/sonner";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { updateAdminLocale } from "@/actions/admin-locale";

/**
 * The same flag picker the storefront NavBar uses (`components/LocalSelector`),
 * kept in sync by hand because the admin surface changes locale through a
 * cookie + `router.refresh()`, never through the URL segment.
 */
const LANGUAGES = [
  { value: "en", label: "English", icon: "/flag/uk.png" },
  { value: "km", label: "ខ្មែរ", icon: "/flag/khmer.png" },
];

export function LocaleSwitcher() {
  const locale = useLocale();
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  const handleChange = (next: string) => {
    if (next === locale) return;
    startTransition(async () => {
      const result = await updateAdminLocale(next);
      if (result.success) {
        router.refresh();
      } else {
        toast.error(result.error || "Failed to switch language");
      }
    });
  };

  const current =
    LANGUAGES.find((language) => language.value === locale) ?? LANGUAGES[0];

  return (
    <DropdownMenu modal={false}>
      <DropdownMenuTrigger asChild className="cursor-pointer">
        <Button
          variant="ghost"
          size="icon-lg"
          disabled={isPending}
          aria-label="Switch language"
          className="h-10 w-10 rounded-full transition-all duration-200 hover:bg-muted/60"
        >
          <Image
            src={current.icon}
            alt={current.label}
            width={20}
            height={20}
            className="rounded-sm"
          />
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="center"
        sideOffset={10}
        className="w-50 rounded-lg shadow-xl"
      >
        <DropdownMenuLabel>Language</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuRadioGroup value={locale} onValueChange={handleChange}>
          {LANGUAGES.map((language) => (
            <DropdownMenuRadioItem
              key={language.value}
              value={language.value}
              className="cursor-pointer"
            >
              <Image
                src={language.icon}
                alt={language.label}
                width={20}
                height={20}
                className="rounded-md"
              />
              {language.label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
