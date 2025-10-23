const Ajv = require('ajv');
const ajv = new Ajv();

// Import related schemas
const timestampsSchema = require('./timestampsSchema');
const machineSchema = require('./machine');
const metricsSchema = require('./metrics');
const itemSchema = require('./item');
const programSchema = require('./program');
const operatorSchema = require('./operator');
const stateSchema = require('./state');
const shiftSchema = require('./shift');

// Fault Session Schema Definition
const schema = {
  type: 'object',
  required: [
    'timestamps',
    'machine',
    'metrics',
    'program',
    'states',
    'shift'
  ],
  properties: {
    timestamps: {
      ...timestampsSchema.schema,
      properties: {
        ...timestampsSchema.schema.properties,
        start: {
          type: 'string',
          format: 'date-time',
          description: 'Timestamp of when the fault session started'
        }
      },
      description: 'Timestamps schema validated timestamps object for this fault session. Must also have .start'
    },
    machine: {
      ...machineSchema.schema,
      description: 'Schema valid machineObject for the machine for this fault session'
    },
    metrics: {
      ...metricsSchema.schema,
      description: 'Schema valid metricsObject for this session'
    },
    item: {
      ...itemSchema.schema,
      description: 'Schema valid itemObject of the item active for this session'
    },
    items: {
      type: 'array',
      items: {
        ...itemSchema.schema
      },
      description: 'Array of schema valid itemObjects of the items active for this session'
    },
    program: {
      ...programSchema.schema,
      description: 'Schema valid programObject of the program running on the machine for this session'
    },
    operator: {
      ...operatorSchema.schema,
      description: 'Schema valid operatorObject of the operator who was credited with work in this session'
    },
    operators: {
      type: 'array',
      items: {
        ...operatorSchema.schema
      },
      description: 'Array of schema valid operatorObjects of the operators who were credited with work in this session'
    },
    states: {
      type: 'object',
      required: ['start', 'array'],
      properties: {
        start: {
          ...stateSchema.schema,
          description: 'Schema valid stateObject record which started this session'
        },
        array: {
          type: 'array',
          items: {
            ...stateSchema.schema
          },
          description: 'Array of schema valid stateObjects representing any state records which have occurred during this session without ending it'
        },
        end: {
          ...stateSchema.schema,
          description: 'Schema valid stateObject record which ended this session, if it has ended'
        }
      },
      additionalProperties: false,
      description: 'Object with two required, one optional, child properties: start, array, and end'
    },
    shift: {
      ...shiftSchema.schema,
      description: 'Schema valid shiftObject of the shift this session was credited to'
    }
  },
  additionalProperties: false,
  // Custom validation to ensure either 'item' OR 'items' is provided, but not both
  // AND either 'operator' OR 'operators' is provided, but not both
  allOf: [
    {
      anyOf: [
        { required: ['item'], not: { required: ['items'] } },
        { required: ['items'], not: { required: ['item'] } }
      ]
    },
    {
      anyOf: [
        { required: ['operator'], not: { required: ['operators'] } },
        { required: ['operators'], not: { required: ['operator'] } }
      ]
    }
  ]
};

// Compile the schema for validation
const validate = ajv.compile(schema);

