import { type BindValue, Database } from 'sqlite3'

/**
 * Base class for interacting with a local SQLite database.
 * @class LocalSQLite
 */
export class LocalSQLite {
  /** @protected */
  public db: Database

  /** @protected */
  protected table: string

  /**
   * Creates an instance of LocalSQLite.
   *
   * @param {string} table - Table name (converted to uppercase).
   * @param {string} [filename='.tmp.sqlite'] - SQLite database file path.
   */
  constructor(table: string, filename: string = 'znx.db.tmp') {
    this.db = new Database(filename)
    this.table = table.toUpperCase()
  }

  /**
   * Creates a table if it does not exist.
   *
   * @template T
   * @param {Record<string, string>} definitions - Column definitions.
   * @param {{ primaryKey?: Array<keyof T> }} [options] - Table options.
   * @protected
   * @returns {void}
   */
  public createTable<T extends Record<string, string>>(
    definitions: T,
    options?: { primaryKey?: Array<keyof T> },
  ): void {
    const primarykey = options?.primaryKey
    this.db.exec(
      `
      CREATE TABLE IF NOT EXISTS ${this.table} (
        ${Object.entries(definitions).map((def) => `${def[0]} ${def[1]}`)}
        ${primarykey ? `, PRIMARY KEY (${primarykey.join(',')})` : ''}
      )
      `,
    )
  }

  /**
   * Retrieves a row matching a partial object of keys.
   *
   * @template T
   * @param {Partial<T>} value - Column-value pairs to filter.
   * @param {{ orderBy?: [keyof Partial<T>, 'DESC' | 'ASC'] }} [options] - Optional ordering.
   * @protected
   * @returns {T|null}
   */
  public getDataByKey<T extends object>(
    value: Partial<T>,
    { orderBy }: { orderBy?: [keyof Partial<T>, 'DESC' | 'ASC'] } = {},
  ): T & Record<string, unknown> | null | undefined {
    const keys = Object.keys(value).map((k) => `${k} = ?`)
    const values: BindValue[] = Object.values(value)
    const order = orderBy ? `ORDER BY ${orderBy[0].toString()} ${orderBy[1]}` : ''

    return this.db
      .prepare(
        `SELECT * FROM ${this.table} WHERE ${keys.join(' AND ')} ${order}`,
      )
      .get<T & Record<string, unknown>>(values)
  }

  /**
   * Retrieves all rows in the table.
   *
   * @template T
   * @protected
   * @returns {T[]} List of rows.
   */
  public getAllData<T extends Record<string, unknown> = Record<string, unknown>>(): T[] {
    return this.db.prepare(`SELECT * FROM ${this.table}`).all<T>()
  }

  /**
   * Inserts or replaces a row based on a conflict strategy.
   *
   * @template T
   * @param {T} data - Row data to insert or update.
   * @protected
   * @returns {void}
   */
  public insertOrUpdateData<T extends object>(data: T): void {
    const values = Object.values(data)
    this.db
      .prepare(
        `INSERT OR REPLACE INTO ${this.table} (${Object.keys(data).join(',')}) VALUES (${
          values.map(() => '?').join(',')
        })`,
      )
      .run(values)
  }

  /**
   * Runs a raw SQL query.
   *
   * @template T
   * @param {string} query - SQL query.
   * @param {string[]} [params=[]] - Prepared statement parameters.
   * @protected
   * @returns {T}
   */
  public query<T extends object>(query: string, params: string[] = []): T {
    return this.db.prepare(query).get([...params]) as T
  }

  /**
   * Deletes rows matching a partial key map.
   *
   * @template T
   * @param {Partial<T>} value - Key/value conditions.
   * @protected
   */
  public deleteByKey<T extends object>(value: Partial<T>): number {
    const keys = Object.keys(value).map((k) => `${k} = ?`)
    const values: BindValue[] = Object.values(value)

    return this.db
      .prepare(`DELETE FROM ${this.table} WHERE ${keys.join(' AND ')}`)
      .run(values)
  }

  /**
   * Deletes all rows from the table.
   */
  public flush(): number {
    return this.db.prepare(`DELETE FROM ${this.table}`).run()
  }
}
