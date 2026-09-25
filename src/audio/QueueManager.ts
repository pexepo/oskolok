import { Track, RepeatMode } from '../types/index.js';

export interface QueueState {
  sourceQueue: Track[];
  playbackQueue: Track[];
  currentIndex: number;
  shuffle: boolean;
  repeatMode: RepeatMode;
}

export class QueueManager {
  private state: QueueState = {
    sourceQueue: [],
    playbackQueue: [],
    currentIndex: -1,
    shuffle: false,
    repeatMode: 'off',
  };

  public getState(): QueueState {
    return { ...this.state };
  }

  public getCurrentTrack(): Track | null {
    if (this.state.currentIndex < 0 || this.state.currentIndex >= this.state.playbackQueue.length) {
      return null;
    }
    return this.state.playbackQueue[this.state.currentIndex];
  }

  public setQueue(tracks: Track[], startIndex: number = 0): void {
    const safeIndex = Math.max(0, Math.min(startIndex, tracks.length - 1));
    this.state.sourceQueue = [...tracks];

    if (this.state.shuffle) {
      this.state.playbackQueue = this.createShuffledQueue(tracks, safeIndex);
      this.state.currentIndex = 0;
    } else {
      this.state.playbackQueue = [...tracks];
      this.state.currentIndex = safeIndex;
    }
  }

  public playNow(track: Track): void {
    if (this.state.playbackQueue.length === 0) {
      this.setQueue([track], 0);
      return;
    }

    const currentTrack = this.getCurrentTrack();
    if (currentTrack && currentTrack.id === track.id) {
      return;
    }

    // Insert immediately after current position and move cursor
    const insertIndex = this.state.currentIndex + 1;
    this.state.playbackQueue.splice(insertIndex, 0, track);
    this.state.sourceQueue.splice(insertIndex, 0, track);
    this.state.currentIndex = insertIndex;
  }

  public playNext(track: Track): void {
    if (this.state.playbackQueue.length === 0) {
      this.setQueue([track], 0);
      return;
    }

    const insertIndex = this.state.currentIndex + 1;
    this.state.playbackQueue.splice(insertIndex, 0, track);
    this.state.sourceQueue.push(track);
  }

  public addToQueue(track: Track): void {
    if (this.state.playbackQueue.length === 0) {
      this.setQueue([track], 0);
      return;
    }

    this.state.playbackQueue.push(track);
    this.state.sourceQueue.push(track);
  }

  public appendTracks(tracks: Track[]): void {
    if (!tracks || tracks.length === 0) return;
    if (this.state.playbackQueue.length === 0) {
      this.setQueue(tracks, 0);
      return;
    }

    const existingIds = new Set(this.state.playbackQueue.map((t) => t.id));
    const newTracks = tracks.filter((t) => !existingIds.has(t.id));
    if (newTracks.length === 0) return;

    this.state.playbackQueue.push(...newTracks);
    this.state.sourceQueue.push(...newTracks);
  }

  public removeFromQueue(index: number): void {
    if (index < 0 || index >= this.state.playbackQueue.length) return;

    const removedTrack = this.state.playbackQueue[index];
    this.state.playbackQueue.splice(index, 1);

    const sourceIdx = this.state.sourceQueue.findIndex((t) => t.id === removedTrack.id);
    if (sourceIdx !== -1) {
      this.state.sourceQueue.splice(sourceIdx, 1);
    }

    if (index < this.state.currentIndex) {
      this.state.currentIndex--;
    } else if (this.state.currentIndex >= this.state.playbackQueue.length) {
      this.state.currentIndex = Math.max(-1, this.state.playbackQueue.length - 1);
    }
  }

  public clearQueue(): void {
    this.state.sourceQueue = [];
    this.state.playbackQueue = [];
    this.state.currentIndex = -1;
  }

  public toggleShuffle(): boolean {
    const newShuffle = !this.state.shuffle;
    this.state.shuffle = newShuffle;

    const currentTrack = this.getCurrentTrack();

    if (newShuffle) {
      if (currentTrack && this.state.sourceQueue.length > 0) {
        const currentSourceIdx = this.state.sourceQueue.findIndex((t) => t.id === currentTrack.id);
        this.state.playbackQueue = this.createShuffledQueue(
          this.state.sourceQueue,
          currentSourceIdx !== -1 ? currentSourceIdx : 0
        );
        this.state.currentIndex = 0;
      }
    } else {
      // Revert to original order preserving current track cursor
      if (currentTrack) {
        const originalIdx = this.state.sourceQueue.findIndex((t) => t.id === currentTrack.id);
        this.state.playbackQueue = [...this.state.sourceQueue];
        this.state.currentIndex = originalIdx !== -1 ? originalIdx : 0;
      } else {
        this.state.playbackQueue = [...this.state.sourceQueue];
      }
    }

    return newShuffle;
  }

  public setRepeatMode(mode: RepeatMode): void {
    this.state.repeatMode = mode;
  }

  public getNextTrack(): { track: Track | null; shouldLoopCurrent: boolean } {
    if (this.state.playbackQueue.length === 0) {
      return { track: null, shouldLoopCurrent: false };
    }

    if (this.state.repeatMode === 'one') {
      return { track: this.getCurrentTrack(), shouldLoopCurrent: true };
    }

    const nextIndex = this.state.currentIndex + 1;

    if (nextIndex < this.state.playbackQueue.length) {
      this.state.currentIndex = nextIndex;
      return { track: this.state.playbackQueue[nextIndex], shouldLoopCurrent: false };
    }

    if (this.state.repeatMode === 'all') {
      this.state.currentIndex = 0;
      return { track: this.state.playbackQueue[0], shouldLoopCurrent: false };
    }

    // Repeat OFF: end of queue
    return { track: null, shouldLoopCurrent: false };
  }

  public peekNextTrack(): Track | null {
    if (this.state.playbackQueue.length === 0) {
      return null;
    }
    if (this.state.repeatMode === 'one') {
      return this.getCurrentTrack();
    }
    const nextIndex = this.state.currentIndex + 1;
    if (nextIndex < this.state.playbackQueue.length) {
      return this.state.playbackQueue[nextIndex];
    }
    if (this.state.repeatMode === 'all' && this.state.playbackQueue.length > 0) {
      return this.state.playbackQueue[0];
    }
    return null;
  }

  public getPreviousTrack(currentTime: number): { track: Track | null; seekToZero: boolean } {
    if (this.state.playbackQueue.length === 0) {
      return { track: null, seekToZero: false };
    }

    // Rule: If currentTime > 3s, seek to 0s
    if (currentTime > 3) {
      return { track: this.getCurrentTrack(), seekToZero: true };
    }

    const prevIndex = this.state.currentIndex - 1;

    if (prevIndex >= 0) {
      this.state.currentIndex = prevIndex;
      return { track: this.state.playbackQueue[prevIndex], seekToZero: false };
    }

    if (this.state.repeatMode === 'all') {
      const lastIdx = this.state.playbackQueue.length - 1;
      this.state.currentIndex = lastIdx;
      return { track: this.state.playbackQueue[lastIdx], seekToZero: false };
    }

    return { track: this.getCurrentTrack(), seekToZero: true };
  }

  /**
   * Fisher-Yates shuffle keeping specified current index track at position 0
   */
  private createShuffledQueue(tracks: Track[], currentTrackIndex: number): Track[] {
    if (tracks.length <= 1) return [...tracks];

    const copy = [...tracks];
    const currentTrack = copy.splice(currentTrackIndex, 1)[0];

    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }

    return [currentTrack, ...copy];
  }
}

export const queueManager = new QueueManager();
