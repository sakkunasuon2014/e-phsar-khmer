import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/routing";

/**
 * Adding a billing address is a dialog on the list page now; this route stays
 * so links written against the old full-page form keep working.
 */
export default async function AddAddressPage() {
  return redirect({ href: "/me/billing-addresses", locale: await getLocale() });
}
