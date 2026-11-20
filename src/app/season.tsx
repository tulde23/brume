import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { listGames, listSeasons } from '@/db';
import { pct, perGame, seasonToCsv, seasonTotals, teamNames, type Game } from '@brume/basketball';
import { shareText } from '@/lib/files';
import { Button, T } from '@/ui/components';
import { base, space, useColors } from '@/ui/theme';

const COLS = [
  { label: '#', width: 40 },
  { label: 'Name', width: 120 },
  { label: 'GP', width: 36 },
  { label: 'PTS', width: 44 },
  { label: 'PPG', width: 48 },
  { label: '2P', width: 36 },
  { label: '3P', width: 36 },
  { label: 'FT', width: 60 },
  { label: 'FT%', width: 52 },
  { label: 'F', width: 36 },
];

export default function Season() {
  const db = useSQLiteContext();
  const c = useColors();
  const [seasons, setSeasons] = useState<string[]>([]);
  const [season, setSeason] = useState<string | null>(null);
  const [games, setGames] = useState<Game[]>([]);
  const [team, setTeam] = useState<string | null>(null);

  useEffect(() => {
    listSeasons(db).then((s) => {
      setSeasons(s);
      setSeason((cur) => cur ?? s[0] ?? null);
    });
  }, [db]);

  useEffect(() => {
    if (season) listGames(db, season).then(setGames);
  }, [db, season]);

  const teams = useMemo(() => teamNames(games), [games]);
  const lines = useMemo(() => seasonTotals(games, team ?? undefined), [games, team]);

  if (!seasons.length) {
    return (
      <View style={[base.screen, base.content, { backgroundColor: c.bg }]}>
        <T muted>Scan some games first; season totals appear here.</T>
      </View>
    );
  }

  const chip = (label: string, selected: boolean, onPress: () => void) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected }}
      style={[styles.chip, { borderColor: selected ? c.accent : c.border, backgroundColor: selected ? c.accent : c.card }]}>
      <T style={{ color: selected ? c.accentText : c.text }}>{label}</T>
    </Pressable>
  );

  return (
    <ScrollView style={[base.screen, { backgroundColor: c.bg }]} contentContainerStyle={base.content}>
      <View style={[base.row, { flexWrap: 'wrap' }]}>
        {seasons.map((s) => chip(s, s === season, () => setSeason(s)))}
      </View>
      <View style={[base.row, { flexWrap: 'wrap' }]}>
        {chip('All teams', team === null, () => setTeam(null))}
        {teams.map((t) => chip(t, t === team, () => setTeam(t)))}
      </View>
      <T muted>
        {games.length} game{games.length === 1 ? '' : 's'}. Players are matched by team and jersey number.
      </T>

      <ScrollView horizontal>
        <View>
          <View style={styles.row}>
            {COLS.map((col) => (
              <T key={col.label} muted style={[styles.head, { width: col.width }]}>{col.label}</T>
            ))}
          </View>
          {lines.map((l) => {
            const values = [
              l.number ?? '',
              l.name ?? '',
              l.games,
              l.points,
              perGame(l.points, l.games),
              l.fg2,
              l.fg3,
              `${l.ftMade}/${l.ftAttempted}`,
              pct(l.ftMade, l.ftAttempted) ?? '–',
              l.fouls,
            ];
            return (
              <View key={l.key} style={[styles.row, { borderBottomColor: c.border }]}>
                {values.map((v, i) => (
                  <T key={i} style={[styles.cell, { width: COLS[i].width, textAlign: i === 1 ? 'left' : 'center' }]}>
                    {v}
                  </T>
                ))}
              </View>
            );
          })}
        </View>
      </ScrollView>

      <Button
        title="Export season CSV"
        onPress={() =>
          shareText(`season-${season}${team ? `-${team}` : ''}.csv`.replace(/[^a-z0-9.-]+/gi, '_'), seasonToCsv(lines), 'text/csv').catch(
            (e) => Alert.alert('Could not share', e instanceof Error ? e.message : String(e)),
          )
        }
      />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  chip: { borderWidth: 1, borderRadius: 16, paddingHorizontal: space.md, paddingVertical: 6 },
  row: { flexDirection: 'row', paddingVertical: 6, borderBottomWidth: StyleSheet.hairlineWidth, borderBottomColor: 'transparent' },
  head: { fontSize: 12, fontWeight: '600', textAlign: 'center' },
  cell: { fontSize: 14 },
});
