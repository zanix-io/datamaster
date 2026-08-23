/**
 * Strips embedded userinfo credentials (`user:password@`) from every connection-string-shaped
 * substring found in `text` — a connector's own connection error can legitimately embed the raw
 * URI it failed to connect with (a malformed/unescaped Mongo or Redis URI, for instance, throws
 * with the full string, credentials included, right inside `error.message`), and the shared
 * `@zanix/logger` redacts by field *name* only — it has no reason to suspect an ordinary
 * `message`/`stack` string, so a credential embedded inside one reaches the log unredacted. This
 * runs before any such string reaches a log call, closing that gap at its actual source instead of
 * asking the shared logger to guess at arbitrary string content (a general-purpose "does this
 * *look* like a secret" scanner is far too imprecise to be a log-time safety net — see
 * `@zanix/utils`'s own `redactSensitiveData` doc for the same reasoning applied to why it
 * deliberately never scans string content either).
 *
 * Matches `scheme://user[:password]@` (scheme letters/digits/`+`/`-`/`.` only, matching what a real
 * URI scheme allows) and replaces the credential portion with `[REDACTED]`, leaving the scheme and
 * host untouched — `mongodb://user:p@ss@cluster.example.com/db` becomes
 * `mongodb://[REDACTED]@cluster.example.com/db`. Greedy up to the *last* `@` before the host (not
 * the first): an unescaped `@` inside the password itself — the very reason a malformed URI throws
 * in the first place — would otherwise leave a trailing `...@host` fragment of the password
 * unredacted if matched too eagerly on the first `@` instead. A string with no embedded credential
 * passes through unchanged.
 */
export function sanitizeConnectionUri(text: string): string {
  return text.replace(/([a-z][a-z0-9+.-]*:\/\/)[^/\s]*@/gi, '$1[REDACTED]@')
}
