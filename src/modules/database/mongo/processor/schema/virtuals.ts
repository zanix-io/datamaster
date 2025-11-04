import type { BaseCustomSchema } from 'mongo/typings/schema.ts'

/**
 * Adds a virtual 'id' field to the Mongoose schema.
 * This virtual property sets the `_id` of the document when a value is assigned to it.
 *
 * @param {BaseCustomSchema} schema - The Mongoose schema to add the virtual to.
 * @returns {void} - This function modifies the schema in place, no value is returned.
 *
 * @example
 * const mySchema = new Schema({ name: String });
 * mainVirtuals(mySchema);
 * const Model = mongoose.model('MyModel', mySchema);
 *
 * // Usage of 'id' virtual field
 * const doc = new Model({ name: 'Example' });
 * doc.id = 'custom-id';  // Sets _id to 'custom-id'
 * console.log(doc._id);  // Output: 'custom-id'
 */
export const mainVirtuals = (schema: BaseCustomSchema): void => {
  schema.virtual('id').set(function virtualId(id) {
    this._id = id
  })
}
