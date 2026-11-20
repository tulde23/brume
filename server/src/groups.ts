import { randomInt, randomUUID } from 'node:crypto';

import type { DB } from './db';
import { ApiError } from './errors';

/**
 * Groups: a league, a school's program, or one team's scorekeepers. Members share the
 * group's games (the sync feed), its team list, and its rosters. Joining is by invite
 * code; the creator is the owner.
 */

export type GroupKind = 'league' | 'school' | 'team';
export type Role = 'owner' | 'member';

export interface Group {
  id: string;
  name: string;
  kind: GroupKind;
  role: Role;
  members: number;
  /** Only owners see the code. */
  inviteCode?: string;
}

// No 0/O or 1/I/L: codes are read aloud across a gym.
const ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
const newCode = () => Array.from({ length: 8 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
export const MAX_GROUPS_PER_USER = 30;

/** The sync store's space for a group's games. */
export const groupSpace = (groupId: string) => `g:${groupId}`;

export function createGroups(db: DB, now: () => number = Date.now) {
  const q = {
    insert: db.prepare('INSERT INTO groups (id, name, kind, invite_code, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    addMember: db.prepare('INSERT OR IGNORE INTO members (group_id, user_id, role, joined_at) VALUES (?, ?, ?, ?)'),
    mine: db.prepare<[string], { id: string; name: string; kind: GroupKind; invite_code: string; role: Role; members: number }>(
      `SELECT g.id, g.name, g.kind, g.invite_code, m.role,
              (SELECT COUNT(*) FROM members x WHERE x.group_id = g.id) AS members
       FROM members m JOIN groups g ON g.id = m.group_id WHERE m.user_id = ? ORDER BY g.name`,
    ),
    role: db.prepare<[string, string], { role: Role }>('SELECT role FROM members WHERE group_id = ? AND user_id = ?'),
    byCode: db.prepare<[string], { id: string }>('SELECT id FROM groups WHERE invite_code = ?'),
    count: db.prepare<[string], { n: number }>('SELECT COUNT(*) AS n FROM members WHERE user_id = ?'),
    setCode: db.prepare('UPDATE groups SET invite_code = ? WHERE id = ?'),
    rename: db.prepare('UPDATE groups SET name = ? WHERE id = ?'),
    removeMember: db.prepare('DELETE FROM members WHERE group_id = ? AND user_id = ?'),
    owners: db.prepare<[string], { n: number }>("SELECT COUNT(*) AS n FROM members WHERE group_id = ? AND role = 'owner'"),
    membersOf: db.prepare<[string], { user_id: string; display_name: string; role: Role; joined_at: number }>(
      `SELECT m.user_id, u.display_name, m.role, m.joined_at FROM members m JOIN users u ON u.id = m.user_id
       WHERE m.group_id = ? ORDER BY m.joined_at`,
    ),
    remove: db.prepare('DELETE FROM groups WHERE id = ?'),
    setRole: db.prepare('UPDATE members SET role = ? WHERE group_id = ? AND user_id = ?'),
  };

  const limit = (userId: string) => {
    if (q.count.get(userId)!.n >= MAX_GROUPS_PER_USER) {
      throw ApiError.forbidden('TooManyGroups', `You can be in up to ${MAX_GROUPS_PER_USER} groups.`);
    }
  };

  const api = {
    create: db.transaction((userId: string, name: string, kind: GroupKind) => {
      limit(userId);
      const id = randomUUID();
      q.insert.run(id, name.trim(), kind, newCode(), userId, now());
      q.addMember.run(id, userId, 'owner', now());
      return api.list(userId).find((g) => g.id === id)!;
    }),

    list(userId: string): Group[] {
      return q.mine.all(userId).map((g) => ({
        id: g.id,
        name: g.name,
        kind: g.kind,
        role: g.role,
        members: g.members,
        ...(g.role === 'owner' ? { inviteCode: g.invite_code } : {}),
      }));
    },

    /** The caller's role, or a 404 that says nothing about whether the group exists. */
    require(groupId: string, userId: string, role?: Role): Role {
      const r = q.role.get(groupId, userId)?.role;
      if (!r) throw ApiError.notFound('Group');
      if (role === 'owner' && r !== 'owner') throw ApiError.forbidden('OwnerOnly', 'Only the group owner can do that.');
      return r;
    },

    join: db.transaction((userId: string, code: string) => {
      const found = q.byCode.get(code.trim().toUpperCase());
      // One answer for every wrong code.
      if (!found) throw ApiError.notFound('Invite code');
      if (!q.role.get(found.id, userId)) {
        limit(userId);
        q.addMember.run(found.id, userId, 'member', now());
      }
      return api.list(userId).find((g) => g.id === found.id)!;
    }),

    rotateCode(groupId: string, userId: string) {
      api.require(groupId, userId, 'owner');
      const code = newCode();
      q.setCode.run(code, groupId);
      return code;
    },

    rename(groupId: string, userId: string, name: string) {
      api.require(groupId, userId, 'owner');
      q.rename.run(name.trim(), groupId);
    },

    /** Owners make another member an owner (so they can leave), or step someone back. */
    setRole: db.transaction((groupId: string, userId: string, target: string, role: Role) => {
      api.require(groupId, userId, 'owner');
      if (!q.role.get(groupId, target)) throw ApiError.notFound('Member');
      if (role === 'member' && q.role.get(groupId, target)!.role === 'owner' && q.owners.get(groupId)!.n === 1) {
        throw ApiError.conflict('LastOwner', 'A group needs at least one owner.');
      }
      q.setRole.run(role, groupId, target);
    }),

    members(groupId: string, userId: string) {
      api.require(groupId, userId);
      return q.membersOf.all(groupId).map((m) => ({ userId: m.user_id, name: m.display_name, role: m.role, joinedAt: m.joined_at }));
    },

    /** Leave, or (as owner) remove someone. The last owner cannot leave a group with others in it. */
    removeMember: db.transaction((groupId: string, userId: string, target: string) => {
      const mine = api.require(groupId, userId);
      if (target !== userId && mine !== 'owner') throw ApiError.forbidden('OwnerOnly', 'Only the group owner can do that.');
      const theirs = q.role.get(groupId, target)?.role;
      if (!theirs) return;
      if (theirs === 'owner' && q.owners.get(groupId)!.n === 1) {
        if (q.membersOf.all(groupId).length > 1) {
          throw ApiError.conflict('LastOwner', 'Make someone else an owner before leaving.');
        }
        q.remove.run(groupId);
        return;
      }
      q.removeMember.run(groupId, target);
    }),
  };
  return api;
}

export type Groups = ReturnType<typeof createGroups>;
