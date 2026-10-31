"use client";

import { useState } from "react";
import Image from "next/image";
import {
  Settings,
  Camera,
  IdCard,
  Forward,
  Heart,
  Bookmark,
  FolderOpen,
  BriefcaseBusiness,
  Info,
  BadgeDollarSign,
  Loader2,
} from "lucide-react";
import { Button } from "../ui/button";
import UserAvatar from "@/components/common/UserAvatar";
import { VerifiedAccountCheck } from "@/components/common/VerifiedAccountBadge";
import { Link, usePathname, useRouter } from "@/i18n/routing";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "@/components/ui/sonner";
import { uploadUserPhoto } from "@/actions/user-photo";
import Zoom from "yet-another-react-lightbox/plugins/zoom";
import "yet-another-react-lightbox/plugins/thumbnails.css";
import { useRef } from "react";
import "yet-another-react-lightbox/styles.css";
import Fullscreen from "yet-another-react-lightbox/plugins/fullscreen";
import Lightbox, { FullscreenRef } from "yet-another-react-lightbox";

/** The subset of profile identity the header renders. Fed by the real logged-in session (`/me` layout), whose follow counts come from `GET /users/me/follow-counts`. */
export interface ProfileUser {
  name: string;
  username: string;
  avatar: string;
  cover: string;
  following: number;
  follower: number;
  joinDate: string;
  /** Paid-plan badge (active subscription), derived by the backend. */
  verifiedAccount?: boolean;
}

interface ProfileHeaderProps {
  user: ProfileUser;
  isOwnProfile: boolean;
}

const PROFILE_TABS = [
  { value: "manage-ads", href: "/me", label: "Manage Ads", icon: FolderOpen },
  { value: "about", href: "/me/about", label: "About", icon: Info },
  {
    value: "jobs",
    href: "/me/job-applications",
    label: "Jobs",
    icon: BriefcaseBusiness,
  },
  { value: "saved", href: "/me/saved", label: "Saved", icon: Bookmark },
  { value: "likes", href: "/me/likes", label: "Likes", icon: Heart },
  {
    value: "subscriptions",
    href: "/me/subscriptions",
    label: "Subscriptions",
    icon: BadgeDollarSign,
  },
] as const;

