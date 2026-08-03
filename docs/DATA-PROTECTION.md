# Data Protection

Schema-level accessors and standalone utilities for masking, encrypting, hashing, and restricting
access to sensitive fields. See [Configuration](./CONFIGURATION.md) for the environment variables
these all read.

## Protection strategies (`dataProtectionGetter`)

```ts
import { dataProtectionGetter } from 'jsr:@zanix/datamaster@[version]'

const schema = {
  password: { type: String, get: dataProtectionGetter('hash') },
  ssn: { type: String, get: dataProtectionGetter('encrypt') },
  email: {
    type: String,
    get: dataProtectionGetter({ strategy: 'mask', settings: { endBefore: '@' } }),
  },
}
```

`dataProtectionGetter(protection, baseGetter?)` accepts either a bare strategy name
(`'mask' | 'hash' | 'encrypt'`), a `{ strategy, settings }` object, or a fully versioned
`{ activeVersion, versionConfigs }` object (see [Versioned keys](#versioned-keys) below). It wraps
whatever the field's own getter would return with a protection-aware object:

| Strategy  | Reversible | Returned wrapper                              | Settings (`*Settings`)                                       |
| --------- | ---------- | --------------------------------------------- | ------------------------------------------------------------ |
| `mask`    | Yes        | `UnmaskableObject` — `.unmask()` (sync)       | `MaskingSettings` (`MaskingBaseOptions` from `@zanix/types`) |
| `encrypt` | Yes        | `DecryptableObject` — `.decrypt()` (async)    | `EncryptSettings` — `{ type?: 'symmetric' \| 'asymmetric' }` |
| `hash`    | No         | `VerifiableObject` — `.verify(input)` (async) | `HashingSettings` — `{ level?, useSalt? }`                   |

All three wrappers are boxed `String` objects (`new String(value)` with the method attached), not
plain strings — `String(field)`/`field.toString()` give you the protected representation, and the
attached method gives you the original value back (or, for `hash`, whether an input matches it).
Array-valued fields get the same method attached to the array itself, except `hash`, whose `verify`
wraps each array element individually.

### Typing a hydrated document's protected fields

Mongoose infers a document's field types from the schema's `type:` marker only (`String` → `string`)
— it has no way to know a `get:` function changes what actually comes back at read time, so
`InferSchemaType`/a hand-written `Attrs` type will keep saying `string` for a protected field even
though you get a wrapper object back. There's no way to make this fully automatic without
re-implementing Mongoose's own type inference; the practical pattern is a **separate type for the
hydrated/read side**, since a protected field's write shape (`string`, what you assign) and read
shape (the wrapper) are genuinely different — and always reached with a **type assertion (`as`)**,
never a plain `:` annotation. Mongoose's declared type (`string`) and the wrapper type are
deliberately structurally incompatible (that mismatch is the whole point — it's what makes a stray
`user.email` hard to accidentally treat as plaintext), so a `:` annotation always fails
assignability where an `as` assertion succeeds:

```ts
import type {
  RequiredDecryptableScalar,
  RequiredUnmaskableScalar,
  RequiredVerifiableScalar,
} from '@zanix/datamaster'

// What you write (create/update payloads) — unchanged, plain strings
export type AuthenticationAttrs = {
  id: string
  password?: string
  oauthRefreshToken?: string
}

// What you read off a hydrated document — one type describing every protected field's real shape.
// Pick the `Required<Strategy>Scalar`/`Required<Strategy>Array` matching each field's actual shape
// (scalar `String` vs. array, e.g. `phones: [String]`) — the same rule for every strategy, no
// exceptions to remember.
export type HydratedAuthentication =
  & Omit<AuthenticationAttrs, 'password' | 'oauthRefreshToken'>
  & {
    password?: RequiredVerifiableScalar
    oauthRefreshToken?: RequiredDecryptableScalar
  }

const userAuth = user?.auth as HydratedAuthentication
await userAuth.password?.verify('input') // no `!`/`?.` needed on the method itself
await userAuth.oauthRefreshToken?.decrypt()

// Reading a single field off a loosely-typed source works the same way:
const email = (user?.email) as RequiredUnmaskableScalar | undefined
const fullEmail = email?.unmask()
```

**Use the `Required<Strategy>Scalar`/`Required<Strategy>Array` variant consistently, for every
protected field, regardless of strategy** — `RequiredVerifiableScalar`/`RequiredVerifiableArray`
(`hash`), `RequiredDecryptableScalar`/`RequiredDecryptableArray` (`encrypt`),
`RequiredUnmaskableScalar`/`RequiredUnmaskableArray` (`mask`). One rule, no per-strategy exceptions:
pick `*Scalar` or `*Array` to match the field's real shape, and the method (`verify`/`decrypt`/
`unmask`) is always directly callable, no narrowing or `!`/`?.` on the method itself needed.

(Technically, `mask`/`encrypt`'s plain union types — `UnmaskableObject`/`DecryptableObject` —
already let you call `.unmask?.()`/`.decrypt?.()` without narrowing, since both their scalar and
array branches carry the method; only `hash`'s `VerifiableArray` lacks it entirely on the array
itself. Still, sticking to the `Required*` pattern everywhere — rather than switching approach per
strategy — keeps one convention to remember, and forces you to be explicit about whether a given
field is scalar- or array-valued instead of leaning on the union to gloss over it.)

## Access strategies (`dataAccessGetter`)

```ts
import { dataAccessGetter } from 'jsr:@zanix/datamaster@[version]'

const schema = {
  internalNotes: { type: String, get: dataAccessGetter('internal') },
  ssn: { type: String, get: dataAccessGetter('private') },
  email: {
    type: String,
    get: dataAccessGetter({ strategy: 'protected', settings: { virtualMask: { endBefore: '@' } } }),
  },
}
```

Access strategies decide **whether a field is visible at all**, based on the current request's
session (read from ALS via `ProgramModule.asyncContext`). Behavior differs per strategy in a way
that's easy to get wrong from the names alone:

| Strategy    | No session | Anonymous session                                  | Authenticated session                                |
| ----------- | ---------- | -------------------------------------------------- | ---------------------------------------------------- |
| `internal`  | Removed    | Removed                                            | **Removed** — never rendered, regardless of session. |
| `private`   | Removed    | Removed                                            | Shown as-is (no masking).                            |
| `protected` | Removed    | **Shown, but masked** using `virtualMask` settings | Shown as-is (no masking).                            |

Only `protected` accepts `settings` (`virtualMask`, a `MaskingBaseOptions`-like shape); its masking
always runs with `algorithm: 'hard'` regardless of what you pass — other options (`endBefore`,
`startAfter`, ...) still apply. `internal` and `private` don't take settings.

## Combining both (`dataPoliciesGetter`)

```ts
import { dataPoliciesGetter } from 'jsr:@zanix/datamaster@[version]'

const schema = {
  email: {
    type: String,
    get: dataPoliciesGetter({
      access: { strategy: 'protected', settings: { virtualMask: { endBefore: '@' } } },
      protection: { strategy: 'mask', settings: { endBefore: '@' } },
    }),
  },
}
```

`dataPoliciesGetter({ access, protection }, baseGetter?)` does **not** run both policies on every
read. On a plain field access (`doc.email`), it behaves exactly like `dataProtectionGetter` alone —
the `access` policy only kicks in during a `toJSON()`/`toObject()` call (the mongo transform layer
sets an internal ALS flag for that duration). In other words: reach for `protection` alone if you
only need masking/encryption/hashing, and add `access` on top only when you also need the field to
disappear or get access-masked specifically in serialized output.

`toJSON`/`toObject` normally read the session from ALS, but `SchemaMethods.toJSON` also accepts an
explicit `userSession` override (`doc.toJSON({ userSession: { type: 'admin' } })`) for call sites
that don't have an active ALS context to inherit from — for example a background job serializing a
document outside of any request.

## Protecting a value before writing it

Protection (whether set via `dataProtectionGetter` or `dataPoliciesGetter`'s `protection` side)
isn't purely a read-time concern — a `pre('save')` hook automatically runs every configured
protection transform on a document's **first** save (`new Model(data).save()`, while `isNew` is
still `true`), and `upsertById`/`upsertManyById` do the same whenever `useDataPolicies: true` (the
default — see [Database: seeders](./DATABASE.md#seeders-registermodels-extensionsseeders)).
**Access** strategies (`dataAccessGetter`) have no such hook — they're a read/serialization-time
concern only, with nothing to apply before storage.

That automatic path does **not** cover every write, though:

- Saving over an **already-existing** document again (`isNew` is `false` on that second `.save()`)
  does not re-run the transform on its own — see
  [Automatic update-time protection](#automatic-update-time-protection-autoprotectonupdate) below
  for the option that extends it there too.
- Query-level operations that update a collection directly — `updateOne`, `findOneAndUpdate` (and
  therefore `findByIdAndUpdate`, implemented as sugar over it), `bulkWrite` — bypass Mongoose's
  document middleware entirely, so the pre-save hook never fires for them. `updateOne`/
  `findOneAndUpdate` accept an opt-in `useDataPolicies` query option instead (`bulkWrite` gets its
  own static override for the same option, since Mongoose has no query-middleware hook for it at
  all) — see [Query-level protection (`useDataPolicies`)](#query-level-protection-usedatapolicies)
  below.

This is **deliberate, not an oversight**: on an update, the field's current in-memory value could
either be a genuine new plaintext value (needs protecting) or the same already-protected value being
carried through unchanged (e.g. a partial update that round-trips other fields) — and there's no
fully reliable way to tell those apart generically:

- **`hash` is one-way by design** — there's no reverse operation to check "is this already a hash,"
  and no reserved format a hash's output is guaranteed not to collide with. Re-hashing an
  already-hashed value silently and permanently breaks `validateHash`/`.verify()` for that record,
  with no error raised anywhere.
- **`mask`/`encrypt` do carry a recognizable version prefix** (`"v0:..."`, see
  [Versioned keys](#versioned-keys)), so a prefix-based heuristic could flag "this looks already
  protected." But it's still a heuristic: a legitimate plaintext value that happens to start with
  that exact pattern (a version tag, a changelog note, ...) would be silently left unprotected in
  the database — a much worse failure mode than doing nothing.

Given that, this library doesn't guess. Instead, updates that need protection go through the
**explicit** path below, where the caller's contract removes the ambiguity entirely (the input is
always treated as plaintext to protect — never a value read back from a hydrated document).

For those cases, every bound model also exposes the same protection primitives as **static
methods**, sourced from the model's `SchemaStatics`, so you can protect a value yourself before
building the update payload:

```ts
// Model is whatever `connector.getModel(...)` / `registerModel` bound — see [Database](./DATABASE.md)
await Model.hash(refreshToken) // one-way; same as the 'hash' strategy
await Model.encrypt(secret, { type: 'symmetric' }) // same as 'encrypt'
Model.mask(email) // same as 'mask', synchronous
Model.unmask(maskedEmail) // reverse of mask
Model.validateHash(input, storedHash) // verify a value against a previously-hashed one
```

This is also how you search a field that's stored masked: mask the search term the same way before
building the query, then match against the stored (masked) value —

```ts
const filter = { email: { $regex: Model.mask(searchTerm), $options: 'i' } }
```

**Reconstructing a new document from an already-protected one** (cloning/duplicating a record,
exporting and re-importing between environments) needs the reverse first — decrypt/unmask it back to
plaintext, then let the normal `isNew` path (or `upsertById`) protect it fresh:

```ts
import { transformByDataProtection } from 'jsr:@zanix/datamaster@[version]/database'

const original = await Model.findById(id)
await transformByDataProtection({ excludeHashedFields: true })(original, original)
const plain = original.toJSON({ getters: false, transform: false })

await new Model({ ...plain, _id: undefined }).save() // protected fresh, not a copy of the old ciphertext
```

This is the exact mechanism `seedRotateProtectionKeys` already uses in production to re-encrypt
every document under a new key version — see [Key rotation](#key-rotation) below.

### Automatic update-time protection (`autoProtectOnUpdate`)

`extensions.autoProtectOnUpdate: true` extends the automatic path to document-level updates too
(`.save()` on an existing, non-`isNew` document) — **without** the heuristics ruled out above. A
protected path's current value is compared against a snapshot taken the moment the document was last
hydrated from the database (not its shape/format): reassigning the exact same already-protected
value back (a no-op edit, or a partial update that round-trips other fields) is never re-protected —
only a value that's genuinely different from what was loaded gets protected. This works even for
`hash`, since the comparison never needs to reverse anything to make the call.

```ts
registerModel({
  name: 'users',
  definition: { ssn: { type: String, get: dataProtectionGetter('encrypt') } },
  extensions: { autoProtectOnUpdate: true },
})

const user = await User.findById(id)
user.ssn = 'a-genuinely-new-value'
await user.save() // now protected automatically, no `upsertById` needed
```

**On by default** — falls back to the `AUTO_PROTECT_ON_DB_UPDATE` env var (the literal `'false'` to
opt out everywhere an explicit per-model value isn't set) when the option itself is omitted, same
explicit-wins-over-env-var rule every option/env-var pair in this package follows. Set
`extensions.autoProtectOnUpdate: false` on a specific model (or the env var to `'false'` globally)
to opt back out.

This only ever covers document-level `.save()` — it does **not** extend to `updateOne`,
`findOneAndUpdate`, or `bulkWrite`; see the next section for those.

### Query-level protection (`useDataPolicies`)

`updateOne` and `findOneAndUpdate` (and therefore `findByIdAndUpdate`, implemented as sugar over
`findOneAndUpdate`) accept a `useDataPolicies: true` query option that protects the update's
`$set`/`$setOnInsert` payload in place before it executes — same purpose as `upsertById`'s own
`useDataPolicies` flag, extended to a raw query call:

```ts
await User.updateOne(
  { _id: id },
  { $set: { password: 'a-new-password' } },
  { useDataPolicies: true },
) // `password` is hashed before the update runs, using the field's own configured settings

await User.findOneAndUpdate(
  { _id: id },
  { $setOnInsert: { ssn: 'a-new-ssn' } },
  { upsert: true, useDataPolicies: true },
)
```

`bulkWrite` gets the same option through a static override instead of a query hook — Mongoose has no
query-middleware hook for `bulkWrite` at all (a driver/ODM limitation, not specific to this library)
— covering `updateOne`/`updateMany`'s `$set`/`$setOnInsert`, `insertOne`'s `document`, and
`replaceOne`'s `replacement` within the batch:

```ts
await User.bulkWrite(
  [{ updateOne: { filter: { _id: id }, update: { $set: { password: 'a-new-password' } } } }],
  { useDataPolicies: true },
)
```

**Opt-in only, `false`/unset by default — never automatic**, unlike `autoProtectOnUpdate` above.
That option can safely default to on because it has a loaded document to snapshot-diff against (see
`isProtectionUnchanged`); here there is no document at all, only a `$set`/`$setOnInsert` payload the
caller built themselves — it could be genuine plaintext that needs protecting, or a value the caller
already protected by hand (e.g. via `Model.hash()`) before building the update. Only an explicit ask
resolves that ambiguity safely; guessing would risk silently double-protecting an already-protected
value (the exact same risk `autoProtectOnUpdate`'s own heuristics section above rules out for the
general case).

**Typing note**: `findOneAndUpdate`/`bulkWrite` pick up `useDataPolicies` through a `mongoose`
module augmentation (so it survives a Mongoose version bump with nothing to keep in sync).
`updateOne` needs an explicit additional overload on the bound model instead — its own options type
can't be augmented the same way (see `mongo/typings/mongoose-augment.ts`'s own comments for the full
reason). Both are covered either way; this only affects how the typing is wired internally.

**Not yet supported for wildcard (`*`) protected paths** — a per-element protected path inside an
array of subdocuments (see [Combining both](#combining-both-datapoliciesgetter) for an example
shape). Those keep today's behavior: only the explicit `upsertById`/`upsertManyById` path protects
them on update. Query-level operations (`updateOne`, `findOneAndUpdate`, `bulkWrite`) are also
unaffected either way — this option only extends the document-level `.save()` path.

## Versioned keys

Any protection config can be a full versioned object instead of a bare strategy:

```ts
dataProtectionGetter({
  activeVersion: 'v1',
  versionConfigs: {
    v0: { strategy: 'mask' },
    v1: { strategy: 'mask', settings: { endBefore: '@' } },
  },
})
```

- **Reading** a stored value auto-detects its version from a literal prefix (e.g. `"v1:..."`) and
  looks up that version's config — falling back to `versionConfigs.default` if the parsed version
  isn't listed.
- **Writing** always uses `activeVersion` — never a version parsed from the incoming value — and
  throws if there's no config for it and no `default`.

If you don't need multi-version migration yet but still want the versioned shape (so adding a real
rotation later doesn't require touching the field's `get`), a single `default` entry is enough —
this is the common case in practice:

```ts
dataProtectionGetter({ activeVersion: 'v0', versionConfigs: { default: { strategy: 'mask' } } })
```

This is what lets you rotate encryption/masking keys without a hard cutover: old documents keep
decrypting under their original version's key while new writes use the new one. See
[Configuration: versioned keys](./CONFIGURATION.md#versioned-keys) for the environment variable
naming convention.

### Key rotation

```ts
import { seedRotateProtectionKeys } from 'jsr:@zanix/datamaster@[version]'

registerModel({
  name: 'users',
  definition: {/* ... same schema, pointed at the new activeVersion ... */},
  extensions: { seeders: [seedRotateProtectionKeys()] },
})
```

Skips with a warning if the model has no data protection configured at all
(`Model._hasDataProtection()` is `false`). Otherwise it reads every document, decrypts/unmasks each
protected field in memory (hashed fields are dropped — hashing is one-way), and re-upserts the plain
values through `upsertManyById(..., { useDataPolicies: true, type: 'update' })`, which re-runs the
setter under the model's **current** `activeVersion` — re-encrypting/re-masking with the new key.

**Every document is re-protected on every run, unconditionally** — there's no check for "already on
the target version," so running this seeder twice re-processes the whole collection both times. For
`mask` this is invisible (deterministic: the same input/key always produces the same output, so the
stored value doesn't actually change), but for `encrypt` it isn't — AES-GCM uses a random IV per
call, so the ciphertext changes on every single run even with the exact same key and version. This
is harmless (the value still decrypts to the same original), just something to know if you're
diffing raw stored values across runs and expect them to stabilize once rotation is "done."

`upsertManyById`'s underlying `bulkWrite` (`ordered: false`) retries only the specific operations
MongoDB reports as failed, up to 3 times with backoff, before giving up and re-throwing — so a
transient failure for a handful of documents doesn't require re-running the whole seeder, and a
non-transient failure surfaces with the exact failed document count logged, not a generic driver
error.

That retry only covers transient failures, though — it can't detect a document a concurrent,
not-yet-redeployed replica is still writing under the old key mid-rollout. Call
`checkProtectionRotationStatus(Model)` (same package) after rotating, and again before removing an
old key from the environment, to confirm nothing was left behind:

```ts
import { checkProtectionRotationStatus } from 'jsr:@zanix/datamaster@[version]/database'

const status = await checkProtectionRotationStatus(UsersModel)
// { ssn: { total: 500, current: 500, outdated: 0 }, email: { total: 500, current: 480, outdated: 20 } }
```

Reports `{ total, current, outdated }` per protected path — `outdated` is how many documents are
still on an older protection version than the one currently active; `0` for every path is what "safe
to remove the old key" actually means. `hash` paths are always skipped (no version to check — same
reason `seedRotateProtectionKeys` excludes them), and so are wildcard (`*`) protected paths inside
an array of subdocuments (not yet supported, same limitation as `autoProtectOnUpdate`). Streams the
collection via the same `readDocuments` options as `seedRotateProtectionKeys` (`filter`, `limit`,
`batchSize`, `mode`) rather than loading it all into memory.

## Standalone utilities

For data that isn't stored through a Mongo schema (e.g. values you're about to cache), the same
primitives are available directly:

```ts
import {
  createDecryptableObject,
  createUnmaskableObject,
  createVerifiableObject,
  datamasterDecrypt,
  datamasterEncrypt,
  datamasterHash,
  datamasterMask,
  datamasterUnmask,
} from 'jsr:@zanix/datamaster@[version]'

const encrypted = await datamasterEncrypt('secret value', { type: 'symmetric' })
const original = await datamasterDecrypt(encrypted, { type: 'symmetric' })

// Or get the value pre-wrapped with its reveal method attached:
const masked = createUnmaskableObject('user@example.com', { endBefore: '@' })
masked.unmask() // 'user@example.com'
```

`datamasterEncrypt`/`datamasterDecrypt`/`datamasterMask`/`datamasterUnmask`/`datamasterHash` are the
same `encrypt`/`decrypt`/`mask`/`unmask`/`createHashFrom` functions the schema getters use
internally, just exported directly under clearer names. `createDecryptableObject`,
`createUnmaskableObject`, and `createVerifiableObject` wrap an already-protected value with its
reveal method attached (`DecryptableObject`/`UnmaskableObject`/`VerifiableObject`), without
performing the protection operation itself.

## See also

- [Configuration](./CONFIGURATION.md) — the exact environment variable names (`DATA_AES_KEY`,
  `DATA_RSA_PUB`/`DATA_RSA_KEY`, `DATA_SECRET_KEY`) and versioned-key naming convention.
- [Database](./DATABASE.md) — where these getters attach to a model's schema definition.
- [Triggers](./TRIGGERS.md) — the other schema-level lifecycle hook, covering both document- and
  query-level operations.
