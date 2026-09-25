import { describe, it, expect, beforeEach } from 'vitest';
import { QueueManager } from '../src/audio/QueueManager.js';
import { Track } from '../src/types/index.js';

describe('QueueManager Engine', () => {
  let queue: QueueManager;

  const mockTracks: Track[] = [
    { id: '1', source: 'soundcloud', sourceId: '1', title: 'Track 1', artist: { id: 'a1', source: 'soundcloud', sourceId: 'a1', name: 'Artist 1' }, duration: 180, access: 'playable' },
    { id: '2', source: 'soundcloud', sourceId: '2', title: 'Track 2', artist: { id: 'a2', source: 'soundcloud', sourceId: 'a2', name: 'Artist 2' }, duration: 200, access: 'playable' },
    { id: '3', source: 'soundcloud', sourceId: '3', title: 'Track 3', artist: { id: 'a3', source: 'soundcloud', sourceId: 'a3', name: 'Artist 3' }, duration: 220, access: 'playable' },
  ];

  beforeEach(() => {
    queue = new QueueManager();
  });

  it('should initialize queue and track cursor correctly', () => {
    queue.setQueue(mockTracks, 1);
    expect(queue.getCurrentTrack()?.id).toBe('2');
  });

  it('should preserve currently playing track at index 0 when enabling shuffle', () => {
    queue.setQueue(mockTracks, 1); // Track 2 is active
    queue.toggleShuffle();

    const state = queue.getState();
    expect(state.shuffle).toBe(true);
    expect(queue.getCurrentTrack()?.id).toBe('2');
    expect(state.playbackQueue[0].id).toBe('2');
  });

  it('should handle repeat one mode', () => {
    queue.setQueue(mockTracks, 0);
    queue.setRepeatMode('one');

    const next = queue.getNextTrack();
    expect(next.shouldLoopCurrent).toBe(true);
    expect(next.track?.id).toBe('1');
  });

  it('should seek to 0 if currentTime > 3 seconds when pressing Previous', () => {
    queue.setQueue(mockTracks, 1); // Track 2
    const res = queue.getPreviousTrack(5); // 5 seconds in
    expect(res.seekToZero).toBe(true);
    expect(res.track?.id).toBe('2');
  });

  it('should go to previous track if currentTime <= 3 seconds', () => {
    queue.setQueue(mockTracks, 1); // Track 2
    const res = queue.getPreviousTrack(2); // 2 seconds in
    expect(res.seekToZero).toBe(false);
    expect(res.track?.id).toBe('1');
  });

  it('should append new unique tracks to queue without duplicating existing tracks', () => {
    queue.setQueue(mockTracks, 1);
    const newTracks: Track[] = [
      mockTracks[0], // duplicate '1'
      { id: '4', source: 'soundcloud', sourceId: '4', title: 'Track 4', artist: { id: 'a4', source: 'soundcloud', sourceId: 'a4', name: 'Artist 4' }, duration: 190, access: 'playable' },
    ];
    queue.appendTracks(newTracks);
    const state = queue.getState();
    expect(state.playbackQueue.length).toBe(4);
    expect(state.playbackQueue[3].id).toBe('4');
    expect(queue.getCurrentTrack()?.id).toBe('2');
  });
});
