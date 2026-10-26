import { describe, expect, it } from 'vitest';
import { discordUserFromToken } from '../server/src/controllers/discordController.js';
import { env } from '../server/src/config/env.js';

const answer = (body: unknown, ok = true) => (async () => ({ ok, json: async () => body })) as unknown as typeof fetch;
const token = 'a'.repeat(30);

describe('Discord token check', () => {
  it('accepts only tokens issued to Осколок with the identify scope', async () => {
    const user = { id: '42', username: 'listener', global_name: 'Слушатель', avatar: 'abc' };
    expect(await discordUserFromToken(token, answer({ application: { id: env.DISCORD_CLIENT_ID }, scopes: ['identify'], user })))
      .toEqual({ id: '42', username: 'listener', globalName: 'Слушатель', avatarUrl: 'https://cdn.discordapp.com/avatars/42/abc.png?size=128' });
    expect(await discordUserFromToken(token, answer({ application: { id: '1' }, scopes: ['identify'], user }))).toBeNull();
    expect(await discordUserFromToken(token, answer({ application: { id: env.DISCORD_CLIENT_ID }, scopes: [], user }))).toBeNull();
    expect(await discordUserFromToken(token, answer({}, false))).toBeNull();
    expect(await discordUserFromToken('bad token!', answer({}))).toBeNull();
  });
});
