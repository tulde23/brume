import { randomUUID } from 'node:crypto';

import { seasonFor } from '@inkstat/basketball';

import type { DB } from './db';
import { ApiError } from './errors';

/**
 * The shared registry scorekeepers build as they go: teams (with aliases and merges),
 * which scorebook template each team uses, and final scores. Nothing here holds a
 * player's name: rosters live only inside groups (see rosters below).
 */

export type Level = 'varsity' | 'jv' | 'freshman' | 'middle' | 'youth' | 'college' | 'adult' | 'other';
export type Gender = 'boys' | 'girls' | 'men' | 'women' | 'coed';

export interface TeamInput {
  sport: string;
  name: string;
  school?: string | null;
  town?: string | null;
  state?: string | null;
  level: Level;
  gender: Gender;
}

export interface Team extends Required<Omit<TeamInput, 'school' | 'town' | 'state'>> {
  id: string;
  school: string | null;
  town: string | null;
  state: string | null;
  aliases: string[];
}

/** Votes from different scorekeepers before two teams merge. */
export const MERGE_VOTES = 2;

const STOP = new Set(['the', 'high', 'school', 'hs', 'academy', 'boys', 'girls', 'basketball', 'varsity', 'jv']);

/** "St. Mary's High School" -> "st marys". Accents and punctuation go; filler words go. */
export function normalizeName(s: string): string {
  const words = s
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
    .split(' ')
    .filter(Boolean);
  const kept = words.filter((w) => !STOP.has(w));
  return (kept.length ? kept : words).join(' ');
}

export function editDistance(a: string, b: string): number {
  if (a === b) return 0;
  const prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    let diag = prev[0];
    prev[0] = i;
    for (let j = 1; j <= b.length; j++) {
      const tmp = prev[j];
      prev[j] = Math.min(prev[j] + 1, prev[j - 1] + 1, diag + (a[i - 1] === b[j - 1] ? 0 : 1));
      diag = tmp;
    }
  }
  return prev[b.length];
}

const dedupeKey = (t: TeamInput) =>
  [t.sport, t.level, t.gender, normalizeName(t.name), normalizeName(t.town ?? ''), (t.state ?? '').toUpperCase()].join('|');

interface TeamRow {
  id: string;
  sport: string;
  name: string;
  norm: string;
  school: string | null;
  town: string | null;
  state: string | null;
  level: Level;
  gender: Gender;
  merged_into: string | null;
}

export interface ResultInput {
  sport: string;
  date: string;
  homeId: string;
  awayId: string;
  homeScore: number;
  awayScore: number;
  periods?: { home: (number | null)[]; away: (number | null)[] } | null;
}

export type ResultStatus = 'reported' | 'confirmed' | 'disputed';

export interface Result {
  id: string;
  sport: string;
  season: string;
  date: string;
  home: { id: string; name: string; score: number };
  away: { id: string; name: string; score: number };
  status: ResultStatus;
  reports: number;
}

/** What the public scoreboard shows of a team: its name and where it plays. */
export interface PublicTeam {
  id: string;
  name: string;
  town: string | null;
  state: string | null;
  level: Level;
  gender: Gender;
}

export interface PublicResult {
  id: string;
  date: string;
  home: { id: string; score: number | null };
  away: { id: string; score: number | null };
  status: ResultStatus;
}

export interface RosterPlayer {
  number: string | null;
  name: string | null;
}

