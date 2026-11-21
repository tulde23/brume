import type { ExtractionProgress, NormRect } from '@inkstat/ocr-engine';
import { router, useFocusEffect } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Image, Platform, Pressable, ScrollView, StyleSheet, useWindowDimensions, View } from 'react-native';

import { READ_IN_PROGRESS_KEY, clearSetting, getActiveTemplate, getSetting, listTemplates, saveGame, setSetting } from '@/db';
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
import { splitPage, type HomeAt } from '@/lib/splitPage';
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
  const insets = useSafeAreaInsets();
  const dialog = useDialog();
  // A few plain questions, one screen each:
  //   1. one page with both teams, or a page per team?
  //   2. one page: where is the home team on it?  /  a page per team: both photos.
  //   3. one page: the photo.
  // A page per team needs both photos before going on; any photo can be replaced.
  const [book, setBook] = useState<Book | null>(null);
  const [homeAt, setHomeAt] = useState<HomeAt | null>(null);
  const [last, setLast] = useState<{ book?: Book; homeAt?: HomeAt }>({});
  const [pages, setPages] = useState<Record<Side, string | null>>({ home: null, away: null });
  const [sheet, setSheet] = useState<string | null>(null);
  const ready = book === 'separate' ? !!pages.home && !!pages.away : book === 'combined' ? !!sheet && !!homeAt : false;

  useEffect(() => {
    void Promise.all([getSetting(db, BOOK_KEY), getSetting(db, HOME_AT_KEY)]).then(([b, h]) =>
      setLast({ book: (b as Book | null) ?? undefined, homeAt: (h as HomeAt | null) ?? undefined }),
    );
  }, [db]);
  const chooseBook = (b: Book) => {
    setBook(b);
    void setSetting(db, BOOK_KEY, b);
  };
  const chooseHomeAt = (h: HomeAt) => {
    setHomeAt(h);
    void setSetting(db, HOME_AT_KEY, h);
  };
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

  /** Asks camera or photos, then puts the picture in its slot. */
  const addPhoto = (slot: Side | 'sheet') => {
    const what = slot === 'sheet' ? 'the scoresheet' : slot === 'home' ? 'the home team’s page' : 'the away team’s page';
    const put = async (source: 'camera' | 'library') => {
      const uri = await pick(source);
      if (!uri) return;
      if (slot === 'sheet') setSheet(uri);
      else setPages((p) => ({ ...p, [slot]: uri }));
    };
    dialog.actions(`Add ${what}`, [
      { label: 'Take a photo', hint: 'Flat, in good light, filling the frame', onPress: () => void put('camera') },
      { label: 'Choose from Photos', hint: 'A picture you already took', onPress: () => void put('library') },
    ]);
  };

  /** The photo to read for each team. A shared page is cut into its two halves. */
  const teamPhotos = async (): Promise<Partial<Record<Side, string>>> =>
    book === 'combined' && sheet && homeAt
      ? splitPage(sheet, homeAt)
      : { ...(pages.home ? { home: pages.home } : {}), ...(pages.away ? { away: pages.away } : {}) };

  const makeTemplate = async () => {
    const photos = await teamPhotos();
    const uri = photos.home ?? photos.away;
    if (uri) router.push({ pathname: '/template-editor', params: { uri } });
  };

  const pick = async (source: 'camera' | 'library'): Promise<string | null> => {
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
        return null;
      }
    }
    const result =
      source === 'camera'
        ? await ImagePicker.launchCameraAsync(options)
        : await ImagePicker.launchImageLibraryAsync(options);
    return result.canceled ? null : result.assets[0].uri;
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
      const startedAt = Date.now();
      setStatus({ text: 'Getting the pages ready…', detail: '', fraction: 0, startedAt, uri: sheet ?? pages.home ?? undefined, rect: null });
      const photos = await teamPhotos();
      const modelId = await getActiveModelId(db);
      const sides = (['home', 'away'] as const).filter((s) => photos[s]);
      const readings: Partial<Record<Side, PageReading>> = {};

      for (const [i, side] of sides.entries()) {
        const uri = keepImage(photos[side]!, id, side);
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

  const step = book === null ? 'layout' : book === 'combined' && !homeAt ? 'where' : 'photos';
  const stepNo = step === 'layout' ? 1 : step === 'where' || book === 'separate' ? 2 : 3;

  const missing =
    book === 'combined'
      ? 'Add a photo of the scoresheet to continue.'
      : !pages.home && !pages.away
        ? 'Add both teams’ pages to continue.'
        : !pages.home
          ? 'Add the home team’s page to continue.'
          : 'Add the away team’s page to continue.';

  return (
    <View style={[base.screen, { backgroundColor: c.bg }]}>
      <ScrollView contentContainerStyle={[base.content, { paddingBottom: step === 'photos' ? 140 : space.xl }]}>
        <View style={[base.row, { justifyContent: 'space-between' }]}>
          <View style={styles.progress}>
            {[1, 2, 3].map((n) => (
              <View key={n} style={[styles.progressBar, { backgroundColor: n <= stepNo ? c.accent : c.border }]} />
            ))}
          </View>
          <T muted style={styles.stepLabel}>{`STEP ${stepNo} OF 3`}</T>
        </View>

        {/* Answers so far, each with Change */}
        {book && <Answer text={BOOK_LABEL[book]} onChange={() => { setBook(null); setHomeAt(null); }} />}
        {book === 'combined' && homeAt && <Answer text={`Home team on the ${homeAt}`} onChange={() => setHomeAt(null)} />}

        {step === 'layout' && (
          <>
            <T style={styles.question}>How is this game’s scoresheet laid out?</T>
            <T muted style={styles.lead}>Look at the paper. This tells InkStat how many photos to ask for.</T>
            {(['separate', 'combined'] as const).map((b) => (
              <Choice
                key={b}
                title={BOOK_LABEL[b]}
                body={b === 'separate' ? 'You’ll add two photos.' : 'You’ll add one photo.'}
                tag={last.book === b ? 'Same as last time' : undefined}
                picture={<Diagram kind={b} />}
                onPress={() => chooseBook(b)}
              />
            ))}
            <View style={[styles.tip, { backgroundColor: c.sunken }]}>
              <T muted style={{ fontSize: 14 }}>Not sure? Most high school scorebooks give each team its own page, side by side.</T>
            </View>
          </>
        )}

        {step === 'where' && (
          <>
            <T style={styles.question}>Where is the home team on the page?</T>
            <T muted style={styles.lead}>InkStat cuts the photo in two and reads each team’s half.</T>
            <View style={styles.grid}>
              {(['top', 'bottom', 'left', 'right'] as const).map((h) => (
                <Choice
                  key={h}
                  compact
                  title={`${h[0].toUpperCase()}${h.slice(1)}`}
                  tag={last.homeAt === h ? 'Last time' : undefined}
                  picture={<Diagram kind={h} />}
                  onPress={() => chooseHomeAt(h)}
                />
              ))}
            </View>
            <T muted style={base.small}>Home is usually marked HOME or H next to the team name.</T>
          </>
        )}

        {step === 'photos' && (
          <>
            <T style={styles.question}>{book === 'separate' ? 'Add both teams’ pages' : 'Add the scoresheet'}</T>
            <T muted style={styles.lead}>
              {book === 'separate'
                ? 'Lay each page flat in good light. Get the whole page in, with the writing sharp.'
                : 'Lay the page flat in good light. Get both teams in, with the writing sharp.'}
            </T>
            {book === 'separate' ? (
              <View style={[base.row, { alignItems: 'flex-start', gap: space.md }]}>
                {(['home', 'away'] as const).map((side) => (
                  <PhotoSlot key={side} label={side === 'home' ? 'Home team' : 'Away team'} uri={pages[side]} onPress={() => addPhoto(side)} />
                ))}
              </View>
            ) : (
              <PhotoSlot label="Both teams" wide uri={sheet} onPress={() => addPhoto('sheet')} />
            )}

            {/* The template: what makes reading accurate. */}
            <Card>
              <View style={[base.row, { justifyContent: 'space-between' }]}>
                <View style={{ flex: 1 }}>
                  <T style={[styles.overline, { color: layout ? c.ok : c.muted }]}>
                    {layout ? 'Template · ready' : templateCount ? 'Template · not finished' : 'Template · none yet'}
                  </T>
                  <T style={{ fontFamily: fonts.bodySemiBold, fontSize: 15 }}>
                    {layout ? layout.name : 'InkStat will guess where things are'}
                  </T>
                </View>
                {layout && (
                  <Pressable onPress={() => router.push('/templates')} accessibilityRole="button" hitSlop={8} style={{ minHeight: 44, justifyContent: 'center' }}>
                    <T style={{ color: c.accent, fontFamily: fonts.bodySemiBold }}>Change</T>
                  </Pressable>
                )}
              </View>
              {layout ? (
                <T muted style={base.small}>{`Reads the ${markedParts(layout).length} parts you showed it on this kind of scoresheet.`}</T>
              ) : (
                <>
                  <T muted style={base.small}>
                    {templateCount
                      ? 'Your template needs the player rows, names and points shown before it can help.'
                      : 'A template shows InkStat where things are on your scoresheet. Make one once per kind of book, about two minutes, and every scan reads much better.'}
                  </T>
                  {templateCount > 0 ? (
                    <Button title="Finish my template" kind="secondary" onPress={() => router.push('/templates')} />
                  ) : (
                    <Button title="Make a template from this photo" kind="secondary" disabled={!(sheet || pages.home || pages.away)} onPress={() => void makeTemplate()} />
                  )}
                </>
              )}
            </Card>
          </>
        )}
      </ScrollView>

      {step === 'photos' && (
        <View style={[styles.footer, { backgroundColor: c.bg, borderTopColor: c.border, paddingBottom: space.md + insets.bottom }]}>
          <Button title="Continue: read the scoresheet" size="lg" disabled={!ready} onPress={read} />
          {!ready && <T muted style={[base.small, { textAlign: 'center' }]}>{missing}</T>}
        </View>
      )}
    </View>
  );
}

