import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useMemo, useState } from 'react';
import { Alert, FlatList, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Svg, { Path } from 'react-native-svg';

import { READ_IN_PROGRESS_KEY, clearSetting, deleteGame, getSetting, listGames } from '@/db';
import { perGame, seasonFor, seasonTotals, teamScore, validateGame, type Game } from '@brume/basketball';
import { activeModel, type ActiveModel } from '@/engine/host';
import { Badge, Button, Card, StatusDot, T } from '@/ui/components';
import { deleteGameImages } from '@/lib/files';
import { Logo } from '@/ui/Logo';
import { base, fonts, space, useColors } from '@/ui/theme';

export default function Home() {
  const db = useSQLiteContext();
  const c = useColors();
  const [games, setGames] = useState<Game[]>([]);
  const [model, setModel] = useState<ActiveModel | null>(null);
  const [killedMidRead, setKilledMidRead] = useState(false);

  useFocusEffect(
    useCallback(() => {
      let live = true;
      (async () => {
        const current = await activeModel(db);
        const list = await listGames(db);
        const interrupted = (await getSetting(db, READ_IN_PROGRESS_KEY)) !== null;
        if (!live) return;
        setModel(current);
        setGames(list);
        setKilledMidRead(interrupted);
      })();
      return () => {
        live = false;
      };
    }, [db]),
  );

  const remove = (game: Game) =>
    Alert.alert(
      'Delete this game?',
      `${game.home.name ?? 'Home'} vs ${game.away.name ?? 'Away'}${game.date ? `, ${game.date}` : ''}. The box score and page photos will be removed.`,
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await deleteGame(db, game.id);
            deleteGameImages(game.id);
            setGames((list) => list.filter((g) => g.id !== game.id));
          },
        },
      ],
    );

  const season = seasonFor(null);
  const top = useMemo(() => seasonTotals(games.filter((g) => g.season === season))[0], [games, season]);

  return (
    <SafeAreaView style={[base.screen, { backgroundColor: c.bg }]} edges={['top']}>
      <FlatList
        contentContainerStyle={base.content}
        data={games}
        keyExtractor={(g) => g.id}
        ListHeaderComponent={
          <View style={{ gap: space.lg }}>
            <View style={styles.between}>
              <Logo size={28} />
              <View style={base.row}>
              <Pressable
                onPress={() => router.push('/sync')}
                accessibilityRole="button"
                accessibilityLabel="Sync with server"
                style={styles.iconButton}>
                <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c.text} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                  <Path d="M7 18a4.5 4.5 0 0 1-.6-8.96A6 6 0 0 1 18 9.5a4 4 0 0 1-1 8.5" />
                  <Path d="M12 12v8M9 15l3-3 3 3" />
                </Svg>
              </Pressable>
              <Pressable
                onPress={() => router.push('/models')}
                accessibilityRole="button"
                accessibilityLabel="Reading model settings"
                style={styles.iconButton}>
                <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c.text} strokeWidth={2} strokeLinecap="round">
                  <Path d="M4 7h10M18 7h2M4 17h4M12 17h8" />
                  <Path d="M16 5v4M10 15v4" />
                </Svg>
              </Pressable>
              </View>
            </View>

            {killedMidRead && (
              <Card style={{ backgroundColor: c.errorBg, borderColor: c.error }}>
                <T style={[base.h2, { color: c.error }]}>Reading was interrupted</T>
                <T>
                  Android closed Brume while it was reading a page, almost always because the phone ran
                  low on memory. Close other apps and try again.
                  {model?.approxRamBytes ? ` ${model.name} needs about ${(model.approxRamBytes / 1e9).toFixed(1)} GB free.` : ''}
                </T>
                <Button
                  title="OK"
                  kind="secondary"
                  onPress={() => {
                    setKilledMidRead(false);
                    void clearSetting(db, READ_IN_PROGRESS_KEY);
                  }}
                />
              </Card>
            )}

            {model && !model.ready ? (
              <Card style={{ backgroundColor: c.warnBg, borderColor: c.warnLine }}>
                <T style={base.h2}>Download the reading model</T>
                <T>
                  Brume reads scoresheets entirely on this phone. It needs a one-time download of {model.name}{' '}
                  first. Use Wi-Fi.
                </T>
                <Button title="Set up model" onPress={() => router.push('/models')} />
              </Card>
            ) : (
              <View style={{ gap: space.sm }}>
                <Button
                  title="Scan a game"
                  size="lg"
                  onPress={() => router.push('/scan')}
                  icon={
                    <Svg width={22} height={22} viewBox="0 0 24 24" fill="none" stroke={c.accentText} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
                      <Path d="M3 8V5a2 2 0 0 1 2-2h3M16 3h3a2 2 0 0 1 2 2v3M21 16v3a2 2 0 0 1-2 2h-3M8 21H5a2 2 0 0 1-2-2v-3" />
                      <Path d="M7 12h10" />
                    </Svg>
                  }
                />
                {model && (
                  <View style={base.row}>
                    <StatusDot tone="ok" />
                    <T muted style={base.small}>
                      {model.name} ready · runs on this phone
                    </T>
                  </View>
                )}
              </View>
            )}

            <View style={base.row}>
              <Pressable style={{ flex: 1 }} onPress={() => router.push('/season')} accessibilityRole="button">
                <Card style={styles.tile}>
                  <T muted style={base.small}>{season} games</T>
                  <T style={[base.num, { fontSize: 26 }]}>{games.filter((g) => g.season === season).length}</T>
                </Card>
              </Pressable>
              <Pressable style={{ flex: 1 }} onPress={() => router.push('/season')} accessibilityRole="button">
                <Card style={styles.tile}>
                  <T muted style={base.small}>Top scorer</T>
                  <T style={[base.num, { fontSize: 26 }]}>{top ? perGame(top.points, top.games) : '–'}</T>
                  {top && (
                    <T muted style={base.small}>
                      {top.number ? `#${top.number} ` : ''}
                      {top.name ?? ''} · ppg
                    </T>
                  )}
                </Card>
              </Pressable>
            </View>

            <View style={styles.between}>
              <T style={base.h2}>Recent games</T>
              <Pressable onPress={() => router.push('/season')} accessibilityRole="link" hitSlop={12}>
                <T style={{ color: c.accent, fontFamily: fonts.bodySemiBold }}>Season</T>
              </Pressable>
            </View>
            {games.length === 0 ? (
              <T muted>No games yet. Scan a scorebook page to get started.</T>
            ) : (
              <T muted style={base.small}>Press and hold a game to delete it.</T>
            )}
          </View>
        }
        renderItem={({ item }) => <GameRow game={item} onDelete={() => remove(item)} />}
        ItemSeparatorComponent={() => <View style={{ height: space.sm + 2 }} />}
      />
    </SafeAreaView>
  );
}

