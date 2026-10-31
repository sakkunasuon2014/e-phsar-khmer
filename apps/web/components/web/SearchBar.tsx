"use client";

import { useEffect, useMemo, useState } from "react";
import { useParams, useSearchParams } from "next/navigation";
import { useLocale, useTranslations } from "next-intl";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
} from "@/components/ui/input-group";
import DbImage from "@/components/common/DbImage";
import { usePathname, useRouter } from "@/i18n/routing";
import { getSearchCategories } from "@/actions/listings";
import {
  CATEGORY_PARAM,
  MAX_QUERY_LENGTH,
  Q_PARAM,
  SUB_PARAM,
  normalizeQuery,
} from "@/lib/search-params";
import {
  IconSelector,
  IconSearch,
  IconChevronDown,
  IconLayoutGrid,
} from "@tabler/icons-react";

/** What the search is limited to: everything, one category, or one subcategory. */
type Scope =
  | { kind: "all" }
  | { kind: "category"; slug: string }
  | { kind: "sub"; slug: string; categorySlug: string };

/**
 * The scope the current route implies: a category or subcategory page scopes
 * the bar to that page, everywhere else stays "All Categories". Read from the
 * route params, never the pathname: next-intl's `usePathname` returns the
 * pathname TEMPLATE (`/category/[categorySlug]/[subcategorySlug]`), not the
 * concrete URL.
 */
function scopeFromParams(
  categorySlug: string | undefined,
  subcategorySlug: string | undefined,
): Scope {
  if (!categorySlug) return { kind: "all" };
  return subcategorySlug
    ? { kind: "sub", slug: subcategorySlug, categorySlug }
    : { kind: "category", slug: categorySlug };
}

/**
 * Header search: a category scope dropdown (real catalogue, loaded on first
 * open) + keyword input. Submitting goes to `/search?q=…&category=…|sub=…`.
 * On the search page itself the bar mirrors the URL; on a category or
 * subcategory page it mirrors that page's scope, so searching from
 * "Car for Sale" starts inside Car for Sale (captain, 2026-10-26).
 */
