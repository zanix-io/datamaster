/**
 * Sanitizes a database model by removing or masking any sensitive
 * connection details (such as credentials, connection strings, or host names).
 *
 * Use this function **before logging, serializing, or exposing** a Mongoose model
 * outside of a secure environment (e.g., in an API response or debugging output).
 *
 * ⚠️ **Security Notice:**
 * - This does **not** replace proper secret handling or environment isolation.
 * - Be cautious when logging or exposing any part of the model object.
 * - The model is modified **in place** (mutated directly).
 *
 * @param {import("mongoose").Model<any>} Model - A Mongoose model instance or a similar object.
 */

// deno-lint-ignore no-explicit-any
export const sanitizeModel = (Model?: any) => {
  if (!Model?.db) return

  const { db } = Model

  // 🔒 Remove direct references to connection metadata or credentials
  delete db._connectionString
  delete db.$initialConnection
  delete db.$dbName

  const client = db.client
  if (client) {
    // 🔒 Clean up sensitive data inside the MongoDB topology
    const topology = client.topology?.s
    if (topology) {
      // Remove replica set name and credentials
      delete topology.description?.setName
      topology.credentials = {}
      topology.seedlist = []

      // Remove SRV host from poller if it exists
      if (topology.srvPoller) delete topology.srvPoller.srvHost
    }

    // 🔒 Remove or mask sensitive connection options
    const clientOptions = client.s?.options
    if (clientOptions) {
      clientOptions.hosts = [] // Clear host object
      clientOptions.credentials = {} // Clear credentials object
      delete clientOptions.srvHost // Remove SRV host reference
      delete clientOptions.replicaSet // Remove replica set info
    }

    // 🔒 Mask the connection URL to avoid leaks
    if (client.s) client.s.url = 'mongodb://*****'
  }

  // 🔒 Mask identifiable properties at the model level
  if ('host' in db) db.host = '*****'
  if ('name' in db) db.name = '*****'
}
