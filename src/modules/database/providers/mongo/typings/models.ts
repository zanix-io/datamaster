// deno-lint-ignore-file no-explicit-any
import type {
  AnyBulkWriteOperation,
  FilterQuery,
  HydratedDocument,
  InferSchemaType,
  Model as MongoModel,
  mongo,
  MongooseBulkWriteOptions,
  MongooseBulkWriteResult,
  ObtainSchemaGeneric,
  ProjectionType,
  QueryOptions,
  Schema,
  SchemaDefinition,
  SchemaOptions,
  UpdateQuery,
  UpdateWithAggregationPipeline,
} from 'mongoose'
import type { BaseCustomSchema, MongoSchemaDefinition } from './schema.ts'
import type { SchemaStatics } from './statics.ts'
import type { BaseAttributes, Extensions, SeederOptions } from 'database/typings/general.ts'
import type { Model, MongoSeeder, SchemaMethods } from './commons.ts'

/**
 * Defines the structure of a MongoDB model, including its schema definition, options, and an optional callback
 * function for further schema customization.
 *
 * This type is used to define models in a MongoDB context, providing a schema definition and additional options
 * for the model. It also supports an optional `callback` that can be used to modify or extend the schema after
 * it has been defined.
 *
 * @template Attrs - The attributes (or schema) of the model. Defaults to `any` if not provided.
 *
 * @type MongoModelDefinition
 */
export type MongoModelDefinition<
  Attrs extends BaseAttributes = any,
> = {
  /**
   * The schema definition for the model, specifying the fields
   * and their types, validation, and other constraints.
   */
  definition: MongoSchemaDefinition<Attrs>
  /**
   * Optional additional options to customize the behavior of the model
   * schema, such as validation, timestamps, and indexes.
   */
  options?: SchemaOptions
  /**
   * Represents optional extensions that can be added to a model definition.
   */
  extensions?: Omit<Extensions, 'seeders'> & {
    /** Seeder functions (or handler/options pairs) run sequentially to populate initial data. */
    seeders?: Array<
      MongoSeeder | {
        /** The seeder function to execute. */
        handler: MongoSeeder
        /** Configuration options that customize how the seeder runs. */
        options?: SeederOptions
      }
    >
  }
  /**
   * Optional callback to modify the schema after it has been defined.
   * @param {Schema<MongoSchemaDefinition<Attrs>>} schema - The MongoDB schema to be modified.
   * @returns {Promise<Schema> | Schema} - The modified schema, either synchronously or asynchronously.
   */
  callback?: (
    schema: Schema<MongoSchemaDefinition<Attrs>>,
  ) => Promise<Schema> | Schema
}

/**
 * Represents a model constructed from a given schema type.
 * It combines MongoModel with the inferred schema types and additional static methods.
 *
 * @template S - The schema type extending Schema.
 */
export type ModelBySchema<S extends Schema> =
  & MongoModel<
    InferSchemaType<S>,
    ObtainSchemaGeneric<S, 'TQueryHelpers'>,
    & ObtainSchemaGeneric<S, 'TInstanceMethods'>
    & SchemaMethods<InferSchemaType<S>>,
    ObtainSchemaGeneric<S, 'TVirtuals'>,
    HydratedDocument<
      InferSchemaType<S>,
      & ObtainSchemaGeneric<S, 'TVirtuals'>
      & ObtainSchemaGeneric<S, 'TInstanceMethods'>
      & SchemaMethods<InferSchemaType<S>>,
      ObtainSchemaGeneric<S, 'TQueryHelpers'>,
      ObtainSchemaGeneric<S, 'TVirtuals'>
    >,
    S
  >
  & ObtainSchemaGeneric<S, 'TStaticMethods'>
  & {
    /** The underlying Mongoose schema instance, merged with its model type. */
    schema:
      & S
      & MongoModel<
        InferSchemaType<S>,
        ObtainSchemaGeneric<S, 'TQueryHelpers'>,
        ObtainSchemaGeneric<S, 'TInstanceMethods'>,
        ObtainSchemaGeneric<S, 'TVirtuals'>,
        HydratedDocument<
          InferSchemaType<S>,
          & ObtainSchemaGeneric<S, 'TVirtuals'>
          & ObtainSchemaGeneric<S, 'TInstanceMethods'>,
          ObtainSchemaGeneric<S, 'TQueryHelpers'>,
          ObtainSchemaGeneric<S, 'TVirtuals'>
        >,
        S
      >['schema']
  }

