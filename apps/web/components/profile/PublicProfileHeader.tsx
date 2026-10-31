"use client";

import { useState } from "react";
import { useTranslations } from "next-intl";
import { usePathname, useSearchParams } from "next/navigation";
import Image from "next/image";
import { Link } from "@/i18n/routing";
import { Button } from "@/components/ui/button";
import UserAvatar from "@/components/common/UserAvatar";
import { VerifiedAccountCheck } from "@/components/common/VerifiedAccountBadge";
import type { User } from "@/lib/user";
import {
  profileTabHref,
  pushProfileTab,
  readProfileTab,
} from "@/lib/profile-tab";
import type { ProfileTab } from "@/lib/profile-tab";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PhoneCall,
  Mail,
  House,
  Info,
  Calendar,
  CircleCheckBig,
  Globe,
  Link2,
} from "lucide-react";
import Lightbox from "yet-another-react-lightbox";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/styles.css";
import { ThreeDotProfile } from "./ThreeDotProfile";
import { FollowButton } from "./FollowButton";
import { Separator } from "@/components/ui/separator";

export default function PublicProfileHeader({
  user,
  viewerId,
  initialFollowing = false,
}: {
  user: User;
  /** Signed-in viewer, or null/omitted when anonymous. */
  viewerId?: string | null;
  /** Whether that viewer already follows this profile. */
  initialFollowing?: boolean;
}) {
  const t = useTranslations("Profile");
  const pathname = usePathname();
  const activeList = readProfileTab(useSearchParams());

  const tab = pathname.includes("/about") ? "about" : "home";

  /**
   * Open a follower/following list under the header without leaving the page.
   *
   * These counts used to link to their own routes, so every click re-rendered
   * the whole profile. A plain click now swaps the list in place; a modified
   * one (new tab, download) is left to the browser, which is why the element
   * is still an anchor with a real, shareable href.
   */
  const openList = (
    event: React.MouseEvent<HTMLAnchorElement>,
    list: ProfileTab,
  ) => {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey)
      return;
    if (event.button !== 0) return;
    event.preventDefault();
    pushProfileTab(list);
  };

  const [open, setOpen] = useState(false);
  const [activeImage, setActiveImage] = useState("");

  const profileImg = user.avatar;
  const coverImg = user.cover;
  const hasCover = !!coverImg;

  const handleImageClick = (src: string) => {
    if (!src) return;
    setActiveImage(src);
    setOpen(true);
  };

  return (
    <div className="w-full pb-4 bg-muted">
      {hasCover ? (
        <div
          className="relative h-64 md:h-72 lg:h-[300px] w-full bg-slate-200 overflow-hidden cursor-pointer"
          onClick={() => handleImageClick(coverImg)}
        >
          <Image
            src={coverImg}
            alt={t("coverAlt")}
            width={1920}
            height={1080}
            className="object-cover hover:opacity-95 transition-opacity"
            priority
          />
        </div>
      ) : (
        <div className="h-20 w-full border-b border-muted/20" />
      )}

      <div className="bg-card w-full">
        <div className="max-w-7xl mx-auto px-6 pb-1">
          <div className="flex flex-row items-start gap-5">
            {/* ─── AVATAR WRAPPER UNIT ─── */}
            <div
              className={`relative shrink-0 cursor-pointer group z-10 w-[120px] h-[120px] md:w-[130px] md:h-[130px]
                        ${hasCover ? "-mt-[60px] md:-mt-[65px]" : "mt-4"}`}
              onClick={() => handleImageClick(profileImg)}
            >
              {/* The Single White Border Ring Container */}
              <div className="relative w-full h-full rounded-full border-[4px] border-card bg-card shadow-md">
                {/* Inner Image Mask — Only this layer hides the image corners */}
                <div className="w-full h-full rounded-full overflow-hidden relative">
                  <UserAvatar
                    src={profileImg}
                    name={user.name}
                    className="h-full w-full text-4xl"
                  />
                </div>

                {/* 🟢 THE STATUS INDICATOR DOT */}
                {/* Placed outside the hidden overflow mask so it displays safely on top of the rim */}
                <span className="absolute bottom-1 right-1 w-4 h-4 md:w-5 md:h-5 bg-emerald-500 rounded-full border-2 border-card z-20 shadow-sm" />
              </div>
            </div>

            <div className="flex-1 flex flex-row justify-between items-start pt-3 pb-4 gap-4 min-w-0">
              <div className="flex flex-col gap-1 min-w-0 space-y-1 mt-1">
                <div className="flex items-center gap-2 flex-wrap ">
                  <h1 className="type-page-title text-foreground">
                    {user.name}
                  </h1>
                  {user.verifiedAccount && <VerifiedAccountCheck />}
                </div>
                <p className="type-body-sm text-muted-foreground">
                  @{user.username}
                </p>

                <div className="flex items-center gap-4 type-body-sm text-muted-foreground">
                  {(
                    [
                      {
                        list: "following",
                        value: user.following,
                        label: t("following"),
                      },
                      {
                        list: "followers",
                        value: user.follower,
                        label: t("followers"),
                      },
                    ] as const
                  ).map(({ list, value, label }) => {
                    const active = activeList === list;
                    const className = `transition-colors hover:text-foreground ${
                      active ? "text-[#00a0e9]" : ""
                    }`;
                    const body = (
                      <>
                        <strong className="text-foreground font-semibold">
                          {value}
                        </strong>{" "}
                        {label}
                      </>
                    );
                    // The lists need a session, so an anonymous visitor gets
                    // the sign-in bounce the old routes performed.
                    return viewerId ? (
                      <a
                        key={list}
                        href={profileTabHref(pathname, list)}
                        onClick={(event) => openList(event, list)}
                        aria-current={active ? "page" : undefined}
                        className={className}
                      >
                        {body}
                      </a>
                    ) : (
                      <Link key={list} href="/login" className={className}>
                        {body}
                      </Link>
                    );
                  })}
                </div>
                <div className="flex items-center gap-2 type-meta text-muted-foreground flex-wrap">
                  <span className="flex items-center gap-1">
                    <Calendar size={12} />{" "}
                    {t("joined", { date: user.joinDate ?? "" })}
                  </span>
                  {user.verified && (
                    <span className="flex items-center gap-1 text-blue-500 font-medium">
                      <CircleCheckBig size={12} /> {t("verified")}
                    </span>
                  )}
                  {user.email && (
                    <a
                      href={`mailto:${user.email}`}
                      className="w-6 h-6 rounded-full border border-muted flex items-center justify-center hover:bg-muted/50"
                    >
                      <Mail size={11} />
                    </a>
                  )}
                  {user.google && (
                    <a
                      href={`https://mail.google.com`}
                      target="_blank"
                      className="w-6 h-6 rounded-full border flex items-center justify-center"
                    >
                      <Globe size={11} />
                    </a>
                  )}
                  {user.userlink && (
                    <a
                      href={user.userlink}
                      className="w-6 h-6 rounded-full border flex items-center justify-center"
                    >
                      <Link2 size={11} />
                    </a>
                  )}
                </div>
              </div>
              <div className="flex items-center gap-2 shrink-0 pt-1">
                <FollowButton
                  key={user.userId}
                  userId={user.userId}
                  initialFollowing={initialFollowing}
                  viewerId={viewerId}
                  variant="profile"
                  className="rounded-full bg-card hover:bg-card/80 text-foreground px-5 h-9 type-nav shadow-sm"
                />
                {/* Each contact button renders only when the profile actually
                    carries that detail: a real profile exposes neither a phone
                    nor an email, and a button whose only outcome is
                    `tel:undefined` is worse than no button. */}
                {user.phone?.[0] && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      (window.location.href = `tel:${user.phone?.[0]}`)
                    }
                    className="rounded-full border-muted-foreground/30 text-[#00a5e4] h-9 w-9"
                  >
                    <PhoneCall className="h-4 w-4" />
                  </Button>
                )}
                {user.email && (
                  <Button
                    variant="outline"
                    size="icon"
                    onClick={() =>
                      (window.location.href = `mailto:${user.email}`)
                    }
                    className="rounded-full border-muted-foreground/30 text-[#00a5e4] h-9 w-9"
                  >
                    <Mail className="h-4 w-4" />
                  </Button>
                )}
                <ThreeDotProfile user={user} viewerId={viewerId} />
              </div>
            </div>
          </div>
          <Separator className="mb-3" />
          <Tabs defaultValue={tab || "home"}>
            <TabsList variant="line">
              <TabsTrigger value="home" asChild>
                <Link
                  href={{
                    pathname: "/[username]",
                    params: { username: user.username },
                  }}
                  className="flex items-center gap-2 px-4 h-11  font-medium transition"
                >
                  <House />
                  {t("home")}
                </Link>
              </TabsTrigger>
              <TabsTrigger value="about" asChild>
                <Link
                  href={{
                    pathname: "/[username]/about",
                    params: { username: user.username },
                  }}
                  className="flex items-center gap-2 px-4 h-11  font-medium transition"
                >
                  <Info />
                  {t("about")}
                </Link>
              </TabsTrigger>
            </TabsList>
          </Tabs>
        </div>
      </div>
      <Lightbox
        open={open}
        close={() => setOpen(false)}
        slides={activeImage ? [{ src: activeImage }] : []}
        plugins={[Zoom]}
        render={{
          buttonPrev: () => null,
          buttonNext: () => null,
        }}
      />
    </div>
  );
}
