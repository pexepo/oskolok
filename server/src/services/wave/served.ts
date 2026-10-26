/* What the wave already gave each listener, across sessions. The client only remembers the current
   session's queue, so a restarted wave used to open with the very same batch: here the last few days of
   issued tracks stay out, and every new session turns the seed rotation to another corner of the taste.
   shortcut: kept in memory (lost on restart, one process); move to the database if it must survive deploys. */
const KEEP_MS = 3 * 86_400_000, MAX_PER_USER = 900, MAX_USERS = 5000;
type Memory = { served: Map<string, number>; sessions: number };
const users = new Map<string, Memory>();

function memory(userId: string): Memory {
  let m = users.get(userId);
  if (!m) {
    m = { served: new Map(), sessions: Math.floor(Math.random() * 97) };
    users.set(userId, m);
    if (users.size > MAX_USERS) users.delete(users.keys().next().value!);
  }
  return m;
}

/** Track ids issued to this listener lately, oldest first. */
export function recentlyServed(userId: string): string[] {
  const m = memory(userId), cutoff = Date.now() - KEEP_MS;
  for (const [id, at] of m.served) if (at < cutoff) m.served.delete(id); else break;
  return [...m.served.keys()];
}

export function noteServed(userId: string, ids: string[]): void {
  const m = memory(userId), now = Date.now();
  ids.forEach(id => { m.served.delete(id); m.served.set(id, now); });
  while (m.served.size > MAX_PER_USER) m.served.delete(m.served.keys().next().value!);
}

/** Rotation offset of this wave session: a new session (batch 0) moves on to the next one. */
export function sessionSalt(userId: string, batch: number): number {
  const m = memory(userId);
  if (!batch) m.sessions++;
  return m.sessions * 7;
}