type Book = 'separate' | 'combined';
const BOOK_KEY = 'scan.book';
const HOME_AT_KEY = 'scan.homeAt';
const BOOK_LABEL: Record<Book, string> = {
  separate: 'Each team has its own page',
  combined: 'Both teams on one page',
};

function Answer({ text, onChange }: { text: string; onChange: () => void }) {
  const c = useColors();
  return (
    <View style={[base.row, { minHeight: 32 }]}>
      <T style={{ color: c.ok, fontFamily: fonts.bodyBold }}>✓</T>
      <T muted style={{ flex: 1, fontSize: 14 }}>{text}</T>
      <Pressable onPress={onChange} accessibilityRole="button" accessibilityLabel={`Change: ${text}`} hitSlop={10} style={{ minHeight: 44, justifyContent: 'center' }}>
        <T style={{ color: c.accent, fontFamily: fonts.bodySemiBold }}>Change</T>
      </Pressable>
    </View>
  );
}

function Choice({
  title,
  body,
  tag,
  picture,
  compact,
  onPress,
}: {
  title: string;
  body?: string;
  tag?: string;
  picture: React.ReactNode;
  compact?: boolean;
  onPress: () => void;
}) {
  const c = useColors();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={[title, body, tag].filter(Boolean).join('. ')}
      onPress={onPress}
      style={({ pressed }) => [
        compact ? styles.choiceCompact : styles.choice,
        { borderColor: tag ? c.accent : c.border, borderWidth: tag ? 2 : 1.5, backgroundColor: pressed ? c.sunken : c.card },
      ]}>
      {picture}
      <View style={compact ? { alignItems: 'center', gap: 2 } : { flex: 1, gap: 3 }}>
        <T style={{ fontFamily: fonts.bodyBold, fontSize: 16 }}>{title}</T>
        {body && <T muted style={{ fontSize: 14 }}>{body}</T>}
        {tag && <T style={[base.small, { color: c.accent, fontFamily: fonts.bodySemiBold }]}>{tag}</T>}
      </View>
      {!compact && <T style={{ fontSize: 22, color: tag ? c.accent : c.muted }}>›</T>}
    </Pressable>
  );
}