export function createRegistry(db: DB, now: () => number = Date.now) {
  const q = {
    team: db.prepare<[string], TeamRow>('SELECT * FROM teams WHERE id = ?'),
    byKey: db.prepare<[string], TeamRow>('SELECT * FROM teams WHERE dedupe_key = ?'),
    insertTeam: db.prepare(
      `INSERT INTO teams (id, sport, name, norm, school, town, state, level, gender, dedupe_key, created_by, created_at, updated_at)
       VALUES (@id, @sport, @name, @norm, @school, @town, @state, @level, @gender, @key, @by, @at, @at)`,
    ),
    aliases: db.prepare<[string], { alias: string }>('SELECT alias FROM team_aliases WHERE team_id = ? ORDER BY alias'),
    addAlias: db.prepare('INSERT OR IGNORE INTO team_aliases (team_id, alias_norm, alias) VALUES (?, ?, ?)'),
    search: db.prepare<[string, string, string, string], TeamRow>(
      `SELECT DISTINCT t.* FROM teams t LEFT JOIN team_aliases a ON a.team_id = t.id
       WHERE t.sport = ? AND t.merged_into IS NULL AND (t.norm LIKE ? OR a.alias_norm LIKE ? OR t.town LIKE ?)
       LIMIT 200`,
    ),
    similar: db.prepare<[string, string, string], TeamRow>(
      'SELECT * FROM teams WHERE sport = ? AND level = ? AND gender = ? AND merged_into IS NULL LIMIT 2000',
    ),
    vote: db.prepare('INSERT OR IGNORE INTO merge_votes (from_id, into_id, user_id, created_at) VALUES (?, ?, ?, ?)'),
    votes: db.prepare<[string, string], { n: number }>('SELECT COUNT(*) AS n FROM merge_votes WHERE from_id = ? AND into_id = ?'),
    markMerged: db.prepare('UPDATE teams SET merged_into = ?, updated_at = ? WHERE id = ?'),
    moveAliases: db.prepare('INSERT OR IGNORE INTO team_aliases (team_id, alias_norm, alias) SELECT ?, alias_norm, alias FROM team_aliases WHERE team_id = ?'),
    moveTemplates: db.prepare('INSERT OR IGNORE INTO team_templates (team_id, template_id, user_id, used_at) SELECT ?, template_id, user_id, used_at FROM team_templates WHERE team_id = ?'),
    moveGroupTeams: db.prepare('INSERT OR IGNORE INTO group_teams (group_id, team_id, added_by) SELECT group_id, ?, added_by FROM group_teams WHERE team_id = ?'),
    resultsOf: db.prepare<[string, string], { id: string; home_id: string; away_id: string; date: string; sport: string }>(
      'SELECT id, home_id, away_id, date, sport FROM results WHERE home_id = ? OR away_id = ?',
    ),
    setSides: db.prepare('UPDATE results SET home_id = ?, away_id = ? WHERE id = ?'),
    resultBy: db.prepare<[string, string, string, string], { id: string }>(
      'SELECT id FROM results WHERE sport = ? AND date = ? AND home_id = ? AND away_id = ?',
    ),
    moveReports: db.prepare('INSERT OR IGNORE INTO result_reports SELECT ?, user_id, home_score, away_score, periods, reported_at FROM result_reports WHERE result_id = ?'),
    deleteResult: db.prepare('DELETE FROM results WHERE id = ?'),

    insertTemplate: db.prepare('INSERT INTO templates (id, sport, name, layout, created_by, created_at) VALUES (?, ?, ?, ?, ?, ?)'),
    template: db.prepare<[string], { id: string; sport: string; name: string; layout: string; created_at: number }>(
      'SELECT id, sport, name, layout, created_at FROM templates WHERE id = ?',
    ),
    useTemplate: db.prepare(
      `INSERT INTO team_templates (team_id, template_id, user_id, used_at) VALUES (?, ?, ?, ?)
       ON CONFLICT (team_id, template_id, user_id) DO UPDATE SET used_at = excluded.used_at`,
    ),
    teamTemplates: db.prepare<[string], { id: string; name: string; sport: string; users: number; last_used: number }>(
      `SELECT t.id, t.name, t.sport, COUNT(DISTINCT tt.user_id) AS users, MAX(tt.used_at) AS last_used
       FROM team_templates tt JOIN templates t ON t.id = tt.template_id
       WHERE tt.team_id = ? GROUP BY t.id ORDER BY users DESC, last_used DESC LIMIT 10`,
    ),

    insertResult: db.prepare('INSERT OR IGNORE INTO results (id, sport, season, date, home_id, away_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'),
    report: db.prepare(
      `INSERT INTO result_reports (result_id, user_id, home_score, away_score, periods, reported_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (result_id, user_id) DO UPDATE SET home_score = excluded.home_score, away_score = excluded.away_score,
         periods = excluded.periods, reported_at = excluded.reported_at`,
    ),
    reports: db.prepare<[string], { home_score: number; away_score: number; reported_at: number }>(
      'SELECT home_score, away_score, reported_at FROM result_reports WHERE result_id = ? ORDER BY reported_at',
    ),
    resultRow: db.prepare<[string], { id: string; sport: string; season: string; date: string; home_id: string; away_id: string }>(
      'SELECT id, sport, season, date, home_id, away_id FROM results WHERE id = ?',
    ),
    teamResults: db.prepare<[string, string, string], { id: string }>(
      'SELECT id FROM results WHERE (home_id = ? OR away_id = ?) AND season = ? ORDER BY date DESC',
    ),
    seasonResults: db.prepare<[string, string], { id: string }>(
      'SELECT id FROM results WHERE sport = ? AND season = ? ORDER BY date DESC, created_at DESC LIMIT 5000',
    ),
    seasons: db.prepare<[string], { season: string; n: number }>(
      'SELECT season, COUNT(*) AS n FROM results WHERE sport = ? GROUP BY season ORDER BY season DESC',
    ),
    retract: db.prepare('DELETE FROM result_reports WHERE result_id = ? AND user_id = ?'),
    orphanResults: db.prepare('DELETE FROM results WHERE id = ? AND NOT EXISTS (SELECT 1 FROM result_reports WHERE result_id = ?)'),

    addGroupTeam: db.prepare('INSERT OR IGNORE INTO group_teams (group_id, team_id, added_by) VALUES (?, ?, ?)'),
    removeGroupTeam: db.prepare('DELETE FROM group_teams WHERE group_id = ? AND team_id = ?'),
    groupTeams: db.prepare<[string], { team_id: string }>('SELECT team_id FROM group_teams WHERE group_id = ?'),
    groupResults: db.prepare<[string, string, string], { id: string }>(
      `SELECT r.id FROM results r
       WHERE r.season = ? AND r.home_id IN (SELECT team_id FROM group_teams WHERE group_id = ?)
         AND r.away_id IN (SELECT team_id FROM group_teams WHERE group_id = ?) ORDER BY r.date`,
    ),
    roster: db.prepare<[string, string, string], { players: string; updated_at: number }>(
      'SELECT players, updated_at FROM rosters WHERE group_id = ? AND team_id = ? AND season = ?',
    ),
    putRoster: db.prepare(
      `INSERT INTO rosters (group_id, team_id, season, players, updated_by, updated_at) VALUES (?, ?, ?, ?, ?, ?)
       ON CONFLICT (group_id, team_id, season) DO UPDATE SET players = excluded.players,
         updated_by = excluded.updated_by, updated_at = excluded.updated_at`,
    ),
  };

  /** Follows merges to the team that lives on. */
  function live(id: string): TeamRow {
    let row = q.team.get(id);
    for (let hop = 0; row?.merged_into && hop < 16; hop++) row = q.team.get(row.merged_into);
    if (!row) throw ApiError.notFound('Team');
    return row;
  }

  const toTeam = (r: TeamRow): Team => ({
    id: r.id,
    sport: r.sport,
    name: r.name,
    school: r.school,
    town: r.town,
    state: r.state,
    level: r.level,
    gender: r.gender,
    aliases: q.aliases.all(r.id).map((a) => a.alias),
  });

  function resultOf(id: string): Result | null {
    const r = q.resultRow.get(id);
    if (!r) return null;
    const reports = q.reports.all(id);
    if (!reports.length) return null;
    const agree = (a: (typeof reports)[0], b: (typeof reports)[0]) => a.home_score === b.home_score && a.away_score === b.away_score;
    const disputed = reports.some((x) => !agree(x, reports[0]));
    // The latest report stands in when they disagree; status says not to trust it.
    const shown = disputed ? reports[reports.length - 1] : reports[0];
    const home = live(r.home_id);
    const away = live(r.away_id);
    return {
      id: r.id,
      sport: r.sport,
      season: r.season,
      date: r.date,
      home: { id: home.id, name: home.name, score: shown.home_score },
      away: { id: away.id, name: away.name, score: shown.away_score },
      status: disputed ? 'disputed' : reports.length >= 2 ? 'confirmed' : 'reported',
      reports: reports.length,
    };
  }

  const api = {
    get: (id: string) => toTeam(live(id)),

    /** Finds the team this describes, or adds it. `similar` lists near-misses to offer a merge. */
    upsertTeam: db.transaction((input: TeamInput, userId: string): { team: Team; created: boolean; similar: Team[] } => {
      const key = dedupeKey(input);
      const existing = q.byKey.get(key);
      if (existing) return { team: toTeam(live(existing.id)), created: false, similar: [] };
      const id = randomUUID();
      const norm = normalizeName(input.name);
      q.insertTeam.run({
        id,
        sport: input.sport,
        name: input.name.trim(),
        norm,
        school: input.school?.trim() || null,
        town: input.town?.trim() || null,
        state: input.state?.trim().toUpperCase() || null,
        level: input.level,
        gender: input.gender,
        key,
        by: userId,
        at: now(),
      });
      const similar = q
        .similar.all(input.sport, input.level, input.gender)
        .filter((t) => t.id !== id && editDistance(t.norm, norm) <= Math.max(1, Math.floor(norm.length / 5)))
        .slice(0, 5)
        .map(toTeam);
      return { team: toTeam(q.team.get(id)!), created: true, similar };
    }),

    /** Ranked by closeness to what was typed; aliases count as names. */
    search(sport: string, text: string, filters: { level?: string; gender?: string; state?: string } = {}): Team[] {
      const norm = normalizeName(text);
      if (norm.length < 2) return [];
      const like = `%${norm}%`;
      const rows = q.search.all(sport, like, like, `%${text.trim()}%`);
      const score = (t: TeamRow) => {
        const names = [t.norm, ...q.aliases.all(t.id).map((a) => normalizeName(a.alias))];
        return Math.min(...names.map((n) => (n.startsWith(norm) ? 0 : editDistance(n, norm))));
      };
      return rows
        .filter((t) => (!filters.level || t.level === filters.level) && (!filters.gender || t.gender === filters.gender))
        .filter((t) => !filters.state || t.state === filters.state.toUpperCase())
        .map((t) => ({ t, s: score(t) }))
        .sort((a, b) => a.s - b.s || a.t.name.localeCompare(b.t.name))
        .slice(0, 20)
        .map((x) => toTeam(x.t));
    },

    addAlias(teamId: string, alias: string) {
      const t = live(teamId);
      const norm = normalizeName(alias);
      if (!norm || norm === t.norm) return toTeam(t);
      q.addAlias.run(t.id, norm, alias.trim().slice(0, 80));
      return toTeam(t);
    },

    /**
     * One scorekeeper's vote that two teams are the same. When MERGE_VOTES different
     * people agree, `from` folds into `into`: aliases, templates, groups and results move.
     */
    voteMerge: db.transaction((fromId: string, intoId: string, userId: string) => {
      const from = live(fromId);
      const into = live(intoId);
      if (from.id === into.id) return { merged: true, into: toTeam(into), votes: MERGE_VOTES };
      if (from.sport !== into.sport) throw ApiError.badRequest('DifferentSport', 'Those teams play different sports.');
      q.vote.run(from.id, into.id, userId, now());
      const votes = q.votes.get(from.id, into.id)!.n;
      if (votes < MERGE_VOTES) return { merged: false, into: toTeam(into), votes };

      q.addAlias.run(into.id, from.norm, from.name);
      q.moveAliases.run(into.id, from.id);
      q.moveTemplates.run(into.id, from.id);
      q.moveGroupTeams.run(into.id, from.id);
      for (const r of q.resultsOf.all(from.id, from.id)) {
        const home = r.home_id === from.id ? into.id : r.home_id;
        const away = r.away_id === from.id ? into.id : r.away_id;
        const clash = q.resultBy.get(r.sport, r.date, home, away);
        if (clash && clash.id !== r.id) {
          // The same game reported under both names: one result, all its reports.
          q.moveReports.run(clash.id, r.id);
          q.deleteResult.run(r.id);
        } else {
          q.setSides.run(home, away, r.id);
        }
      }
      q.markMerged.run(into.id, now(), from.id);
      return { merged: true, into: toTeam(into), votes };
    }),

    /** A layout only: never a photo, and anchors only as printed scoresheet words (see sanitizeLayout). */
    addTemplate(sport: string, name: string, layout: unknown, userId: string) {
      const id = randomUUID();
      q.insertTemplate.run(id, sport, name.trim().slice(0, 80), JSON.stringify(layout), userId, now());
      return { id, sport, name };
    },

    template(id: string) {
      const t = q.template.get(id);
      if (!t) throw ApiError.notFound('Template');
      return { id: t.id, sport: t.sport, name: t.name, layout: JSON.parse(t.layout) as unknown, createdAt: t.created_at };
    },

    /** Records that this scorekeeper read this team's book with this template. */
    useTemplate(teamId: string, templateId: string, userId: string) {
      const t = live(teamId);
      api.template(templateId);
      q.useTemplate.run(t.id, templateId, userId, now());
    },

    templatesFor: (teamId: string) => q.teamTemplates.all(live(teamId).id).map((t) => ({
      id: t.id, name: t.name, sport: t.sport, scorekeepers: t.users, lastUsed: t.last_used,
    })),

    /** One scorekeeper's final score. Two who agree make it confirmed; any disagreement, disputed. */
    report: db.transaction((input: ResultInput, userId: string): Result => {
      const home = live(input.homeId);
      const away = live(input.awayId);
      if (home.id === away.id) throw ApiError.badRequest('SameTeam', 'A team cannot play itself.');
      if (home.sport !== input.sport || away.sport !== input.sport) {
        throw ApiError.badRequest('DifferentSport', 'Both teams must play this sport.');
      }
      const at = now();
      q.insertResult.run(randomUUID(), input.sport, seasonFor(input.date), input.date, home.id, away.id, at);
      const { id } = q.resultBy.get(input.sport, input.date, home.id, away.id)!;
      q.report.run(id, userId, input.homeScore, input.awayScore, input.periods ? JSON.stringify(input.periods) : null, at);
      return resultOf(id)!;
    }),

    retract: db.transaction((resultId: string, userId: string) => {
      q.retract.run(resultId, userId);
      q.orphanResults.run(resultId, resultId);
    }),

    result: (id: string) => resultOf(id),

    teamResults(teamId: string, season: string): Result[] {
      const t = live(teamId);
      return q.teamResults.all(t.id, t.id, season).map((r) => resultOf(r.id)).filter((r): r is Result => r !== null);
    },

    /** Wins and losses from results, counting reported and confirmed; disputed are listed apart. */
    standings(teamIds: string[], results: Result[]) {
      const table = new Map(teamIds.map((id) => [id, { team: api.get(id), w: 0, l: 0, pf: 0, pa: 0, disputed: 0 }]));
      for (const r of results) {
        const h = table.get(r.home.id);
        const a = table.get(r.away.id);
        if (r.status === 'disputed') {
          if (h) h.disputed++;
          if (a) a.disputed++;
          continue;
        }
        if (h) {
          h.pf += r.home.score;
          h.pa += r.away.score;
          if (r.home.score > r.away.score) h.w++;
          else if (r.home.score < r.away.score) h.l++;
        }
        if (a) {
          a.pf += r.away.score;
          a.pa += r.home.score;
          if (r.away.score > r.home.score) a.w++;
          else if (r.away.score < r.home.score) a.l++;
        }
      }
      return [...table.values()].sort((x, y) => y.w - x.w || x.l - y.l || (y.pf - y.pa) - (x.pf - x.pa));
    },

    // --- the public scoreboard (inkstat.app) ---

    /**
     * A season's scores for anyone to read: team names, places, dates and final scores.
     * Nothing from a group, no rosters, no scorekeepers, no report counts. A disputed
     * result shows no score, since nobody can say which one is right.
     */
    publicSeason(sport: string, season: string) {
      const results = q.seasonResults.all(sport, season).map((r) => resultOf(r.id)).filter((r): r is Result => r !== null);
      const teams = new Map<string, PublicTeam>();
      const side = (s: Result['home'], disputed: boolean) => {
        if (!teams.has(s.id)) {
          const t = live(s.id);
          teams.set(t.id, { id: t.id, name: t.name, town: t.town, state: t.state, level: t.level, gender: t.gender });
        }
        return { id: s.id, score: disputed ? null : s.score };
      };
      const games: PublicResult[] = results.map((r) => ({
        id: r.id,
        date: r.date,
        home: side(r.home, r.status === 'disputed'),
        away: side(r.away, r.status === 'disputed'),
        status: r.status,
      }));
      return { teams: [...teams.values()], results: games };
    },

    publicSeasons: (sport: string) => q.seasons.all(sport).map((s) => ({ season: s.season, games: s.n })),

    // --- inside a group ---

    addGroupTeam: (groupId: string, teamId: string, userId: string) => q.addGroupTeam.run(groupId, live(teamId).id, userId),
    removeGroupTeam: (groupId: string, teamId: string) => q.removeGroupTeam.run(groupId, teamId),
    groupTeams: (groupId: string) => q.groupTeams.all(groupId).map((r) => api.get(r.team_id)),
    groupResults: (groupId: string, season: string) =>
      q.groupResults.all(season, groupId, groupId).map((r) => resultOf(r.id)).filter((r): r is Result => r !== null),

    /** Player names never leave the group they were shared with. */
    roster(groupId: string, teamId: string, season: string): { players: RosterPlayer[]; updatedAt: number | null } {
      const r = q.roster.get(groupId, live(teamId).id, season);
      return r ? { players: JSON.parse(r.players) as RosterPlayer[], updatedAt: r.updated_at } : { players: [], updatedAt: null };
    },
    putRoster(groupId: string, teamId: string, season: string, players: RosterPlayer[], userId: string) {
      q.putRoster.run(groupId, live(teamId).id, season, JSON.stringify(players), userId, now());
    },
  };
  return api;
}

export type Registry = ReturnType<typeof createRegistry>;
