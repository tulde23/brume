import { router } from 'expo-router';
import * as ImagePicker from 'expo-image-picker';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useRef, useState } from 'react';
import { Alert, Image, Platform, ScrollView, StyleSheet, View } from 'react-native';

import { saveGame } from '@/db';
import {
  SCOREBOOK_PAGE_TEMPLATE,
  emptyTeam,
  normalizeDate,
  readPage,
  seasonFor,
  type Game,
  type PageReading,
  type Side,
} from '@/domains/basketball';
import { extract, getActiveModelId } from '@/engine/host';
import { keepImage, newId } from '@/lib/files';
import { Button, Card, ProgressBar, T } from '@/ui/components';
import { base, space, useColors } from '@/ui/theme';

const REGION_LABELS: Record<string, string> = Object.fromEntries(
  SCOREBOOK_PAGE_TEMPLATE.regions.map((r) => [r.id, r.label.toLowerCase()]),
);

type Status = { text: string; fraction: number } | null;

export default function Scan() {
  const db = useSQLiteContext();
  const c = useColors();
  const [pages, setPages] = useState<Record<Side, string | null>>({ home: null, away: null });
  const [status, setStatus] = useState<Status>(null);
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
    try {
      const modelId = await getActiveModelId(db);
      const sides = (['home', 'away'] as const).filter((s) => pages[s]);
      const readings: Partial<Record<Side, PageReading>> = {};

      for (const [i, side] of sides.entries()) {
        const uri = keepImage(pages[side]!, id, side);
        const run = await extract(modelId, uri, SCOREBOOK_PAGE_TEMPLATE, {
          signal,
          onModelLoad: (f) => setStatus({ text: 'Loading the reading model…', fraction: f }),
          onProgress: (p) =>
            setStatus({
              text: `Reading ${side} page: ${REGION_LABELS[p.regionId] ?? 'finishing'}`,
              fraction: (i + p.done / p.total) / sides.length,
            }),
        });
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
      if (failures.length) {
        Alert.alert(
          'Some parts could not be read',
          `${failures.join('\n')}\n\nYou can fill these in by hand on the next screen.`,
        );
      }
      router.replace({ pathname: '/game/[id]', params: { id } });
    } catch (e) {
      if (!signal.aborted) Alert.alert('Reading failed', e instanceof Error ? e.message : String(e));
    } finally {
      setStatus(null);
      abort.current = null;
    }
  };

  if (status) {
    return (
      <View style={[base.screen, base.content, { backgroundColor: c.bg, justifyContent: 'center' }]}>
        <T style={base.h2}>{status.text}</T>
        <ProgressBar fraction={status.fraction} />
        <T muted>This takes a minute or two per page. Keep Brume open.</T>
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
      <Button title="Read pages" onPress={read} disabled={!pages.home && !pages.away} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  preview: { width: '100%', height: 220, borderRadius: 8, marginVertical: space.xs },
});
