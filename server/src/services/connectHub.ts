/**
 * Осколок Connect: the listener's open players (phone, desktop, Telegram, browser tabs) see each other,
 * show what plays where, pass playback between devices and control one another.
 * Presence lives in memory — a device is listed while its event stream is open; the API runs as one process.
 * Jam rooms (below) reuse the same streams: friends share one queue and each plays it on their own device.
 */
import {randomBytes} from 'node:crypto';
export type DeviceKind = 'desktop' | 'phone' | 'tablet' | 'telegram' | 'web';
export interface ConnectTrack { id: string; title: string; artist: string; artworkUrl?: string; duration: number }
export interface DeviceState { track: ConnectTrack | null; isPlaying: boolean; position: number; duration: number; volume: number; at: number }
export interface DeviceView { id: string; name: string; kind: DeviceKind; state: DeviceState | null; connectedAt: number }
export interface Sink { send(event: string, data: unknown): void }
export type ConnectAction = 'play' | 'pause' | 'toggle' | 'next' | 'previous' | 'seek' | 'volume' | 'handoff';

interface Device { id: string; name: string; kind: DeviceKind; sinks: Set<Sink>; state: DeviceState | null; connectedAt: number }

const MAX_DEVICES = 12, MAX_SINKS = 3;
const users = new Map<string, Map<string, Device>>();

const view = (d: Device): DeviceView => ({ id: d.id, name: d.name, kind: d.kind, state: d.state, connectedAt: d.connectedAt });

export function listDevices(userId: string): DeviceView[] {
  return [...(users.get(userId)?.values() || [])].map(view).sort((a, b) => a.connectedAt - b.connectedAt);
}

function safeSend(sink: Sink, event: string, data: unknown) { try { sink.send(event, data); } catch { /* the stream closes itself */ } }
function broadcast(userId: string) {
  const devices = listDevices(userId);
  for (const d of users.get(userId)?.values() || []) for (const s of d.sinks) safeSend(s, 'devices', devices);
}

/** Registers an open stream; the returned function forgets it. Oldest devices give way past the limit. */
export function attachDevice(userId: string, info: { id: string; name: string; kind: DeviceKind }, sink: Sink): () => void {
  let map = users.get(userId);
  if (!map) { map = new Map(); users.set(userId, map); }
  let device = map.get(info.id);
  if (!device) {
    while (map.size >= MAX_DEVICES) {
      const oldest = [...map.values()].sort((a, b) => a.connectedAt - b.connectedAt)[0];
      map.delete(oldest.id);
    }
    device = { ...info, sinks: new Set(), state: null, connectedAt: Date.now() };
    map.set(info.id, device);
  } else { device.name = info.name; device.kind = info.kind; }
  if (device.sinks.size >= MAX_SINKS) device.sinks.delete(device.sinks.values().next().value as Sink);
  device.sinks.add(sink);
  safeSend(sink, 'hello', { self: info.id, devices: listDevices(userId) });
  broadcast(userId);
  jamDeviceBack(userId, info.id, sink);
  const own = device;
  return () => {
    own.sinks.delete(sink);
    const current = users.get(userId);
    if (!own.sinks.size && current?.get(own.id) === own) current.delete(own.id);
    if (current && !current.size) users.delete(userId);
    broadcast(userId);
    if (!own.sinks.size) jamDeviceGone(userId, own.id);
  };
}

export function publishState(userId: string, deviceId: string, state: Omit<DeviceState, 'at'>): boolean {
  const map = users.get(userId), device = map?.get(deviceId);
  if (!map || !device) return false;
  const startedNow = state.isPlaying && !device.state?.isPlaying;
  device.state = { ...state, at: Date.now() };
  // One player at a time, like Spotify Connect: when this device starts, the others pause.
  if (startedNow) for (const other of map.values()) {
    if (other !== device && other.state?.isPlaying) for (const s of other.sinks) safeSend(s, 'command', { from: deviceId, action: 'pause', reason: 'other-device' });
  }
  broadcast(userId);
  return true;
}

export function sendCommand(userId: string, from: string, target: string, action: ConnectAction, value?: number): boolean {
  const device = users.get(userId)?.get(target);
  if (!device || target === from) return false;
  for (const s of device.sinks) safeSend(s, 'command', { from, action, value });
  return true;
}

