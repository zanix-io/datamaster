/**
 *  ______               _
 * |___  /              (_)
 *    / /   __ _  _ __   _ __  __
 *   / /   / _` || '_ \ | |\ \/ /
 * ./ /___| (_| || | | || | >  <
 * \_____/ \__,_||_| |_||_|/_/\_\
 */

/**
 * This module aggregates and exposes the core public modules of the Zanix datamaster.
 *
 * It provides access to the main `ProgramModule`, database utilities, and (optionally)
 * other subsystems like caching or additional service layers.
 *
 * The purpose of this module is to serve as a centralized entry point for importing
 * the project's key functionalities.
 *
 * @module zanixDatamaster
 */

import ProgramModule from 'modules/program/public.ts'

export { ProgramModule }

export * from 'modules/database/mod.ts'
// export * from 'modules/cache/mod.ts'
