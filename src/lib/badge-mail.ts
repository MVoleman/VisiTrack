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

/**
 * Reads a sender or reply-to address out of an environment variable.
 *
 * Values pasted into a hosting dashboard routinely arrive wrapped in quotes or
 * with a stray space, and the mail provider answers that with nothing more
 * useful than "Invalid `from` field". Both are stripped here, and anything that
 * still is not an address returns null so the caller can say so precisely
 * instead of failing at the provider.
 */
export function mailAddress(raw: string | undefined): string | null {
  // mailto: comes along when the value is copied out of a link or a signature.
  const cleaned = raw?.trim().replace(/^["']|["']$/g, "").trim().replace(/^mailto:/i, "").trim();
  if (!cleaned) return null;
  // "<name@example.com>" with no display name is a valid address and is what a
  // mail client hands you when you copy a contact. Unwrap it rather than refuse.
  const value = cleaned.replace(/^<\s*([^<>]+?)\s*>$/, "$1");
  const plain = /^[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+$/;
  const withName = /^[^<>]+<\s*[^@\s<>]+@[^@\s<>]+\.[^@\s<>]+\s*>$/;
  if (plain.test(value)) return value;
  if (withName.test(value)) return value.replace(/<\s*/, "<").replace(/\s*>$/, ">");
  return null;
}

const SUPPORT = "Kontakta skolans reception om något inte stämmer.";
const SUPPORT_EN = "Contact the school reception if something is not right.";

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
  const validUntilEn = new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "long",
    timeZone,
  }).format(new Date(expiresAt));

  // Both languages in the subject: the people this is for are external staff,
  // and the ones who need the English version have to recognise the mail before
  // they open it.
  const subject = "Din QR-kod för in- och utcheckning / Your QR code";

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
    "",
    "---",
    "",
    `Hi ${firstName},`,
    "",
    "This is your personal QR code for checking in and out at the school. Open the link and save the picture to your phone - then the code works even when you have no signal.",
    "",
    url,
    "",
    `The link works until ${validUntilEn}. Please save the picture before then.`,
    "",
    "The code is personal and works like a key. Do not pass it on. If you lose your phone, tell the school and we will block the code and send you a new one.",
    "",
    SUPPORT_EN,
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

        <hr style="margin:28px 0;border:0;border-top:1px solid #e5e7eb">

        <p style="margin:0 0 20px;font-size:16px">Hi ${escapeHtml(firstName)},</p>
        <p style="margin:0 0 24px;font-size:16px">
          This is your personal QR code for checking in and out at the school. Open the link and save
          the picture to your phone – then the code works even when you have no signal.
        </p>
        <table role="presentation" cellpadding="0" cellspacing="0" style="margin:0 0 24px">
          <tr><td style="border-radius:12px;background:#3563b8">
            <a href="${escapeHtml(url)}" style="display:inline-block;padding:14px 24px;font-size:16px;font-weight:600;color:#ffffff;text-decoration:none">Open your QR code</a>
          </td></tr>
        </table>
        <p style="margin:0 0 24px;font-size:14px;color:#5b6472">
          The link works until ${escapeHtml(validUntilEn)}. Please save the picture before then.
        </p>
        <p style="margin:0 0 24px;padding:14px 16px;background:#f3f4f6;border-radius:12px;font-size:14px;color:#374151">
          The code is personal and works like a key. Do not pass it on. If you lose your phone, tell the
          school and we will block the code and send you a new one.
        </p>
        <p style="margin:0;font-size:13px;color:#8a929e">${SUPPORT_EN}</p>
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
