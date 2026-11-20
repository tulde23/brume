import { router, Stack, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Alert,
  Image,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  type KeyboardTypeOptions,
} from 'react-native';

import { deleteGame, getGame, saveGame } from '@/db';
import {
  gameToCsv,
  gameToJson,
  seasonFor,
  teamScore,
  validateGame,
  type Game,
  type Issue,
  type PlayerLine,
  type Side,
  type TeamSheet,
} from '@inkstat/basketball';
import { deleteGameImages, shareText } from '@/lib/files';
import { Button, Card, T } from '@/ui/components';
import { PhotoViewer, type Photo } from '@/ui/PhotoViewer';
import { base, fonts, radius, space, useColors, type Colors } from '@/ui/theme';

// Points and fouls first: they fit on a phone screen without scrolling.
const STAT_COLUMNS: { key: keyof PlayerLine; label: string; width: number }[] = [
  { key: 'points', label: 'PTS', width: 52 },
  { key: 'fouls', label: 'F', width: 40 },
  { key: 'fg2', label: '2P', width: 44 },
  { key: 'fg3', label: '3P', width: 44 },
  { key: 'ftMade', label: 'FTM', width: 48 },
  { key: 'ftAttempted', label: 'FTA', width: 48 },
];

const blankPlayer = (): PlayerLine => ({
  number: null,
  name: null,
  fouls: null,
  fg2: null,
  fg3: null,
  ftMade: null,
  ftAttempted: null,
  points: null,
  readNotes: [],
});

/** What InkStat read from, in order: the whole page, then each crop it sent to the model. */
function teamPhotos(team: TeamSheet): Photo[] {
  const label = (regionId: string) => {
    if (regionId === 'summary') return 'Header and score by period';
    if (regionId === 'team_name') return 'Team name';
    if (regionId === 'details') return 'Game details';
    if (regionId === 'quarters') return 'Score by quarter';
    if (regionId === 'timeouts') return 'Timeouts';
    if (regionId === 'team_fouls') return 'Team fouls';
    const strip = regionId.match(/^players-(\d+)/);
    return strip ? `Player rows, strip ${strip[1]}` : regionId;
  };
  return [
    ...(team.pageUri ? [{ uri: team.pageUri, label: 'Full page' }] : []),
    ...team.crops.map((cr) => ({ uri: cr.uri, label: label(cr.regionId) })),
  ];
}

const toInt = (s: string): number | null => {
  const n = parseInt(s.replace(/[^0-9]/g, ''), 10);
  return Number.isFinite(n) ? n : null;
};

