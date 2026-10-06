import { describe, expect, it } from 'vitest';
import { type MonitorState, nextState } from '../src/modules/checks/state-machine.js';

const up: MonitorState = { status: 'UP', consecutiveFailures: 0 };

describe('nextState', () => {
  it('UP -> 1 failure stays UP -> 2 failures DOWN -> success recovers', () => {
    const afterOne = nextState(up, false);
    expect(afterOne).toEqual({ status: 'UP', consecutiveFailures: 1, transition: null });

    const afterTwo = nextState(afterOne, false);
    expect(afterTwo).toEqual({ status: 'DOWN', consecutiveFailures: 2, transition: 'down' });

    const afterThree = nextState(afterTwo, false);
    expect(afterThree).toEqual({ status: 'DOWN', consecutiveFailures: 3, transition: null });

    expect(nextState(afterThree, true)).toEqual({
      status: 'UP',
      consecutiveFailures: 0,
      transition: 'recovered',
    });
  });

  it('a single blip between successes never changes status', () => {
    const blip = nextState(up, false);
    expect(nextState(blip, true)).toEqual({
      status: 'UP',
      consecutiveFailures: 0,
      transition: null,
    });
  });

  it('UNKNOWN becomes UP on success (no recovery event) and DOWN after 2 failures', () => {
    const unknown: MonitorState = { status: 'UNKNOWN', consecutiveFailures: 0 };
    expect(nextState(unknown, true).transition).toBeNull();
    expect(nextState(unknown, true).status).toBe('UP');
    const one = nextState(unknown, false);
    expect(one.status).toBe('UNKNOWN');
    expect(nextState(one, false)).toMatchObject({ status: 'DOWN', transition: 'down' });
  });
});
