// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { dataAccessGetterDefinition } from 'modules/database/policies/access.ts'
import { transformByDataAccess } from 'mongo/processor/schema/transforms/data-policies.ts'

// mockups
console.warn = () => {}

const conditionalConfig = {
  strategy: 'conditional' as const,
}

Deno.test(
  'dataAccessGetterDefinition (conditional) hides the field when no document context is given',
  () => {
    const result = dataAccessGetterDefinition(
      conditionalConfig,
      'secret',
      { id: 'owner-id', type: 'user', rateLimit: 0 },
    )

    assertEquals(result, undefined)
  },
)

Deno.test(
  'dataAccessGetterDefinition (conditional) shows the field to its own owner',
  () => {
    const result = dataAccessGetterDefinition(
      conditionalConfig,
      'secret',
      { id: 'owner-id', type: 'user', rateLimit: 0 },
      { doc: { userId: 'owner-id' }, path: 'notes' },
    )

    assertEquals(result, 'secret')
  },
)

Deno.test(
  'dataAccessGetterDefinition (conditional) hides the field from a non-owner with no resolveGrant',
  () => {
    const result = dataAccessGetterDefinition(
      conditionalConfig,
      'secret',
      { id: 'someone-else', type: 'user', rateLimit: 0 },
      { doc: { userId: 'owner-id' }, path: 'notes' },
    )

    assertEquals(result, undefined)
  },
)

Deno.test(
  'dataAccessGetterDefinition (conditional) shows the field to a non-owner resolveGrant approves',
  () => {
    const result = dataAccessGetterDefinition(
      {
        strategy: 'conditional',
        settings: {
          resolveGrant: ({ documentId, viewerId, field }) => {
            assertEquals(documentId, 'doc-1')
            assertEquals(viewerId, 'someone-else')
            assertEquals(field, 'notes')
            return true
          },
        },
      },
      'secret',
      { id: 'someone-else', type: 'user', rateLimit: 0 },
      { doc: { _id: 'doc-1', userId: 'owner-id' }, path: 'notes' },
    )

    assertEquals(result, 'secret')
  },
)

Deno.test(
  'transformByDataAccess (conditional) resolves the owner check against the real document',
  () => {
    const fakeDoc = {
      userId: 'owner-id',
      notes: 'secret',
      schema: {
        statics: {
          _getDataAccess: () => ({ notes: conditionalConfig }),
          _getDataAccessPaths: () => ['notes'],
        },
      },
    }

    const ret = { notes: 'secret' }

    const ownerResult = transformByDataAccess()(
      fakeDoc as any,
      { ...ret },
      { userSession: { id: 'owner-id', type: 'user', rateLimit: 0 } } as any,
    )
    assertEquals(ownerResult.notes, 'secret')

    const strangerResult = transformByDataAccess()(
      fakeDoc as any,
      { ...ret },
      { userSession: { id: 'someone-else', type: 'user', rateLimit: 0 } } as any,
    )
    assertEquals(strangerResult.notes, undefined)
  },
)
