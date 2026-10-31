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
export function GridCardSell() {
  const router = useRouter();
  const t = useTranslations("Card");
  return (
    <Card className="mx-auto w-full max-w-md flex flex-col bg-gradient-to-b from-[#00a0e9] to-[#00a0e9] text-white rounded-sm shadow-lg">
      <CardHeader>
        <CardTitle className="text-center py-2 ">{t("title")}</CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-center type-body px-2  opacity-90">{t("des")}</p>
      </CardContent>
      <CardFooter className="mt-auto p-3 border-none leading-relaxed ">
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
