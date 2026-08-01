// deno-lint-ignore-file no-explicit-any
import { assertEquals } from '@std/assert'
import { dataProtectionGetterDefinition } from 'modules/database/policies/protection.ts'
import { transformByDataProtection } from 'mongo/processor/schema/transforms/data-policies.ts'

// Regression coverage for a crash surfaced while making the triggers middleware consistently
// reverse data protection before dispatch (see `triggers/mod.ts`'s `forDispatch`): an unset
// `[String]` schema path defaults to `[]` in Mongoose, which is truthy, so it used to reach
// `extractVersion` (`utils/protection.ts`) and crash indexing into its first (`undefined`)
// element — there was nothing to reverse in the first place.

Deno.test(
  'dataProtectionGetterDefinition returns nothing for an empty array (nothing to reverse)',
  () => {
    const result = dataProtectionGetterDefinition(
      { activeVersion: 'v1', versionConfigs: { v1: { strategy: 'mask' } } },
      [],
    )

    assertEquals(result, undefined)
  },
)

Deno.test(
  'transformByDataProtection leaves an empty-array protected path untouched instead of throwing',
  async () => {
    const fakeDoc = {
      schema: {
        statics: {
          _getDataProtection: () => ({
            tags: { activeVersion: 'v1', versionConfigs: { v1: { strategy: 'mask' } } },
          }),
          _getDataProtectionPaths: () => ['tags'],
        },
      },
    }

    const ret: { tags: string[] } = { tags: [] }
    const result = await transformByDataProtection({ excludeHashedFields: true })(
      fakeDoc as any,
      ret as any,
    )

    assertEquals(result.tags, [])
  },
)
