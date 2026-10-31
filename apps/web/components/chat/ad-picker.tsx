"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { ImageOff, Loader2, Tag } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { loadMyAds } from "@/actions/my-ads";
import { formatPrice } from "@/lib/chat/format";
import type { Post } from "@/lib/posts";

export interface PickedAd {
  id: string;
  title: string;
}

type State =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; items: Post[] };

/**
 * "Share one of my ads" — the composer's ad tile picks one of the viewer's
 * active listings and stages it as the message's context card. Reads through
 * the existing /me → Manage Ads server action, so the JWT stays server-side.
 */
export function AdPicker({
  open,
  onOpenChange,
  onSelect,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSelect: (ad: PickedAd) => void;
}) {
  const t = useTranslations("Chat");

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="dark max-w-md border-white/10 bg-[#1b1b1b] text-foreground">
        <DialogHeader>
          <DialogTitle>{t("composer.adPickerTitle")}</DialogTitle>
        </DialogHeader>
        {/* Mounted only while open, so every open fetches afresh and the
            initial state can already be "loading" (no setState in an effect). */}
        {open && (
          <AdList
            onSelect={(ad) => {
              onSelect(ad);
              onOpenChange(false);
            }}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

function AdList({ onSelect }: { onSelect: (ad: PickedAd) => void }) {
  const t = useTranslations("Chat");
  const locale = useLocale();
  const [state, setState] = useState<State>({ status: "loading" });

  useEffect(() => {
    let cancelled = false;
    void loadMyAds("active", 1).then((res) => {
      if (cancelled) return;
      setState(
        res.error ? { status: "error" } : { status: "ready", items: res.items },
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state.status === "loading")
    return (
      <div className="flex items-center justify-center gap-2 py-10 text-sm text-muted-foreground">
        <Loader2 className="size-4 animate-spin" />
        {t("composer.adPickerLoading")}
      </div>
    );

  if (state.status === "error")
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("composer.adPickerError")}
      </p>
    );

  if (state.items.length === 0)
    return (
      <p className="py-10 text-center text-sm text-muted-foreground">
        {t("composer.adPickerEmpty")}
      </p>
    );

  return (
    <ul className="max-h-[60vh] space-y-1 overflow-y-auto">
      {state.items.map((post) => {
        const id = String(post.postId);
        const thumb = post.images?.[0];
        const price =
          post.price === null
            ? null
            : formatPrice(String(post.price), "USD", locale);
        return (
          <li key={id}>
            <button
              type="button"
              onClick={() => onSelect({ id, title: post.title })}
              className="flex w-full items-center gap-3 rounded-lg p-2 text-left transition-colors hover:bg-white/5"
            >
              <span className="relative flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-md bg-white/5">
                {thumb ? (
                  <Image
                    src={thumb}
                    alt=""
                    fill
                    sizes="48px"
                    className="object-cover"
                    unoptimized
                  />
                ) : (
                  <ImageOff className="size-4 text-muted-foreground" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm text-foreground">
                  {post.title}
                </span>
                <span className="block text-xs text-muted-foreground">
                  {price ?? t("listing.noPrice")}
                </span>
              </span>
              <Tag className="size-4 shrink-0 text-muted-foreground" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}
