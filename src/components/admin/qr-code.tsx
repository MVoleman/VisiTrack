"use client";

import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { cn } from "@/lib/utils";

const QR_OPTIONS = { errorCorrectionLevel: "M", margin: 0 } as const;

/** Crisp, scalable SVG QR code rendered in the browser (the token never leaves the page). */
export function QrCode({ value, className, label }: { value: string; className?: string; label: string }) {
  const [svg, setSvg] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    QRCode.toString(value, { ...QR_OPTIONS, type: "svg", color: { dark: "#111827", light: "#ffffff" } }).then(
      (markup) => !cancelled && setSvg(markup),
    );
    return () => {
      cancelled = true;
    };
  }, [value]);

  return (
    <div
      role="img"
      aria-label={label}
      className={cn("aspect-square w-full [&>svg]:size-full", !svg && "animate-pulse rounded-lg bg-muted", className)}
      // Markup is generated locally by the qrcode library from the token.
      dangerouslySetInnerHTML={svg ? { __html: svg } : undefined}
    />
  );
}

/** Renders a print-quality PNG: QR code with the person's name and company underneath. */
export async function renderBadgePng({ token, name, company }: { token: string; name: string; company: string }) {
  const width = 1024;
  const padding = 96;
  const qrSize = width - padding * 2;
  const height = padding + qrSize + 220;

  const qrCanvas = document.createElement("canvas");
  await QRCode.toCanvas(qrCanvas, token, { ...QR_OPTIONS, width: qrSize, color: { dark: "#111827", light: "#ffffff" } });

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d")!;
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(qrCanvas, padding, padding, qrSize, qrSize);

  const font = getComputedStyle(document.body).fontFamily;
  ctx.textAlign = "center";
  ctx.fillStyle = "#111827";
  ctx.font = `600 56px ${font}`;
  ctx.fillText(name, width / 2, padding + qrSize + 110, width - padding);
  ctx.fillStyle = "#5b6472";
  ctx.font = `400 40px ${font}`;
  ctx.fillText(company, width / 2, padding + qrSize + 170, width - padding);

  return canvas.toDataURL("image/png");
}
