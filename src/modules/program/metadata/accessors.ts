import type { DataAccessConfig, DataProtection } from 'typings/protection.ts'

import { ProgramContainer } from '@zanix/server'

/**
 * A container for holding and managing accessors.
 */
export class AccessorsContainer extends ProgramContainer {
  #dataProtectionKey = 'db-accessor-data-protection'
  #dataAccessKey = 'db-accessor-data-access'

  /** Associate data with an accessor */
  private setAccessorData<R>(accessor: (...args: unknown[]) => R, data: object, key: string) {
    this.setData(key, data, accessor)
  }

  /** get accessor data info and delete it */
  private consumeAccessorData<R, D extends object>(
    accessor: (...args: unknown[]) => R,
    key: string,
  ) {
    const data = this.getData<D | undefined>(key, accessor)
    this.deleteData(key, accessor)
    return data
  }

  /**
   * Associate data proteccion method with an accessor
   */
  public setDataProtection<R>(accessor: (...args: unknown[]) => R, data: DataProtection) {
    this.setAccessorData(accessor, data, this.#dataProtectionKey)
  }

  /**
   * get accessor data protection info and delete it
   */
  public consumeDataProtection<R>(accessor: (...args: unknown[]) => R) {
    return this.consumeAccessorData<R, DataProtection>(
      accessor,
      this.#dataProtectionKey,
    )
  }

  /**
   * Associate data access with an accessor
   */
  public setDataAccess<R>(accessor: (...args: unknown[]) => R, data: DataAccessConfig) {
    this.setAccessorData(accessor, data, this.#dataAccessKey)
  }

  /**
   * get accessor data access info and delete it
   */
  public consumeDataAccess<R>(accessor: (...args: unknown[]) => R) {
    return this.consumeAccessorData<R, DataAccessConfig>(accessor, this.#dataAccessKey)
  }
}
