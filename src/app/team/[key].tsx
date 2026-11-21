import { router, Stack, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { listGames } from '@/db';
import {
  pct,
  perGame,
  seasonTotals,
  standings,
  teamKey,
  type Game,
  type SeasonLine,
  type StandingRow,
  type TeamResult,
} from '@inkstat/basketball';
import { TEAM_COLORS, defaultTeamColor, setTeamColor, teamColors } from '@/lib/teamColor';
import { Card, T } from '@/ui/components';
import { useDialog } from '@/ui/Dialog';
import { useLightStatusBar } from '@/ui/useLightStatusBar';
import { HeaderTabs, TeamBadge } from '@/ui/HeaderTabs';
import { base, fonts, space, useColors } from '@/ui/theme';

type Tab = 'overview' | 'games' | 'players' | 'stats';

const ordinal = (n: number) => `${n}${n % 100 >= 11 && n % 100 <= 13 ? 'th' : (['th', 'st', 'nd', 'rd'][n % 10] ?? 'th')}`;
const record = (s: { wins: number; losses: number }) => `${s.wins}–${s.losses}`;
const signed = (n: number) => `${n > 0 ? '+' : ''}${n}`;
const shortDate = (iso: string | null) =>
  iso ? new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' }) : 'No date';

/** One team: header in its colour, then Overview, Games, Players and Stats tabs. */
export default function Team() {
  const { key, season } = useLocalSearchParams<{ key: string; season?: string }>();
  const db = useSQLiteContext();
  const c = useColors();
  const dialog = useDialog();
  useLightStatusBar();
  const [games, setGames] = useState<Game[]>([]);
  const [color, setColor] = useState(() => defaultTeamColor(key));
  const [tab, setTab] = useState<Tab>('overview');

  useFocusEffect(
    useCallback(() => {
      void listGames(db, season).then(setGames);
      void teamColors(db, [key]).then((m) => setColor(m[key]));
    }, [db, key, season]),
  );

  const table = useMemo(() => standings(games), [games]);
  const rank = table.findIndex((r) => r.key === key);
  const row: StandingRow | undefined = table[rank];

  // This team's games, with every spelling of its name made the same, for player totals.
  const players = useMemo(() => {
    if (!row) return [];
    const same = games.map((g) => ({
      ...g,
      home: g.home.name && teamKey(g.home.name) === key ? { ...g.home, name: row.name } : g.home,
      away: g.away.name && teamKey(g.away.name) === key ? { ...g.away, name: row.name } : g.away,
    }));
    return seasonTotals(same, row.name);
  }, [games, key, row]);

  const pickColor = () =>
    dialog.actions(
      'Team colour',
      TEAM_COLORS.map((t) => ({
        label: `${t.value === color ? '✓  ' : ''}${t.name}`,
        onPress: () => {
          setColor(t.value);
          void setTeamColor(db, key, t.value);
        },
      })),
      'Shown on the standings and this page.',
    );

  if (!row) {
    return (
      <View style={[base.screen, base.content, { backgroundColor: c.bg }]}>
        <Stack.Screen options={{ title: 'Team' }} />
        <T muted>No results for this team yet.</T>
      </View>
    );
  }

  return (
    <View style={[base.screen, { backgroundColor: c.bg }]}>
      <Stack.Screen options={{ headerShown: false }} />
      <SafeAreaView edges={['top']} style={{ backgroundColor: color }}>
        <View style={styles.header}>
          <View style={[base.row, { justifyContent: 'space-between' }]}>
            <Pressable onPress={() => router.back()} accessibilityRole="button" accessibilityLabel="Back" style={styles.icon}>
              <Svg width={24} height={24} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2.2} strokeLinecap="round" strokeLinejoin="round">
                <Path d="M15 5l-7 7 7 7" />
              </Svg>
            </Pressable>
            <Pressable onPress={pickColor} accessibilityRole="button" accessibilityLabel="Team colour" style={styles.icon}>
              <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke="#fff" strokeWidth={2} strokeLinecap="round">
                <Path d="M5 12h.01M12 12h.01M19 12h.01" strokeWidth={3.5} />
              </Svg>
            </Pressable>
          </View>
          <View style={[base.row, { gap: space.md }]}>
            <TeamBadge name={row.name} color={color} size={56} inverted />
            <View style={{ flex: 1 }}>
              <Text style={styles.name} numberOfLines={1}>{row.name}</Text>
              <Text style={styles.sub}>
                {`${ordinal(rank + 1)} of ${table.length} · ${record(row)}${row.streak ? ` · ${row.streak.kind}${row.streak.count}` : ''}`}
              </Text>
            </View>
          </View>
          <HeaderTabs
            value={tab}
            onChange={setTab}
            tabs={[
              { key: 'overview', label: 'Overview' },
              { key: 'games', label: 'Games' },
              { key: 'players', label: 'Players' },
              { key: 'stats', label: 'Stats' },
            ]}
          />
        </View>
      </SafeAreaView>
      <ScrollView contentContainerStyle={[base.content, { paddingHorizontal: space.md, paddingBottom: 48 }]}>
        {tab === 'overview' && <Overview row={row} players={players} onTab={setTab} />}
        {tab === 'games' && <Games results={row.results} />}
        {tab === 'players' && <Players lines={players} />}
        {tab === 'stats' && <Stats results={row.results} />}
      </ScrollView>
    </View>
  );
}

