import { isUsable, markedParts, type ScorebookTemplate } from '@inkstat/basketball';
import { router, useFocusEffect } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, View } from 'react-native';

import { deleteTemplate, getActiveTemplate, listTemplates, setActiveTemplate } from '@/db';
import { deleteGameImages } from '@/lib/files';
import { Badge, Card, T } from '@/ui/components';
import { useDialog } from '@/ui/Dialog';
import { base, fonts, space, useColors } from '@/ui/theme';

const HOW = [
  ['1', 'Photo', 'One clear, filled-in page'],
  ['2', 'Questions', 'What your page has on it'],
  ['3', 'Mark', 'Draw a box on each part'],
  ['4', 'Check', 'Test read, then save'],
];

export default function Templates() {
  const db = useSQLiteContext();
  const c = useColors();
  const dialog = useDialog();
  const [list, setList] = useState<ScorebookTemplate[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [all, active] = await Promise.all([listTemplates(db), getActiveTemplate(db)]);
    setList(all);
    setActiveId(active?.id ?? null);
  }, [db]);
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const remove = async (t: ScorebookTemplate) => {
    const ok = await dialog.confirm({
      title: 'Delete this template?',
      subject: { label: t.name },
      body: 'Games already read keep their results. Pages from this book will need a new template.',
      confirm: 'Delete template',
      cancel: 'Keep it',
      destructive: true,
    });
    if (!ok) return;
    await deleteTemplate(db, t.id);
    deleteGameImages(t.id);
    await load();
    dialog.toast({ text: `Deleted ${t.name}` });
  };

  const actions = (t: ScorebookTemplate) =>
    dialog.actions(
      t.name,
      [
        ...(isUsable(t) && t.id !== activeId
          ? [{
              label: 'Use by default',
              hint: 'Picked first when no page matches better',
              onPress: async () => {
                await setActiveTemplate(db, t.id);
                await load();
              },
            }]
          : []),
        { label: 'Edit', hint: 'Move boxes, add or remove parts', onPress: () => router.push({ pathname: '/template-editor', params: { id: t.id } }) },
        { label: 'Delete', destructive: true, onPress: () => void remove(t) },
      ],
      `${markedParts(t).length} of ${t.enabled.length} parts marked`,
    );

  return (
    <ScrollView style={[base.screen, { backgroundColor: c.bg }]} contentContainerStyle={[base.content, { gap: space.md }]}>
      <T muted>A template shows InkStat where each part of your scorebook is. Make one for each kind of book you use. It works for every page from that book.</T>

      {list.map((t) => {
        const active = t.id === activeId;
        const marked = markedParts(t).length;
        return (
          <Pressable
            key={t.id}
            onPress={() => actions(t)}
            accessibilityRole="button"
            accessibilityHint="Opens use, edit and delete"
            style={[styles.card, { backgroundColor: c.card, borderColor: active ? c.accent : c.border, borderWidth: active ? 1.5 : 1 }]}>
            {t.photoUri ? (
              <Image source={{ uri: t.photoUri }} style={styles.thumb} resizeMode="cover" />
            ) : (
              <View style={[styles.thumb, { backgroundColor: c.sunken }]} />
            )}
            <View style={{ flex: 1, gap: 6 }}>
              <View style={[base.row, { justifyContent: 'space-between' }]}>
                <T style={{ fontFamily: fonts.bodySemiBold, fontSize: 16, flex: 1 }}>{t.name}</T>
                {active && <Badge tone="ok" label="In use" />}
              </View>
              <T muted style={base.small}>{`${marked} of ${t.enabled.length} parts marked${t.test ? ` · tested ${t.test.seconds} s` : ''}`}</T>
              {!isUsable(t) ? (
                <Badge tone="error" label="Needs rows, names and points" />
              ) : !t.test ? (
                <Badge tone="warn" label="Not tested yet" />
              ) : t.test.problems ? (
                <Badge tone="warn" label={`Test read: ${t.test.problems} to check`} />
              ) : (
                <Badge tone="ok" label="Test read passed" />
              )}
            </View>
          </Pressable>
        );
      })}

      <Pressable
        onPress={() => router.push('/template-editor')}
        accessibilityRole="button"
        style={[styles.newButton, { borderColor: c.accent }]}>
        <T style={{ color: c.accent, fontFamily: fonts.bodySemiBold, fontSize: 16 }}>+ New template</T>
      </Pressable>

      <Card>
        <T style={{ fontFamily: fonts.bodyBold }}>How it works</T>
        <View style={[base.row, { alignItems: 'flex-start' }]}>
          {HOW.map(([n, title, text]) => (
            <View key={n} style={{ flex: 1, alignItems: 'center', gap: 4 }}>
              <View style={[styles.num, { backgroundColor: c.accent + '22' }]}>
                <T style={{ color: c.accent, fontFamily: fonts.mono }}>{n}</T>
              </View>
              <T style={{ fontSize: 13, fontFamily: fonts.bodySemiBold }}>{title}</T>
              <T muted style={{ fontSize: 12, textAlign: 'center', lineHeight: 16 }}>{text}</T>
            </View>
          ))}
        </View>
      </Card>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  card: { flexDirection: 'row', gap: 14, alignItems: 'center', padding: 14, borderRadius: 16 },
  thumb: { width: 96, height: 66, borderRadius: 6 },
  newButton: { minHeight: 56, borderRadius: 14, borderWidth: 1.5, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  num: { width: 32, height: 32, borderRadius: 16, alignItems: 'center', justifyContent: 'center' },
});
