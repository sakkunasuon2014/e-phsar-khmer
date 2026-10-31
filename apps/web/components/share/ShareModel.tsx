"use client";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import {
  IconBrandFacebook,
  IconBrandTelegram,
  IconBrandX,
  IconBrandWhatsapp,
} from "@tabler/icons-react";
import { Separator } from "../ui/separator";
import { useTranslations } from "next-intl";
import { toast } from "sonner";
import { IconCopy, IconCheck } from "@tabler/icons-react";

type ShareModalProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  url: string;
};
export default function ShareModal({
  open,
  onOpenChange,
  url,
}: ShareModalProps) {
  const t = useTranslations("Share");
  const [copied, setCopied] = useState(false);
  const shareLinks = {
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${url}`,
    telegram: `https://t.me/share/url?url=${url}`,
    twitter: `https://twitter.com/intent/tweet?url=${url}`,
    whatsapp: `https://wa.me/?text=${url}`,
  };
  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.error("Failed to copy!", err);
    }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-lg pb-8">
        <DialogHeader>
          <DialogTitle>{t("title")}</DialogTitle>
        </DialogHeader>
        <Separator className="my-1" />
        <div className="flex justify-center gap-4 py-4">
          <a
            href={shareLinks.facebook}
            target="_blank"
            className="p-1 bg-blue-500 rounded-full w-12 h-12 flex items-center justify-center"
          >
            <IconBrandFacebook
              className="scale-150 text-white"
              strokeWidth={1.5}
            />
          </a>

          <a
            href={shareLinks.telegram}
            target="_blank"
            className="p-1 bg-cyan-500 rounded-full w-12 h-12 flex items-center justify-center"
          >
            <IconBrandTelegram
              className="scale-150 text-white"
              strokeWidth={1.5}
            />
          </a>

          <a
            href={shareLinks.twitter}
            target="_blank"
            className="p-1 bg-black rounded-full w-12 h-12 flex items-center justify-center"
          >
            <IconBrandX className="scale-150 text-white" strokeWidth={1.5} />
          </a>

          <a
            href={shareLinks.whatsapp}
            target="_blank"
            className="p-1 bg-green-500 rounded-full w-12 h-12 flex items-center justify-center"
          >
            <IconBrandWhatsapp
              className="scale-150 text-white"
              strokeWidth={1.5}
            />
          </a>
        </div>
        <p className="text-center text-muted-foreground mb-3">{t("orCopy")}</p>
        <div className="relative flex items-center">
          <Input
            value={url}
            readOnly
            className="bg-muted/30 rounded-sm p-5 focus-visible:ring-0 focus-visible:ring-offset-0"
          />
          <Button
            size="icon"
            variant="ghost"
            className="absolute right-1 h-9 w-9 hover:bg-transparent"
            onClick={() => {
              handleCopy();
              toast.success(t("copied"), {
                position: "top-right",
              });
            }}
          >
            {copied ? (
              <IconCheck className="scale-150 h-4 w-4 text-green-500" />
            ) : (
              <IconCopy className="scale-150 h-4 w-4 text-muted-foreground hover:text-foreground" />
            )}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
