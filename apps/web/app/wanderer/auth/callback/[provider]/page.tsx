import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { SocialCallback } from "@/components/auth/SocialCallback";

export const metadata: Metadata = {
  title: "Signing in",
  description: "Completing social sign-in",
  robots: { index: false, follow: false },
};

/**
 * The admin OAuth callback. It sits under `/wanderer/*` (not under
 * `/dashboard`) so the proxy's admin-subdomain allow-list lets it through
 * while the dashboard's own layout gate stays untouched.
 */
export default async function AdminSocialCallbackPage({
  params,
}: {
  params: Promise<{ provider: string }>;
}) {
  const { provider } = await params;
  if (provider !== "google" && provider !== "facebook") notFound();

  return (
    <div className="flex min-h-svh items-center justify-center bg-muted p-6 md:p-10">
      <div className="w-full max-w-md">
        <SocialCallback
          provider={provider}
          mode="admin"
          loginHref="/wanderer/login"
        />
      </div>
    </div>
  );
}