function Section({ title, children, pad = true }: { title: string; children: React.ReactNode; pad?: boolean }) {
  const c = useColors();
  return (
    <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
      <Text style={[styles.sectionTitle, { color: c.muted, borderBottomColor: pad ? 'transparent' : c.text }]}>{title}</Text>
      <View style={pad ? { paddingHorizontal: space.md, paddingBottom: space.md } : undefined}>{children}</View>
    </View>
  );
}

function Overview({ row, players, onTab }: { row: StandingRow; players: SeasonLine[]; onTab: (t: Tab) => void }) {
  const c = useColors();
  const gp = row.wins + row.losses;
  const diff = perGame(row.pointsFor - row.pointsAgainst, gp);
  const tiles = [
    { k: 'Home', v: record(row.home) },
    { k: 'Away', v: record(row.away) },
    { k: 'PPG', v: String(perGame(row.pointsFor, gp)) },
    { k: 'Diff', v: signed(diff), color: diff > 0 ? c.ok : diff < 0 ? c.error : c.text },
  ];
  const best = (by: (p: SeasonLine) => number, min = (_: SeasonLine) => true) =>
    [...players].filter(min).sort((a, b) => by(b) - by(a))[0];
  const pts = best((p) => perGame(p.points, p.games));
  const threes = best((p) => perGame(p.fg3, p.games));
  const ft = best((p) => pct(p.ftMade, p.ftAttempted) ?? -1, (p) => p.ftAttempted >= 5);
  const who = (p: SeasonLine) => `${p.number ? `#${p.number} ` : ''}${p.name ?? ''}`.trim();

  return (
    <>
      <View style={[styles.tiles, { backgroundColor: c.card, borderColor: c.border }]}>
        {tiles.map((t, i) => (
          <View key={t.k} style={[styles.tile, i < 3 && { borderRightWidth: 1, borderRightColor: c.sunken }]}>
            <Text style={[styles.tileValue, { color: t.color ?? c.text }]}>{t.v}</Text>
            <Text style={[styles.tileLabel, { color: c.muted }]}>{t.k}</Text>
          </View>
        ))}
      </View>
      <Section title="Last 10 · newest first">
        <View style={{ flexDirection: 'row', gap: 5 }} accessibilityLabel={`Last ${row.lastTen.length}: ${row.lastTen.join(' ')}`}>
          {row.lastTen.map((r, i) => (
            <View key={i} style={[styles.chip, { backgroundColor: r === 'W' ? c.ok : c.error }]}>
              <Text style={[styles.chipText, { color: c.accentText }]}>{r}</Text>
            </View>
          ))}
        </View>
      </Section>
      <Section title="Recent games" pad={false}>
        {row.results.slice(0, 4).map((r) => (
          <ResultRow key={r.game.id} r={r} />
        ))}
        {row.results.length > 4 && (
          <Pressable onPress={() => onTab('games')} accessibilityRole="button" style={styles.more}>
            <T style={{ color: c.accent, fontFamily: fonts.bodySemiBold }}>{`All ${row.results.length} games`}</T>
          </Pressable>
        )}
      </Section>
      {pts && (
        <Section title="Team leaders · per game">
          <View style={{ flexDirection: 'row', gap: space.sm }}>
            <Leader value={String(perGame(pts.points, pts.games))} label={`PTS · ${who(pts)}`} />
            {threes && <Leader value={String(perGame(threes.fg3, threes.games))} label={`3PM · ${who(threes)}`} />}
            {ft && <Leader value={`${Math.round(pct(ft.ftMade, ft.ftAttempted) ?? 0)}%`} label={`FT · ${who(ft)}`} />}
          </View>
        </Section>
      )}
    </>
  );
}