/** A small drawing of the page(s): ruled lines, with the home team's part highlighted. */
function Diagram({ kind }: { kind: Book | HomeAt }) {
  const c = useColors();
  const narrow = kind === 'left' || kind === 'right';
  const part = (home: boolean) => (
    <View style={{ flex: 1, padding: 3, justifyContent: 'center', backgroundColor: home ? c.warnBg : c.card }}>
      <T style={{ fontSize: 8, fontFamily: fonts.bodyBold, color: home ? c.warn : c.muted, textAlign: 'center' }}>{narrow ? (home ? 'H' : 'A') : home ? 'HOME' : 'AWAY'}</T>
      <View style={[styles.rule, { backgroundColor: c.border }]} />
      <View style={[styles.rule, { backgroundColor: c.border }]} />
    </View>
  );
  const page = (children: React.ReactNode, across = false, size = styles.page) => (
    <View style={[size, { borderColor: c.muted, flexDirection: across ? 'row' : 'column' }]}>{children}</View>
  );
  if (kind === 'separate') {
    return (
      <View style={{ flexDirection: 'row', gap: 4 }}>
        {page(part(true), false, styles.pageSmall)}
        {page(part(false), false, styles.pageSmall)}
      </View>
    );
  }
  const across = kind === 'left' || kind === 'right';
  const homeFirst = kind === 'combined' || kind === 'top' || kind === 'left';
  const divider = <View style={across ? { width: 1, backgroundColor: c.muted } : { height: 1, backgroundColor: c.muted }} />;
  return (
    <View style={kind === 'combined' ? { width: 92, alignItems: 'center' } : undefined}>
      {page(
        <>
          {part(homeFirst)}
          {divider}
          {part(!homeFirst)}
        </>,
        across,
      )}
    </View>
  );
}

