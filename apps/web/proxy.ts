import createMiddleware from "next-intl/middleware";
import { NextRequest, NextResponse } from "next/server";
import { routing } from "./i18n/routing";
import { ACCESS_TOKEN_COOKIE } from "./lib/auth/session";

const intlMiddleware = createMiddleware(routing);

const LOCALE_RE = new RegExp(`^/(en|km)(?=/wanderer(?:/|$))`);

export default function proxy(req: NextRequest): NextResponse {
  const { pathname } = req.nextUrl;
  const host = req.headers.get("host") || "";

  // Check if the current hostname is the backoffice/admin subdomain
  const isAdminSubdomain =
    host.startsWith("phsar-backoffice.") ||
    host.startsWith("backoffice.") ||
    host.startsWith("admin.") ||
    host.startsWith("phsar-admin.");

  // =========================================================================
  // CASE 1: Request came via admin subdomain (e.g. admin.yourdomain.com)
  // =========================================================================
  if (isAdminSubdomain) {
    const hasToken = Boolean(req.cookies.get(ACCESS_TOKEN_COOKIE)?.value);

    // Root path on admin subdomain: dashboard if authenticated, login if not
    if (pathname === "/") {
      const url = req.nextUrl.clone();
      url.pathname = hasToken ? "/wanderer/dashboard" : "/wanderer/login";
      return NextResponse.rewrite(url);
    }

    // Direct /login route on admin subdomain
    if (pathname === "/login") {
      if (hasToken) {
        const url = req.nextUrl.clone();
        url.pathname = "/dashboard";
        return NextResponse.redirect(url);
      }
      const url = req.nextUrl.clone();
      url.pathname = "/wanderer/login";
      return NextResponse.rewrite(url);
    }

    // Direct /dashboard or /dashboard/* route on admin subdomain
    if (pathname === "/dashboard" || pathname.startsWith("/dashboard/")) {
      if (!hasToken) {
        const url = req.nextUrl.clone();
        url.pathname = "/login";
        url.searchParams.set("next", pathname);
        return NextResponse.redirect(url);
      }
      const url = req.nextUrl.clone();
      url.pathname = pathname.replace(/^\/dashboard/, "/wanderer/dashboard");
      return NextResponse.rewrite(url);
    }

    // Standard /wanderer/* routes (used by internal links, forms, and redirects)
    if (pathname === "/wanderer" || pathname.startsWith("/wanderer/")) {
      if (
        pathname === "/wanderer/dashboard" ||
        pathname.startsWith("/wanderer/dashboard/")
      ) {
        if (!hasToken) {
          const url = req.nextUrl.clone();
          url.pathname = "/login";
          url.searchParams.set("next", pathname.replace(/^\/wanderer/, ""));
          return NextResponse.redirect(url);
        }
      }
      return NextResponse.next();
    }

    // Any other path on admin subdomain: return 404 (do not leak public portal routes)
    return new NextResponse(null, { status: 404 });
  }

  // =========================================================================
  // CASE 2: Request came via main domain / portal (e.g. yourdomain.com)
  // =========================================================================

  // Strip stray locale prefix from /wanderer/* URLs
  const strayLocale = pathname.match(LOCALE_RE);
  if (strayLocale) {
    const url = req.nextUrl.clone();
    url.pathname = "/" + pathname.slice(strayLocale[0].length);
    return NextResponse.redirect(url);
  }

  // Accessing /wanderer/* on main portal:
  if (pathname === "/wanderer" || pathname.startsWith("/wanderer/")) {
    // If an explicit admin URL is defined in env, redirect there
    const adminOrigin = process.env.NEXT_PUBLIC_ADMIN_URL;
    if (adminOrigin) {
      const cleanPath = pathname.replace(/^\/wanderer/, "") || "/dashboard";
      const target = new URL(cleanPath, adminOrigin);
      return NextResponse.redirect(target);
    }

    // Local dev fallback when not using subdomains
    if (
      pathname === "/wanderer/dashboard" ||
      pathname.startsWith("/wanderer/dashboard/")
    ) {
      const hasToken = Boolean(req.cookies.get(ACCESS_TOKEN_COOKIE)?.value);
      if (!hasToken) {
        const url = req.nextUrl.clone();
        url.pathname = "/wanderer/login";
        url.searchParams.set("next", pathname);
        return NextResponse.redirect(url);
      }
    }
    return NextResponse.next();
  }

  // Locale-prefixed & public paths -> next-intl middleware
  return intlMiddleware(req);
}

export const config = {
  matcher: ["/((?!api|_next/static|_next/image|favicon.ico|.*\\..*).*)"],
};
