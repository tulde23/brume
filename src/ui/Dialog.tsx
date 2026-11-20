import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Modal, Pressable, StyleSheet, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Button, T } from './components';
import { fonts, radius, space, useColors } from './theme';

/**
 * InkStat's own dialogs, in place of the stock OS alert: a centered confirm or
 * notice, a bottom sheet of actions, and an undo toast. One at a time; each
 * returns a promise so callers read top to bottom.
 */

export interface ConfirmOptions {
  title: string;
  body?: string;
  /** Shown between the title and body, e.g. the game or template being deleted. */
  subject?: { label: string; value?: string };
  confirm: string;
  cancel?: string;
  destructive?: boolean;
}

export interface SheetAction {
  label: string;
  hint?: string;
  destructive?: boolean;
  onPress: () => void;
}

export interface ToastOptions {
  text: string;
  action?: { label: string; onPress: () => void };
  /** ms; default 5000. */
  duration?: number;
}

interface DialogApi {
  confirm(o: ConfirmOptions): Promise<boolean>;
  notice(title: string, body?: string): Promise<void>;
  actions(title: string, actions: SheetAction[], subtitle?: string): void;
  toast(o: ToastOptions): void;
}

type Open =
  | { kind: 'confirm'; o: ConfirmOptions; done: (ok: boolean) => void }
  | { kind: 'notice'; title: string; body?: string; done: () => void }
  | { kind: 'actions'; title: string; subtitle?: string; actions: SheetAction[] };

const Ctx = createContext<DialogApi | null>(null);

export function useDialog(): DialogApi {
  const api = useContext(Ctx);
  if (!api) throw new Error('useDialog needs a DialogProvider');
  return api;
}