/** Passes the queue to another device (push «play there», or the answer to a «listen here» request). */
export function relayTakeover(userId: string, from: string, to: string, payload: { queue: unknown[]; index: number; position: number; isPlaying: boolean }): boolean {
  const device = users.get(userId)?.get(to);
  if (!device || to === from) return false;
  for (const s of device.sinks) safeSend(s, 'takeover', { from, ...payload });
  return true;
}

/* ---------- Jam: one queue for friends, each listening on their own device ---------- */
export interface JamPerson { userId: string; publicId: string; name: string; avatarUrl: string }
export interface JamTrack { id: string; title: string; [key: string]: unknown }
export interface JamEntry { key: string; track: JamTrack; addedBy: string }
export interface JamMemberView extends JamPerson { owner: boolean; online: boolean }
export interface JamView { id: string; ownerId: string; /** The listener this copy is for. */ you: string; members: JamMemberView[]; queue: JamEntry[]; index: number; isPlaying: boolean; position: number; at: number; now: number; rev: number }
export interface JamSummary { id: string; owner: JamPerson; members: number; track: JamTrack | null; isPlaying: boolean }
export type JamControl = { action: 'play' | 'pause' | 'seek' | 'jump' | 'ended'; position?: number; index?: number; fromIndex?: number };

interface JamMember extends JamPerson { deviceId: string; joinedAt: number; leaveTimer?: ReturnType<typeof setTimeout> }
interface Jam { id: string; ownerId: string; members: Map<string, JamMember>; queue: JamEntry[]; index: number; isPlaying: boolean; position: number; at: number; rev: number }

export const JAM_QUEUE_LIMIT = 300, JAM_MEMBER_LIMIT = 10;
/** A member whose device dropped keeps the seat this long (reconnects, a reloaded tab). */
export const JAM_GRACE_MS = 90_000;
const jams = new Map<string, Jam>(), jamOfUser = new Map<string, string>();
let entrySeq = 0;
const entryKey = () => `${Date.now().toString(36)}${(entrySeq++ % 1296).toString(36).padStart(2, '0')}`;

const deviceOnline = (userId: string, deviceId: string) => !!users.get(userId)?.get(deviceId)?.sinks.size;
function sendToDevice(userId: string, deviceId: string, event: string, data: unknown) {
  for (const s of users.get(userId)?.get(deviceId)?.sinks || []) safeSend(s, event, data);
}
function sendToUser(userId: string, event: string, data: unknown) {
  for (const d of users.get(userId)?.values() || []) for (const s of d.sinks) safeSend(s, event, data);
}
const livePos = (jam: Jam) => jam.position + (jam.isPlaying ? (Date.now() - jam.at) / 1000 : 0);

function jamView(jam: Jam, you: string): JamView {
  const members = [...jam.members.values()].sort((a, b) => a.joinedAt - b.joinedAt)
    .map(({ userId, publicId, name, avatarUrl, deviceId }) => ({ userId, publicId, name, avatarUrl, owner: userId === jam.ownerId, online: deviceOnline(userId, deviceId) }));
  return { id: jam.id, ownerId: jam.ownerId, you, members, queue: jam.queue, index: jam.index, isPlaying: jam.isPlaying, position: jam.position, at: jam.at, now: Date.now(), rev: jam.rev };
}
function broadcastJam(jam: Jam) {
  for (const m of jam.members.values()) sendToDevice(m.userId, m.deviceId, 'jam', jamView(jam, m.userId));
}
const changed = (jam: Jam, you: string) => { jam.rev++; broadcastJam(jam); return jamView(jam, you); };

export function jamFor(userId: string): JamView | null {
  const jam = jams.get(jamOfUser.get(userId) || '');
  return jam ? jamView(jam, userId) : null;
}
export function jamOwner(jamId: string): string | null { return jams.get(jamId)?.ownerId || null; }
export function isJamMember(jamId: string, userId: string) { return !!jams.get(jamId)?.members.has(userId); }

export function endJam(jamId: string, reason: 'ended' | 'owner-left' = 'ended') {
  const jam = jams.get(jamId);
  if (!jam) return false;
  jams.delete(jamId);
  for (const m of jam.members.values()) {
    clearTimeout(m.leaveTimer);
    if (jamOfUser.get(m.userId) === jamId) jamOfUser.delete(m.userId);
    sendToDevice(m.userId, m.deviceId, 'jam-end', { id: jamId, reason });
  }
  return true;
}

