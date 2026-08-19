/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * Side-effect-only module that auto-registers the default Mongo, Redis, local-cache, SQLite,
 * Elasticsearch/OpenSearch, and SeaweedFS connectors/providers with the Zanix DI container.
 *
 * Import it for its side effects only, for apps that don't need to customize their
 * connector configuration:
 *
 * ```ts
 * import 'jsr:@zanix/datamaster@[version]/core'
 * ```
 *
 * @module zanixCore
 */

export * from 'mongo/connector/core.ts'
export * from 'cache/providers/core.ts'
export * from 'sqlite/core.ts'
export * from 'observability/core.ts'
export * from 'dlq/core.ts'
export * from 'storage/core.ts'