function Leader({ value, label }: { value: string; label: string }) {
  const c = useColors();
  return (
    <View style={{ flex: 1 }}>
      <Text style={{ fontFamily: fonts.monoBold, fontSize: 22, color: c.text }}>{value}</Text>
      <Text numberOfLines={2} style={{ fontFamily: fonts.body, fontSize: 12, color: c.muted }}>{label}</Text>
    </View>
  );
}

function ResultRow({ r }: { r: TeamResult }) {
  const c = useColors();
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/game/[id]', params: { id: r.game.id } })}
      accessibilityRole="button"
      accessibilityLabel={`${r.won ? 'Won' : 'Lost'} ${r.us} to ${r.them} ${r.side === 'home' ? 'against' : 'at'} ${r.opponent}, ${shortDate(r.game.date)}`}
      style={({ pressed }) => [styles.result, { borderTopColor: c.sunken, backgroundColor: pressed ? c.sunken : 'transparent' }]}>
      <Text style={{ width: 22, fontFamily: fonts.monoBold, fontSize: 14, color: r.won ? c.ok : c.error }}>{r.won ? 'W' : 'L'}</Text>
      <View style={{ flex: 1 }}>
        <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 15, color: c.text }}>
          {`${r.side === 'home' ? 'vs' : '@'} ${r.opponent}`}
        </Text>
        <Text style={{ fontFamily: fonts.body, fontSize: 12, color: c.muted }}>
          {`${shortDate(r.game.date)} · ${r.side === 'home' ? 'Home' : 'Away'}`}
        </Text>
      </View>
      <Text style={{ fontFamily: fonts.monoBold, fontSize: 15, color: c.text }}>{`${r.us}–${r.them}`}</Text>
      <Text style={{ color: c.muted, fontSize: 18 }}>›</Text>
    </Pressable>
  );
}

function Games({ results }: { results: TeamResult[] }) {
  return (
    <Section title={`${results.length} games · newest first`} pad={false}>
      {results.map((r) => (
        <ResultRow key={r.game.id} r={r} />
      ))}
    </Section>
  );
}

