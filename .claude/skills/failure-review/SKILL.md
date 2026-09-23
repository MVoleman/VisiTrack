---
name: failure-review
description: Check a change for failures that would be silent or untraceable. Use before committing code that validates input, handles an error, calls an external service, reads configuration, or falls back to a default — and whenever a person reports "it just doesn't work".
---

# Failure review

Types, lint and tests all pass on code that fails silently, because nothing about
it is wrong in a way a machine can see. This is the pass that catches it. It
takes a few minutes and it is cheaper than one round trip with the person who
has to use the thing.

## 1. Find the places that can refuse

Run these against the change, not the whole repo (`git diff --name-only` first):

```
rg -n "catch\s*[({]" <files>            # what does each one do besides not crashing?
rg -n "\?\? (undefined|null|\"\"|\[\])" <files>   # a default that hides a missing value
rg -n "if \(!\w+\) return" <files>      # early exits - do they say which check failed?
rg -n "process\.env\." <files>          # configuration read without being reported
```

Also read every user-facing string the change adds. If one sentence can be
produced by more than one cause, it is a candidate.

## 2. Ask of each one

- **Is something being dropped?** A value that is ignored, trimmed away, refused
  by a validator, or replaced by a default. Whoever can fix it must be told, in
  the interface, not only in a log.
- **Does the message name the cause?** "Not configured" that covers a missing
  variable, a refused credential and a provider outage tells the reader nothing.
  Name the variable. Pass the provider's own error code and sentence through.
- **Does it quote what it rejected?** `the address is invalid (<a@b.se>)` ends
  the guessing game that `the address is invalid` starts. Never quote a secret.
- **Who is reading it?** A viewer or an anonymous visitor gets one neutral
  sentence. An admin configuring the system gets the detail — they are the only
  one who can act on it, and they already know the addresses involved.
- **Does the comment match the code?** "dropped and logged" next to code that
  does not log is worse than no comment: it stops the next reader from checking.

## 3. Be suspicious of strict parsing

A validator that refuses valid input reports it as the user's mistake. Before
trusting one, run it against what people actually paste:

wrapping quotes · a trailing space or newline · a non-breaking space ·
`mailto:` · `<addr>` with no display name · `Name <addr>` · uppercase ·
a plus tag · a subdomain

## 4. Trigger the failure, do not just read it

Set the variable to nothing. Use a wrong key. Delete the object the row points
at. Pull the network. Then look at what the interface actually said, and whether
the log line has a tag you could grep for months later.

## 5. Leave the log usable

One grep-able prefix per failure (`badge-mail-unconfigured:`,
`snapshot-object-missing:`), the identifiers needed to find the record, and
never a key, token or password on the same line.
