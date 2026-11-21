/**
 * Team colours and initials, as on the phone (src/lib/teamColor.ts). Scoresheets don't
 * say a team's colours, so each team gets a steady colour from its name. All dark enough
 * for white text on top.
 */
export const TEAM_COLORS = ['#8C2F2F', '#2F5DA8', '#2F6F3E', '#4B3F72', '#8A6A00', '#1F6E75', '#B4572A', '#1F2F55', '#B42318', '#5C574E'];

/** The phone's team key: "Hawks", "HAWKS " and "Hawks." are one team. */
export const teamKey = (name: string) =>
  name
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();

export function teamColor(name: string): string {
  let h = 0;
  for (const ch of teamKey(name)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return TEAM_COLORS[h % TEAM_COLORS.length];
}

/** "Hawks" → "HAW"; "North Rams" → "NR". */
export function teamAbbr(name: string): string {
  const words = name.replace(/[^\p{L}\p{N} ]/gu, '').trim().split(/\s+/).filter(Boolean);
  if (words.length >= 2) return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
  return (words[0] ?? '?').slice(0, 3).toUpperCase();
}