export default function GameScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const db = useSQLiteContext();
  const c = useColors();
  const [game, setGame] = useState<Game | null>(null);
  const [viewing, setViewing] = useState<number | null>(null);
  const [side, setSide] = useState<Side>('home');
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    getGame(db, id).then(setGame);
  }, [db, id]);

  // Save shortly after edits stop, and on leaving the screen.
  const pending = useRef<Game | null>(null);
  useEffect(
    () => () => {
      if (saveTimer.current) clearTimeout(saveTimer.current);
      if (pending.current) void saveGame(db, pending.current);
    },
    [db],
  );

  const update = useCallback(
    (fn: (g: Game) => Game) => {
      setGame((prev) => {
        if (!prev) return prev;
        const next = { ...fn(prev), updatedAt: Date.now() };
        next.season = seasonFor(next.date);
        pending.current = next;
        if (saveTimer.current) clearTimeout(saveTimer.current);
        saveTimer.current = setTimeout(() => {
          pending.current = null;
          void saveGame(db, next);
        }, 600);
        return next;
      });
    },
    [db],
  );

  const issues = useMemo(() => (game ? validateGame(game) : []), [game]);
  const issueAt = useMemo(() => {
    const map = new Map<string, Issue>();
    for (const i of issues) if (!map.has(i.path) || i.severity === 'error') map.set(i.path, i);
    return map;
  }, [issues]);

  if (!game) return <View style={[base.screen, { backgroundColor: c.bg }]} />;
  const sideIssues = issues.filter((i) => i.path.startsWith(`${side}.`));

  const updateTeam = (side: Side, fn: (t: TeamSheet) => TeamSheet) =>
    update((g) => ({ ...g, [side]: fn(g[side]) }));

  const share = async (kind: 'csv' | 'json') => {
    const name = `${game.date ?? 'game'}-${game.home.name ?? 'home'}-vs-${game.away.name ?? 'away'}`
      .replace(/[^a-z0-9-]+/gi, '_')
      .toLowerCase();
    try {
      if (kind === 'csv') await shareText(`${name}.csv`, gameToCsv(game), 'text/csv');
      else await shareText(`${name}.json`, gameToJson(game), 'application/json');
    } catch (e) {
      Alert.alert('Could not share', e instanceof Error ? e.message : String(e));
    }
  };

  const remove = () =>
    Alert.alert('Delete this game?', 'The box score and page photos will be removed.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          pending.current = null;
          if (saveTimer.current) clearTimeout(saveTimer.current);
          await deleteGame(db, game.id);
          deleteGameImages(game.id);
          router.back();
        },
      },
    ]);

  return (
    <>
      <Stack.Screen
        options={{
          title: `${game.home.name ?? 'Home'} ${teamScore(game.home) ?? '–'} – ${teamScore(game.away) ?? '–'} ${game.away.name ?? 'Away'}`,
        }}
      />
      <ScrollView
        style={[base.screen, { backgroundColor: c.bg }]}
        contentContainerStyle={base.content}
        keyboardShouldPersistTaps="handled">
        <View accessibilityRole="tablist" style={[styles.segment, { backgroundColor: c.sunken }]}>
          {(['home', 'away'] as const).map((s) => {
            const selected = s === side;
            const count = issues.filter((i) => i.path.startsWith(`${s}.`)).length;
            return (
              <Pressable
                key={s}
                accessibilityRole="tab"
                accessibilityState={{ selected }}
                onPress={() => setSide(s)}
                style={[styles.segmentItem, selected && { backgroundColor: c.card }]}>
                <T style={{ fontFamily: fonts.bodySemiBold, color: selected ? c.text : c.muted }}>
                  {game[s].name ?? (s === 'home' ? 'Home' : 'Away')}
                  {count > 0 ? ` · ${count}` : ''}
                </T>
              </Pressable>
            );
          })}
        </View>

        {sideIssues.length > 0 && (
          <Card style={{ backgroundColor: c.warnBg, borderColor: c.warnLine }}>
            <T style={{ fontFamily: fonts.bodyBold, color: c.warn }}>
              {sideIssues.length} thing{sideIssues.length === 1 ? '' : 's'} to check
            </T>
            {sideIssues.map((i, k) => (
              <T key={k} style={{ color: i.severity === 'error' ? c.error : c.text, fontSize: 14, lineHeight: 20 }}>
                {i.message}
              </T>
            ))}
          </Card>
        )}

        <TeamEditor
          side={side}
          team={game[side]}
          issueAt={issueAt}
          onChange={(fn) => updateTeam(side, fn)}
          onZoom={setViewing}
        />

        <Card>
          <View style={base.row}>
            <Field label="Date" value={game.date} width={120} placeholder="yyyy-mm-dd" c={c}
              onChange={(v) => update((g) => ({ ...g, date: v || null }))} />
            <View style={{ flex: 1 }}>
              <Field label="Location" value={game.location} c={c}
                onChange={(v) => update((g) => ({ ...g, location: v || null }))} />
            </View>
          </View>
        </Card>

        <View style={base.row}>
          <View style={{ flex: 1 }}>
            <Button title="Export CSV" onPress={() => share('csv')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Export JSON" kind="secondary" onPress={() => share('json')} />
          </View>
        </View>
        <Button title="Delete game" kind="danger" onPress={remove} />
      </ScrollView>

      <PhotoViewer photos={teamPhotos(game[side])} index={viewing} onClose={() => setViewing(null)} />
    </>
  );
}

