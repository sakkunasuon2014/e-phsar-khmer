import localFont from "next/font/local";
import { Koh_Santepheap } from "next/font/google";

/**
 * Khmer script face, appended last in the global stack. The stack's system
 * fonts cover Latin first, so this face only renders glyphs the system lacks
 * (Khmer on systems without Khmer coverage).
 */
export const kohSantepheap = Koh_Santepheap({
  subsets: ["khmer"],
  weight: ["300", "400", "700", "900"],
  variable: "--font-koh-santepheap",
  display: "swap",
});

export const nunitoSans = localFont({
  src: "../fonts/nunito-sans-latin.woff2",
  weight: "400 700",
  display: "swap",
});
