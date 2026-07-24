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
  does not re-run the transform — only the very first save of a document does.
- Query-level operations that update a collection directly — `updateOne`, `findOneAndUpdate`,
  `bulkWrite`, etc. — bypass Mongoose's document middleware entirely, so the pre-save hook never
  fires for them.

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
Existing values that already match the new version are left untouched.

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
