"use client";

import Image from "next/image";
import { useState } from "react";

/**
 * The Hestia mark: a Greek key ring around a branching tree.
 *
 * The artwork lives at `web/public/hestia-logo.png`. Until it is added the
 * component falls back to a drawn meander ring, so the layout never shows a
 * broken image — but the real file should be dropped in.
 *
 * The mark is black line art, so it is inverted in dark mode via the
 * `logo-mark` class (see globals.css).
 */
export function HestiaLogo({
  size = 40,
  className = "",
}: {
  size?: number;
  className?: string;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return <MeanderFallback size={size} className={className} />;

  return (
    <Image
      src="/hestia-logo.png"
      alt="Project Hestia"
      width={size}
      height={size}
      priority
      onError={() => setFailed(true)}
      className={`logo-mark ${className}`}
    />
  );
}

/** Geometric stand-in: the meander ring only, never a guess at the tree. */
function MeanderFallback({ size, className }: { size: number; className: string }) {
  const teeth = 16;
  const marks = Array.from({ length: teeth }, (_, i) => (i * 360) / teeth);

  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      role="img"
      aria-label="Project Hestia"
      className={`logo-mark ${className}`}
    >
      <circle cx="50" cy="50" r="47" fill="none" stroke="currentColor" strokeWidth="2.5" />
      <circle cx="50" cy="50" r="36" fill="none" stroke="currentColor" strokeWidth="2.5" />
      {marks.map((angle) => (
        <rect
          key={angle}
          x="49"
          y="3"
          width="2"
          height="8"
          fill="currentColor"
          transform={`rotate(${angle} 50 50)`}
        />
      ))}
      {/* A plain trunk and branches — deliberately abstract, not an imitation. */}
      <path
        d="M50 78 V52 M50 60 L38 46 M50 60 L62 46 M50 52 L41 38 M50 52 L59 38 M38 46 L32 38 M62 46 L68 38"
        fill="none"
        stroke="currentColor"
        strokeWidth="2"
        strokeLinecap="round"
      />
    </svg>
  );
}