/** Leaves the listener's jam; the owner leaving ends it for everyone. */
export function leaveJam(userId: string): boolean {
  const jam = jams.get(jamOfUser.get(userId) || '');
  if (!jam) return false;
  if (jam.ownerId === userId) return endJam(jam.id, 'owner-left');
  const m = jam.members.get(userId)!;
  clearTimeout(m.leaveTimer);
  jam.members.delete(userId);
  jamOfUser.delete(userId);
  sendToDevice(userId, m.deviceId, 'jam-end', { id: jam.id, reason: 'left' });
  jam.rev++; broadcastJam(jam);
  return true;
}

function seat(jam: Jam, person: JamPerson, deviceId: string) {
  const existing = jam.members.get(person.userId);
  if (existing) {
    clearTimeout(existing.leaveTimer); existing.leaveTimer = undefined;
    // Joining from another device moves the seat: the old one falls silent.
    if (existing.deviceId !== deviceId) sendToDevice(person.userId, existing.deviceId, 'jam-end', { id: jam.id, reason: 'moved' });
    Object.assign(existing, person, { deviceId });
  } else jam.members.set(person.userId, { ...person, deviceId, joinedAt: Date.now() });
  jamOfUser.set(person.userId, jam.id);
}

/** Starts a jam with the owner's current queue. Any earlier jam of the owner ends, any other one is left. */
export function createJam(owner: JamPerson, deviceId: string, init: { queue: JamTrack[]; index: number; position: number; isPlaying: boolean }): JamView {
  leaveJam(owner.userId);
  const queue = init.queue.slice(0, JAM_QUEUE_LIMIT).map(track => ({ key: entryKey(), track, addedBy: owner.userId }));
  const jam: Jam = { id: randomBytes(9).toString('base64url'), ownerId: owner.userId, members: new Map(), queue,
    index: queue.length ? Math.max(0, Math.min(init.index, queue.length - 1)) : 0, isPlaying: queue.length > 0 && init.isPlaying,
    position: queue.length ? Math.max(0, init.position) : 0, at: Date.now(), rev: 1 };
  jams.set(jam.id, jam);
  seat(jam, owner, deviceId);
  broadcastJam(jam);
  return jamView(jam, owner.userId);
}

/** Seats a listener. Who may join (the owner's friends) is decided by the caller. */
export function joinJam(jamId: string, person: JamPerson, deviceId: string): JamView | 'not-found' | 'full' {
  const jam = jams.get(jamId);
  if (!jam) return 'not-found';
  if (!jam.members.has(person.userId) && jam.members.size >= JAM_MEMBER_LIMIT) return 'full';
  if (jamOfUser.get(person.userId) && jamOfUser.get(person.userId) !== jamId) leaveJam(person.userId);
  seat(jam, person, deviceId);
  return changed(jam, person.userId);
}

/** Adds a track: to the end, right after the current one, or to play now for everyone. */
export function addToJam(userId: string, track: JamTrack, mode: 'end' | 'next' | 'now' = 'end'): JamView | null {
  const jam = jams.get(jamOfUser.get(userId) || '');
  if (!jam) return null;
  // The queue played out (index past the end): a new song starts at once for everyone.
  const ended = jam.index >= jam.queue.length;
  const upcoming = jam.queue.findIndex((e, i) => i > jam.index && e.track.id === track.id);
  if (mode === 'end' && upcoming >= 0) return jamView(jam, userId);
  const entry = upcoming >= 0 ? jam.queue.splice(upcoming, 1)[0] : { key: entryKey(), track, addedBy: userId };
  if (!jam.queue.length || ended) {
    jam.queue.push(entry); jam.index = jam.queue.length - 1;
    Object.assign(jam, { isPlaying: true, position: 0, at: Date.now() });
  } else if (mode === 'end') jam.queue.push(entry);
  else {
    jam.queue.splice(jam.index + 1, 0, entry);
    if (mode === 'now') { jam.index++; Object.assign(jam, { isPlaying: true, position: 0, at: Date.now() }); }
  }
  // Long sessions forget the oldest played songs, never the current or upcoming ones.
  while (jam.queue.length > JAM_QUEUE_LIMIT && jam.index > 0) { jam.queue.shift(); jam.index--; }
  if (jam.queue.length > JAM_QUEUE_LIMIT) jam.queue.length = JAM_QUEUE_LIMIT;
  return changed(jam, userId);
}

