import type { CSSProperties } from 'react';
import { Crown, Code2, Lightbulb, FlaskConical, Shield, Star, Heart, Music, Mic, PenLine, Sparkles, Bug, Gem, Zap, Headphones, Flame, type LucideIcon } from 'lucide-react';

export type PublicRole = { id: string; key?: string | null; name: string; color: string; icon: string; description?: string; position: number; hoist?: boolean };

export const ROLE_ICONS: Record<string, LucideIcon> = {
  crown: Crown, code: Code2, lightbulb: Lightbulb, 'flask-conical': FlaskConical, shield: Shield, star: Star, heart: Heart, music: Music,
  mic: Mic, 'pen-line': PenLine, sparkles: Sparkles, bug: Bug, gem: Gem, zap: Zap, headphones: Headphones, flame: Flame,
};

/** Discord-style: the highest-priority role (lowest position) tints the name. */
export const topRoleColor = (roles?: PublicRole[]) => roles?.length ? [...roles].sort((a, b) => a.position - b.position)[0].color : undefined;

/** A role pill: icon (or emoji) plus the name; the description shows on hover. */
export function RoleBadge({ role, compact = false }: { role: PublicRole; compact?: boolean }) {
  const Icon = ROLE_ICONS[role.icon];
  return <span className={`role-badge${compact ? ' role-badge--compact' : ''}`} style={{ '--role': role.color } as CSSProperties} title={role.description || role.name}>
    {Icon ? <Icon size={compact ? 11 : 12} strokeWidth={2.2} aria-hidden="true" /> : role.icon ? <span aria-hidden="true">{role.icon}</span> : <i aria-hidden="true" />}
    {compact ? <span className="sr-only">{role.name}</span> : <span>{role.name}</span>}
  </span>;
}

export function RoleBadges({ roles, compact = false, max = 6 }: { roles?: PublicRole[]; compact?: boolean; max?: number }) {
  if (!roles?.length) return null;
  const shown = [...roles].filter(r => r.hoist !== false).sort((a, b) => a.position - b.position).slice(0, max);
  return <span className="role-badges">{shown.map(role => <RoleBadge key={role.id} role={role} compact={compact} />)}</span>;
}
