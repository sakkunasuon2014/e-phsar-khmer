import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import Chats from "@/components/home/Chats";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Chat");
  return { title: t("inbox.title") };
}

export default function ChatsPage() {
  return (
    // Sits under the site navbar like every other page: the workspace owns the
    // height (100dvh minus the 3.5rem bar and this page's top padding) and its
    // own scroll areas, so the document itself never scrolls.
    <div className="bg-muted min-h-[calc(100dvh-3.5rem)] py-0 pt-4">
      <div className="mx-auto">
        <Chats />
      </div>
    </div>
  );
}