function Players({ lines }: { lines: SeasonLine[] }) {
  const c = useColors();
  const [totals, setTotals] = useState(false);
  const cols = [
    { k: 'GP', w: 28, v: (p: SeasonLine) => p.games },
    { k: 'PTS', w: 44, v: (p: SeasonLine) => (totals ? p.points : perGame(p.points, p.games)), bold: true },
    { k: '3PM', w: 40, v: (p: SeasonLine) => (totals ? p.fg3 : perGame(p.fg3, p.games)) },
    { k: 'FT%', w: 42, v: (p: SeasonLine) => (p.ftAttempted ? `${Math.round(pct(p.ftMade, p.ftAttempted) ?? 0)}` : '–') },
    { k: 'PF', w: 36, v: (p: SeasonLine) => (totals ? p.fouls : perGame(p.fouls, p.games)) },
  ];
  const sorted = [...lines].sort((a, b) => (totals ? b.points - a.points : perGame(b.points, b.games) - perGame(a.points, a.games)));
  if (!lines.length) return <T muted>No player lines in these games yet.</T>;
  return (
    <>
      <View style={[styles.segment, { backgroundColor: c.sunken }]}>
        {[false, true].map((t) => (
          <Pressable
            key={String(t)}
            onPress={() => setTotals(t)}
            accessibilityRole="button"
            accessibilityState={{ selected: totals === t }}
            style={[styles.segmentItem, totals === t && { backgroundColor: c.card, borderColor: c.border }]}>
            <Text style={{ fontFamily: fonts.bodySemiBold, fontSize: 13, color: totals === t ? c.text : c.muted }}>
              {t ? 'Totals' : 'Per game'}
            </Text>
          </Pressable>
        ))}
      </View>
      <View style={[styles.section, { backgroundColor: c.card, borderColor: c.border }]}>
        <View style={[styles.tr, { minHeight: 34, borderBottomWidth: 2, borderBottomColor: c.text }]}>
          <Text style={[styles.th, { flex: 1, textAlign: 'left', color: c.muted }]}>PLAYER</Text>
          {cols.map((col) => (
            <Text key={col.k} style={[styles.th, { width: col.w, color: col.bold ? c.text : c.muted }]}>{col.k}</Text>
          ))}
        </View>
        {sorted.map((p, i) => (
          <View key={p.key} style={[styles.tr, { minHeight: 46 }, i < sorted.length - 1 && { borderBottomWidth: 1, borderBottomColor: c.sunken }]}>
            <View style={{ flex: 1, flexDirection: 'row', alignItems: 'baseline', gap: 6, minWidth: 0 }}>
              <Text style={{ width: 24, fontFamily: fonts.monoBold, fontSize: 12, color: c.muted }}>{p.number ?? ''}</Text>
              <Text numberOfLines={1} style={{ flex: 1, fontFamily: fonts.bodySemiBold, fontSize: 14.5, color: c.text }}>{p.name ?? 'Unnamed'}</Text>
            </View>
            {cols.map((col) => (
              <Text key={col.k} style={[styles.td, { width: col.w, color: c.text, fontFamily: col.bold ? fonts.monoBold : fonts.mono }]}>
                {col.v(p)}
              </Text>
            ))}
          </View>
        ))}
      </View>
      <T muted style={base.small}>Player names stay on this phone and in your group. They are never shared with other scorekeepers.</T>
    </>
  );
}