function TeamEditor({
  side,
  team,
  issueAt,
  onChange,
  onZoom,
}: {
  side: Side;
  team: TeamSheet;
  issueAt: Map<string, Issue>;
  onChange: (fn: (t: TeamSheet) => TeamSheet) => void;
  /** Open the photo viewer at this index of teamPhotos(team). */
  onZoom: (index: number) => void;
}) {
  const c = useColors();
  const flag = (path: string) => issueAt.get(`${side}.${path}`);
  const setPlayer = (i: number, patch: Partial<PlayerLine>) =>
    onChange((t) => ({ ...t, players: t.players.map((p, k) => (k === i ? { ...p, ...patch } : p)) }));

  return (
    <Card>
      <View style={base.row}>
        <View style={{ flex: 1 }}>
          <Field label={side === 'home' ? 'Home team' : 'Away team'} value={team.name} c={c}
            onChange={(v) => onChange((t) => ({ ...t, name: v || null }))} />
        </View>
        <View style={{ flex: 1 }}>
          <Field label="Coach" value={team.coach ?? null} c={c}
            onChange={(v) => onChange((t) => ({ ...t, coach: v || null }))} />
        </View>
      </View>

      {team.crops.length > 0 && (
        <ScrollView horizontal contentContainerStyle={{ gap: space.sm }}>
          {teamPhotos(team).map((p, i) => (
            <Pressable key={p.uri} onPress={() => onZoom(i)} accessibilityLabel={`View ${p.label}`}>
              <Image source={{ uri: p.uri }} style={styles.thumb} />
            </Pressable>
          ))}
        </ScrollView>
      )}

      <T muted style={base.small}>Score by period</T>
      <View style={[base.row, { flexWrap: 'wrap' }]}>
        {team.periodScores.map((s, i) => (
          <Cell key={i} label={i < 4 ? `Q${i + 1}` : `OT${i - 3}`} value={s} width={48} c={c}
            issue={flag('periodScores')}
            onChange={(v) => onChange((t) => ({ ...t, periodScores: t.periodScores.map((x, k) => (k === i ? v : x)) }))} />
        ))}
        <Cell label="Final" value={team.totalPoints} width={56} c={c} issue={flag('totalPoints')}
          onChange={(v) => onChange((t) => ({ ...t, totalPoints: v }))} />
        <Pressable onPress={() => onChange((t) => ({ ...t, periodScores: [...t.periodScores, null] }))}
          accessibilityRole="button" style={styles.addOt}>
          <T style={{ color: c.accent }}>+ OT</T>
        </Pressable>
      </View>

      <View style={[base.row, { flexWrap: 'wrap', alignItems: 'flex-end' }]}>
        <Cell label="Timeouts" value={team.timeoutsUsed} width={72} c={c}
          onChange={(v) => onChange((t) => ({ ...t, timeoutsUsed: v }))} />
        {(team.teamFouls?.length ? team.teamFouls : [null, null]).map((f, i, all) => (
          <Cell key={i} label={all.length === 2 ? `Team fouls H${i + 1}` : `Team fouls ${i + 1}`} value={f} width={all.length === 2 ? 100 : 72} c={c}
            onChange={(v) => onChange((t) => {
              const cur = t.teamFouls?.length ? t.teamFouls : [null, null];
              return { ...t, teamFouls: cur.map((x, k) => (k === i ? v : x)) };
            })} />
        ))}
      </View>

      {/* nestedScrollEnabled: on Android a horizontal list inside the vertical page needs it to receive swipes. */}
      <ScrollView horizontal nestedScrollEnabled showsHorizontalScrollIndicator>
        <View>
          <View style={styles.tableRow}>
            <T muted style={[styles.head, { width: 44 }]}>#</T>
            <T muted style={[styles.head, { width: 130 }]}>Name</T>
            {STAT_COLUMNS.map((col) => (
              <T key={col.key} muted style={[styles.head, { width: col.width }]}>{col.label}</T>
            ))}
          </View>
          {team.players.map((p, i) => (
            <View key={i}>
              <View style={styles.tableRow}>
                <Input value={p.number ?? ''} width={44} c={c} issue={flag(`players.${i}.number`)}
                  keyboardType="number-pad" onChange={(v) => setPlayer(i, { number: v || null })} />
                <Input value={p.name ?? ''} width={130} c={c} text
                  onChange={(v) => setPlayer(i, { name: v || null })} />
                {STAT_COLUMNS.map((col) => (
                  <Input key={col.key} value={p[col.key] === null ? '' : String(p[col.key])} width={col.width} c={c}
                    issue={flag(`players.${i}.${col.key}`)} keyboardType="number-pad"
                    onChange={(v) => setPlayer(i, { [col.key]: toInt(v) })} />
                ))}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove row ${i + 1}`}
                  onPress={() => onChange((t) => ({ ...t, players: t.players.filter((_, k) => k !== i) }))}
                  style={styles.remove}>
                  <T style={{ color: c.error }}>✕</T>
                </Pressable>
              </View>
              {p.readNotes.length > 0 && (
                <T muted style={[base.small, { marginLeft: 4, marginBottom: 4 }]}>
                  {p.readNotes.join('; ')}
                </T>
              )}
            </View>
          ))}
        </View>
      </ScrollView>
      <Button title="Add player" kind="secondary"
        onPress={() => onChange((t) => ({ ...t, players: [...t.players, blankPlayer()] }))} />
    </Card>
  );
}

function Field({ label, value, onChange, width, placeholder, c }: {
  label: string; value: string | null; onChange: (v: string) => void; width?: number; placeholder?: string; c: Colors;
}) {
  const [text, setText] = useState(value ?? '');
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    // Value changed underneath us (e.g. reloaded): adopt it during render, not in an effect.
    setPrev(value);
    setText(value ?? '');
  }
  return (
    <View style={{ width, gap: 2 }}>
      <T muted style={base.small}>{label}</T>
      <TextInput
        value={text}
        placeholder={placeholder}
        placeholderTextColor={c.muted}
        onChangeText={setText}
        onEndEditing={() => onChange(text.trim())}
        style={[styles.input, { color: c.text, borderColor: c.border }]}
      />
    </View>
  );
}

function Cell({ label, value, onChange, width, issue, c }: {
  label: string; value: number | null; onChange: (v: number | null) => void; width: number; issue?: Issue; c: Colors;
}) {
  return (
    <View style={{ gap: 2 }}>
      <T muted style={base.small}>{label}</T>
      <Input value={value === null ? '' : String(value)} width={width} c={c} issue={issue}
        keyboardType="number-pad" onChange={(v) => onChange(toInt(v))} />
    </View>
  );
}

/** Commits on blur so typing "12" does not save "1" then re-validate mid-keystroke. */
function Input({ value, onChange, width, issue, keyboardType, text: isText, c }: {
  value: string; onChange: (v: string) => void; width: number; issue?: Issue; keyboardType?: KeyboardTypeOptions;
  /** Free text (names): body font, left-aligned. Default is a centered numeric cell. */
  text?: boolean; c: Colors;
}) {
  const [text, setText] = useState(value);
  const [prev, setPrev] = useState(value);
  if (value !== prev) {
    setPrev(value);
    setText(value);
  }
  const bg = issue ? (issue.severity === 'error' ? c.errorBg : c.warnBg) : 'transparent';
  const border = issue ? (issue.severity === 'error' ? c.error : c.warn) : c.border;
  return (
    <TextInput
      value={text}
      onChangeText={setText}
      onEndEditing={() => text !== value && onChange(text.trim())}
      keyboardType={keyboardType}
      selectTextOnFocus
      accessibilityHint={issue?.message}
      style={[
        styles.input,
        styles.cell,
        isText && { textAlign: 'left', fontFamily: fonts.body },
        { width, color: c.text, backgroundColor: bg, borderColor: border },
      ]}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: 8,
    paddingVertical: 8,
    fontSize: 15,
    fontFamily: fonts.body,
    minHeight: 44,
  },
  cell: { textAlign: 'center', marginRight: 4, fontFamily: fonts.mono, paddingHorizontal: 2 },
  tableRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 4 },
  head: { fontSize: 12, fontFamily: fonts.bodyBold, textAlign: 'center', marginRight: 4 },
  segment: { flexDirection: 'row', borderRadius: radius.md, padding: 4 },
  segmentItem: { flex: 1, minHeight: 44, borderRadius: 9, alignItems: 'center', justifyContent: 'center' },
  remove: { width: 36, height: 36, alignItems: 'center', justifyContent: 'center' },
  addOt: { paddingHorizontal: space.sm, paddingTop: 18 },
  thumb: { width: 96, height: 72, borderRadius: 6 },
});
