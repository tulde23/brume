import { router, useLocalSearchParams } from 'expo-router';
import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Image, PanResponder, StyleSheet, useWindowDimensions, View } from 'react-native';

import { getScorebookLayout, saveScorebookLayout } from '@/db';
import { DEFAULT_LAYOUT, normalizeLayout, type ScorebookLayout } from '@brume/basketball';
import { Button, T } from '@/ui/components';
import { base, fonts, space, useColors } from '@/ui/theme';

type Step = 0 | 1 | 2;

const STEPS: { title: string; hint: string }[] = [
  {
    title: 'Box the player rows',
    hint: 'Drag the box and its corners so it covers every player row, but not the headers or the running-score grid.',
  },
  {
    title: 'Cover the name column',
    hint: 'Drag the band and its edges over the jersey numbers and player names.',
  },
  {
    title: 'Cover the total points column',
    hint: 'Drag the band over the TP / PTS column. Keep it narrow: just that column.',
  },
];

const HANDLE = 44;
const MIN = 0.02;
const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Drag helper: reports total movement since the touch began, as fractions of the image. */
function useDrag(size: { w: number; h: number }, onMove: (dx: number, dy: number) => void, onStart: () => void) {
  const latest = useRef({ onMove, onStart, size });
  useLayoutEffect(() => {
    latest.current = { onMove, onStart, size };
  });
  return useMemo(
    () =>
      // The ref is read only inside touch callbacks, never during render; the lint
      // rule cannot see that through PanResponder.create.
      // eslint-disable-next-line react-hooks/refs
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: () => latest.current.onStart(),
        onPanResponderMove: (_, g) => {
          const { w, h } = latest.current.size;
          if (w && h) latest.current.onMove(g.dx / w, g.dy / h);
        },
        onPanResponderTerminationRequest: () => false,
      }).panHandlers,
    [],
  );
}

