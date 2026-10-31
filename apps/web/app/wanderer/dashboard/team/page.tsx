import TeamClient from "./TeamClient";
import { getTeamUsers } from "@/actions/admin-users";
import { getCurrentUser } from "@/actions/user";
import { redirect } from "next/navigation";

export default async function Page() {
  const user = await getCurrentUser();
  // Only super_admin can access the Team management page.
  if (!user || user.role !== "super_admin") {
    redirect("/wanderer/dashboard");
  }

  const initialData = await getTeamUsers().catch(() => undefined);
  return <TeamClient initialData={initialData} />;
}
