import { LoginForm } from "@/components/auth/LoginForm";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Login",
  description: "PhsarKhmer marketplace",
};
export default function LoginPage() {
  return (
    <div className="flex min-h-svh flex-col items-center justify-center bg-muted p-6 md:p-10">
      {/* Same card size as the admin login; widen to `max-w-sm md:max-w-4xl`
          together with LoginForm's image column if the artwork returns. */}
      <div className="w-full max-w-md">
        <LoginForm />
      </div>
    </div>
  );
}