export default function LayoutScreen() {
  const { uri } = useLocalSearchParams<{ uri?: string }>();
  const db = useSQLiteContext();
  const c = useColors();
  const { width: screenW, height: screenH } = useWindowDimensions();
  const [layout, setLayout] = useState<ScorebookLayout>(DEFAULT_LAYOUT);
  const [step, setStep] = useState<Step>(0);
  const [aspect, setAspect] = useState<number | null>(null);
  const start = useRef<ScorebookLayout>(DEFAULT_LAYOUT);

  useEffect(() => {
    getScorebookLayout(db).then((saved) => saved && setLayout(saved));
  }, [db]);

  useEffect(() => {
    if (uri) Image.getSize(uri, (w, h) => setAspect(w / h), () => setAspect(1.3));
  }, [uri]);

  // Fit the page in the space above the controls.
  const maxW = screenW - space.lg * 2;
  const maxH = screenH * 0.55;
  const size = aspect
    ? aspect >= maxW / maxH
      ? { w: maxW, h: maxW / aspect }
      : { w: maxH * aspect, h: maxH }
    : { w: 0, h: 0 };

  const begin = () => {
    start.current = layout;
  };
  const update = (fn: (s: ScorebookLayout) => ScorebookLayout) => setLayout(fn(start.current));

  const t = layout.table;
  // Table: move, and four corners.
  const tableMove = useDrag(size, (dx, dy) =>
    update((s) => ({
      ...s,
      table: { ...s.table, x: clamp(s.table.x + dx, 0, 1 - s.table.w), y: clamp(s.table.y + dy, 0, 1 - s.table.h) },
    })), begin);
  const corner = (cx: 0 | 1, cy: 0 | 1) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useDrag(size, (dx, dy) =>
      update((s) => {
        const r = s.table;
        let x0 = r.x, y0 = r.y, x1 = r.x + r.w, y1 = r.y + r.h;
        if (cx === 0) x0 = clamp(x0 + dx, 0, x1 - MIN * 5); else x1 = clamp(x1 + dx, x0 + MIN * 5, 1);
        if (cy === 0) y0 = clamp(y0 + dy, 0, y1 - MIN * 5); else y1 = clamp(y1 + dy, y0 + MIN * 5, 1);
        return { ...s, table: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
      }), begin);
  const corners = [corner(0, 0), corner(1, 0), corner(0, 1), corner(1, 1)];

  // Column bands: move, and left/right edges.
  const bandKey = step === 1 ? 'nameColumn' : 'pointsColumn';
  const bandMove = useDrag(size, (dx) =>
    update((s) => {
      const b = s[bandKey];
      return { ...s, [bandKey]: { ...b, x: clamp(b.x + dx, s.table.x, s.table.x + s.table.w - b.w) } };
    }), begin);
  const bandEdge = (side: 0 | 1) =>
    // eslint-disable-next-line react-hooks/rules-of-hooks
    useDrag(size, (dx) =>
      update((s) => {
        const b = s[bandKey];
        let x0 = b.x, x1 = b.x + b.w;
        if (side === 0) x0 = clamp(x0 + dx, s.table.x, x1 - MIN); else x1 = clamp(x1 + dx, x0 + MIN, s.table.x + s.table.w);
        return { ...s, [bandKey]: { x: x0, w: x1 - x0 } };
      }), begin);
  const edges = [bandEdge(0), bandEdge(1)];

  const px = (v: number, of: number) => v * of;
  const band = (b: { x: number; w: number }, active: boolean, color: string) => ({
    left: px(b.x, size.w),
    top: px(t.y, size.h),
    width: px(b.w, size.w),
    height: px(t.h, size.h),
    backgroundColor: color === 'transparent' ? color : color + (active ? '55' : '22'),
    borderColor: color,
    borderWidth: active ? 2 : 1,
  });

  const save = async () => {
    await saveScorebookLayout(db, normalizeLayout(layout));
    router.back();
  };

  if (!uri) {
    return (
      <View style={[base.screen, base.content, { backgroundColor: c.bg }]}>
        <T>Pick a page photo on the scan screen first, then set up the layout from there.</T>
      </View>
    );
  }

  return (
    <View style={[base.screen, { backgroundColor: c.bg }]}>
      <View style={[base.content, { paddingBottom: space.sm }]}>
        <T muted style={base.small}>
          Step {step + 1} of 3 · done once per kind of scorebook
        </T>
        <T style={base.h2}>{STEPS[step].title}</T>
        <T muted>{STEPS[step].hint}</T>
      </View>

      <View style={{ alignItems: 'center' }}>
        <View style={{ width: size.w, height: size.h }}>
          <Image source={{ uri }} style={{ width: size.w, height: size.h }} resizeMode="stretch" />

          {/* Player table box */}
          <View
            pointerEvents={step === 0 ? 'auto' : 'none'}
            style={[
              styles.box,
              {
                left: px(t.x, size.w),
                top: px(t.y, size.h),
                width: px(t.w, size.w),
                height: px(t.h, size.h),
                borderColor: c.accent,
                borderWidth: step === 0 ? 3 : 1.5,
                backgroundColor: step === 0 ? c.accent + '22' : 'transparent',
              },
            ]}
            {...tableMove}
            accessibilityLabel="Player table box"
          />

          {/* Column bands (shown once the table is set) */}
          {step >= 1 && (
            <View pointerEvents="none" style={[styles.box, band(layout.nameColumn, step === 1, c.ok)]} />
          )}
          {step >= 1 && (
            <View pointerEvents="none" style={[styles.box, band(layout.pointsColumn, step === 2, c.warnLine)]} />
          )}
          {step >= 1 && (
            <View
              style={[styles.box, band(layout[bandKey], true, 'transparent'), { borderWidth: 0 }]}
              {...bandMove}
              accessibilityLabel={step === 1 ? 'Name column band' : 'Points column band'}
            />
          )}

          {/* Handles */}
          {step === 0 &&
            ([
              [0, 0],
              [1, 0],
              [0, 1],
              [1, 1],
            ] as const).map(([cx, cy], i) => (
              <View
                key={i}
                {...corners[i]}
                style={[
                  styles.handle,
                  {
                    left: px(t.x + cx * t.w, size.w) - HANDLE / 2,
                    top: px(t.y + cy * t.h, size.h) - HANDLE / 2,
                  },
                ]}
                accessibilityLabel="Resize corner">
                <View style={[styles.dot, { backgroundColor: c.accent }]} />
              </View>
            ))}
          {step >= 1 &&
            ([0, 1] as const).map((side) => {
              const b = layout[bandKey];
              return (
                <View
                  key={side}
                  {...edges[side]}
                  style={[
                    styles.handle,
                    {
                      left: px(b.x + side * b.w, size.w) - HANDLE / 2,
                      top: px(t.y + t.h / 2, size.h) - HANDLE / 2,
                    },
                  ]}
                  accessibilityLabel={side === 0 ? 'Left edge' : 'Right edge'}>
                  <View style={[styles.bar, { backgroundColor: step === 1 ? c.ok : c.warnLine }]} />
                </View>
              );
            })}
        </View>
      </View>

      <View style={[base.content, base.row]}>
        <View style={{ flex: 1 }}>
          {step > 0 ? (
            <Button title="Back" kind="secondary" onPress={() => setStep((s) => (s - 1) as Step)} />
          ) : (
            <Button title="Reset" kind="secondary" onPress={() => setLayout(DEFAULT_LAYOUT)} />
          )}
        </View>
        <View style={{ flex: 1 }}>
          {step < 2 ? (
            <Button title="Next" onPress={() => setStep((s) => (s + 1) as Step)} />
          ) : (
            <Button title="Save layout" onPress={save} />
          )}
        </View>
      </View>
      <T muted style={[base.small, { textAlign: 'center', fontFamily: fonts.mono }]}>
        {`table ${Math.round(t.x * 100)},${Math.round(t.y * 100)} ${Math.round(t.w * 100)}×${Math.round(t.h * 100)}%`}
      </T>
    </View>
  );
}

const styles = StyleSheet.create({
  box: { position: 'absolute', borderRadius: 4 },
  handle: { position: 'absolute', width: HANDLE, height: HANDLE, alignItems: 'center', justifyContent: 'center' },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#FFFFFF' },
  bar: { width: 8, height: 32, borderRadius: 4, borderWidth: 1.5, borderColor: '#FFFFFF' },
});
