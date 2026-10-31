"use client";

import UserAvatar from "@/components/common/UserAvatar";
import type { SettingsUser } from "@/lib/auth/current-user";

/** "Sok Dara", falling back to the handle for an account with no name yet. */
export function displayName(me?: SettingsUser | null): string {
  const full = [me?.firstName, me?.lastName].filter(Boolean).join(" ");
  return full || me?.username || "";
}

/**
 * The avatar + name + @handle block both settings layouts open with. The photo
 * is a DB value, so it renders through UserAvatar: anything that is not a
 * storage object (including "no photo at all") degrades to an initials circle,
 * never a bundled stand-in.
 */
export function AccountIdentity({ me }: { me?: SettingsUser | null }) {
  const name = displayName(me);

  return (
    <div className="flex items-center gap-4 px-2">
      <UserAvatar
        src={me?.profilePhotoUrl}
        name={name}
        size={50}
        className="border border-gray-100 text-sm"
      />
      <div>
        {/* The card's link carries `group`; only the display name picks up
            the theme on hover — the @handle stays muted. */}
        <p className="font-medium text-foreground transition-colors group-hover:text-[#00a0e9]">
          {name}
        </p>
        <p className="type-body-sm text-muted-foreground">
          {me?.username ? `@${me.username}` : ""}
        </p>
      </div>
    </div>
  );
}
