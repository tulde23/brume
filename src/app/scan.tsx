import type { ExtractionProgress } from '@brume/ocr-engine';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, Image, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { READ_IN_PROGRESS_KEY, clearSetting, getActiveTemplate, saveGame, setSetting } from '@/db';
import {
  SCOREBOOK_PAGE_TEMPLATE,
  applyTemplate,
  isUsable,
  markedParts,
  emptyTeam,
  normalizeDate,
  readPage,
  seasonFor,
  type Game,
  type PageReading,
  type ScorebookTemplate,
  type Side,
} from '@brume/basketball';
import { extract, getActiveModelId } from '@/engine/host';
import { keepImage, newId } from '@/lib/files';
import { Button, Card, ProgressBar, T } from '@/ui/components';
import { base, space, useColors } from '@/ui/theme';

const REGION_LABELS: Record<string, string> = {
  ...Object.fromEntries(SCOREBOOK_PAGE_TEMPLATE.regions.map((r) => [r.id, r.label.toLowerCase()])),
  details: 'game details',
  timeouts: 'timeouts',
  team_fouls: 'team fouls',
  quarters: 'score by quarter',
};

type Status = { text: string; detail: string; fraction: number; startedAt: number } | null;

const KEEP_AWAKE_TAG = 'brume-reading';

/** Within one crop: encoding the image is roughly the first 40%, writing the answer the rest. */
function cropFraction(p: ExtractionProgress): number {
  if (p.phase === 'finished') return 1;
  if (p.phase === 'looking') return 0.05;
  return 0.4 + 0.6 * Math.min(1, p.tokens / Math.max(1, p.maxTokens * 0.6));
}

function describeProgress(side: Side, p: ExtractionProgress): { text: string; detail: string } {
  const what = REGION_LABELS[p.regionId] ?? 'finishing';
  const part = p.tileCount > 1 ? ` (${p.tileIndex + 1} of ${p.tileCount})` : '';
  const detail =
    p.phase === 'looking' ? 'Looking at the page…' : p.phase === 'writing' ? `Writing results… ${p.tokens} tokens` : '';
  return { text: `Reading ${side} page: ${what}${part}`, detail };
}

