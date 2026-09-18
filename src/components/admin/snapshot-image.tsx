"use client";

import { useState } from "react";

/**
 * A snapshot that says so when it cannot be fetched.
 *
 * /admin/snapshots answers with a status, not an image, when the photo is gone
 * or storage is misconfigured - and a bare <img> turns every one of those into
 * the same silent grey square, which reads like "no photo was taken". That is
 * the one thing it must never be confused with: "raderad enligt
 * lagringspolicyn" is an answer to a GDPR question, and a broken deployment is
 * not. So a failed load renders the caller's fallback instead.
 */
export function SnapshotImage({
  src,
  alt,
  className,
  fallback,
}: {
  src: string;
  alt: string;
  className?: string;
  fallback: React.ReactNode;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) return <>{fallback}</>;

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={src} alt={alt} className={className} loading="lazy" onError={() => setFailed(true)} />
  );
}