export function MyProfileHeader({ user, isOwnProfile }: ProfileHeaderProps) {
  const [open, setOpen] = useState(false);
  const [image, setImage] = useState<string | null>(null);

  const [index, setIndex] = useState(0);
  const [avatarOverride, setAvatarOverride] = useState<string | null>(null);
  const [coverOverride, setCoverOverride] = useState<string | null>(null);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const [uploadingCover, setUploadingCover] = useState(false);
  const fullscreenRef = useRef<FullscreenRef>(null);
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const coverInputRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // The tabs are routes, so the default is derived from the URL: the highlight
  // stays correct on a hard load of a sub-tab and on back/forward (an
  // uncontrolled Tabs would keep showing "Manage Ads"). The key remounts Tabs
  // when the route changes so Radix's internal state can't go stale, while a
  // click still lights its own tab immediately — no waiting for navigation.
  const pathname = usePathname();
  const activeTab =
    PROFILE_TABS.find(({ href }) => href === pathname)?.value ??
    // /me/* pages that are not tabs (followers, membership, ...) keep the
    // default section lit instead of dropping the highlight entirely.
    "manage-ads";

  // These overrides reflect an upload immediately; router.refresh() keeps the
  // server data in sync.
  const displayedAvatar = avatarOverride ?? user.avatar;
  const displayedCover = coverOverride ?? user.cover;
  const handleImageClick = (src: string) => {
    setImage(src);
    setOpen(true);
  };

  async function handlePhotoUpload(kind: "avatar" | "cover", file: File) {
    if (!file.type.startsWith("image/")) {
      toast.error("Only image files are allowed");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Image must be 5MB or smaller");
      return;
    }
    const setUploading =
      kind === "avatar" ? setUploadingAvatar : setUploadingCover;
    setUploading(true);
    try {
      const res = await uploadUserPhoto(kind, file);
      if (!res.success) {
        toast.error(res.error);
        return;
      }
      const url =
        kind === "avatar" ? res.data.profilePhotoUrl : res.data.coverPhotoUrl;
      if (url) {
        if (kind === "avatar") setAvatarOverride(url);
        else setCoverOverride(url);
      }
      toast.success(`${kind === "avatar" ? "Avatar" : "Cover"} updated`);
      router.refresh();
    } catch {
      toast.error("Upload failed");
    } finally {
      setUploading(false);
    }
  }

  return (
    <div className="bg-card">
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        ref={avatarInputRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handlePhotoUpload("avatar", file);
          e.target.value = "";
        }}
      />
      <input
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        ref={coverInputRef}
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void handlePhotoUpload("cover", file);
          e.target.value = "";
        }}
      />
      <div className="w-full mx-auto max-w-7xl">
        <div className=" bg-card">
          <div
            onClick={() => {
              // With a cover, click to view (lightbox); empty cover + own
              // profile, click opens the upload picker.
              if (displayedCover) {
                handleImageClick(displayedCover);
              } else if (isOwnProfile) {
                coverInputRef.current?.click();
              }
            }}
            className={`relative h-[500px] md:h-[450px] lg:h-[400px] xl:h-[350px] w-full cursor-pointer ${
              displayedCover
                ? ""
                : "bg-gradient-to-b from-[#00a0e9]/10 via-[#b8e0f7]/25 to-[#00a0e9]/5"
            }`}
          >
            {displayedCover && (
              <Image
                src={displayedCover}
                alt="Cover"
                sizes="(max-width: 768px) 100vw, (max-width: 1200px) 50vw, 33vw"
                fill
                unoptimized
                className="object-cover rounded-b-lg"
              />
            )}
            {isOwnProfile && (
              <Button
                type="button"
                onClick={(e) => {
                  e.stopPropagation();
                  coverInputRef.current?.click();
                }}
                disabled={uploadingCover}
                className="absolute bottom-4 h-10 right-4 flex items-center gap-2 bg-card px-4 py-2 rounded-sm shadow-md hover:shadow-lg transition cursor-pointer"
              >
                {uploadingCover ? (
                  <Loader2 className="scale-135 text-foreground animate-spin" />
                ) : (
                  <Camera className="scale-135 text-foreground" />
                )}
                <span className="text-sm font-bold text-foreground">
                  {uploadingCover ? "Uploading..." : "Upload Cover"}
                </span>
              </Button>
            )}
          </div>
          <div className="px-6 pb-6">
            <div className="flex flex-col md:flex-row md:items-end gap-4 mt-1">
              <div
                onClick={() => {
                  // No photo yet: the circle shows initials, and on your own
                  // profile a click opens the picker (the cover behaves the
                  // same way rather than opening a lightbox with nothing in it).
                  if (displayedAvatar) {
                    handleImageClick(displayedAvatar);
                  } else if (isOwnProfile) {
                    avatarInputRef.current?.click();
                  }
                }}
                className="relative cursor-pointer"
              >
                <UserAvatar
                  src={displayedAvatar}
                  name={user.name}
                  className="w-32 h-32 border-4 border-card shadow-lg -mt-24 text-4xl"
                />
                {isOwnProfile && (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={(e) => {
                      e.stopPropagation();
                      avatarInputRef.current?.click();
                    }}
                    disabled={uploadingAvatar}
                    className="absolute bottom-1 right-2 bg-card text-foreground rounded-full h-8 w-8 flex items-center justify-center p-1 cursor-pointer"
                  >
                    {uploadingAvatar ? (
                      <Loader2 className="scale-110 animate-spin" />
                    ) : (
                      <Camera className="scale-110" />
                    )}
                  </Button>
                )}
              </div>

              <div className="flex-1">
                <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4">
                  <div className="">
                    <div className="flex items-center gap-1.5">
                      <h1 className="text-xl font-medium">{user.name}</h1>
                      {user.verifiedAccount && <VerifiedAccountCheck />}
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <p className="text-muted-foreground">@{user.username}</p>
                      <Button
                        variant="outline"
                        onClick={() => router.replace("/me/membership")}
                        className="h-6 rounded-full border-orange-500 text-orange-500 bg-transparent px-3 text-[10px] font-medium hover:bg-orange-500 hover:text-white transition-colors cursor-pointer"
                      >
                        Upgrade Account
                      </Button>
                    </div>
                    <div className="flex gap-4 mb-2">
                      <Link
                        href="/me/following"
                        className="text-sm transition-colors hover:text-[#00a0e9]"
                      >
                        {user.following} Following
                      </Link>
                      <Link
                        href="/me/followers"
                        className="text-sm transition-colors hover:text-[#00a0e9]"
                      >
                        {user.follower} Followers
                      </Link>
                    </div>
                    <p className="text-sm text-muted-foreground ">
                      Joined {user.joinDate}
                    </p>
                  </div>

                  <div className="flex gap-2 flex-wrap md:flex-nowrap">
                    <Button className="flex items-center gap-2 px-5 h-11 bg-card border border-gray-300 rounded-lg font-medium text-slate-600 hover:bg-muted/50 transition cursor-pointer">
                      <IdCard className="h-5 w-5" />
                      Resume (CV)
                    </Button>
                    <Button className="flex items-center justify-center h-11 w-11 bg-card border border-gray-300 rounded-lg text-slate-600 hover:bg-muted/50 transition cursor-pointer">
                      <Forward className="h-5 w-5" />
                    </Button>
                    <Button
                      onClick={() => router.replace("/settings")}
                      className="flex items-center justify-center h-11 w-11 bg-card border border-gray-300 rounded-lg text-slate-600 hover:bg-muted/50 transition cursor-pointer"
                    >
                      <Settings className="h-5 w-5" />
                    </Button>
                  </div>
                </div>
              </div>
            </div>
          </div>
          <hr className="border-border w-full" />
          <div className="flex items-center px-4 gap-4 h-14">
            <Tabs
              key={activeTab}
              defaultValue={activeTab}
              className="flex-1 min-w-0"
            >
              <TabsList
                variant="line"
                className="w-full justify-start overflow-x-auto pb-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden group-data-horizontal/tabs:h-auto"
              >
                {PROFILE_TABS.map(({ value, href, label, icon: Icon }) => (
                  <TabsTrigger
                    key={value}
                    value={value}
                    asChild
                    className="h-11 px-4 rounded-lg transition-colors hover:bg-[#00a0e9]/10 hover:text-[#00a0e9] data-active:text-[#00a0e9] data-active:hover:text-[#00a0e9] data-active:hover:bg-[#00a0e9]/10 data-active:after:bg-[#00a0e9] data-active:after:h-[3px]"
                  >
                    <Link
                      href={href}
                      className="flex items-center gap-2 font-medium transition"
                    >
                      <Icon className="h-4 w-4" />
                      {label}
                    </Link>
                  </TabsTrigger>
                ))}
              </TabsList>
            </Tabs>
            <Lightbox
              open={open}
              close={() => setOpen(false)}
              index={index}
              slides={image ? [{ src: image }] : []}
              plugins={[Zoom, Fullscreen]} // Cleaned up
              render={{
                buttonPrev: () => null,
                buttonNext: () => null,
              }}
              zoom={{
                maxZoomPixelRatio: 8, // High zoom limit
                doubleClickMaxStops: 3, // Three stages of zoom on double-click
              }}
              fullscreen={{ ref: fullscreenRef }}
              on={{
                view: ({ index: currentIndex }) => setIndex(currentIndex),
                // 4. Corrected Click Handler
                click: () => {
                  // Enter fullscreen when the main image is clicked
                  fullscreenRef.current?.enter();
                },
              }}
              animation={{ fade: 300 }}
              styles={{
                container: { backgroundColor: "rgba(0, 0, 0, .9)" },
                thumbnailsContainer: { backgroundColor: "rgba(0, 0, 0, 0.5)" },
              }}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