function Stats({ results }: { results: TeamResult[] }) {
  const c = useColors();
  const n = results.length;
  const sum = (f: (r: TeamResult) => number) => results.reduce((a, r) => a + f(r), 0);
  const mine = (r: TeamResult) => r.game[r.side];
  const theirs = (r: TeamResult) => r.game[r.side === 'home' ? 'away' : 'home'];
  const players = (r: TeamResult, f: (p: Game['home']['players'][number]) => number | null) =>
    mine(r).players.reduce((a, p) => a + (f(p) ?? 0), 0);
  const ftm = sum((r) => players(r, (p) => p.ftMade));
  const fta = sum((r) => players(r, (p) => p.ftAttempted));
  const rows: [string, string][] = [
    ['Points scored', String(perGame(sum((r) => r.us), n))],
    ['Points allowed', String(perGame(sum((r) => r.them), n))],
    ['2-point field goals', String(perGame(sum((r) => players(r, (p) => p.fg2)), n))],
    ['3-point field goals', String(perGame(sum((r) => players(r, (p) => p.fg3)), n))],
    ['Free throws', `${perGame(ftm, n)} of ${perGame(fta, n)}`],
    ['Free throw %', fta ? `${pct(ftm, fta)}%` : '–'],
    ['Fouls', String(perGame(sum((r) => players(r, (p) => p.fouls)), n))],
  ];
  const quarter = (side: (r: TeamResult) => Game['home'], q: number) => {
    const known = results.map((r) => side(r).periodScores[q]).filter((v): v is number => typeof v === 'number');
    return known.length ? String(perGame(known.reduce((a, b) => a + b, 0), known.length)) : '–';
  };
  return (
    <>
      <Section title="Per game" pad={false}>
        {rows.map(([k, v]) => (
          <View key={k} style={[styles.statRow, { borderTopColor: c.sunken }]}>
            <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 15, color: c.text }}>{k}</Text>
            <Text style={{ fontFamily: fonts.monoBold, fontSize: 15, color: c.text }}>{v}</Text>
          </View>
        ))}
      </Section>
      <Section title="Average by quarter" pad={false}>
        <View style={[styles.statRow, { borderTopColor: c.sunken }]}>
          <Text style={{ flex: 1 }} />
          {[1, 2, 3, 4].map((q) => (
            <Text key={q} style={[styles.th, { width: 44, color: c.muted }]}>{`Q${q}`}</Text>
          ))}
        </View>
        {(
          [
            ['Scored', mine],
            ['Allowed', theirs],
          ] as const
        ).map(([label, side]) => (
          <View key={label} style={[styles.statRow, { borderTopColor: c.sunken }]}>
            <Text style={{ flex: 1, fontFamily: fonts.body, fontSize: 15, color: c.text }}>{label}</Text>
            {[0, 1, 2, 3].map((q) => (
              <Text key={q} style={[styles.td, { width: 44, color: c.text }]}>{quarter(side, q)}</Text>
            ))}
          </View>
        ))}
      </Section>
      <Card style={{ paddingVertical: space.sm }}>
        <T muted style={base.small}>{`From ${n} game${n === 1 ? '' : 's'}, as read from the scoresheets and checked by you.`}</T>
      </Card>
    </>
  );
}

const styles = StyleSheet.create({
  header: { paddingHorizontal: space.lg, gap: space.sm },
  icon: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  name: { color: '#fff', fontFamily: fonts.headingBold, fontSize: 24 },
  sub: { color: '#fff', opacity: 0.88, fontFamily: fonts.body, fontSize: 13.5 },
  section: { borderWidth: 1, borderRadius: 8, overflow: 'hidden' },
  sectionTitle: {
    fontFamily: fonts.bodyBold,
    fontSize: 12,
    letterSpacing: 0.5,
    textTransform: 'uppercase',
    paddingHorizontal: space.md,
    paddingVertical: 10,
    borderBottomWidth: 2,
  },
  tiles: { flexDirection: 'row', borderWidth: 1, borderRadius: 8 },
  tile: { flex: 1, alignItems: 'center', paddingVertical: 10, gap: 2 },
  tileValue: { fontFamily: fonts.monoBold, fontSize: 19 },
  tileLabel: { fontFamily: fonts.bodySemiBold, fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.4 },
  chip: { flex: 1, height: 28, borderRadius: 4, alignItems: 'center', justifyContent: 'center' },
  chipText: { fontFamily: fonts.monoBold, fontSize: 12 },
  result: { flexDirection: 'row', alignItems: 'center', gap: 10, minHeight: 56, paddingHorizontal: space.md, borderTopWidth: 1 },
  more: { minHeight: 48, alignItems: 'center', justifyContent: 'center' },
  segment: { flexDirection: 'row', borderRadius: 8, padding: 3, gap: 3 },
  segmentItem: { flex: 1, minHeight: 36, borderRadius: 6, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: 'transparent' },
  tr: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 10, gap: 2 },
  th: { fontFamily: fonts.monoBold, fontSize: 11, textAlign: 'right' },
  td: { fontFamily: fonts.mono, fontSize: 14, textAlign: 'right' },
  statRow: { flexDirection: 'row', alignItems: 'center', minHeight: 46, paddingHorizontal: space.md, borderTopWidth: 1 },
});
