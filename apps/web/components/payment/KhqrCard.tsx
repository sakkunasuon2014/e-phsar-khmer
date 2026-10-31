import { nunitoSans } from "@/lib/fonts";
import { QRCodeSVG } from "qrcode.react";

// The KHQR card from NBC's "KHQR Card Guideline" (docs/KHQR Card
// Guideline.pdf). The guideline sizes everything as a percentage of the
// card's HEIGHT on a fixed 20:29 card; with height = 1.45 × width, each
// value below is that percentage × 1.45 in `cqw` (percent of card width),
// so the card scales with whatever width its parent gives it:
//   header 12% → 17.4cqw · side margins 10% → 14.5cqw
//   receiver name / currency 3% → 4.35cqw · amount 6.5% → 9.43cqw
// The rest (corner radius, header fold, dashed rule, QR placement) is
// measured off the guideline's own vector artwork, as are the wordmark and
// the centre currency badges in public/payment/.

const KHQR_RED = "#E1232E";

// The QR is rendered on a 256-unit grid; the guideline's centre badge is
// 32/165 of the code's width.
const QR_SIZE = 256;
const BADGE_SIZE = Math.round((QR_SIZE * 32) / 165);

function formatAmount(amount: number, currency: string): string {
  const decimals = currency === "KHR" ? 0 : 2;
  return amount.toLocaleString("en-US", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function KhqrWordmark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 49.5 12"
      fill="currentColor"
      role="img"
      aria-label="KHQR"
      className={className}
      style={{ height: "5.27cqw", width: "auto" }}
    >
      <path d="M49.46 6.00L47.59 6.00C47.59 3.72 45.82 1.92 43.59 1.92C41.81 1.92 40.32 3.06 39.76 4.77C39.67 5.14 39.58 5.62 39.58 6.00L39.58 11.97L39.48 11.97C38.46 11.97 37.71 11.12 37.71 10.17L37.71 6.00C37.71 4.39 38.37 2.77 39.58 1.64C40.70 0.59 42.09 0.02 43.59 0.02C46.85 0.02 49.46 2.68 49.46 6.00" />
      <path d="M49.46 11.97L46.85 11.97L46.20 11.31L44.80 9.89L42.84 7.89L45.45 7.89L49.46 11.97" />
      <path d="M32.77 10.08L27.18 10.08C26.53 10.08 25.97 9.51 25.97 8.84L25.97 3.15C25.97 2.49 26.53 1.92 27.18 1.92L32.77 1.92C33.42 1.92 33.98 2.49 33.98 3.15L33.98 8.84L35.85 10.74L35.85 1.83C35.85 0.78 35.01 0.02 34.08 0.02L25.97 0.02C24.94 0.02 24.20 0.88 24.20 1.83L24.20 10.08C24.20 11.12 25.03 11.88 25.97 11.88L34.64 11.88L32.77 10.08" />
      <path d="M10.12 11.97L7.51 11.97L2.10 6.38L2.10 11.97L-0.04 11.97L-0.04 0.02L2.10 0.02L2.10 5.33L7.32 0.02L9.84 0.02L4.25 5.71L10.12 11.97" />
      <path d="M19.91 0.02L21.96 0.02L21.96 11.97L19.91 11.97L19.91 6.76L13.94 6.76L13.94 11.97L11.80 11.97L11.80 0.02L13.94 0.02L13.94 5.05L19.91 5.05L19.91 0.02" />
      <path d="M32.12 4.48L32.12 8.27L28.39 8.27C28.02 8.27 27.74 7.99 27.74 7.61L27.74 4.48C27.74 4.10 28.02 3.82 28.39 3.82L31.37 3.82C31.84 3.72 32.12 4.10 32.12 4.48" />
    </svg>
  );
}

export interface KhqrCardProps {
  /** The KHQR (EMV) payload; `null` while the provider is still producing it. */
  qr: string | null;
  receiverName: string | null;
  amount: number;
  /** ISO code, e.g. "USD" or "KHR" — picks the centre badge. */
  currency: string;
  className?: string;
}

export function KhqrCard({
  qr,
  receiverName,
  amount,
  currency,
  className,
}: KhqrCardProps) {
  const badge =
    currency === "KHR" ? "/payment/khqr-riel.svg" : "/payment/khqr-usd.svg";

  return (
    <div
      className={`${nunitoSans.className} ${className ?? ""}`}
      style={{ containerType: "inline-size" }}
    >
      <div
        className="relative flex flex-col overflow-hidden bg-white text-black"
        style={{
          aspectRatio: "20 / 29",
          borderRadius: "6cqw",
          boxShadow: "0 0 16px rgba(0, 0, 0, 0.1)",
        }}
      >
        <div
          className="flex shrink-0 items-center justify-center text-white"
          style={{ height: "17.4cqw", background: KHQR_RED }}
        >
          <KhqrWordmark />
        </div>
        {/* The header's folded corner — part of the KHQR mark itself. */}
        <div
          aria-hidden
          className="absolute right-0"
          style={{
            top: "17.4cqw",
            width: "8.23cqw",
            height: "8.23cqw",
            background: KHQR_RED,
            clipPath: "polygon(0 0, 100% 0, 100% 100%)",
          }}
        />

        {/* Receiver name and amount — left-aligned, per the guideline. */}
        <div
          className="flex shrink-0 flex-col justify-center"
          style={{ height: "32cqw", paddingInline: "14.5cqw" }}
        >
          <p
            className="truncate"
            style={{ fontSize: "4.35cqw", lineHeight: 1.2 }}
          >
            {receiverName ?? " "}
          </p>
          <p
            className="flex items-baseline whitespace-nowrap"
            style={{ gap: "3cqw" }}
          >
            <span
              className="font-bold tabular-nums"
              style={{ fontSize: "9.43cqw", lineHeight: 1.2 }}
            >
              {formatAmount(amount, currency)}
            </span>
            <span style={{ fontSize: "4.35cqw" }}>{currency}</span>
          </p>
        </div>

        <div
          aria-hidden
          className="shrink-0"
          style={{
            height: "0.25cqw",
            background:
              "repeating-linear-gradient(to right, rgba(0,0,0,0.5) 0 1cqw, transparent 1cqw 3cqw)",
          }}
        />

        <div
          className="flex flex-1 items-center justify-center"
          style={{ paddingInline: "14.5cqw" }}
        >
          {qr ? (
            <QRCodeSVG
              value={qr}
              size={QR_SIZE}
              level="M"
              marginSize={0}
              title="KHQR payment code"
              imageSettings={{
                src: badge,
                width: BADGE_SIZE,
                height: BADGE_SIZE,
                excavate: true,
              }}
              className="aspect-square h-auto w-full"
            />
          ) : (
            <div className="flex aspect-square w-full flex-col items-center justify-center text-center">
              <span className="size-7 animate-spin rounded-full border-2 border-neutral-200 border-t-[#E1232E]" />
              <p
                className="mt-3 text-neutral-500"
                style={{ fontSize: "3.5cqw" }}
              >
                Preparing your QR code…
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