/** The owner removes anything upcoming; a guest only what they added. */
export function removeFromJam(userId: string, key: string): JamView | null | 'forbidden' {
  const jam = jams.get(jamOfUser.get(userId) || '');
  if (!jam) return null;
  const i = jam.queue.findIndex(e => e.key === key);
  if (i < 0 || i === jam.index) return jamView(jam, userId);
  if (jam.ownerId !== userId && jam.queue[i].addedBy !== userId) return 'forbidden';
  jam.queue.splice(i, 1);
  if (i < jam.index) jam.index--;
  return changed(jam, userId);
}

/** Play, pause, seek, move to another track or mark the end of the queue — for everyone. A «jump» from a stale index is ignored,
 *  so two players ending the same song at once advance the queue by one. */
export function controlJam(userId: string, c: JamControl): JamView | null {
  const jam = jams.get(jamOfUser.get(userId) || '');
  if (!jam) return null;
  const now = Date.now(), pos = (v?: number) => Math.max(0, typeof v === 'number' ? v : livePos(jam));
  switch (c.action) {
    case 'play': Object.assign(jam, { isPlaying: jam.queue.length > 0, position: pos(c.position), at: now }); break;
    case 'pause': Object.assign(jam, { isPlaying: false, position: pos(c.position), at: now }); break;
    case 'seek': Object.assign(jam, { position: pos(c.position), at: now }); break;
    case 'jump': {
      if (typeof c.fromIndex === 'number' && c.fromIndex !== jam.index) return jamView(jam, userId);
      if (typeof c.index !== 'number' || c.index < 0 || c.index >= jam.queue.length) return jamView(jam, userId);
      Object.assign(jam, { index: c.index, isPlaying: true, position: 0, at: now });
      break;
    }
    case 'ended': {
      // The last song finished: the queue waits past its end until someone adds more.
      if (c.fromIndex !== jam.index || jam.index !== jam.queue.length - 1) return jamView(jam, userId);
      Object.assign(jam, { index: jam.queue.length, isPlaying: false, position: 0, at: now });
      break;
    }
  }
  return changed(jam, userId);
}

/** Open jams hosted by these listeners (the friends list shows them). */
export function jamsHostedBy(ownerIds: string[]): JamSummary[] {
  const wanted = new Set(ownerIds);
  return [...jams.values()].filter(j => wanted.has(j.ownerId)).map(j => {
    const { userId, publicId, name, avatarUrl } = j.members.get(j.ownerId)!;
    return { id: j.id, owner: { userId, publicId, name, avatarUrl }, members: j.members.size, track: j.queue[j.index]?.track || null, isPlaying: j.isPlaying };
  });
}

/** A live invite on every open device of the friend (the bell gets a notification separately). */
export function inviteToJam(fromUserId: string, toUserId: string): boolean {
  const jam = jams.get(jamOfUser.get(fromUserId) || '');
  if (!jam) return false;
  const from = jam.members.get(fromUserId)!;
  sendToUser(toUserId, 'jam-invite', { id: jam.id, from: { userId: from.userId, publicId: from.publicId, name: from.name, avatarUrl: from.avatarUrl }, track: jam.queue[jam.index]?.track || null });
  return true;
}

function jamDeviceBack(userId: string, deviceId: string, sink: Sink) {
  const jam = jams.get(jamOfUser.get(userId) || ''), m = jam?.members.get(userId);
  if (!jam || !m || m.deviceId !== deviceId) return;
  clearTimeout(m.leaveTimer); m.leaveTimer = undefined;
  safeSend(sink, 'jam', jamView(jam, userId));
  broadcastJam(jam);
}
function jamDeviceGone(userId: string, deviceId: string) {
  const jam = jams.get(jamOfUser.get(userId) || ''), m = jam?.members.get(userId);
  if (!jam || !m || m.deviceId !== deviceId) return;
  broadcastJam(jam);
  clearTimeout(m.leaveTimer);
  m.leaveTimer = setTimeout(() => { if (jam.members.get(userId) === m && !deviceOnline(userId, m.deviceId)) leaveJam(userId); }, JAM_GRACE_MS);
  m.leaveTimer.unref?.();
}

/** Tests only. */
export function resetConnectHub() {
  for (const jam of jams.values()) for (const m of jam.members.values()) clearTimeout(m.leaveTimer);
  users.clear(); jams.clear(); jamOfUser.clear();
}
