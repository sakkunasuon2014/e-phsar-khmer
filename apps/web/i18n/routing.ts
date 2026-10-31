import { defineRouting } from "next-intl/routing";
import { createNavigation } from "next-intl/navigation";

export const routing = defineRouting({
  locales: ["en", "km"],

  defaultLocale: "en",

  pathnames: {
    "/": {
      en: "/",
      km: "/",
    },
    "/login": {},
    "/register": {},
    "/otp": {},
    "/forgot-password": {},

    "/category": {},

    "/category/[categorySlug]": {},

    "/category/[categorySlug]/[subcategorySlug]": {},

    "/category/[categorySlug]/[subcategorySlug]/[brandOrType]": {},

    "/category/[categorySlug]/[subcategorySlug]/[brandOrType]/[modelSlug]": {},

    "/post": {},
    "/post/[slug]": {},
    "/[slug]": {},
    "/sell": {},

    "/about": {},
    "/contact": {
      en: "/contact",
      km: "/contact-haha",
    },

    "/all-ads": {
      en: "/all-ads",
      km: "/all-ads",
    },

    "/search": {},

    "/product/[brand]/[model]": {},

    "/insight": {},

    "/me": {},
    "/me/about": {},
    "/me/applied-jobs": {},
    "/me/billing-addresses": {},
    "/me/job-applications": {},
    "/me/likes": {},
    "/me/membership": {},
    "/me/saved": {},
    "/me/subscriptions": {},
    "/me/resume": {},
    "/me/followers": {},
    "/me/following": {},

    "/[username]": {},
    "/[username]/about": {},
    "/[username]/followers": {},
    "/[username]/following": {},

    "/premium-account": {},

    "/premium-account/[category]": {},
    "/checkout": {},
    "/settings": {},
    "/settings/edit-profile": {},
    "/settings/change-password": {},
    "/settings/change-username": {},
    "/settings/change-phone": {},
    "/settings/passkeys": {},
    "/settings/privacy": {},
    "/settings/devices": {},
    "/billing-addresses": {},
    "/billing-addresses/add": {},
    "/notifications": {},
    "/chats": {},
    "/contact-us": {},

    "/account-deletion": {},
    "/privacy-policy": {},

    "/feedback": {},

    "/posting-rule": {},

    "/safety-tips": {},
  },
});

export type Locale = (typeof routing.locales)[number];
export const { Link, redirect, usePathname, useRouter, getPathname } =
  createNavigation(routing);
