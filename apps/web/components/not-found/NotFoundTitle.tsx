"use client";

import { useEffect } from "react";

/**
 * Keeps the browser tab reading `404 Not found - PhsarKhmer`.
 *
 * The two `not-found.tsx` boundaries already export `metadata = { title: … }`,
 * and that IS what the server puts in the initial `<head>` — verified against a
 * production build, every 404 shape. But Next re-resolves metadata from the
 * matched route when it renders the boundary on the client, and the page that
 * threw `notFound()` is no longer there to contribute a title, so the layout's
 * `title.default` (`app/[locale]/layout.tsx`) wins and the tab silently reverts
 * to the site name a moment after load. Setting it here covers every 404ing
 * route at once.
 *
 * The alternative — a `generateMetadata` on each route that can 404
 * (`category/[categorySlug]`, its `[subcategorySlug]` child, `[slug]/about`)
 * — would have to repeat each page's backend fetch just to learn it is going to
 * 404, since those fetch with `cache: "no-store"` and are not deduped.
 *
 * The ` - PhsarKhmer` suffix is the template in `app/[locale]/layout.tsx`, spelled
 * out because the template is not readable from here. Change it in both places.
 */
export default function NotFoundTitle() {
  useEffect(() => {
    document.title = "404 Not found - PhsarKhmer";
  }, []);

  return null;
}
