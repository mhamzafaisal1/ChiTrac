const Ajv = require('ajv');
const ajv = new Ajv();

// Names Schema Definition
const schema = {
  type: 'object',
  required: [
    'first',
    'surname'
  ],
  properties: {
    first: {
      type: 'string',
      description: "String of the person's first name"
    },
    surname: {
      type: 'string',
      description: "String of the person's surname/last name"
    },
    prefix: {
      type: 'string',
      description: "String of the person's name prefix, such as Dr., Mr., Ms., Mrs., etc."
    },
    suffix: {
      type: 'string',
      description: "String of the person's name suffix, such as Sr./Jr., II, III, etc."
    },
    middle: {
      type: 'string',
      description: "String of the person's middle name"
    },
    middleInitial: {
      type: 'string',
      maxLength: 1,
      description: "String of the person's middle initial"
    },
    additionalSurnames: {
      type: 'array',
      items: {
        type: 'string'
      },
      description: "Array of strings, sorted in the order they should be displayed, of additional last names for a person. This is often applicable for Spanish names which often include mother's maiden name in a person's last name."
    },
    lastFirst: {
      type: 'boolean',
      description: "Boolean value for if a person's last/surname should be displayed prior to their first/given name. If true, the fullname util function should put the surname before the given name."
    }
  },
  additionalProperties: false
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Names Utility Functions
const utils = {
  /**
   * Normalize a name object before validation and persistence.
   * A supplied middle name is authoritative for middleInitial.
   * @param {object} nameObject - Human-names schema object
   * @returns {object} Normalized name object
   */
  normalize: (nameObject) => {
    if (!nameObject || typeof nameObject !== 'object' || Array.isArray(nameObject)) {
      throw new Error('Name must be a human-names schema object');
    }

    const normalizedName = { ...nameObject };
    if (typeof normalizedName.middle === 'string' && normalizedName.middle.trim()) {
      normalizedName.middleInitial = normalizedName.middle.trim().charAt(0);
    }

    return normalizedName;
  },

  /**
   * Return the long and short display forms of a human-names schema object.
   * @param {object} nameObject - Human-names schema object
   * @returns {{fullName: string, fullNameShort: string}} Formatted names
   */
  getFormattedNames: (nameObject) => {
    const normalizedName = utils.normalize(nameObject);
    const valid = validate(normalizedName);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    const firstNames = [
      normalizedName.first,
      normalizedName.middle || normalizedName.middleInitial
    ].filter(Boolean);
    const surnames = [
      normalizedName.surname,
      ...(normalizedName.additionalSurnames || [])
    ].filter(Boolean);
    const orderedNames = normalizedName.lastFirst
      ? [...surnames, ...firstNames]
      : [...firstNames, ...surnames];
    const shortNames = normalizedName.lastFirst
      ? [normalizedName.surname, normalizedName.first]
      : [normalizedName.first, normalizedName.surname];

    return {
      fullName: [
        normalizedName.prefix,
        ...orderedNames,
        normalizedName.suffix
      ].filter(Boolean).join(' ').trim().replace(/\s+/g, ' '),
      fullNameShort: shortNames.filter(Boolean).join(' ').trim().replace(/\s+/g, ' ')
    };
  },

  /**
   * Set or update name properties on a name object
   * @param {object} nameObjectToEdit - If initing a name, provide an empty object. Otherwise, provide the existing name object.
   * @param {object} nameObject - Object containing the properties to set/overwrite. If a null is provided for a property, that property will be removed.
   * @returns {object} The updated name object
   */
  setName: (nameObjectToEdit, nameObject) => {
    const updatedName = { ...nameObjectToEdit };

    // Iterate through all properties in nameObject
    for (const [key, value] of Object.entries(nameObject)) {
      if (value === null) {
        // If null is provided, remove the property
        delete updatedName[key];
      } else {
        // Otherwise, set/overwrite the property
        updatedName[key] = value;
      }
    }

    const normalizedName = utils.normalize(updatedName);

    // Validate against schema before returning
    const valid = validate(normalizedName);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return normalizedName;
  },

  /**
   * Get the full name of a person based on the specified format
   * @param {string} nameFormat - String for indicating the name format to use. Currently only 'standard' is supported.
   * @param {object} nameObject - The name object containing the person's name properties
   * @returns {string} Concatenated string of the person's full name
   */
  getFullName: (nameFormat, nameObject) => {
    if (nameFormat !== 'standard') {
      throw new Error(`Unsupported name format: ${nameFormat}. Only 'standard' is currently supported.`);
    }

    return utils.getFormattedNames(nameObject).fullName;
  },

  /**
   * Set a property on a name object
   * @param {object} object - Required schema valid name object
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Schema validated name object with updated property
   */
  setProperty: (object, propertyToSet, valueToSet) => {
    const updatedName = utils.normalize({
      ...object,
      [propertyToSet]: valueToSet
    });

    // Validate against schema before returning
    const valid = validate(updatedName);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedName;
  }
};

module.exports = {
  schema,
  utils
};