function GameRow({ game, onDelete }: { game: Game; onDelete: () => void }) {
  const issues = validateGame(game);
  const errors = issues.filter((i) => i.severity === 'error').length;
  return (
    <Pressable
      onPress={() => router.push({ pathname: '/game/[id]', params: { id: game.id } })}
      onLongPress={onDelete}
      accessibilityRole="button"
      accessibilityHint="Press and hold to delete"
      accessibilityActions={[{ name: 'delete', label: 'Delete game' }]}
      onAccessibilityAction={(e) => e.nativeEvent.actionName === 'delete' && onDelete()}>
      <Card style={styles.gameRow}>
        <View style={{ flex: 1, gap: 4 }}>
          <T style={{ fontFamily: fonts.bodySemiBold, fontSize: 16 }}>
            {game.home.name ?? 'Home'} vs {game.away.name ?? 'Away'}
          </T>
          <T muted style={base.small}>{game.date ?? 'No date'}</T>
        </View>
        <View style={{ alignItems: 'flex-end', gap: 4 }}>
          <T style={[base.num, { fontSize: 17 }]}>
            {teamScore(game.home) ?? '–'}–{teamScore(game.away) ?? '–'}
          </T>
          {errors > 0 ? (
            <Badge tone="error" label={`${errors} error${errors === 1 ? '' : 's'}`} />
          ) : issues.length > 0 ? (
            <Badge tone="warn" label={`${issues.length} to check`} />
          ) : (
            <Badge tone="ok" label="Checked" />
          )}
        </View>
      </Card>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  between: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  iconButton: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  tile: { padding: 14, gap: 4 },
  gameRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 14 },
});
