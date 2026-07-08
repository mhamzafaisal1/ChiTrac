const assert = require('node:assert/strict');
const test = require('node:test');

const humanNamesSchema = require('../schemas/human-names');
const { formatHumanName } = require('../utils/humanNames');

test('formats all human-name fields and derives middleInitial', () => {
  const name = humanNamesSchema.utils.setName({}, {
    prefix: 'Dr.',
    first: 'Ana',
    middle: 'Maria',
    surname: 'Lopez',
    additionalSurnames: ['Garcia', 'Diaz'],
    suffix: 'Jr.',
    lastFirst: false
  });

  assert.equal(name.middleInitial, 'M');
  assert.deepEqual(humanNamesSchema.utils.getFormattedNames(name), {
    fullName: 'Dr. Ana Maria Lopez Garcia Diaz Jr.',
    fullNameShort: 'Ana Lopez'
  });
});

test('lastFirst reverses both long and short name order', () => {
  const formatted = humanNamesSchema.utils.getFormattedNames({
    first: 'Ana',
    middle: 'Maria',
    surname: 'Lopez',
    additionalSurnames: ['Garcia'],
    lastFirst: true
  });

  assert.deepEqual(formatted, {
    fullName: 'Lopez Garcia Ana Maria',
    fullNameShort: 'Lopez Ana'
  });
});

test('middle name replaces a supplied middleInitial with its first letter', () => {
  const name = humanNamesSchema.utils.normalize({
    first: 'Ana',
    middle: '  maria',
    middleInitial: 'X',
    surname: 'Lopez'
  });

  assert.equal(name.middleInitial, 'm');
});

test('legacy string display remains readable during data migration', () => {
  assert.equal(formatHumanName('Legacy Operator'), 'Legacy Operator');
  assert.equal(formatHumanName(null, 'Operator 10'), 'Operator 10');
});

test('middleInitial is limited to one character', () => {
  assert.throws(
    () => humanNamesSchema.utils.setName({}, {
      first: 'Ana',
      surname: 'Lopez',
      middleInitial: 'MM'
    }),
    /Schema validation failed/
  );
});
