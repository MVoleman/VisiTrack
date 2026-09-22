"use client";

import { useState } from "react";
import { Download } from "lucide-react";
import { renderBadgePng } from "@/components/admin/qr-code";
import { Button } from "@/components/ui/button";
import { Spinner } from "@/components/ui/spinner";
import { slugify } from "@/lib/utils";

/**
 * Saves the code as a picture, so it works when the phone has no signal - which
 * is the normal case in a stairwell or a basement corridor. The image is drawn
 * in the browser; nothing is requested from the server.
 */
export function SaveBadge({ token, name, company }: { token: string; name: string; company: string }) {
  const [saving, setSaving] = useState(false);

  async function save() {
    setSaving(true);
    try {
      const url = await renderBadgePng({ token, name, company });
      const link = document.createElement("a");
      link.href = url;
      link.download = `visitrack-qr-${slugify(name)}.png`;
      link.click();
    } finally {
      setSaving(false);
    }
  }

  return (
    <Button size="lg" className="w-full" onClick={save} disabled={saving}>
      {saving ? <Spinner /> : <Download />}
      Spara bilden
    </Button>
  );
}
