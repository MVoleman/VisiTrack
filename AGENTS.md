<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Failures must be traceable

Four separate bugs in this project shipped as *silence*: a value the code
rejected and then ignored, a message that covered four different causes, an
error code thrown away before anyone could read it, and a comment claiming a log
line that did not exist. Each one cost a round trip with the person trying to
use the thing. None of them were caught by types, lint or tests, because none of
them were wrong in a way a machine can see.

So, when writing anything that can refuse, drop, retry or fall back:

1. **Nothing is dropped quietly.** If a value is ignored, malformed or missing,
   say so where the person who can fix it will see it — not only in a log.
2. **Quote what was rejected.** "The address is invalid" starts a guessing game;
   "the address is invalid (`<a@b.se>`)" ends it. Never quote a secret.
3. **One message per cause.** If the same sentence covers a missing variable, a
   refused credential and a provider outage, it tells the reader nothing. Name
   the variable. Carry the provider's own code and sentence through.
4. **A comment is a promise.** Do not write "logged" or "validated" next to code
   that does neither.
5. **Test a parser against what people paste**, not against what the spec says:
   wrapping quotes, a trailing space, `mailto:`, `<addr>` with no display name.
   Being strict is not the same as being correct.
6. **Log with a grep-able tag** (`badge-mail-unconfigured:`), and never beside a
   key or a token.

The audience matters. A viewer gets one neutral sentence; an admin configuring
the system gets the detail, because they are the one who can act on it. See
`src/app/admin/(dashboard)/workers/actions.ts` and
`src/app/admin/snapshots/[...path]/route.ts` for the shape this takes.