export default function SearchBar() {
  const t = useTranslations("Search");
  const locale = useLocale();
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const onSearchPage = pathname === "/search";
  const params = useParams<{
    categorySlug?: string;
    subcategorySlug?: string;
  }>();

  const urlQ = onSearchPage ? (searchParams.get(Q_PARAM) ?? "") : "";
  const urlCategory = onSearchPage ? searchParams.get(CATEGORY_PARAM) : null;
  const urlSub = onSearchPage ? searchParams.get(SUB_PARAM) : null;
  const routeScope = useMemo(
    () => scopeFromParams(params.categorySlug, params.subcategorySlug),
    [params.categorySlug, params.subcategorySlug],
  );

  const [open, setOpen] = useState(false);
  const [text, setText] = useState(urlQ);
  const [scope, setScope] = useState<Scope>(routeScope);

  const categories = useQuery({
    queryKey: ["search-categories", locale],
    queryFn: () => getSearchCategories(locale),
    staleTime: 10 * 60 * 1000,
    // Needed to open the menu, or to name a scope that came from the URL.
    // A category route needs it too — that is where its label comes from.
    enabled: open || !!urlCategory || !!urlSub || routeScope.kind !== "all",
  });

  // The keyword mirrors the search page's `q`. Route changes alone never
  // touch it, so typing then browsing to another category keeps the text.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setText(urlQ);
  }, [urlQ]);

  // The scope mirrors the search page's URL and follows the category route
  // everywhere else. Deliberately NOT keyed on the category list: its lazy
  // load must not reset a scope the user just picked.
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setScope(
      urlSub
        ? { kind: "sub", slug: urlSub, categorySlug: urlCategory ?? "" }
        : urlCategory
          ? { kind: "category", slug: urlCategory }
          : routeScope,
    );
  }, [urlCategory, urlSub, routeScope]);

  const scopeLabel = (() => {
    if (scope.kind === "all") return t("allCategoriesOption");
    for (const c of categories.data ?? []) {
      if (scope.kind === "category" && c.slug === scope.slug) return c.name;
      const s = c.subcategories.find((x) => x.slug === scope.slug);
      if (scope.kind === "sub" && s) return s.name;
    }
    return t("allCategoriesOption");
  })();

  const submit = () => {
    const q = normalizeQuery(text);
    const query: Record<string, string> = {};
    if (q) query[Q_PARAM] = q;
    if (scope.kind === "category") query[CATEGORY_PARAM] = scope.slug;
    if (scope.kind === "sub") {
      const parent =
        scope.categorySlug ||
        categories.data?.find((c) =>
          c.subcategories.some((s) => s.slug === scope.slug),
        )?.slug;
      if (parent) query[CATEGORY_PARAM] = parent;
      query[SUB_PARAM] = scope.slug;
    }
    router.push({ pathname: "/search", query });
  };

  return (
    <form
      role="search"
      className="flex flex-1 items-center max-w-lg"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <div className="flex w-full items-center border rounded bg-card h-[42px] focus-within:ring-1 focus-within:ring-[#00a0e9] focus-within:border-[#00a0e9] transition-all duration-100 shadow-sm">
        <DropdownMenu open={open} onOpenChange={setOpen} modal={false}>
          <DropdownMenuTrigger asChild>
            <Button
              type="button"
              variant="ghost"
              className="relative flex items-center rounded-l-xs rounded-r-none bg-card text-foreground hover:bg-muted/60 h-full px-4 focus:ring-0 whitespace-nowrap type-nav w-[120px] sm:w-[170px] justify-between transition-colors duration-75 cursor-pointer"
            >
              <span className="absolute left-1/2 -translate-x-1/2 truncate max-w-[70px] sm:max-w-[115px] text-center">
                {scopeLabel}
              </span>
              <IconChevronDown className="ml-auto scale-80 text-card-foreground" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="start"
            sideOffset={8}
            className=" w-[340px] max-h-[68vh] overflow-y-auto overflow-x-hidden p-1.5 rounded-xl border bg-card shadow-2xl animate-in fade-in-0 zoom-in-95 duration-100"
          >
            <DropdownMenuItem
              onClick={() => setScope({ kind: "all" })}
              className="flex items-center gap-3 px-3 py-2 cursor-pointer mb-1 outline-none hover:bg-muted/60"
            >
              <div className="flex w-6 justify-center">
                <IconSelector className="text-card-foreground" />
              </div>
              <span className="type-nav text-card-foreground">
                {t("allCategoriesOption")}
              </span>
            </DropdownMenuItem>
            <div className="my-1 h-px bg-border/60" />
            {categories.isLoading && (
              <p className="px-4 py-2 type-body-sm text-muted-foreground">
                {t("loading")}
              </p>
            )}
            {(categories.data ?? []).map((category) => (
              <div key={category.slug}>
                <DropdownMenuItem
                  onClick={() =>
                    setScope({ kind: "category", slug: category.slug })
                  }
                  className="flex items-center gap-3 px-4 py-2 rounded-lg cursor-pointer outline-none transition-all duration-75 hover:bg-muted/60"
                >
                  <span className="flex size-7 shrink-0 items-center justify-center">
                    {category.icon ? (
                      <DbImage
                        src={category.icon}
                        alt=""
                        width={28}
                        height={28}
                        className="object-contain"
                      />
                    ) : (
                      <IconLayoutGrid className="size-5 text-muted-foreground" />
                    )}
                  </span>
                  <span className="type-nav text-card-foreground ">
                    {category.name}
                  </span>
                </DropdownMenuItem>
                {category.subcategories.map((sub) => (
                  <DropdownMenuItem
                    key={sub.slug}
                    onClick={() =>
                      setScope({
                        kind: "sub",
                        slug: sub.slug,
                        categorySlug: category.slug,
                      })
                    }
                    className="flex items-center gap-3 cursor-pointer py-2 px-3 ml-9 rounded-lg outline-none transition-all duration-75 hover:bg-muted/60"
                  >
                    <span className="flex size-[22px] shrink-0 items-center justify-center">
                      {sub.icon && (
                        <DbImage
                          src={sub.icon}
                          alt=""
                          width={22}
                          height={22}
                          className="object-contain"
                        />
                      )}
                    </span>
                    <span className="type-body-sm text-card-foreground">
                      {sub.name}
                    </span>
                  </DropdownMenuItem>
                ))}
                <DropdownMenuSeparator />
              </div>
            ))}
          </DropdownMenuContent>
        </DropdownMenu>
        <InputGroup className="relative flex-1 h-full rounded-xs flex items-center ">
          <InputGroupInput
            type="search"
            name={Q_PARAM}
            value={text}
            maxLength={MAX_QUERY_LENGTH}
            onChange={(e) => setText(e.target.value)}
            placeholder={t("placeholder")}
            aria-label={t("search")}
          />
          <InputGroupAddon align="inline-end">
            <InputGroupButton
              type="submit"
              variant="ghost"
              className="h-10 rounded-full cursor-pointer"
              aria-label={t("search")}
            >
              <IconSearch className="scale-125 text-muted-foreground" />
            </InputGroupButton>
          </InputGroupAddon>
        </InputGroup>
      </div>
    </form>
  );
}
