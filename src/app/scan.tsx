import type { ExtractionProgress, NormRect } from '@inkstat/ocr-engine';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Image, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { READ_IN_PROGRESS_KEY, clearSetting, getActiveTemplate, listTemplates, saveGame, setSetting } from '@/db';
import {
  SCOREBOOK_PAGE_TEMPLATE,
  applyTemplate,
  isUsable,
  markedParts,
  templateForPhoto,
  emptyTeam,
  normalizeDate,
  readPage,
  seasonFor,
  type Game,
  type PageReading,
  type ScorebookTemplate,
  type Side,
} from '@inkstat/basketball';
import { extract, getActiveModelId } from '@/engine/host';
import { keepImage, newId } from '@/lib/files';
import { recognizePageText } from '../../modules/page-text';
import { Button, Card, ProgressBar, T } from '@/ui/components';
import { ReadingView, progressRect } from '@/ui/ReadingView';
import { useDialog } from '@/ui/Dialog';
import { base, fonts, space, useColors } from '@/ui/theme';

const REGION_LABELS: Record<string, string> = {
  ...Object.fromEntries(SCOREBOOK_PAGE_TEMPLATE.regions.map((r) => [r.id, r.label.toLowerCase()])),
  details: 'game details',
  timeouts: 'timeouts',
  team_fouls: 'team fouls',
  quarters: 'score by quarter',
};

/** uri / rect: the page being read and the part of it being read now, for the animation. */
type Status = { text: string; detail: string; fraction: number; startedAt: number; uri?: string; rect?: NormRect | null } | null;

