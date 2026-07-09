const machineSchema = require('../schemas/machine');
const ipAddressSchema = require('../schemas/ipAddress');

function ipAddress(lastOctet) {
  return ipAddressSchema.utils.initIPAddress(192, 168, 0, lastOctet);
}

function addresses(count) {
  return Array.from({ length: count }, (_, index) => index + 1);
}

function machine(id, name, lastOctet, count, type) {
  return machineSchema.utils.initMachine(
    id,
    name,
    ipAddress(lastOctet),
    addresses(count),
    type,
    false,
    false,
    null,
    null,
    addresses(count)
  );
}

module.exports = {
  machine: [
    machine(90001, 'SPF1', 1, 1, 'SPF'),
    machine(90002, 'SPF2', 2, 1, 'SPF'),
    machine(90003, 'SPF3', 3, 1, 'SPF'),
    machine(90004, 'SPF4', 4, 1, 'SPF'),
    machine(90005, 'SPF5', 5, 1, 'SPF'),
    machine(90006, 'SPF6', 6, 1, 'SPF'),
    machine(90007, 'LPL1', 7, 3, 'LPL'),
    machine(90008, 'LPL2', 8, 3, 'LPL'),
    machine(90009, 'Blanket1', 9, 2, 'Blanket'),
    machine(90010, 'Blanket2', 10, 2, 'Blanket'),
    machine(90011, 'SPL1', 11, 4, 'SPL')
  ]
};
