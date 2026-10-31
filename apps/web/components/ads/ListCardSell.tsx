"use client";

import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { useRouter } from "@/i18n/routing";
import { useTranslations } from "next-intl";

export function ListCardSell() {
  const t = useTranslations("Card");
  const router = useRouter();

  return (
    <Card className="mx-auto w-full max-w-7xl bg-gradient-to-b from-blue-500 to-blue-700 text-white  rounded-sm shadow-lg">
      <CardHeader>
        <CardTitle className="text-start px-2">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="whitespace-pre-line type-body opacity-90 px-2">
          {t("des")}
        </p>
      </CardContent>
      <CardFooter className="p-3 border-none leading-relaxed ">
        <Button
          onClick={() => router.push({ pathname: "/post" })}
          size="sm"
          className="w-full bg-card rounded text-foreground px-18 py-4 type-nav hover:bg-muted cursor-pointer"
        >
          {t("button_post_ad")}
        </Button>
      </CardFooter>
    </Card>
  );
}
