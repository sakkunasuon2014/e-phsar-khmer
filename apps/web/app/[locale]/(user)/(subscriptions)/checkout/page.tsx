"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSearchParams } from "next/navigation";
import {
  ArrowRight,
  BadgeCheck,
  Check,
  CircleAlert,
  Clock3,
  CreditCard,
  MapPin,
  Phone,
  ShieldCheck,
  UserRound,
} from "lucide-react";
import Image from "next/image";
import { Link } from "@/i18n/routing";
import { Breadcrumbs } from "@/components/common/Breadcrumbs";
import { getUserProfile, type CurrentUser } from "@/actions/user";
import {
  getBillingAddresses,
  type BillingAddress,
} from "@/actions/billing-addresses";
import BillingAddressDialog from "@/components/billing/BillingAddressDialog";
import AddressMapPreview from "@/components/billing/AddressMapPreview";
import {
  createSubscriptionCheckout,
  getMySubscriptions,
  getPaymentProviders,
  getPaymentTransactionStatus,
  getSubscriptionCatalog,
} from "@/actions/subscriptions";
import type {
  PaymentProvider,
  PaymentTransactionStatus,
  SubscriptionCatalogItem,
  UserSubscription,
} from "@/types/subscription";
import {
  currentSubscription,
  offerState,
  packageIdOf,
  priceFor,
} from "@/lib/subscription-pricing";
import { KhqrCard } from "@/components/payment/KhqrCard";
import { useNotificationEvents } from "@/hooks/use-chat-ws";
import { isTabAttending } from "@/hooks/use-tab-attention";
import { useMobilePlatform } from "@/hooks/use-mobile-platform";

// Waiting for the charge job to hand back the KHQR: up to ~20s.
const QR_WAIT_MS = 1_000;
const QR_WAIT_TRIES = 20;
// Payment status reads only when no push can arrive: socket down, or the
// code just expired (failures and expiry are not pushed).
const FALLBACK_REFRESH_MS = 5_000;
const FALLBACK_MAX_REFRESH_MS = 15_000;
// Kept above the backend's 30 s expiry sweep slack (PaymentReconciler), so
// the page is still reading when an expired checkout flips to failed.
const EXPIRY_GRACE_MS = 60_000;
// Both providers stamp `expiresAt` into the checkout (Bakong: the 5 min KHQR;
// ABA: `ABA_PAYWAY_LIFETIME_MINUTES`), which drives the countdown and the
// stop. This is only the fallback for a checkout that arrives without one.
const NO_EXPIRY_WAIT_MS = 7 * 60_000;

