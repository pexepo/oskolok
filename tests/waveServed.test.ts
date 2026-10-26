import { describe, expect, it } from 'vitest';
import { noteServed, recentlyServed, sessionSalt } from '../server/src/services/wave/served.js';

describe('wave served memory', () => {
  it('remembers issued tracks across sessions and turns the rotation per new session', () => {
    noteServed('u1', ['a', 'b']);
    noteServed('u1', ['c', 'a']);
    expect(recentlyServed('u1')).toEqual(['b', 'c', 'a']);
    expect(recentlyServed('u2')).toEqual([]);
    const first = sessionSalt('u1', 0), refill = sessionSalt('u1', 1), next = sessionSalt('u1', 0);
    expect(refill).toBe(first);
    expect(next).not.toBe(first);
  });
});
