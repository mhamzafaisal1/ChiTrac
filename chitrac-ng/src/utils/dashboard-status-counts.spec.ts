import { hasConnectedActivity } from './dashboard-status-counts';

describe('hasConnectedActivity', () => {
  it('excludes a machine that has only offline time', () => {
    expect(hasConnectedActivity({
      metrics: {
        runtime: { total: 0 },
        pausedTime: { total: 0 },
        faultTime: { total: 0 },
        offlineTime: { total: 3_600_000 },
      },
    })).toBeFalse();
  });

  it('includes machines that ran, paused, or faulted during the timeframe', () => {
    expect(hasConnectedActivity({ metrics: { runtime: { total: 1 } } })).toBeTrue();
    expect(hasConnectedActivity({ metrics: { pausedTime: { total: 1 } } })).toBeTrue();
    expect(hasConnectedActivity({ metrics: { faultTime: { total: 1 } } })).toBeTrue();
  });

  it('supports the legacy performance metric shape', () => {
    expect(hasConnectedActivity({ performance: { runtime: { total: 1 } } })).toBeTrue();
  });
});
