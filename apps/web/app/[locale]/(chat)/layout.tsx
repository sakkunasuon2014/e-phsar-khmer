import { NavBar } from "@/components/web/NavBar";
import { E2eBackupProvider } from "@/components/chat/e2e-backup-provider";
import { getUserProfile } from "@/actions/user";

export default async function ChatLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getUserProfile();

  return (
    <E2eBackupProvider userId={user?.id ?? null}>
      <NavBar user={user} />
      {children}
    </E2eBackupProvider>
  );
}
