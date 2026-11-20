import {
  DEFAULT_PARTS,
  SCOREBOOK_PAGE_TEMPLATE,
  applyTemplate,
  newTemplate,
  placeParts,
  templateForPhoto,
  readPage,
  scoreReading,
  emptyTeam,
  isUsable,
  normalizeDate,
  seasonFor,
  truthTeam,
  type BenchScore,
  type Game,
  type PageReading,
  type Side,
  type BenchTruth,
  type PartId,
} from '@inkstat/basketball';
import { Directory, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { getActiveTemplate, saveGame } from '@/db';
import { extract, getActiveModelId } from '@/engine/host';
import { keepImage, readBenchMarks, type BenchMarks } from '@/lib/files';
import { Button, Card, T } from '@/ui/components';
import { base, fonts, space, useColors } from '@/ui/theme';
import { recognizePageText } from '../../modules/page-text';

/**
 * Development test bench: runs every sample page in <documents>/bench/<id>/
 * (page image + truth.json, pushed with scripts/push-bench.sh) through the real
 * pipeline and scores it against its known answers. Results and each page's OCR
 * text go to the Metro log as [bench-result] / [bench-ocr] lines.
 */

interface Sample {
  id: string;
  uri: string;
  truth: BenchTruth;
  /** Hand-checked boxes, marked on the phone with "Mark boxes". */
  marked: BenchMarks | null;
}

interface Result {
  mode: Mode;
  seconds: number;
  placed: PartId[];
  score: BenchScore | null;
  error?: string;
}

type Mode = 'template' | 'marked' | 'whole-page';
type GameMode = 'games' | 'answers';

/** Samples that belong to a game (truth.game), paired by side. */
function gamesOf(samples: Sample[]): { game: string; home?: Sample; away?: Sample }[] {
  const by = new Map<string, { game: string; home?: Sample; away?: Sample }>();
  for (const s of samples) {
    if (!s.truth.game || !s.truth.side) continue;
    const g = by.get(s.truth.game) ?? { game: s.truth.game };
    g[s.truth.side] = s;
    by.set(s.truth.game, g);
  }
  return [...by.values()].sort((a, b) => a.game.localeCompare(b.game));
}

/** `only` takes ids, or prefixes ending in * (only=g0*,stars). */
const matches = (only: string[] | undefined, id: string) =>
  !only || only.some((o) => (o.endsWith('*') ? id.startsWith(o.slice(0, -1)) : id === o));

function loadSamples(): Sample[] {
  const root = new Directory(Paths.document, 'bench');
  if (!root.exists) return [];
  return root
    .list()
    .filter((d): d is Directory => d instanceof Directory)
    .flatMap((dir) => {
      const files = dir.list().filter((f): f is File => f instanceof File);
      const image = files.find((f) => /\.(jpe?g|png)$/i.test(f.name));
      const truthFile = files.find((f) => f.name === 'truth.json');
      if (!image || !truthFile) return [];
      try {
        return [{ id: dir.name, uri: image.uri, truth: JSON.parse(truthFile.textSync()) as BenchTruth, marked: readBenchMarks(dir.name) }];
      } catch {
        return [];
      }
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

const KEEP_AWAKE_TAG = 'inkstat-bench';

export default function Bench() {
  const db = useSQLiteContext();
  const c = useColors();
  const [samples, setSamples] = useState(loadSamples);
  // Coming back from marking a sample's boxes: pick up its marked.json.
  useFocusEffect(useCallback(() => setSamples(loadSamples()), []));
  const [results, setResults] = useState<Record<string, Result>>({});
  const [running, setRunning] = useState<string | null>(null);
  const [gamesNote, setGamesNote] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  useEffect(() => () => abort.current?.abort(), []);

  const runOne = useCallback(
    async (s: Sample, mode: Mode, signal: AbortSignal): Promise<Result> => {
      const t0 = Date.now();
      try {
        let doc = SCOREBOOK_PAGE_TEMPLATE;
        let placed: PartId[] = [];
        let source: string = mode;
        if (mode === 'marked') {
          if (!s.marked) throw new Error('No marked boxes yet: tap Mark boxes');
          const tpl = { ...newTemplate(`bench-${s.id}`, s.id, s.uri), ...s.marked };
          placed = tpl.enabled.filter((p) => !!tpl.parts[p]);
          doc = applyTemplate(SCOREBOOK_PAGE_TEMPLATE, tpl);
        } else if (mode === 'template') {
          const lines = await recognizePageText(s.uri);
          if (lines) console.log(`[bench-ocr] ${s.id} ${JSON.stringify(lines)}`);
          // A recognised built-in book first; label guessing when the page is unknown.
          const fromLibrary = templateForPhoto(null, lines);
          if (fromLibrary.template) {
            source = `library ${fromLibrary.detail}`;
            placed = fromLibrary.template.enabled;
            doc = applyTemplate(SCOREBOOK_PAGE_TEMPLATE, fromLibrary.template);
          } else {
            const placement = lines ? placeParts(lines) : null;
            source = 'label guess';
            placed = placement?.found ?? [];
            const tpl = newTemplate(`bench-${s.id}`, s.id, s.uri);
            tpl.parts = Object.fromEntries(tpl.enabled.map((p) => [p, placement?.parts[p] ?? DEFAULT_PARTS[p]]));
            doc = applyTemplate(SCOREBOOK_PAGE_TEMPLATE, tpl);
          }
        }
        const modelId = await getActiveModelId(db);
        const run = await extract(modelId, s.uri, doc, { signal });
        for (const r of run.results) console.log(`[bench-raw] ${s.id} ${r.regionId}#${r.tileIndex}: ${r.raw.replace(/\s+/g, ' ').slice(0, 600)}`);
        const score = scoreReading(s.truth, readPage(run));
        const result = { mode, source, seconds: Math.round((Date.now() - t0) / 100) / 10, placed, score };
        console.log(`[bench-result] ${JSON.stringify({ id: s.id, ...result })}`);
        return result;
      } catch (e) {
        if (signal.aborted) throw e;
        return { mode, seconds: Math.round((Date.now() - t0) / 100) / 10, placed: [], score: null, error: e instanceof Error ? e.message : String(e) };
      }
    },
    [db],
  );

  const runAll = async (mode: Mode, only?: string[]) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    const started = Date.now();
    console.log(`[bench-start] ${mode}`);
    // Re-read the folder: samples may have been pushed since this screen opened.
    const list = loadSamples();
    setSamples(list);
    try {
      for (const s of list) {
        if (!matches(only, s.id)) continue;
        if (mode === 'marked' && !s.marked) continue;
        setRunning(s.id);
        const r = await runOne(s, mode, ctrl.signal);
        setResults((all) => ({ ...all, [s.id]: r }));
      }
    } catch {
      // cancelled
    } finally {
      console.log(`[bench-done] ${mode} ${Math.round((Date.now() - started) / 1000)}s`);
      setRunning(null);
      await deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    }
  };

  /**
   * League samples become real games, saved under a stable id (league-g01) so a second
   * run replaces the first. 'answers' saves the answer key as it is, instantly; 'games'
   * reads both pages through the scan pipeline with the active template, scores each
   * page, and saves what was read. Home and away come from each page's truth.side.
   */
  const runGames = async (mode: GameMode, only?: string[]) => {
    const ctrl = new AbortController();
    abort.current = ctrl;
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    const started = Date.now();
    console.log(`[bench-start] ${mode}`);
    const list = loadSamples();
    setSamples(list);
    let saved = 0;
    try {
      const layout = mode === 'games' ? await getActiveTemplate(db) : null;
      if (mode === 'games' && !(layout && isUsable(layout))) {
        throw new Error('Make a template first: reading games uses the active template.');
      }
      const modelId = mode === 'games' ? await getActiveModelId(db) : 'answer-key';
      for (const g of gamesOf(list)) {
        if (!matches(only, g.game)) continue;
        const id = `league-${g.game}`;
        const readings: Partial<Record<Side, PageReading>> = {};
        for (const side of ['home', 'away'] as const) {
          const s = g[side];
          if (!s) continue;
          setRunning(s.id);
          const pageUri = keepImage(s.uri, id, side);
          if (mode === 'answers') {
            readings[side] = {
              team: { ...truthTeam(s.truth), pageUri },
              opponent: s.truth.opponent ?? null,
              date: s.truth.date ?? null,
              location: s.truth.location ?? null,
              failures: [],
              notes: [],
            };
            continue;
          }
          const t0 = Date.now();
          const lines = await recognizePageText(pageUri);
          const chosen = templateForPhoto(layout, lines);
          const doc = chosen.template ? applyTemplate(SCOREBOOK_PAGE_TEMPLATE, chosen.template) : SCOREBOOK_PAGE_TEMPLATE;
          const run = await extract(modelId, pageUri, doc, { signal: ctrl.signal });
          const reading = readPage(run);
          reading.team.pageUri = pageUri;
          reading.team.crops = reading.team.crops.map((cr, k) => ({ ...cr, uri: keepImage(cr.uri, id, `${side}-crop-${k}`) }));
          readings[side] = reading;
          const score = scoreReading(s.truth, reading);
          const result: Result = {
            mode: 'template',
            seconds: Math.round((Date.now() - t0) / 100) / 10,
            placed: chosen.template?.enabled ?? [],
            score,
          };
          console.log(`[bench-result] ${JSON.stringify({ id: s.id, source: chosen.source, ...result })}`);
          setResults((all) => ({ ...all, [s.id]: result }));
        }
        const home = readings.home?.team ?? emptyTeam();
        const away = readings.away?.team ?? emptyTeam();
        home.name ??= readings.away?.opponent ?? g.away?.truth.teamName ?? null;
        away.name ??= readings.home?.opponent ?? g.home?.truth.teamName ?? null;
        const date = normalizeDate(readings.home?.date ?? readings.away?.date ?? null);
        const now = Date.now();
        const game: Game = {
          id,
          date,
          location: readings.home?.location ?? readings.away?.location ?? null,
          season: seasonFor(date),
          home,
          away,
          modelId,
          createdAt: now,
          updatedAt: now,
        };
        await saveGame(db, game);
        saved++;
        console.log(`[bench-game] ${id} ${home.name} ${home.totalPoints ?? '?'} - ${away.totalPoints ?? '?'} ${away.name}`);
      }
      setGamesNote(
        `${saved} game${saved === 1 ? '' : 's'} saved (${mode === 'answers' ? 'from the answer key' : 'as read'}). They are on Home and in Season.`,
      );
    } catch (e) {
      if (!ctrl.signal.aborted) setGamesNote(e instanceof Error ? e.message : String(e));
    } finally {
      console.log(`[bench-done] ${mode} ${saved} games ${Math.round((Date.now() - started) / 1000)}s`);
      setRunning(null);
      await deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
    }
  };

  // Driven from a computer: inkstat://bench?run=template&only=stars,g01-*
  // or run=answers / run=games (only=g0*) to save league games.
  // (adb shell am start -d ...); results are read from the Metro log.
  // `n` is a nonce so the same run can be requested again.
  const { run, only, n } = useLocalSearchParams<{ run?: Mode | GameMode; only?: string; n?: string }>();
  const autoRan = useRef<string | null>(null);
  useEffect(() => {
    const key = `${run}|${only}|${n}`;
    if (!run || autoRan.current === key) return;
    autoRan.current = key;
    const ids = only ? only.split(',') : undefined;
    // On the next tick: a run sets state, which the effect itself must not do.
    setTimeout(() => void (run === 'games' || run === 'answers' ? runGames(run, ids) : runAll(run, ids)), 0);
    // runAll is recreated each render; the key above makes this run once per link.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [run, only, n]);

  if (!__DEV__) {
    return (
      <View style={[base.screen, base.content, { backgroundColor: c.bg }]}>
        <T>The test bench is only in development builds.</T>
      </View>
    );
  }

  return (
    <ScrollView style={[base.screen, { backgroundColor: c.bg }]} contentContainerStyle={[base.content, { gap: space.md }]}>
      <T muted>{`${samples.length} sample pages. Push more with scripts/push-bench.sh.`}</T>
      <View style={base.row}>
        <View style={{ flex: 1 }}>
          <Button title="Run with auto template" onPress={() => runAll('template')} disabled={!!running || !samples.length} />
        </View>
        <View style={{ flex: 1 }}>
          <Button title="Run whole page" kind="secondary" onPress={() => runAll('whole-page')} disabled={!!running || !samples.length} />
        </View>
      </View>
      <Button
        title={`Run with marked boxes (${samples.filter((s) => s.marked).length})`}
        kind="secondary"
        onPress={() => runAll('marked')}
        disabled={!!running || !samples.some((s) => s.marked)}
      />
      {gamesOf(samples).length > 0 && (
        <Card>
          <T style={{ fontFamily: fonts.bodyBold }}>{`League games: ${gamesOf(samples).length}`}</T>
          <T muted style={base.small}>
            Saves each game, home and away pages together, as a real game you can open. Running again replaces them.
          </T>
          <View style={base.row}>
            <View style={{ flex: 1 }}>
              <Button title="Import answers" kind="secondary" onPress={() => runGames('answers')} disabled={!!running} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Read and save" onPress={() => runGames('games')} disabled={!!running} />
            </View>
          </View>
          {gamesNote && <T style={{ fontSize: 14 }}>{gamesNote}</T>}
        </Card>
      )}
      {running && <Button title={`Running ${running}… Cancel`} kind="secondary" onPress={() => abort.current?.abort()} />}
      {samples.map((s) => {
        const r = results[s.id];
        const sc = r?.score;
        return (
          <Card key={s.id}>
            <View style={[base.row, { justifyContent: 'space-between' }]}>
              <T style={{ fontFamily: fonts.bodyBold }}>{s.id}</T>
              {r && <T muted style={[base.small, { fontFamily: fonts.mono }]}>{`${r.mode} · ${r.seconds} s`}</T>}
            </View>
            <T muted style={base.small}>{s.truth.layout}</T>
            <Pressable
              onPress={() => router.push({ pathname: '/template-editor', params: { uri: s.uri, benchId: s.id } })}
              accessibilityRole="button"
              style={{ minHeight: 36, justifyContent: 'center' }}>
              <T style={{ color: c.accent, fontFamily: fonts.bodySemiBold }}>{s.marked ? 'Edit marked boxes' : 'Mark boxes'}</T>
            </Pressable>
            {r?.error && <T style={{ color: c.error }}>{r.error}</T>}
            {sc && (
              <>
                <T style={styles.mono}>
                  {`players ${sc.playersFound}/${sc.playersExpected} · points ${sc.pointsRight}/${sc.pointsChecked} · fouls ${sc.foulsRight}/${sc.foulsChecked}`}
                </T>
                {sc.checks.map((k) => (
                  <T key={k.field} style={[styles.mono, { color: k.ok ? c.ok : c.warn }]}>
                    {`${k.ok ? '✓' : '✗'} ${k.field}: ${k.got}${k.ok ? '' : ` (want ${k.expected})`}`}
                  </T>
                ))}
                {r.mode === 'template' && <T muted style={base.small}>{`placed from labels: ${r.placed.join(', ') || 'none'}`}</T>}
              </>
            )}
          </Card>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  mono: { fontFamily: fonts.mono, fontSize: 13 },
});