/** An empty dashed slot to add a photo, or the photo with Replace. */
function PhotoSlot({ label, uri, wide, onPress }: { label: string; uri: string | null; wide?: boolean; onPress: () => void }) {
  const c = useColors();
  return (
    <View style={{ flex: 1, gap: space.xs }}>
      <View style={[base.row, { gap: 6 }]}>
        <T style={{ fontFamily: fonts.bodyBold }}>{label}</T>
        {uri && <T style={{ color: c.ok, fontFamily: fonts.bodyBold }}>✓</T>}
      </View>
      {uri ? (
        <>
          <Image source={{ uri }} style={[styles.slot, wide && styles.slotWide, { backgroundColor: c.sunken }]} resizeMode="contain" />
          <Button title="Replace" kind="secondary" onPress={onPress} />
        </>
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add the ${label.toLowerCase()} photo`}
          onPress={onPress}
          style={({ pressed }) => [
            styles.slot,
            wide && styles.slotWide,
            styles.empty,
            { borderColor: c.accent, backgroundColor: pressed ? c.sunken : 'transparent' },
          ]}>
          <T style={{ fontSize: 34, lineHeight: 38, color: c.accent }}>+</T>
          <T style={{ color: c.accent, fontFamily: fonts.bodySemiBold }}>Add photo</T>
          <T muted style={{ fontSize: 12 }}>Camera or Photos</T>
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  progress: { flexDirection: 'row', gap: 4, flex: 1, marginRight: space.md },
  progressBar: { flex: 1, height: 4, borderRadius: 2 },
  stepLabel: { fontFamily: fonts.monoBold, fontSize: 12 },
  question: { fontFamily: fonts.headingBold, fontSize: 24, lineHeight: 30, marginTop: space.xs },
  lead: { fontSize: 15 },
  tip: { borderRadius: 8, padding: space.md },
  choice: { flexDirection: 'row', alignItems: 'center', gap: 14, borderRadius: 10, padding: 14, minHeight: 104 },
  choiceCompact: { width: '47%', flexGrow: 1, alignItems: 'center', gap: space.sm, borderRadius: 10, paddingVertical: 14, paddingHorizontal: space.sm, minHeight: 140 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  page: { width: 52, height: 68, borderWidth: 1.5, borderRadius: 3, overflow: 'hidden' },
  pageSmall: { width: 44, height: 58, borderWidth: 1.5, borderRadius: 3, overflow: 'hidden' },
  rule: { height: 2, borderRadius: 1, marginTop: 4 },
  overline: { fontSize: 12, fontFamily: fonts.bodyBold, letterSpacing: 0.5, textTransform: 'uppercase' },
  slot: { width: '100%', height: 210, borderRadius: 8 },
  slotWide: { height: 260 },
  empty: { borderWidth: 2, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center', gap: 2 },
  footer: { position: 'absolute', left: 0, right: 0, bottom: 0, padding: space.lg, gap: space.xs, borderTopWidth: 1 },
});
