import {
  DEFAULT_PARTS,
  SCOREBOOK_PAGE_TEMPLATE,
  applyTemplate,
  newTemplate,
  placeParts,
  templateForPhoto,
  readPage,
  scoreReading,
  type BenchScore,
  type BenchTruth,
  type PartId,
} from '@inkstat/basketball';
import { Directory, File, Paths } from 'expo-file-system';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { router, useFocusEffect, useLocalSearchParams } from 'expo-router';
import { Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { extract, getActiveModelId } from '@/engine/host';
import { readBenchMarks, type BenchMarks } from '@/lib/files';
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
        if (only && !only.includes(s.id)) continue;
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

  // Driven from a computer: inkstat://bench?run=template&only=stars,nba-nets-1984
  // (adb shell am start -d ...); results are read from the Metro log.
  // `n` is a nonce so the same run can be requested again.
  const { run, only, n } = useLocalSearchParams<{ run?: Mode; only?: string; n?: string }>();
  const autoRan = useRef<string | null>(null);
  useEffect(() => {
    const key = `${run}|${only}|${n}`;
    if (!run || autoRan.current === key) return;
    autoRan.current = key;
    void runAll(run, only ? only.split(',') : undefined);
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
