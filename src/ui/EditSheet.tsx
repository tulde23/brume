import { useState } from 'react';
import { Image, KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, T } from './components';
import { fonts, radius, space, useColors } from './theme';

export interface SheetField {
  key: string;
  label: string;
  value: string;
  numeric?: boolean;
  /** Grid width share; fields flow in rows. Default 1. */
  flex?: number;
  /** Shown in red under the label: what was read and why to look. */
  flag?: string;
  placeholder?: string;
}

/**
 * InkStat's edit sheet: what the page shows at the top, the fields under it,
 * Save at the thumb. Used for a player row, team details and game details.
 */
export function EditSheet({
  visible,
  title,
  image,
  imageLabel,
  onImage,
  fields,
  footnote,
  onSave,
  onClose,
  remove,
}: {
  visible: boolean;
  title: string;
  image?: string | null;
  imageLabel?: string;
  /** Tap the crop to open it full screen with zoom. */
  onImage?: () => void;
  fields: SheetField[];
  /** Live feedback from the draft values, e.g. "With 2, player points add up to 50". */
  footnote?: (draft: Record<string, string>) => { text: string; ok: boolean } | null;
  onSave: (draft: Record<string, string>) => void;
  onClose: () => void;
  remove?: { label: string; onPress: () => void };
}) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [shown, setShown] = useState(false);
  if (visible !== shown) {
    // Opening: start from the current values (during render, not in an effect).
    setShown(visible);
    if (visible) setDraft(Object.fromEntries(fields.map((f) => [f.key, f.value])));
  }
  const note = footnote?.(draft) ?? null;

  return (
    <Modal visible={visible} transparent animationType="slide" statusBarTranslucent onRequestClose={onClose}>
      <Pressable accessibilityLabel="Close" onPress={onClose} style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(34,32,28,0.45)' }]} />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={{ flex: 1, justifyContent: 'flex-end' }} pointerEvents="box-none">
        <View style={[styles.sheet, { backgroundColor: c.card, borderColor: c.text, paddingBottom: insets.bottom + space.lg }]}>
          <View style={[styles.grab, { backgroundColor: c.border }]} />
          <View style={styles.head}>
            <T style={styles.title}>{title}</T>
            <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={styles.close}>
              <T style={{ fontSize: 22, lineHeight: 24 }}>×</T>
            </Pressable>
          </View>
          <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12 }}>
            {image ? (
              <View style={{ gap: 6 }}>
                <T muted style={styles.caption}>{`${imageLabel ?? 'On the page'} · tap to zoom`}</T>
                <Pressable onPress={onImage} accessibilityRole="imagebutton" accessibilityLabel="Open the page photo">
                  <Image source={{ uri: image }} style={[styles.crop, { borderColor: c.border, backgroundColor: c.sunken }]} resizeMode="contain" />
                </Pressable>
              </View>
            ) : null}
            <View style={styles.grid}>
              {fields.map((f) => (
                <View key={f.key} style={{ flexGrow: f.flex ?? 1, flexBasis: f.numeric ? 72 : 140, gap: 4 }}>
                  <T style={[styles.label, { color: f.flag ? c.error : c.muted }]}>{f.flag ? `${f.label} · ${f.flag}` : f.label}</T>
                  <TextInput
                    value={draft[f.key] ?? ''}
                    onChangeText={(v) => setDraft((d) => ({ ...d, [f.key]: v }))}
                    keyboardType={f.numeric ? 'number-pad' : 'default'}
                    placeholder={f.placeholder}
                    placeholderTextColor={c.muted}
                    selectTextOnFocus
                    accessibilityLabel={f.label}
                    style={[
                      styles.input,
                      f.numeric && { fontFamily: fonts.monoBold, fontSize: 19 },
                      { color: c.text, borderColor: f.flag ? c.error : c.border, backgroundColor: c.card },
                    ]}
                  />
                </View>
              ))}
            </View>
            {note ? (
              <T style={{ fontSize: 14, fontFamily: fonts.bodySemiBold, color: note.ok ? c.ok : c.warn }}>{note.text}</T>
            ) : null}
          </ScrollView>
          <View style={styles.row}>
            {remove ? (
              <Pressable accessibilityRole="button" onPress={remove.onPress} style={styles.remove}>
                <T style={{ color: c.error, fontFamily: fonts.bodySemiBold, fontSize: 16 }}>{remove.label}</T>
              </Pressable>
            ) : null}
            <View style={{ flex: 1 }}>
              <Button title="Save" onPress={() => onSave(draft)} />
            </View>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  sheet: {
    borderTopWidth: 1.5,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 12,
    maxHeight: '92%',
  },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2 },
  head: { flexDirection: 'row', alignItems: 'center' },
  title: { flex: 1, fontSize: 20, fontFamily: fonts.bodyBold },
  close: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  caption: { fontSize: 12.5, fontFamily: fonts.bodyBold, letterSpacing: 0.5, textTransform: 'uppercase' },
  crop: { width: '100%', height: 110, borderRadius: radius.sm, borderWidth: 1 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  label: { fontSize: 13, fontFamily: fonts.bodySemiBold },
  input: { minHeight: 48, borderWidth: 1.5, borderRadius: radius.md, paddingHorizontal: 12, fontSize: 17, fontFamily: fonts.bodySemiBold },
  row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  remove: { minHeight: 48, paddingHorizontal: 12, justifyContent: 'center' },
});