/**
 * Represents a generic MongoModel with attributes, options and a schema.
 */
export type AdaptedModel<
  Attrs extends BaseAttributes = any,
  Opts extends SchemaOptions = SchemaOptions,
> = Model<Attrs> & SchemaStatics & {
  /** The model's underlying schema, with its custom statics and methods available. */
  schema: SchemaDefinition<Opts> & BaseCustomSchema
  /**
   * Additional `updateOne` overload accepting `useDataPolicies` (see
   * `processor/middlewares/data-protection.ts`'s query-level protection hook). Declared as an
   * explicit overload rather than a `mongoose` module augmentation — JSR's "no slow types" policy
   * hard-bans `declare module`/`declare global` anywhere reachable from a package's public API, so
   * augmenting Mongoose's own types isn't an option here regardless of whether the target type
   * would otherwise merge cleanly.
   */
  updateOne(
    filter: FilterQuery<Attrs>,
    update: UpdateQuery<Attrs> | UpdateWithAggregationPipeline,
    options: QueryOptions<Attrs> & { useDataPolicies?: boolean },
  ): ReturnType<Model<Attrs>['updateOne']>
  /**
   * Additional `findOneAndUpdate` overloads accepting `useDataPolicies` — same rationale as
   * `updateOne` above. `useDataPolicies` is required (not optional) in these signatures, unlike
   * `updateOne`'s: Mongoose's own `findOneAndUpdate` has several overloads returning different
   * shapes depending on `lean`/`includeResultMetadata`/`upsert`+`new`, and a required key means
   * these overloads only match calls that actually pass `useDataPolicies`, so Mongoose's own more
   * precise overloads stay reachable — and preferred — for calls that don't use the flag. Combining
   * `useDataPolicies` with those other flags still type-checks, just against this catch-all return
   * shape rather than the fine-grained native one.
   */
  findOneAndUpdate(
    filter: FilterQuery<Attrs>,
    update: UpdateQuery<Attrs>,
    options: QueryOptions<Attrs> & { useDataPolicies: boolean },
  ): ReturnType<Model<Attrs>['findOneAndUpdate']>
  /**
   * Additional `findOne` overload accepting `useDataPolicies` (see
   * `processor/middlewares/data-protection.ts`'s query-level `find`/`findOne`/`countDocuments`
   * hook) — protects the filter's `mask`-strategy paths (`$eq`/plain equality, or `$in`) before the
   * query runs, so a filter written against plaintext still matches masked-at-rest data. Same
   * required-key rationale as `findOneAndUpdate` above — `findOne` has several native overloads
   * distinguished by `lean`, and a required key keeps those reachable for calls that don't use the
   * flag. `projection` must be passed explicitly (`null` if unused) to reach the `options` slot,
   * same as `updateOne`/`findOneAndUpdate` already require.
   */
  findOne(
    filter: FilterQuery<Attrs>,
    projection: ProjectionType<Attrs> | null | undefined,
    options: QueryOptions<Attrs> & { useDataPolicies: boolean },
  ): ReturnType<Model<Attrs>['findOne']>
  /**
   * Additional `bulkWrite` overloads accepting `useDataPolicies` (see `processor/schema/statics/
   * bulk-write.ts`'s static override — Mongoose has no query-middleware hook for `bulkWrite` at
   * all, so the runtime protection lives there instead of a `schema.pre` hook). Same
   * required-key rationale as `findOneAndUpdate` above; mirrors both of Mongoose's own `bulkWrite`
   * overloads (distinguished by `ordered: false`) so the richer `validationErrors`-carrying result
   * type is preserved when combined with `useDataPolicies`.
   */
  bulkWrite<DocContents = Attrs>(
    writes: Array<
      AnyBulkWriteOperation<
        DocContents extends mongo.Document ? DocContents : any
      >
    >,
    options: mongo.BulkWriteOptions & MongooseBulkWriteOptions & {
      ordered: false
      useDataPolicies: boolean
    },
  ): Promise<MongooseBulkWriteResult>
  bulkWrite<DocContents = Attrs>(
    writes: Array<
      AnyBulkWriteOperation<
        DocContents extends mongo.Document ? DocContents : any
      >
    >,
    options: mongo.BulkWriteOptions & MongooseBulkWriteOptions & {
      useDataPolicies: boolean
    },
  ): Promise<mongo.BulkWriteResult>
}

