import "server-only";

/**
 * The one call this app makes to a third party at runtime.
 *
 * Kept deliberately small and free of VisiTrack wording: headers, timeout,
 * idempotency, and an answer the caller can act on. Nothing here logs a body,
 * an address or a token - the whole point of a mail is personal data.
 */

const ENDPOINT = "https://api.resend.com/emails";
const TIMEOUT_MS = 10_000;

export type SendOutcome =
  /** Queued by the provider. NOT the same as delivered. */
  | { ok: true; id: string }
  /** Nothing will work until someone fixes the configuration. */
  | { ok: false; kind: "unconfigured"; code: string; detail?: string }
  /** The account is out of allowance. */
  | { ok: false; kind: "quota"; code: string; detail?: string }
  /** Worth another try in a moment. */
  | { ok: false; kind: "transient"; code: string; detail?: string };

// Resend's machine-readable `name` values, grouped by what the sender should do.
const UNCONFIGURED = new Set([
  "missing_api_key",
  "restricted_api_key",
  "suspended_api_key",
  "invalid_permission",
  "validation_error",
  "invalid_parameter",
  "invalid_attachment",
  "missing_required_field",
  "missing_required_parameter",
  "not_found",
  "method_not_allowed",
]);
const QUOTA = new Set(["email_above_quota", "daily_quota_exceeded", "monthly_quota_exceeded"]);

export async function sendEmail({
  from,
  to,
  replyTo,
  subject,
  html,
  text,
  idempotencyKey,
}: {
  from: string;
  to: string;
  replyTo?: string;
  subject: string;
  html: string;
  text: string;
  /** Stable per attempt: a timed-out request that did go through must not send twice on retry. */
  idempotencyKey: string;
}): Promise<SendOutcome> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) return { ok: false, kind: "unconfigured", code: "missing_api_key" };

  let response: Response;
  try {
    response = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        // Required by the API: without one it answers 403.
        "User-Agent": "VisiTrack",
        "Idempotency-Key": idempotencyKey,
      },
      // The REST body is snake_case. The camelCase names belong to their SDK,
      // which we are not using.
      body: JSON.stringify({ from, to, reply_to: replyTo, subject, html, text }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch {
    // Timed out or never connected. Next dispatches server actions one at a
    // time per client, so waiting longer than this would freeze the page.
    return { ok: false, kind: "transient", code: "no_response" };
  }

  if (response.ok) {
    const body = (await response.json().catch(() => null)) as { id?: string } | null;
    return body?.id ? { ok: true, id: body.id } : { ok: false, kind: "transient", code: "no_id" };
  }

  const error = (await response.json().catch(() => null)) as { name?: string; message?: string } | null;
  const code = error?.name ?? `http_${response.status}`;
  // The provider's own sentence, passed back for whoever is setting this up. It
  // says things like which domain is unverified, which no error code can. It is
  // shown to admins only, and never written to a log alongside the key.
  const detail = error?.message?.slice(0, 200);

  if (UNCONFIGURED.has(code)) return { ok: false, kind: "unconfigured", code, detail };
  if (QUOTA.has(code)) return { ok: false, kind: "quota", code, detail };
  return { ok: false, kind: "transient", code, detail };
}
