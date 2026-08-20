import { getStatusDotByCode } from './status-utils';

export interface MachineStatusCounts {
  total: number;
  running: number;
  paused: number;
  faulted: number;
  offline: number;
  idlePaused: number;
  down: number;
}

export interface OperatorStatusCounts {
  total: number;
  assigned: number;
  running: number;
  paused: number;
  faulted: number;
  idle: number;
  idlePaused: number;
  down: number;
}

export const EMPTY_MACHINE_STATUS_COUNTS: MachineStatusCounts = {
  total: 0,
  running: 0,
  paused: 0,
  faulted: 0,
  offline: 0,
  idlePaused: 0,
  down: 0,
};

export const EMPTY_OPERATOR_STATUS_COUNTS: OperatorStatusCounts = {
  total: 0,
  assigned: 0,
  running: 0,
  paused: 0,
  faulted: 0,
  idle: 0,
  idlePaused: 0,
  down: 0,
};

export function calculateMachineStatusCounts(responses: any[] = []): MachineStatusCounts {
  const total = responses.length;
  const running = responses.filter((r) => getStatusDotByCode(r.currentStatus?.code) === 'Running Dot').length;
  const paused = responses.filter((r) => getStatusDotByCode(r.currentStatus?.code) === 'Paused Dot').length;
  const faulted = responses.filter((r) => getStatusDotByCode(r.currentStatus?.code) === 'Faulted Dot').length;
  const offline = responses.filter((r) => getStatusDotByCode(r.currentStatus?.code) === 'Offline Dot').length;
  const idlePaused = Math.max(total - running - faulted, 0);
  const down = Math.max(total - running, 0);

  return { total, running, paused, faulted, offline, idlePaused, down };
}

export function calculateOperatorStatusCounts(responses: any[] = [], idleOperators = 0): OperatorStatusCounts {
  const idle = Math.max(Number(idleOperators) || 0, 0);
  const total = responses.length;
  const assigned = responses.filter(isAssignedOperator).length;
  const running = responses.filter((r) => isAssignedOperator(r) && getStatusDotByCode(r.currentStatus?.code) === 'Running Dot').length;
  const paused = responses.filter((r) => isAssignedOperator(r) && getStatusDotByCode(r.currentStatus?.code) === 'Paused Dot').length;
  const faulted = responses.filter((r) => isAssignedOperator(r) && getStatusDotByCode(r.currentStatus?.code) === 'Faulted Dot').length;
  const idlePaused = idle + paused;
  const down = idlePaused + faulted;

  return { total, assigned, running, paused, faulted, idle, idlePaused, down };
}

function isAssignedOperator(response: any): boolean {
  return Boolean(response?.currentMachine?.name || response?.currentMachine?.serial);
}
