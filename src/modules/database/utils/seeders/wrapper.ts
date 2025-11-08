import type { BaseSeederHandler, SeederOptions, SeederProcessor } from 'database/typings/general.ts'

import { InternalError } from '@zanix/errors'
import logger from '@zanix/logger'

/**
 * Wraps a seeder handler to provide common setup, option handling, and shared logic
 * for all database seed operations.
 *
 * This function centralizes seeder configuration (e.g. data policies, background execution)
 * and ensures consistent behavior across all seeders.
 *
 * @param {BaseSeederHandler} handler - The specific seeder function or handler to execute.
 * @param {SeederOptions} options - Optional configuration that customizes the seeder behavior.
 * @param  process - Optional process functions to indicate if seed can run and take actions on finish.
 * @returns {BaseSeederHandler} The wrapped seeder handler with standardized setup and execution flow.
 */
export const seederBaseWrapper = (
  handler: BaseSeederHandler,
  process: SeederProcessor,
  options: SeederOptions = {},
): BaseSeederHandler => {
  const {
    name,
    version,
    runOnWorker,
    verbose = true,
    runningMode = 'ifVersionChanged',
  } = options

  if (!name) {
    throw new InternalError('Missing required process information', {
      code: 'SEEDER_DEFINITION_ERROR',
      cause: [
        'Missing seeder name.',
        'Every seeder must have a unique name, either:',
        '  - By declaring a *named function*, e.g. `function MySeeder() { ... }`, or',
        '  - By passing the `name` option explicitly in the seeder configuration.',
        '',
        'Example:',
        '  seeders:[function UserSeeder() { ... }]',
        '  // or',
        '  seeders:[{ handler: async () => { ... }, options: { name: "UserSeeder" } }]',
      ].join('\n'),
    })
  }

  Object.assign({ name }, handler)

  const initializationMsg = `🚀 Initializing seeder operation [${name}]`
  const loggerIntercepted = verbose ? logger : undefined

  const { avoidRun, onFinish } = process

  const success = (time: number, Model: unknown) => {
    onFinish('success', { name, version, duration: Date.now() - time }, Model)
    loggerIntercepted?.success(`Seeder operation [${name}] completed successfully.`)
  }

  const onError = (time: number, error: Error, Model: unknown) => {
    onFinish('failed', { name, version, duration: Date.now() - time, error: error.message }, Model)
    loggerIntercepted?.warn(`An error occurred during seeder operation using [${name}].`, error)
  }

  return function (Model, connector) {
    const start = Date.now()

    try {
      if (runningMode !== 'always' && avoidRun(version, name, Model)) return

      if (runOnWorker) {
        return handler(Model, connector) // TODO: implement worker when is ready instance['worker'],
        // this.worker.task (deno worker) or this.worker.run (bull), preferible use task, seeders are local, neccesary to create a @Job
      }

      loggerIntercepted?.info(`${initializationMsg}...`)

      const response = handler(Model, connector)

      if (response instanceof Promise) {
        return response.then(() => {
          success(start, Model)
        }).catch((err) => {
          onError(start, err, Model)
        })
      }

      success(start, Model)

      return response
    } catch (err) {
      onError(start, err as Error, Model)
    }
  }
}