function useElapsed(since: number | null): string {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    if (since === null) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [since]);
  if (since === null) return '';
  const s = Math.max(0, Math.round((now - since) / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
}

export default function Scan() {
  const db = useSQLiteContext();
  const c = useColors();
  const [pages, setPages] = useState<Record<Side, string | null>>({ home: null, away: null });
  const [layout, setLayout] = useState<ScorebookTemplate | null>(null);

  // Re-read after returning from the template screens.
  useFocusEffect(
    useCallback(() => {
      getActiveTemplate(db).then((t) => setLayout(t && isUsable(t) ? t : null));
    }, [db]),
  );
  const [status, setStatus] = useState<Status>(null);
  const elapsed = useElapsed(status?.startedAt ?? null);
  const abort = useRef<AbortController | null>(null);

  useEffect(() => () => abort.current?.abort(), []);

  const pick = async (side: Side, source: 'camera' | 'library') => {
    const options: ImagePicker.ImagePickerOptions = {
      mediaTypes: ['images'],
      quality: 1,
      // Android's editor allows free-form crops; iOS forces a square, which would cut the page.
      allowsEditing: Platform.OS === 'android',
    };
    if (source === 'camera') {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        Alert.alert('Camera access needed', 'Allow camera access in Settings, or choose a photo instead.');
        return;
      }
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled) setPages((p) => ({ ...p, [side]: result.assets[0].uri }));
  };

  const read = async () => {
    abort.current = new AbortController();
    const signal = abort.current.signal;
    const id = newId();
    // If Android kills Brume for memory mid-read, nothing in JS runs; this marker lets
    // the next launch explain what happened instead of silently landing on Home.
    await setSetting(db, READ_IN_PROGRESS_KEY, String(Date.now()));
    // A read takes minutes. If the screen locks, Android demotes Brume to a cached
    // process, the first thing it kills to free memory; keep the screen on until done.
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    try {
      const modelId = await getActiveModelId(db);
      const sides = (['home', 'away'] as const).filter((s) => pages[s]);
      const readings: Partial<Record<Side, PageReading>> = {};
      const startedAt = Date.now();

      for (const [i, side] of sides.entries()) {
        const uri = keepImage(pages[side]!, id, side);
        const template = layout ? applyTemplate(SCOREBOOK_PAGE_TEMPLATE, layout) : SCOREBOOK_PAGE_TEMPLATE;
        const run = await extract(modelId, uri, template, {
          signal,
          onModelLoad: (f) =>
            setStatus({ text: 'Loading the reading model…', detail: '', fraction: f, startedAt }),
          onProgress: (p) => {
            // One device-log line per crop: the only way to time a run on a phone.
            if (p.phase !== 'writing') {
              console.log(`[scan] ${side} ${p.phase} ${p.done + 1}/${p.total} ${p.regionId} +${Date.now() - startedAt}ms`);
            }
            setStatus({
              ...describeProgress(side, p),
              fraction: (i + (p.done + cropFraction(p)) / Math.max(1, p.total)) / sides.length,
              startedAt,
            });
          },
        });
        console.log(`[scan] ${side} read in ${run.finishedAt - run.startedAt}ms with ${run.modelId}`);
        // The model's exact answer per crop: when a field comes back blank, this shows
        // whether the model left it out or wrote it in a shape the schema didn't accept.
        for (const r of run.results) {
          console.log(`[scan] raw ${side} ${r.regionId}#${r.tileIndex}: ${r.raw.replace(/\s+/g, ' ').slice(0, 1500)}`);
          if (r.warnings.length) console.log(`[scan] warnings ${side} ${r.regionId}#${r.tileIndex}: ${r.warnings.join('; ')}`);
        }
        const reading = readPage(run);
        reading.team.crops = reading.team.crops.map((cr, k) => ({
          ...cr,
          uri: keepImage(cr.uri, id, `${side}-crop-${k}`),
        }));
        readings[side] = reading;
      }

      const home = readings.home?.team ?? emptyTeam();
      const away = readings.away?.team ?? emptyTeam();
      // Each page names its opponent; use that when the other page didn't name its own team.
      home.name ??= readings.away?.opponent ?? null;
      away.name ??= readings.home?.opponent ?? null;
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

      const failures = sides.flatMap((s) => readings[s]!.failures.map((f) => `${s}: ${f}`));
      const notes = sides.flatMap((s) => readings[s]!.notes.map((n) => `${s}: ${n}`));
      if (failures.length) {
        Alert.alert(
          'Some parts could not be read',
          `${failures.join('\n')}\n\nYou can fill these in by hand on the next screen.`,
        );
      } else if (notes.length) {
        Alert.alert('Adjusted while reading', notes.join('\n'));
      }
      router.replace({ pathname: '/game/[id]', params: { id } });
    } catch (e) {
      if (!signal.aborted) Alert.alert('Reading failed', e instanceof Error ? e.message : String(e));
    } finally {
      await deactivateKeepAwake(KEEP_AWAKE_TAG).catch(() => undefined);
      await clearSetting(db, READ_IN_PROGRESS_KEY);
      setStatus(null);
      abort.current = null;
    }
  };

  if (status) {
    return (
      <View style={[base.screen, base.content, { backgroundColor: c.bg, justifyContent: 'center' }]}>
        <T style={base.h2}>{status.text}</T>
        <ProgressBar fraction={status.fraction} />
        <View style={[base.row, { justifyContent: 'space-between' }]}>
          <T muted style={base.small}>{status.detail}</T>
          <T muted style={[base.small, base.num]}>{elapsed}</T>
        </View>
        <T muted>This takes a minute or two per page on most phones. Keep Brume open.</T>
        <Button title="Cancel" kind="secondary" onPress={() => abort.current?.abort()} />
      </View>
    );
  }

  return (
    <ScrollView style={[base.screen, { backgroundColor: c.bg }]} contentContainerStyle={base.content}>
      <T muted>
        {"Photograph each team's page flat, in good light, filling the frame. You can scan just one team."}
      </T>
      {(['home', 'away'] as const).map((side) => (
        <Card key={side}>
          <T style={base.h2}>{side === 'home' ? 'Home team page' : 'Away team page'}</T>
          {pages[side] && <Image source={{ uri: pages[side]! }} style={styles.preview} resizeMode="contain" />}
          <View style={base.row}>
            <View style={{ flex: 1 }}>
              <Button title={pages[side] ? 'Retake' : 'Camera'} onPress={() => pick(side, 'camera')} />
            </View>
            <View style={{ flex: 1 }}>
              <Button title="Photos" kind="secondary" onPress={() => pick(side, 'library')} />
            </View>
          </View>
        </Card>
      ))}
      {(pages.home || pages.away) && (
        <Card>
          <View style={[base.row, { justifyContent: 'space-between' }]}>
            <T style={base.h2}>Template</T>
            <T muted>{layout ? layout.name : 'None'}</T>
          </View>
          <T muted>
            {layout
              ? `Brume reads the ${markedParts(layout).length} parts you marked on this kind of scorebook.`
              : 'Show Brume where each part of your scorebook is, once per kind of book. Reading is much more accurate afterwards.'}
          </T>
          {layout ? (
            <Button title="Change template" kind="secondary" onPress={() => router.push('/templates')} />
          ) : (
            <Button
              title="Make a template from this photo"
              onPress={() => router.push({ pathname: '/template-editor', params: { uri: (pages.home ?? pages.away)! } })}
            />
          )}
        </Card>
      )}
      <Button title="Read pages" onPress={read} disabled={!pages.home && !pages.away} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', height: 220, borderRadius: 8, marginVertical: space.xs },
});
