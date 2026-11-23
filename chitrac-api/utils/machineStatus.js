/**
 * Machine status codes written by the datafeed and the older XML integrations:
 *   0 = paused (includes timeout), 1 = running, 2 and above = a fault code.
 * Older routes compared with `==`, so the string forms "0" and "1" are accepted too.
 */
const STATUS = Object.freeze({ PAUSED: 0, RUNNING: 1, FIRST_FAULT: 2 });

const isRunning = (code) => code === STATUS.RUNNING || code === '1';
const isPaused = (code) => code === STATUS.PAUSED || code === '0';
// Relational comparison keeps the previous `code > 1` coercion for strings.
const isFault = (code) => code >= STATUS.FIRST_FAULT;

module.exports = { STATUS, isRunning, isPaused, isFault };
