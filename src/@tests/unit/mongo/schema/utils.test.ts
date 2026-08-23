// deno-lint-ignore-file no-explicit-any
import { Schema } from 'mongoose'
import { findPathsWithAccessorsDeep } from 'mongo/utils/accessors.ts'
import { assert, assertEquals } from '@std/assert'

Deno.test('Find paths deep with accessors', () => {
  const userSchema = new Schema({
    name: {
      type: String,
      get: (value: any) => {
        return `${value} (altered)`
      },
      set: (value: any) => {
        return value
      },
    },
    friends: {
      type: [String],
      get: (value: any) => {
        return value.map((friend: any) => `${friend} (altered)`)
      },
      set: (value: any) => {
        return value
      },
    },
    arrayObject: [
      new Schema({
        value: {
          type: String,
          get: function (value: any) {
            return `${value} (altered on array)`
          },
        },
      }),
    ],
    mapObject: {
      type: Map,
      of: new Schema({
        myobj: {
          type: [
            new Schema({
              deep: {
                type: String,
                get: function (value: any) {
                  return `${value} (altered on array)`
                },
              },
            }),
          ],
          get: function (value: any) {
            return value
          },
        },
        mapArr: [
          new Schema({
            arr: {
              type: String,
              get: function (value: any) {
                return value
              },
            },
            mapArr: {
              type: Map,
              of: new Schema({
                mdeep: {
                  type: [String],
                  get: function (value: any) {
                    return value
                  },
                },
              }),
            },
          }),
        ],
      }),
      get: (value: any) => {
        return value
      },
    },
  })

  const { getters, setters } = findPathsWithAccessorsDeep(
    userSchema,
  )

  assert(Object.values(getters).length > 0)
  assertEquals(Object.keys(getters), [
    'name',
    'friends',
    'arrayObject.*.value',
    'mapObject',
    'mapObject.*.myobj',
    'mapObject.*.myobj.*.deep',
    'mapObject.*.mapArr.*.arr',
    'mapObject.*.mapArr.*.mapArr.*.mdeep',
  ])

  assert(Object.values(setters).length === 2)
  assertEquals(Object.keys(setters), [
    'name',
    'friends',
  ])
})
