/**
 * The mail that carries a worker's badge link.
 *
 * Deliberately free of secrets and of imports, so scripts/badge-mail-preview.mjs
 * can render it without a server, and so the wording can be read and changed
 * without touching anything that sends.
 *
 * It is text with one link and no images. That is partly for the recipient - a
 * link works in every client, on a locked-down phone, in a screen reader - and
 * partly because a mail that is mostly one image is a textbook spam signal.
 */

export type BadgeMail = { subject: string; html: string; text: string };

const SUPPORT = "Kontakta skolans reception om något inte stämmer.";

export function badgeMailContent({
  fullName,
  url,
  expiresAt,
  timeZone = "Europe/Stockholm",
}: {
  fullName: string;
  url: string;
  expiresAt: string | Date;
  timeZone?: string;
}): BadgeMail {
  const firstName = fullName.trim().split(/\s+/)[0] || fullName;
  const validUntil = new Intl.DateTimeFormat("sv-SE", {
    day: "numeric",
    month: "long",
    timeZone,
  }).format(new Date(expiresAt));

  const subject = "Din QR-kod för in- och utcheckning";

  const text = [
    `Hej ${firstName},`,
    "",
    "Här är din personliga QR-kod för in- och utcheckning på skolan. Öppna länken och spara bilden i telefonen - då fungerar koden även när du saknar täckning.",
    "",
    url,
    "",
    `Länken gäller till ${validUntil}. Spara gärna bilden innan dess.`,
    "",
    "Koden är personlig och fungerar som en nyckel. Skicka den inte vidare. Tappar du telefonen, säg till på skolan så spärrar vi koden och skickar en ny.",
    "",
    SUPPORT,
  ].join("\n");

  // Inline styles only, and a table for the button: mail clients strip <style>
  // blocks and most of them do not do flexbox.
  const html = `<!doctype html>
<html lang="sv">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${escapeHtml(subject)}</title>
  </head>
  <body style="margin:0;padding:24px;background:#f9fafb;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#111827;line-height:1.6">
    <table role="presentation" cellpadding="0" cellspacing="0" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:16px;padding:32px">
      <tr><td>
        <p style="margin:0 0 20px;font-size:16px">Hej ${escapeHtml(firstName)},</p>
        <p style="margin:0 0 24px;font-size:16px">
          Här är din personliga QR-kod för in- och utcheckning på skolan. Öppna länken och spara bilden
          i telefonen – då fungerar koden även när du saknar täckning.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
          <tr><td style="border-radius:12px;background:#3563b8">
            <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none">Öppna din QR-kod</a>
          </td></tr>
        </table>
        <p style="margin:0 0 24px;font-size:13px;color:#5b6472;word-break:break-all">
          Fungerar inte knappen? Kopiera adressen: ${escapeHtml(url)}
        </p>
        <p style="margin:0 0 24px;font-size:14px;color:#5b6472">
          Länken gäller till ${escapeHtml(validUntil)}. Spara gärna bilden innan dess.
        </p>
        <p style="margin:0 0 24px;padding:14px 16px;background:#f3f4f6;border-radius:12px;font-size:14px;color:#374151">
          Koden är personlig och fungerar som en nyckel. Skicka den inte vidare. Tappar du telefonen,
          säg till på skolan så spärrar vi koden och skickar en ny.
        </p>
        <p style="margin:0;font-size:13px;color:#8a929e">${SUPPORT}</p>
      </td></tr>
    </table>
  </body>
</html>`;

  return { subject, html, text };
}

function escapeHtml(value: string) {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