const KEEP_AWAKE_TAG = 'inkstat-reading';

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
  const dialog = useDialog();
  const [pages, setPages] = useState<Record<Side, string | null>>({ home: null, away: null });
  // A guided flow: home page first, then the away page (or skip it), then read.
  const [tab, setTab] = useState<Side>('home');
  const [skipped, setSkipped] = useState<Record<Side, boolean>>({ home: false, away: false });
  const done = (side: Side) => !!pages[side] || skipped[side];
  const ready = done('home') && done('away') && (!!pages.home || !!pages.away);
  const pageCount = (pages.home ? 1 : 0) + (pages.away ? 1 : 0);
  const [layout, setLayout] = useState<ScorebookTemplate | null>(null);
  const [templateCount, setTemplateCount] = useState(0);

  // Re-read after returning from the template screens.
  useFocusEffect(
    useCallback(() => {
      getActiveTemplate(db).then((t) => setLayout(t && isUsable(t) ? t : null));
      listTemplates(db).then((all) => setTemplateCount(all.length));
    }, [db]),
  );
  const [status, setStatus] = useState<Status>(null);
  const { width: screenW, height: screenH } = useWindowDimensions();
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
        void dialog.notice('Camera access needed', 'Allow camera access in Settings, or choose a photo instead.');
        return;
      }
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    if (!result.canceled) {
      setPages((p) => ({ ...p, [side]: result.assets[0].uri }));
      setSkipped((k) => ({ ...k, [side]: false }));
    }
  };

  const read = async () => {
    abort.current = new AbortController();
    const signal = abort.current.signal;
    const id = newId();
    // If Android kills InkStat for memory mid-read, nothing in JS runs; this marker lets
    // the next launch explain what happened instead of silently landing on Home.
    await setSetting(db, READ_IN_PROGRESS_KEY, String(Date.now()));
    // A read takes minutes. If the screen locks, Android demotes InkStat to a cached
    // process, the first thing it kills to free memory; keep the screen on until done.
    await activateKeepAwakeAsync(KEEP_AWAKE_TAG).catch(() => undefined);
    try {
      const modelId = await getActiveModelId(db);
      const sides = (['home', 'away'] as const).filter((s) => pages[s]);
      const readings: Partial<Record<Side, PageReading>> = {};
      const startedAt = Date.now();

      for (const [i, side] of sides.entries()) {
        const uri = keepImage(pages[side]!, id, side);
        // Line the template up with this photo by its printed labels (or recognise a
        // built-in book when there is no template); otherwise use the boxes as saved.
        const lines = await recognizePageText(uri);
        const chosen = templateForPhoto(layout, lines);
        console.log(`[scan] ${side} template: ${chosen.source}${chosen.detail ? ` (${chosen.detail})` : ''}`);
        const template = chosen.template ? applyTemplate(SCOREBOOK_PAGE_TEMPLATE, chosen.template) : SCOREBOOK_PAGE_TEMPLATE;
        const run = await extract(modelId, uri, template, {
          signal,
          onModelLoad: (f) =>
            setStatus({ text: 'Loading the reading model…', detail: '', fraction: f, startedAt, uri, rect: null }),
          onProgress: (p) => {
            // One device-log line per crop: the only way to time a run on a phone.
            if (p.phase !== 'writing') {
              console.log(`[scan] ${side} ${p.phase} ${p.done + 1}/${p.total} ${p.regionId} +${Date.now() - startedAt}ms`);
            }
            setStatus({
              ...describeProgress(side, p),
              fraction: (i + (p.done + cropFraction(p)) / Math.max(1, p.total)) / sides.length,
              startedAt,
              uri,
              rect: p.phase === 'finished' ? null : progressRect(template, p),
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
        void dialog.notice(
          'Some parts could not be read',
          `${failures.join('\n')}\n\nYou can fill these in by hand on the next screen.`,
        );
      } else if (notes.length) {
        void dialog.notice('Adjusted while reading', notes.join('\n'));
      }
      router.replace({ pathname: '/game/[id]', params: { id } });
    } catch (e) {
      if (!signal.aborted) void dialog.notice('Reading failed', e instanceof Error ? e.message : String(e));
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
        {status.uri && <ReadingView uri={status.uri} rect={status.rect ?? null} width={screenW - space.lg * 2} height={Math.round(screenH * 0.42)} />}
        <T style={base.h2}>{status.text}</T>
        <ProgressBar fraction={status.fraction} />
        <View style={[base.row, { justifyContent: 'space-between' }]}>
          <T muted style={base.small}>{status.detail}</T>
          <T muted style={[base.small, base.num]}>{elapsed}</T>
        </View>
        <T muted>This takes a minute or two per page on most phones. Keep InkStat open.</T>
        <Button title="Cancel" kind="secondary" onPress={() => abort.current?.abort()} />
      </View>
    );
  }

  return (
    <ScrollView style={[base.screen, { backgroundColor: c.bg }]} contentContainerStyle={base.content}>
      {/* Home | Away: each tab shows a check once its page is in. */}
      <View accessibilityRole="tablist" style={[styles.tabs, { backgroundColor: c.sunken }]}>
        {(['home', 'away'] as const).map((side) => {
          const selected = tab === side;
          return (
            <Pressable
              key={side}
              accessibilityRole="tab"
              accessibilityState={{ selected }}
              accessibilityLabel={`${side === 'home' ? 'Home' : 'Away'} team page${pages[side] ? ', photographed' : skipped[side] ? ', skipped' : ''}`}
              onPress={() => setTab(side)}
              style={[styles.tab, selected && { backgroundColor: c.card, borderColor: c.border }]}>
              <T style={{ fontFamily: fonts.bodySemiBold, color: selected ? c.text : c.muted }}>
                {`${side === 'home' ? '1 · Home team' : '2 · Away team'}`}
              </T>
              {pages[side] ? (
                <T style={{ color: c.ok, fontFamily: fonts.bodyBold }}>✓</T>
              ) : skipped[side] ? (
                <T muted style={base.small}>skipped</T>
              ) : null}
            </Pressable>
          );
        })}
      </View>

      <Card>
        <T style={base.h2}>{tab === 'home' ? 'Home team page' : 'Away team page'}</T>
        <T muted>
          {pages[tab]
            ? 'Check the whole page is in the photo and sharp. Retake it if not.'
            : 'Lay the page flat in good light and fill the frame with it.'}
        </T>
        {pages[tab] && <Image source={{ uri: pages[tab]! }} style={styles.preview} resizeMode="contain" />}
        <View style={base.row}>
          <View style={{ flex: 1 }}>
            <Button title={pages[tab] ? 'Retake' : 'Camera'} kind={pages[tab] ? 'secondary' : 'primary'} onPress={() => pick(tab, 'camera')} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Photos" kind="secondary" onPress={() => pick(tab, 'library')} />
          </View>
        </View>
        {/* The next step, so nobody stops after the home page. */}
        {tab === 'home' && pages.home && !done('away') && (
          <Button title="Next: away team →" onPress={() => setTab('away')} />
        )}
        {!pages[tab] && !skipped[tab] && (
          <Pressable
            onPress={() => {
              setSkipped((k) => ({ ...k, [tab]: true }));
              if (tab === 'home') setTab('away');
            }}
            accessibilityRole="button"
            style={{ minHeight: 44, justifyContent: 'center', alignItems: 'center' }}>
            <T style={{ color: c.accent, fontFamily: fonts.bodySemiBold }}>
              {tab === 'home' ? 'Skip: scan the away team only' : 'Skip: scan one team only'}
            </T>
          </Pressable>
        )}
      </Card>

      {(pages.home || pages.away) && (
        <Card>
          <View style={[base.row, { justifyContent: 'space-between' }]}>
            <T style={base.h2}>Template</T>
            <T muted>{layout ? layout.name : templateCount ? 'Not ready' : 'None'}</T>
          </View>
          <T muted>
            {layout
              ? `InkStat reads the ${markedParts(layout).length} parts you marked on this kind of scorebook.`
              : templateCount
                ? 'None of your templates can read pages yet: each needs player rows, names and points marked. Finish one, or make one from this photo.'
                : 'Show InkStat where each part of your scorebook is, once per kind of book. Reading is much more accurate afterwards.'}
          </T>
          {layout ? (
            <Button title="Change template" kind="secondary" onPress={() => router.push('/templates')} />
          ) : (
            <>
            {templateCount > 0 && <Button title="Finish a template" kind="secondary" onPress={() => router.push('/templates')} />}
            <Button
              title="Make a template from this photo"
              onPress={() => router.push({ pathname: '/template-editor', params: { uri: (pages.home ?? pages.away)! } })}
            />
            </>
          )}
        </Card>
      )}
      {ready ? (
        <View style={{ gap: space.xs }}>
          <T muted style={[base.small, { textAlign: 'center' }]}>
            {`Home ${pages.home ? '\u2713' : 'skipped'} \u00b7 Away ${pages.away ? '\u2713' : 'skipped'}`}
          </T>
          <Button title={pageCount === 2 ? 'Read both pages' : `Read the ${pages.home ? 'home' : 'away'} page`} onPress={read} />
        </View>
      ) : (
        <T muted style={[base.small, { textAlign: 'center' }]}>
          {!done('home') ? 'Start with the home team\u2019s page.' : 'Now the away team\u2019s page, or skip it.'}
        </T>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', height: 220, borderRadius: 8, marginVertical: space.xs },
  tabs: { flexDirection: 'row', borderRadius: 8, padding: 4, gap: 4 },
  tab: { flex: 1, minHeight: 44, borderRadius: 6, borderWidth: 1, borderColor: 'transparent', flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6 },
});