function money(value: string | number): string {
  return Number(value).toLocaleString("en-US", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

// Picker copy per provider. Both providers hand back a KHQR, so both say
// "scan"; the KHQR icon and wording are the guideline's own "KHQR Payment"
// method component. Unknown providers fall back to the backend displayName.
const PROVIDER_UI: Record<
  string,
  { icon: string; title: string; subtitle: string; appName: string }
> = {
  bakong: {
    icon: "/payment/khqr-method.svg",
    title: "KHQR Payment",
    subtitle: "Scan to pay with Bakong app or any bank apps",
    appName: "Bakong",
  },
  aba_payway: {
    icon: "/icon/ABA.svg",
    title: "ABA PayWay",
    subtitle: "Scan with ABA Mobile or any KHQR banking app",
    appName: "ABA Mobile",
  },
};

function providerUi(provider: PaymentProvider) {
  return (
    PROVIDER_UI[provider.name] ?? {
      icon: null,
      title: provider.displayName,
      subtitle: `Pay with ${provider.displayName}`,
      appName: provider.displayName,
    }
  );
}

// Bakong's charge() stores `{ qr, expiresAt }`; ABA PayWay's purchase
// response carries the KHQR payload as `qrString` (`qr_string` in its docs).
function getQr(
  rawResponse: unknown,
): { qr: string; expiresAt: number | null } | null {
  if (!rawResponse || typeof rawResponse !== "object") return null;
  const raw = rawResponse as Record<string, unknown>;
  const qr = [raw.qr, raw.qrString, raw.qr_string].find(
    (value): value is string => typeof value === "string" && value.length > 0,
  );
  if (!qr) return null;
  return {
    qr,
    expiresAt: typeof raw.expiresAt === "number" ? raw.expiresAt : null,
  };
}

// Reads one top-level EMV tag from a KHQR payload (ID, 2-digit length,
// value). Tag 59 is the merchant name — the card's "receiver name" — taken
// from the code itself so it always matches what the payer's app shows.
function emvTag(payload: string, tag: string): string | null {
  let i = 0;
  while (i + 4 <= payload.length) {
    const id = payload.slice(i, i + 2);
    const length = Number(payload.slice(i + 2, i + 4));
    if (!Number.isInteger(length)) return null;
    if (id === tag) return payload.slice(i + 4, i + 4 + length);
    i += 4 + length;
  }
  return null;
}

function clock(ms: number): string {
  const total = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}

/** One stacked panel of the checkout column: a titled header over a body. */
function Card({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="overflow-hidden rounded-sm border bg-card">
      <div className="border-b px-4 py-3">
        <h2 className="text-lg font-medium text-foreground">{title}</h2>
      </div>
      <div className="p-4">{children}</div>
    </section>
  );
}

export default function CheckoutPage() {
  const params = useSearchParams();
  const termId = params.get("termId");
  const [catalog, setCatalog] = useState<SubscriptionCatalogItem[]>([]);
  const [providers, setProviders] = useState<PaymentProvider[] | null>(null);
  const [providerName, setProviderName] = useState<string | null>(null);
  const [payment, setPayment] = useState<PaymentTransactionStatus | null>(null);
  const [purchaseId, setPurchaseId] = useState<string | null>(null);
  const [activated, setActivated] = useState(false);
  const [loadingCatalog, setLoadingCatalog] = useState(true);
  const [startingCheckout, setStartingCheckout] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [subscriptions, setSubscriptions] = useState<UserSubscription[]>([]);
  // The billing-contact block reads the signed-in account; a failed read just
  // leaves the rows out rather than blocking the payment.
  const [me, setMe] = useState<CurrentUser | null>(null);
  const [addresses, setAddresses] = useState<BillingAddress[]>([]);
  const [addressId, setAddressId] = useState<string | null>(null);
  const [addressOpen, setAddressOpen] = useState(false);
  const idempotencyKey = useRef<string | null>(null);
  const platform = useMobilePlatform();
  const appOpenedFor = useRef<string | null>(null);

  useEffect(() => {
    let mounted = true;
    getSubscriptionCatalog()
      .then((items) => {
        if (mounted) setCatalog(items);
      })
      .catch(() => {
        if (mounted)
          setError(
            "We couldn't load this offer. Please go back and try again.",
          );
      })
      .finally(() => {
        if (mounted) setLoadingCatalog(false);
      });
    getMySubscriptions()
      .then((items) => {
        if (mounted) setSubscriptions(items);
      })
      .catch(() => {});
    getPaymentProviders()
      .then((items) => {
        if (!mounted) return;
        setProviders(items);
        setProviderName(
          (current) =>
            current ?? items.find((item) => item.available)?.name ?? null,
        );
      })
      .catch(() => {
        if (mounted) setProviders([]);
      });
    getUserProfile()
      .then((user) => {
        if (mounted) setMe(user);
      })
      .catch(() => {});
    getBillingAddresses()
      .then((items) => {
        if (mounted) setAddresses(items);
      })
      .catch(() => {});
    return () => {
      mounted = false;
    };
  }, []);

  const provider = providers?.find((item) => item.name === providerName);

  function selectProvider(name: string) {
    if (name === providerName) return;
    setProviderName(name);
    // A key already spent on another provider would replay that provider's
    // payment, so a new choice is a new checkout.
    idempotencyKey.current = null;
  }

  const offer = useMemo(
    () => catalog.find((item) => item.termId === termId),
    [catalog, termId],
  );
  // The offer's own group: a purchase there replaces (upgrades) that
  // group's subscription and leaves the others alone.
  const active = useMemo(
    () => currentSubscription(subscriptions, offer?.groupId ?? null),
    [subscriptions, offer],
  );

  async function startCheckout() {
    if (!offer || !provider) return;
    setStartingCheckout(true);
    setError(null);
    idempotencyKey.current ??= crypto.randomUUID();
    const result = await createSubscriptionCheckout({
      termId: offer.termId,
      idempotencyKey: idempotencyKey.current,
      provider: provider.name,
    });
    setStartingCheckout(false);
    if (!result.success) {
      setError(result.error);
      return;
    }
    setPurchaseId(result.data.purchaseId);
    setActivated(false);
    setPayment({
      id: result.data.paymentTransactionId,
      status: "pending",
      amount: result.data.amount,
      currency: result.data.currency,
      checkout: null,
    });
  }

  function retryCheckout() {
    setPayment(null);
    setPurchaseId(null);
    setActivated(false);
    setError(null);
    idempotencyKey.current = crypto.randomUUID();
  }

  const paymentId = payment?.id;
  const hasCheckout = !!payment?.checkout;
  // Still waiting on the outcome — "succeeded" included, since the plan may
  // not be active yet when the payment is read.
  const awaitingResult =
    !!payment &&
    !activated &&
    (payment.status === "pending" ||
      payment.status === "processing" ||
      payment.status === "succeeded");

  // One read of the payment, plus the subscription once it has succeeded.
  // Runs on a push or a fallback trigger below — never on a fixed interval
  // while the socket is up. A call arriving mid-read is folded into one
  // rerun, so a push landing during a catch-up read is never dropped.
  const livePaymentId = useRef(paymentId);
  const reading = useRef(false);
  const rerun = useRef(false);
  useEffect(() => {
    livePaymentId.current = paymentId;
  }, [paymentId]);

  const refreshPayment = useCallback(async () => {
    if (!paymentId || !purchaseId) return;
    if (reading.current) {
      rerun.current = true;
      return;
    }
    reading.current = true;
    try {
      do {
        rerun.current = false;
        const result = await getPaymentTransactionStatus(paymentId);
        // A retry started a new checkout while this read was in flight.
        if (livePaymentId.current !== paymentId) return;
        if (!result.success) {
          setError(result.error);
          continue;
        }
        setError(null);
        setPayment(result.data);
        if (result.data.status !== "succeeded") continue;
        const latest = await getMySubscriptions().catch(() => null);
        if (latest) setSubscriptions(latest);
        if (
          latest?.some(
            (subscription) =>
              subscription.purchaseId === purchaseId &&
              subscription.status === "active",
          )
        ) {
          setActivated(true);
        }
      } while (rerun.current);
    } finally {
      reading.current = false;
    }
  }, [paymentId, purchaseId]);

  // The KHQR is created asynchronously by the charge job, so read the
  // payment until it carries one — a short, bounded wait, not a status poll.
  useEffect(() => {
    if (!awaitingResult || hasCheckout) return;
    let tries = 0;
    const timer = setInterval(() => {
      tries += 1;
      if (tries > QR_WAIT_TRIES) {
        clearInterval(timer);
        setError("We couldn't load the payment code. Please try again.");
        return;
      }
      void refreshPayment();
    }, QR_WAIT_MS);
    void refreshPayment();
    return () => clearInterval(timer);
  }, [awaitingResult, hasCheckout, refreshPayment]);

  // The outcome is pushed: the backend sends `payment.succeeded` over the
  // shared socket once the subscription is active (every provider settles
  // through that one event — ABA's webhook, Bakong's check, the reconciler).
  const { isConnected } = useNotificationEvents({
    enabled: awaitingResult,
    onNotification: (notification) => {
      if (
        notification.type === "payment.succeeded" &&
        notification.data?.paymentTransactionId === paymentId
      ) {
        void refreshPayment();
      }
    },
  });

  // A push sent while the socket was down is not replayed — catch up on
  // every (re)connect.
  useEffect(() => {
    if (awaitingResult && isConnected) void refreshPayment();
  }, [awaitingResult, isConnected, refreshPayment]);

  // No socket at all (blocked, misconfigured, reconnects exhausted): a slow
  // read keeps the page settling on its own.
  // Backs off (5s, 10s, 15s, then steady) and reads nothing while the tab is
  // hidden; coming back to the tab reads once at once and restarts the pace.
  useEffect(() => {
    if (!awaitingResult || isConnected) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let delay = FALLBACK_REFRESH_MS;
    const run = () => {
      // "Attending" also covers an abandoned-but-visible tab: the socket closes
      // when the tab goes idle, and without this the fallback would then poll a
      // parked checkout page every few seconds.
      if (isTabAttending()) {
        void refreshPayment();
        delay = Math.min(delay + FALLBACK_REFRESH_MS, FALLBACK_MAX_REFRESH_MS);
      }
      timer = setTimeout(run, delay);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState !== "visible") return;
      clearTimeout(timer);
      delay = FALLBACK_REFRESH_MS;
      run();
    };
    timer = setTimeout(run, delay);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      clearTimeout(timer);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [awaitingResult, isConnected, refreshPayment]);

  // Failures and expiry are not pushed, so once the code can no longer be
  // paid, read for a short grace window to pick up the final status, then
  // stop. A late `payment.succeeded` push still lands after that. Without an
  // expiry on the code, the clock starts when waiting starts (this effect
  // only re-runs if an expiry turns up, or for a new checkout).
  const qrExpiresAt = getQr(payment?.checkout?.rawResponse)?.expiresAt ?? null;
  useEffect(() => {
    if (!awaitingResult) return;
    const deadline = qrExpiresAt ?? Date.now() + NO_EXPIRY_WAIT_MS;
    const graceEnd = deadline + EXPIRY_GRACE_MS;
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(
      () => {
        void refreshPayment();
        interval = setInterval(() => {
          if (Date.now() > graceEnd) {
            clearInterval(interval);
            setError(
              "We're still waiting for confirmation. If you already paid, check My subscriptions in a moment.",
            );
            return;
          }
          void refreshPayment();
        }, FALLBACK_REFRESH_MS);
      },
      Math.max(0, deadline - Date.now()),
    );
    return () => {
      clearTimeout(timeout);
      clearInterval(interval);
    };
  }, [awaitingResult, qrExpiresAt, refreshPayment]);

  // Only gates the pre-payment step: once a checkout exists, its own status
  // drives the page (activation flips `active` to the new plan anyway).
  const blocked =
    !payment && offer
      ? (() => {
          const state = offerState(
            offer,
            active,
            packageIdOf(active, catalog),
            now,
          );
          return state.kind === "current" || state.kind === "unavailable"
            ? state.kind
            : null;
        })()
      : null;

  const qrInfo = getQr(payment?.checkout?.rawResponse);
  const waitingForPayment =
    !!payment &&
    !activated &&
    (payment.status === "pending" || payment.status === "processing");

  useEffect(() => {
    if (!waitingForPayment || !qrInfo?.expiresAt) return;
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, [waitingForPayment, qrInfo?.expiresAt]);

  const remainingMs = qrInfo?.expiresAt ? qrInfo.expiresAt - now : null;
  const receiverName = qrInfo ? emvTag(qrInfo.qr, "59") : null;
  const appLink = payment?.checkout?.redirectUrl ?? null;
  const qrShown = !!qrInfo;

  // On a phone, hand off to the provider's app (ABA's deeplink) as soon as
  // the QR is up — the browser's own "Open in …?" prompt is the ask, and an
  // app that isn't installed simply doesn't open, leaving the QR. Once per
  // checkout, so a re-render or a return from the app never re-fires it.
  useEffect(() => {
    if (!platform || !appLink || !qrShown || !waitingForPayment) return;
    if (!paymentId || appOpenedFor.current === paymentId) return;
    appOpenedFor.current = paymentId;
    window.location.href = appLink;
  }, [platform, appLink, qrShown, waitingForPayment, paymentId]);

  // Back from the app: read once rather than wait on a push the
  // backgrounded socket may have missed.
  useEffect(() => {
    if (!awaitingResult) return;
    const onVisible = () => {
      if (document.visibilityState === "visible") void refreshPayment();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => document.removeEventListener("visibilitychange", onVisible);
  }, [awaitingResult, refreshPayment]);
  const ui = provider ? providerUi(provider) : null;
  const paymentFailed =
    payment?.status === "failed" ||
    payment?.status === "cancelled" ||
    payment?.status === "expired";
  const planPrice = offer ? priceFor(offer) : 0;
  const dueToday = payment ? Number(payment.amount) : planPrice;
  const credit = payment && planPrice > dueToday ? planPrice - dueToday : 0;
  const displayName =
    [me?.firstName, me?.lastName].filter(Boolean).join(" ").trim() ||
    me?.username ||
    "This account";

  const reloadAddresses = useCallback(() => {
    getBillingAddresses()
      .then(setAddresses)
      .catch(() => {});
  }, []);

  // The picked one, else the account default, else the first saved row.
  const selectedAddress =
    addresses.find((item) => item.id === addressId) ??
    addresses.find((item) => item.isDefault) ??
    addresses[0] ??
    null;

  return (
    <div className="min-h-screen bg-muted pb-16">
      <div className="mx-auto max-w-5xl px-4 pt-6">
        <Breadcrumbs
          items={[
            { label: "Home", href: "/" },
            { label: "Profile", href: "/me" },
            { label: "Membership", href: "/me/membership" },
            { label: "Check Out" },
          ]}
        />

        {error && (
          <div
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-sm border border-destructive/30 bg-card p-4 text-sm text-destructive"
          >
            <CircleAlert className="mt-0.5 h-4 w-4 shrink-0" /> {error}
          </div>
        )}

        <div className="mt-4 space-y-3">
          {loadingCatalog ? (
            <div className="h-72 animate-pulse rounded-sm border bg-card" />
          ) : !offer ? (
            <Card title="Subscription">
              <div className="flex min-h-56 flex-col items-center justify-center text-center">
                <CircleAlert className="h-8 w-8 text-amber-600" />
                <h3 className="mt-3 text-lg font-medium text-foreground">
                  Offer unavailable
                </h3>
                <p className="mt-1 text-sm text-gray-500">
                  This term may have been removed or deactivated.
                </p>
                <Link
                  href="/premium-account"
                  className="mt-4 text-sm font-medium text-[#00a0e9] hover:underline"
                >
                  Browse available plans
                </Link>
              </div>
            </Card>
          ) : blocked ? (
            <Card title="Subscription">
              <div className="flex min-h-56 flex-col items-center justify-center text-center">
                <BadgeCheck className="h-9 w-9 text-emerald-600" />
                <h3 className="mt-3 text-lg font-medium text-foreground">
                  {blocked === "current"
                    ? "You're already on this plan"
                    : "Not an upgrade from your current plan"}
                </h3>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
                  {blocked === "current"
                    ? `Your ${offer.packageName} package is active — nothing to pay.`
                    : "Your current plan already covers this for the time left. Pick a bigger package to upgrade."}
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <Link
                    href={{
                      pathname: "/premium-account/[category]",
                      params: { category: offer.groupSlug },
                    }}
                    className="inline-flex h-10 items-center gap-2 rounded-sm bg-[#00a0e9] px-5 text-sm font-medium text-white hover:bg-[#008ccb]"
                  >
                    See upgrade options <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/me/subscriptions"
                    className="inline-flex h-10 items-center rounded-sm border px-5 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    My subscriptions
                  </Link>
                </div>
              </div>
            </Card>
          ) : activated ? (
            <Card title="Subscription">
              <div className="flex min-h-56 flex-col items-center justify-center text-center">
                <BadgeCheck className="h-9 w-9 text-emerald-600" />
                <h3 className="mt-3 text-lg font-medium text-foreground">
                  You&apos;re all set
                </h3>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
                  Payment confirmed and your {offer.packageName} package is
                  ready to use.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <Link
                    href="/me"
                    className="inline-flex h-10 items-center gap-2 rounded-sm bg-[#00a0e9] px-5 text-sm font-medium text-white hover:bg-[#008ccb]"
                  >
                    Back to profile <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/me/subscriptions"
                    className="inline-flex h-10 items-center rounded-sm border px-5 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    View my subscriptions
                  </Link>
                </div>
              </div>
            </Card>
          ) : paymentFailed ? (
            <Card title="Subscription">
              <div className="flex min-h-56 flex-col items-center justify-center text-center">
                <CircleAlert className="h-8 w-8 text-amber-600" />
                <h3 className="mt-3 text-lg font-medium text-foreground">
                  Payment didn&apos;t complete
                </h3>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
                  The code expired or the payment wasn&apos;t received, so no
                  subscription was activated. Start a new checkout to try again.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={retryCheckout}
                    className="h-10 rounded-sm bg-[#00a0e9] px-6 text-sm font-medium text-white transition-colors hover:bg-[#008ccb]"
                  >
                    Try again
                  </button>
                  <Link
                    href="/me"
                    className="inline-flex h-10 items-center rounded-sm border px-5 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    Back to profile
                  </Link>
                </div>
              </div>
            </Card>
          ) : payment?.status === "succeeded" ? (
            <Card title="Subscription">
              <div className="flex min-h-56 flex-col items-center justify-center text-center">
                <BadgeCheck className="h-10 w-10 text-emerald-600" />
                <h3 className="mt-3 text-lg font-medium text-foreground">
                  Payment successful
                </h3>
                <p className="mt-1 max-w-sm text-sm text-gray-500">
                  Your payment was received. We&apos;re activating your{" "}
                  {offer.packageName} plan — this page updates by itself.
                </p>
                <div className="mt-5 flex flex-wrap justify-center gap-3">
                  <Link
                    href="/me"
                    className="inline-flex h-10 items-center gap-2 rounded-sm bg-[#00a0e9] px-5 text-sm font-medium text-white hover:bg-[#008ccb]"
                  >
                    Back to profile <ArrowRight className="h-4 w-4" />
                  </Link>
                  <Link
                    href="/me/subscriptions"
                    className="inline-flex h-10 items-center rounded-sm border px-5 text-sm font-medium text-foreground hover:bg-muted"
                  >
                    My subscriptions
                  </Link>
                </div>
              </div>
            </Card>
          ) : (
            <>
              <Card title="Subscription">
                <div className="flex items-start gap-4">
                  <div className="flex h-20 w-20 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-muted">
                    {me?.profilePhotoUrl ? (
                      <Image
                        src={me.profilePhotoUrl}
                        alt=""
                        width={80}
                        height={80}
                        unoptimized
                        className="h-full w-full object-cover"
                      />
                    ) : (
                      <UserRound className="h-9 w-9 text-gray-400" />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="text-base font-semibold text-foreground">
                      {offer.packageName} - {offer.termName}
                    </p>
                    <p className="mt-1 text-sm text-gray-500">
                      Account: {me?.username ?? "—"}
                    </p>
                    <p className="text-sm text-gray-500">
                      {offer.packageName} · {offer.groupName}
                    </p>
                    <p className="text-sm text-gray-500">
                      Runs for {offer.termName} after payment
                    </p>
                    <p className="mt-2 text-sm font-medium text-[#00a0e9]">
                      ${money(dueToday)}
                    </p>
                  </div>
                </div>
              </Card>

              <Card
                title={
                  selectedAddress
                    ? `Address: ${selectedAddress.label}`
                    : "Billing Address"
                }
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="min-w-0 flex-1 space-y-3">
                    <p className="flex items-center gap-3 text-sm text-foreground">
                      <UserRound className="h-4 w-4 shrink-0 text-gray-400" />
                      {selectedAddress?.name ?? displayName}
                    </p>
                    <p className="flex items-center gap-3 text-sm text-foreground">
                      <Phone className="h-4 w-4 shrink-0 text-gray-400" />
                      {selectedAddress?.phone ??
                        me?.primaryPhone ??
                        "No phone number on this account"}
                    </p>
                    {selectedAddress && (
                      <p className="flex items-start gap-3 text-sm text-foreground">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0 text-gray-400" />
                        <span>
                          {selectedAddress.address}
                          {selectedAddress.company && (
                            <span className="block text-gray-500">
                              {selectedAddress.company}
                            </span>
                          )}
                        </span>
                      </p>
                    )}
                    {!selectedAddress && (
                      <p className="text-sm text-gray-500">
                        No saved billing address yet — the plan is linked to
                        this account either way.
                      </p>
                    )}
                  </div>

                  {selectedAddress?.latitude && selectedAddress.longitude && (
                    <AddressMapPreview
                      coords={{
                        lat: Number(selectedAddress.latitude),
                        lng: Number(selectedAddress.longitude),
                      }}
                    />
                  )}
                </div>

                <button
                  type="button"
                  onClick={() => setAddressOpen(true)}
                  className="mt-3 w-full rounded-sm bg-[#00a0e9]/10 py-2.5 text-sm font-semibold text-[#00a0e9] transition-colors hover:bg-[#00a0e9] hover:text-white"
                >
                  {selectedAddress ? "Change Address" : "Add Address"}
                </button>
              </Card>

              {payment ? (
                <Card title="Payment">
                  <div className="grid gap-6 sm:grid-cols-[minmax(0,1fr)_240px] sm:items-center">
                    <div>
                      <span className="inline-flex items-center gap-1.5 rounded-sm bg-amber-500/10 px-2.5 py-1 text-xs font-medium text-amber-700 dark:text-amber-400">
                        <Clock3 className="h-3.5 w-3.5" />
                        Waiting for payment
                      </span>
                      <h3 className="mt-3 text-xl font-semibold text-foreground">
                        Scan to pay{" "}
                        <span className="tabular-nums">
                          ${money(payment.amount)}
                        </span>
                      </h3>
                      <ol className="mt-4 space-y-2 text-sm text-foreground">
                        {[
                          `Open ${ui?.appName ?? "Bakong"} or any KHQR banking app`,
                          "Scan the KHQR code",
                          "Confirm the amount and approve",
                        ].map((text, index) => (
                          <li key={text} className="flex items-center gap-3">
                            <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-gray-500">
                              {index + 1}
                            </span>
                            {text}
                          </li>
                        ))}
                      </ol>
                      <p className="mt-4 text-xs text-gray-500">
                        Keep this page open — it confirms automatically.
                      </p>
                    </div>
                    <div className="mx-auto w-full max-w-[240px]">
                      <KhqrCard
                        qr={qrInfo?.qr ?? null}
                        receiverName={receiverName}
                        amount={Number(payment.amount)}
                        currency={payment.currency}
                      />
                      {/* Expiry and app hand-off sit outside the card, per the
                          guideline: only name, amount and QR belong inside it. */}
                      {remainingMs !== null && (
                        <p className="mt-3 text-center text-xs tabular-nums text-gray-500">
                          {clock(remainingMs)} | QR will expire
                        </p>
                      )}
                      {appLink && platform && (
                        <div>
                          <div className="my-3 flex items-center gap-3 text-xs text-gray-500">
                            <span className="h-px flex-1 bg-border" /> Or
                            <span className="h-px flex-1 bg-border" />
                          </div>
                          <a
                            href={appLink}
                            className="flex h-10 w-full items-center justify-center rounded-sm bg-[#E1232E] text-sm font-medium text-white hover:bg-[#c81e28]"
                          >
                            Pay via {ui?.appName ?? "app"}
                          </a>
                        </div>
                      )}
                    </div>
                  </div>
                </Card>
              ) : (
                <Card title="Payment Methods">
                  {providers === null ? (
                    <div className="space-y-2">
                      {[0, 1].map((row) => (
                        <div
                          key={row}
                          className="h-[68px] animate-pulse rounded-sm bg-muted"
                        />
                      ))}
                    </div>
                  ) : providers.length === 0 ? (
                    <p className="rounded-sm bg-muted p-4 text-sm text-gray-500">
                      We couldn&apos;t load payment methods. Refresh the page to
                      try again.
                    </p>
                  ) : (
                    <div
                      role="radiogroup"
                      aria-label="Payment method"
                      className="space-y-2"
                    >
                      {providers.map((item) => {
                        const itemUi = providerUi(item);
                        const selected = item.name === providerName;
                        return (
                          <button
                            key={item.name}
                            type="button"
                            role="radio"
                            aria-checked={selected}
                            disabled={!item.available}
                            onClick={() => selectProvider(item.name)}
                            className={`flex w-full items-center gap-3 rounded-sm border p-3 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${
                              selected
                                ? "border-[#00a0e9] bg-[#00a0e9]/5"
                                : "hover:bg-muted"
                            }`}
                          >
                            <span className="flex h-12 w-16 shrink-0 items-center justify-center overflow-hidden rounded-sm bg-white ring-1 ring-border">
                              {itemUi.icon ? (
                                <Image
                                  src={itemUi.icon}
                                  alt=""
                                  width={64}
                                  height={48}
                                  unoptimized
                                  className="h-full w-full object-contain"
                                />
                              ) : (
                                <CreditCard className="h-5 w-5 text-gray-400" />
                              )}
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className="block font-semibold text-foreground">
                                {itemUi.title}
                              </span>
                              <span className="block text-sm text-gray-500">
                                {item.available
                                  ? itemUi.subtitle
                                  : "Unavailable right now"}
                              </span>
                            </span>
                            <span
                              aria-hidden
                              className={`flex h-5 w-5 shrink-0 items-center justify-center rounded-full border ${
                                selected
                                  ? "border-[#00a0e9] bg-[#00a0e9] text-white"
                                  : "border-gray-300"
                              }`}
                            >
                              {selected && <Check className="h-3 w-3" />}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  )}
                </Card>
              )}

              <Card title="Summary">
                <dl className="space-y-2 text-sm">
                  {[
                    ["Photos per ad", offer.photos],
                    ["Active ads", offer.ads],
                    ["Renewals", offer.renews],
                  ].map(([label, value]) => (
                    <div key={label} className="flex justify-between gap-2">
                      <dt className="text-gray-500">{label}</dt>
                      <dd className="font-medium tabular-nums text-foreground">
                        {value}
                      </dd>
                    </div>
                  ))}
                </dl>
                <div className="mt-4 space-y-2 border-t pt-4 text-sm">
                  {credit > 0 && (
                    <>
                      <div className="flex justify-between text-gray-500">
                        <span>Plan price</span>
                        <span className="tabular-nums">
                          ${money(planPrice)}
                        </span>
                      </div>
                      <div className="flex justify-between text-emerald-700 dark:text-emerald-400">
                        <span>Credit from current plan</span>
                        <span className="tabular-nums">−${money(credit)}</span>
                      </div>
                    </>
                  )}
                  <div className="flex items-baseline justify-between">
                    <span className="font-medium text-foreground">
                      Due today
                    </span>
                    <span className="text-xl font-semibold tabular-nums text-foreground">
                      ${money(dueToday)}
                      <small className="ml-1 text-xs font-medium text-gray-500">
                        {payment?.currency ?? "USD"}
                      </small>
                    </span>
                  </div>
                </div>
                {!payment && !blocked && (
                  <button
                    type="button"
                    disabled={startingCheckout || !provider}
                    onClick={() => void startCheckout()}
                    className="mt-4 flex h-10 w-full items-center justify-center rounded-sm bg-[#00a0e9] text-sm font-medium text-white transition-colors hover:bg-[#008ccb] disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {startingCheckout
                      ? "Preparing checkout…"
                      : "Continue to payment"}
                    {!startingCheckout && (
                      <ArrowRight className="ml-2 h-4 w-4" />
                    )}
                  </button>
                )}
                <p className="mt-4 flex items-start gap-2 text-xs leading-5 text-gray-500">
                  <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
                  <span>
                    Your plan activates only after{" "}
                    {provider?.displayName ?? "the payment provider"} confirms
                    the payment. All purchases are final — no refunds.
                  </span>
                </p>
              </Card>
              <BillingAddressDialog
                open={addressOpen}
                onOpenChange={setAddressOpen}
                addresses={addresses}
                selectedId={selectedAddress?.id ?? null}
                defaultName={displayName}
                defaultPhone={me?.primaryPhone ?? ""}
                onApply={setAddressId}
                onChanged={reloadAddresses}
              />
            </>
          )}
        </div>
      </div>
    </div>
  );
}