/**
 * Represents a generic MongoModel generated by a schema with attributes.
 */
export type AdaptedModelBySchema<S extends Schema> =
  & ModelBySchema<S>
  & SchemaStatics
  & {
    /** The model's underlying schema, with its custom statics and methods available. */
    schema: BaseCustomSchema & ModelBySchema<S>['schema']
    /** Additional `updateOne` overload accepting `useDataPolicies` — see `AdaptedModel`'s own copy
     * of this override for the full rationale. */
    updateOne(
      filter: FilterQuery<InferSchemaType<S>>,
      update: UpdateQuery<InferSchemaType<S>> | UpdateWithAggregationPipeline,
      options: QueryOptions<InferSchemaType<S>> & { useDataPolicies?: boolean },
    ): ReturnType<ModelBySchema<S>['updateOne']>
    /** Additional `findOneAndUpdate` overload accepting `useDataPolicies` — see `AdaptedModel`'s own
     * copy of this override for the full rationale. */
    findOneAndUpdate(
      filter: FilterQuery<InferSchemaType<S>>,
      update: UpdateQuery<InferSchemaType<S>>,
      options: QueryOptions<InferSchemaType<S>> & { useDataPolicies: boolean },
    ): ReturnType<ModelBySchema<S>['findOneAndUpdate']>
    /** Additional `findOne` overload accepting `useDataPolicies` — see `AdaptedModel`'s own copy of
     * this override for the full rationale. */
    findOne(
      filter: FilterQuery<InferSchemaType<S>>,
      projection: ProjectionType<InferSchemaType<S>> | null | undefined,
      options: QueryOptions<InferSchemaType<S>> & { useDataPolicies: boolean },
    ): ReturnType<ModelBySchema<S>['findOne']>
    /** Additional `bulkWrite` overloads accepting `useDataPolicies` — see `AdaptedModel`'s own copy
     * of this override for the full rationale. */
    bulkWrite<DocContents = InferSchemaType<S>>(
      writes: Array<
        AnyBulkWriteOperation<
          DocContents extends mongo.Document ? DocContents : any
        >
      >,
      options: mongo.BulkWriteOptions & MongooseBulkWriteOptions & {
        ordered: false
        useDataPolicies: boolean
      },
    ): Promise<MongooseBulkWriteResult>
    bulkWrite<DocContents = InferSchemaType<S>>(
      writes: Array<
        AnyBulkWriteOperation<
          DocContents extends mongo.Document ? DocContents : any
        >
      >,
      options: mongo.BulkWriteOptions & MongooseBulkWriteOptions & {
        useDataPolicies: boolean
      },
    ): Promise<mongo.BulkWriteResult>
  }

/**
 * Connector Model general options
 */
export type GetModelOptions = {
  /**
   * Enables the use of `AsyncLocalStorage` (ALS) for the current model.
   * Once enabled, all model accessors and transformations — such as data access policies —
   * will operate within the active ALS session.
   *
   * ⚠️ Make sure ALS is also activated in the controller or handler injection options when enabled.
   */
  useALS?: boolean
}