export function DialogProvider({ children }: { children: ReactNode }) {
  const c = useColors();
  const insets = useSafeAreaInsets();
  const [open, setOpen] = useState<Open | null>(null);
  const [toast, setToast] = useState<(ToastOptions & { key: number }) | null>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
  }, []);

  const api = useMemo<DialogApi>(
    () => ({
      confirm: (o) => new Promise((resolve) => setOpen({ kind: 'confirm', o, done: resolve })),
      notice: (title, body) => new Promise((resolve) => setOpen({ kind: 'notice', title, body, done: resolve })),
      actions: (title, actions, subtitle) => setOpen({ kind: 'actions', title, subtitle, actions }),
      toast: (o) => {
        if (timer.current) clearTimeout(timer.current);
        setToast({ ...o, key: Date.now() });
        timer.current = setTimeout(() => setToast(null), o.duration ?? 5000);
      },
    }),
    [],
  );

  const close = useCallback(
    (ok: boolean) => {
      setOpen((cur) => {
        if (cur?.kind === 'confirm') cur.done(ok);
        if (cur?.kind === 'notice') cur.done();
        return null;
      });
    },
    [],
  );

  const sheet = open?.kind === 'actions';

  return (
    <Ctx.Provider value={api}>
      <View style={{ flex: 1 }}>
        {children}
        {toast && (
          <View pointerEvents="box-none" style={[StyleSheet.absoluteFill, { justifyContent: 'flex-end' }]}>
            <View
              accessibilityLiveRegion="polite"
              style={[styles.toast, { backgroundColor: c.text, marginBottom: insets.bottom + space.lg }]}>
              <T style={{ flex: 1, color: c.bg, fontSize: 14 }}>{toast.text}</T>
              {toast.action && (
                <Pressable
                  accessibilityRole="button"
                  onPress={() => {
                    toast.action?.onPress();
                    setToast(null);
                  }}
                  style={styles.toastAction}>
                  <T style={{ color: c.bg, fontFamily: fonts.bodyBold, textDecorationLine: 'underline' }}>{toast.action.label}</T>
                </Pressable>
              )}
            </View>
          </View>
        )}
      </View>

      <Modal
        visible={open !== null}
        transparent
        animationType={sheet ? 'slide' : 'fade'}
        statusBarTranslucent
        onRequestClose={() => close(false)}>
        <Pressable
          accessibilityLabel="Close"
          onPress={() => close(false)}
          style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(34,32,28,0.45)' }]}
        />
        {open && open.kind !== 'actions' && (
          <View pointerEvents="box-none" style={styles.center}>
            <View
              accessibilityRole="alert"
              style={[styles.dialog, { backgroundColor: c.card, borderColor: c.text }]}>
              <T style={styles.title}>{open.kind === 'confirm' ? open.o.title : open.title}</T>
              {open.kind === 'confirm' && open.o.subject && (
                <View style={[styles.subject, { backgroundColor: c.sunken }]}>
                  <T style={{ fontFamily: fonts.bodySemiBold, flex: 1 }}>{open.o.subject.label}</T>
                  {open.o.subject.value ? <T style={{ fontFamily: fonts.monoBold }}>{open.o.subject.value}</T> : null}
                </View>
              )}
              {(open.kind === 'confirm' ? open.o.body : open.body) ? (
                <T muted style={{ fontSize: 15, lineHeight: 21 }}>{open.kind === 'confirm' ? open.o.body : open.body}</T>
              ) : null}
              {open.kind === 'confirm' ? (
                <View style={[styles.row, { marginTop: space.xs }]}>
                  <View style={{ flex: 1 }}>
                    <Button title={open.o.cancel ?? 'Cancel'} kind="secondary" onPress={() => close(false)} />
                  </View>
                  <View style={{ flex: 1 }}>
                    <Button
                      title={open.o.confirm}
                      kind={open.o.destructive ? 'dangerSolid' : 'primary'}
                      onPress={() => close(true)}
                    />
                  </View>
                </View>
              ) : (
                <Button title="OK" onPress={() => close(true)} />
              )}
            </View>
          </View>
        )}
        {open?.kind === 'actions' && (
          <View pointerEvents="box-none" style={{ flex: 1, justifyContent: 'flex-end' }}>
            <View
              style={[
                styles.sheet,
                { backgroundColor: c.card, borderColor: c.text, paddingBottom: insets.bottom + space.lg },
              ]}>
              <View style={[styles.grab, { backgroundColor: c.border }]} />
              <T style={styles.title}>{open.title}</T>
              {open.subtitle ? <T muted>{open.subtitle}</T> : null}
              <View>
                {open.actions.map((a) => (
                  <Pressable
                    key={a.label}
                    accessibilityRole="button"
                    onPress={() => {
                      setOpen(null);
                      a.onPress();
                    }}
                    style={({ pressed }) => [styles.action, { borderColor: c.border, opacity: pressed ? 0.6 : 1 }]}>
                    <T style={{ fontSize: 16, fontFamily: fonts.bodySemiBold, color: a.destructive ? c.error : c.text }}>
                      {a.label}
                    </T>
                    {a.hint ? <T muted style={{ fontSize: 13 }}>{a.hint}</T> : null}
                  </Pressable>
                ))}
              </View>
              <Button title="Cancel" kind="secondary" onPress={() => setOpen(null)} />
            </View>
          </View>
        )}
      </Modal>
    </Ctx.Provider>
  );
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', padding: 20 },
  dialog: { borderWidth: 1.5, borderRadius: radius.lg, padding: 20, gap: 12 },
  title: { fontSize: 20, fontFamily: fonts.bodyBold },
  subject: { flexDirection: 'row', alignItems: 'baseline', gap: 8, borderRadius: radius.sm, paddingHorizontal: 12, paddingVertical: 10 },
  row: { flexDirection: 'row', gap: 10 },
  sheet: {
    borderTopWidth: 1.5,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    paddingHorizontal: 16,
    paddingTop: 8,
    gap: 10,
  },
  grab: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, marginBottom: 4 },
  action: { minHeight: 52, justifyContent: 'center', borderBottomWidth: 1, paddingVertical: 8 },
  toast: {
    marginHorizontal: 16,
    borderRadius: radius.md,
    minHeight: 52,
    paddingLeft: 14,
    paddingRight: 4,
    flexDirection: 'row',
    alignItems: 'center',
  },
  toastAction: { minHeight: 44, paddingHorizontal: 12, justifyContent: 'center' },
});
