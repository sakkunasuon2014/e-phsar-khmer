import { NavBar } from "@/components/web/NavBar";
import Footer from "@/components/web/Footer";
import { getUserProfile } from "@/actions/user";
import { ReactionsProvider } from "@/components/reactions/reactions-provider";
import { E2eBackupProvider } from "@/components/chat/e2e-backup-provider";
import { getMyReactionIds } from "@/lib/api/reactions";

export default async function UserLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUserProfile();
  // One batched read of the viewer's reaction ids — every heart and bookmark
  // on the page starts from this seed, so no card has to fetch its own state.
  // Anonymous visitors skip it entirely: there is nothing to seed.
  const reactions = user ? await getMyReactionIds() : { liked: [], saved: [] };

  return (
    <E2eBackupProvider userId={user?.id ?? null}>
      <NavBar user={user} />
      <ReactionsProvider
        // Remount when the viewer changes: the provider seeds its sets once,
        // and this layout survives client-side navigations — without the key,
        // an in-tab login or account switch would keep the previous viewer's
        // sets until a hard reload.
        key={user?.username ?? "anon"}
        signedIn={Boolean(user)}
        initialLiked={reactions.liked}
        initialSaved={reactions.saved}
      >
        {children}
      </ReactionsProvider>
      <Footer />
    </E2eBackupProvider>
  );
}