// Fault Session Utility Functions
const utils = {
  /**
   * Initialize a fault session object
   * @param {object} timestamps - Required schema valid timestamps object for this session
   * @param {object} machine - Required schema valid machineObject of machine this session was credited to
   * @param {object} metrics - Required schema valid metricsObject for this session
   * @param {object|object[]} itemOrItems - Required schema valid itemObject or array of itemObjects active for this session
   * @param {object} program - Required schema valid programObject of program the machine was running for this session
   * @param {object|object[]} operatorOrOperators - Required schema valid operatorObject or array of operatorObjects this session was credited to
   * @param {object} states - Required object with start, array, and optional end properties
   * @param {object} shift - Required schema valid shiftObject associated with this session
   * @returns {object} Validated fault session object
   */
  initFaultSession: (timestamps, machine, metrics, itemOrItems, program, operatorOrOperators, states, shift) => {
    // Validate that timestamps has start property
    if (!timestamps.start) {
      throw new Error('Timestamps object must contain start property for fault session.');
    }

    // Handle items - determine if it's a single item or array
    let item, items;
    if (Array.isArray(itemOrItems)) {
      items = itemOrItems;
    } else {
      item = itemOrItems;
    }

    // Handle operators - determine if it's a single operator or array
    let operator, operators;
    if (Array.isArray(operatorOrOperators)) {
      operators = operatorOrOperators;
    } else {
      operator = operatorOrOperators;
    }

    // Build the fault session object with required properties
    const faultSessionObject = {
      timestamps,
      machine,
      metrics,
      program,
      states,
      shift
    };

    // Add item or items based on what was provided
    if (item) {
      faultSessionObject.item = item;
    } else if (items) {
      faultSessionObject.items = items;
    }

    // Add operator or operators based on what was provided
    if (operator) {
      faultSessionObject.operator = operator;
    } else if (operators) {
      faultSessionObject.operators = operators;
    }

    // Validate against schema before returning
    const valid = validate(faultSessionObject);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return faultSessionObject;
  },

  /**
   * Set a property on a fault session object
   * @param {object} faultSessionObject - Required Fault Session schema valid faultSessionObject
   * @param {string} propertyToSet - Required string name of property to set
   * @param {*} valueToSet - Required new property value to be set (any type)
   * @returns {object} Fault Session schema validated object with updated property
   */
  setProperty: (faultSessionObject, propertyToSet, valueToSet) => {
    const now = new Date().toISOString();
    
    const updatedFaultSession = {
      ...faultSessionObject,
      [propertyToSet]: valueToSet,
      timestamps: timestampsSchema.utils.stampUpdate(faultSessionObject.timestamps, now)
    };

    // Validate against schema before returning
    const valid = validate(updatedFaultSession);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedFaultSession;
  },

  /**
   * Push a state into the fault session
   * @param {object} faultSessionObject - Required Fault Session schema valid faultSessionObject to push the state into
   * @param {object} stateToPush - Required schema valid stateObject
   * @param {boolean} [isEndState] - Optional boolean value, only true if the state being pushed is the end state for this session
   * @returns {object} Fault Session schema validated faultSessionObject with added state
   */
  pushState: (faultSessionObject, stateToPush, isEndState = false) => {
    const now = new Date().toISOString();
    
    // Update timestamps.update to the timestamps.update in the stateToPush
    const updatedTimestamps = timestampsSchema.utils.stampUpdate(
      faultSessionObject.timestamps, 
      stateToPush.timestamps.update
    );

    // Push the state into states.array[]
    const updatedStates = {
      ...faultSessionObject.states,
      array: [...faultSessionObject.states.array, stateToPush]
    };

    // If isEndState == true, assign the timestamps.update in the stateToPush to the timestamps.end for this session
    // and assign the stateToPush to states.end
    if (isEndState) {
      updatedTimestamps.end = stateToPush.timestamps.update;
      updatedStates.end = stateToPush;
    }

    // Recalculate metrics for metricsObject and reInit metricsObject
    // TODO: Implement proper metrics recalculation based on updated states
    // For now, using a stub that maintains the existing metrics structure
    const updatedMetrics = metricsSchema.utils.setProperty(
      faultSessionObject.metrics, 
      'totals', 
      {
        ...faultSessionObject.metrics.totals,
        // Add any specific fault session metrics here
      }
    );

    const updatedFaultSession = {
      ...faultSessionObject,
      timestamps: updatedTimestamps,
      states: updatedStates,
      metrics: updatedMetrics
    };

    // Validate against schema before returning
    const valid = validate(updatedFaultSession);
    if (!valid) {
      throw new Error(`Schema validation failed: ${ajv.errorsText(validate.errors)}`);
    }

    return updatedFaultSession;
  },

  /**
   * Get fault session summary information
   * @param {object} faultSessionObject - Required Fault Session schema valid faultSessionObject
   * @returns {object} Summary object with key fault session information
   */
  getFaultSessionSummary: (faultSessionObject) => {
    const stateCount = faultSessionObject.states.array.length;
    const hasEndState = !!faultSessionObject.states.end;
    
    const operatorNames = faultSessionObject.operator ? 
      [operatorSchema.utils.getFullName(faultSessionObject.operator)] : 
      faultSessionObject.operators.map(op => operatorSchema.utils.getFullName(op));
    
    const itemNames = faultSessionObject.item ? 
      [faultSessionObject.item.name] : 
      faultSessionObject.items.map(item => item.name);

    return {
      startTime: faultSessionObject.timestamps.start,
      endTime: faultSessionObject.timestamps.end || 'Session Active',
      machine: machineSchema.utils.getIPAddress(faultSessionObject.machine),
      machineName: faultSessionObject.machine.name,
      stateCount,
      hasEndState,
      operatorNames,
      itemNames,
      programMode: faultSessionObject.program.mode,
      shiftName: faultSessionObject.shift.name || 'Unnamed Shift'
    };
  }
};

module.exports = {
  schema,
  utils
};
