/**
 * The 404 artwork — our own drawing, in the same spirit as the design mock:
 * two extruded grey "4"s with a blue sad-faced character between them, arms
 * reaching up to grip the inner edges of the digits.
 *
 * Inline SVG on purpose. It is not a DB image, so it must NOT go through
 * `DbImage` (which only accepts Supabase Storage object URLs and would render
 * its fallback instead), and it is not a photo that belongs in `public/`.
 */

/** One "4", drawn as two strokes so the glyph needs no font at all: a stem,
 *  then the diagonal that runs into the crossbar. */
const GLYPH = (
  <>
    <path d="M74 0 L74 120" />
    <path d="M74 0 L6 84 L92 84" />
  </>
);

const GLYPH_PROPS = {
  strokeWidth: 18,
  strokeLinecap: "butt",
  strokeLinejoin: "miter",
  fill: "none",
} as const;

export default function NotFoundIllustration({
  className,
}: {
  className?: string;
}) {
  return (
    <svg
      viewBox="0 0 440 300"
      className={className}
      role="img"
      aria-label="404 — page not found"
      fill="none"
    >
      <defs>
        <radialGradient id="nf-shadow" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#000000" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0" />
        </radialGradient>
      </defs>

      {/* Ground shadow */}
      <ellipse cx="213" cy="250" rx="186" ry="20" fill="url(#nf-shadow)" />

      {/* ── The two "4"s: dark extrusion behind, light face offset in front ── */}
      <g stroke="#c9c9c9" {...GLYPH_PROPS} transform="translate(48 38)">
        {GLYPH}
      </g>
      <g stroke="#c9c9c9" {...GLYPH_PROPS} transform="translate(296 38)">
        {GLYPH}
      </g>
      <g stroke="#e6e6e6" {...GLYPH_PROPS} transform="translate(40 30)">
        {GLYPH}
      </g>
      <g stroke="#e6e6e6" {...GLYPH_PROPS} transform="translate(288 30)">
        {GLYPH}
      </g>

      {/* ── Arms, up from the shoulders to the inner edge of each "4" ──────── */}
      <path
        d="M168 178 C 130 170 122 120 138 80"
        stroke="#00a0e9"
        strokeWidth="15"
        strokeLinecap="round"
        fill="none"
      />
      <path
        d="M258 178 C 296 170 304 120 288 80"
        stroke="#00a0e9"
        strokeWidth="15"
        strokeLinecap="round"
        fill="none"
      />

      {/* ── Torso ─────────────────────────────────────────────────────────── */}
      <rect x="159" y="148" width="108" height="84" rx="26" fill="#00a0e9" />
      <text
        x="213"
        y="203"
        textAnchor="middle"
        fontSize="14"
        fontWeight="700"
        fill="#ffffff"
        className="font-sans"
      >
        PhsarKhmer
      </text>

      {/* ── Head: white face, blue outline, dot eyes, frown ───────────────── */}
      <circle
        cx="213"
        cy="104"
        r="42"
        fill="#ffffff"
        stroke="#00a0e9"
        strokeWidth="6"
      />
      <ellipse cx="199" cy="96" rx="4.5" ry="6.5" fill="#00a0e9" />
      <ellipse cx="227" cy="96" rx="4.5" ry="6.5" fill="#00a0e9" />
      <path
        d="M198 126 Q 213 112 228 126"
        stroke="#00a0e9"
        strokeWidth="5"
        strokeLinecap="round"
        fill="none"
      />
    </svg>
  );
}
