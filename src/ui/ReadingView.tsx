import type { DocumentTemplate, ExtractionProgress, NormRect } from '@inkstat/ocr-engine';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, Image, StyleSheet, View } from 'react-native';

import { useColors } from './theme';

/**
 * Where on the page the current crop is: the region's box, or for a tiled
 * region (the player table) the strip being read, split evenly as an estimate.
 */
export function progressRect(doc: DocumentTemplate, p: ExtractionProgress): NormRect | null {
  const region = doc.regions.find((r) => r.id === p.regionId);
  if (!region) return null;
  const r = region.pieces?.length ? region.pieces[0].rect : region.rect;
  if (p.tileCount <= 1) return r;
  const h = r.h / p.tileCount;
  return { x: r.x, y: r.y + h * p.tileIndex, w: r.w, h: Math.min(h * 1.15, r.y + r.h - (r.y + h * p.tileIndex)) };
}

const BRACKET = 26;
const TRAIL = 10; // layers in the scan line's fading tail

/**
 * The page being read, with the part InkStat is reading highlighted and a scan
 * line sweeping it, framed by the Viewfinder corner brackets. Motion is
 * replaced by a still highlight when the phone asks for reduced motion.
 */
export function ReadingView({ uri, rect, width, height }: { uri: string; rect: NormRect | null; width: number; height: number }) {
  const c = useColors();
  const [aspect, setAspect] = useState<number | null>(null);
  const [still, setStill] = useState(false);
  const [sweep] = useState(() => new Animated.Value(0));
  const [pulse] = useState(() => new Animated.Value(0));
  const loops = useRef<Animated.CompositeAnimation[]>([]);

  useEffect(() => {
    Image.getSize(uri, (w, h) => setAspect(w / h), () => setAspect(0.77));
  }, [uri]);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled().then(setStill).catch(() => undefined);
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setStill);
    return () => sub.remove();
  }, []);

  useEffect(() => {
    loops.current.forEach((l) => l.stop());
    if (still) return;
    const s = Animated.loop(
      Animated.sequence([
        Animated.timing(sweep, { toValue: 1, duration: 1400, easing: Easing.inOut(Easing.quad), useNativeDriver: true }),
        Animated.timing(sweep, { toValue: 0, duration: 0, useNativeDriver: true }),
      ]),
    );
    const p = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 0, duration: 900, easing: Easing.inOut(Easing.sin), useNativeDriver: true }),
      ]),
    );
    loops.current = [s, p];
    s.start();
    p.start();
    return () => {
      s.stop();
      p.stop();
    };
  }, [still, sweep, pulse]);

  // Fit the page inside the frame.
  const a = aspect ?? 0.77;
  const fit = a >= width / height ? { w: width, h: width / a } : { w: height * a, h: height };
  const off = { x: (width - fit.w) / 2, y: (height - fit.h) / 2 };
  const box = rect
    ? { left: off.x + rect.x * fit.w, top: off.y + rect.y * fit.h, width: rect.w * fit.w, height: Math.max(rect.h * fit.h, 8) }
    : { left: off.x, top: off.y, width: fit.w, height: fit.h };

  const glow = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.55, 1] });
  const bracketOpacity = pulse.interpolate({ inputRange: [0, 1], outputRange: [0.6, 1] });
  const lineY = sweep.interpolate({ inputRange: [0, 1], outputRange: [0, Math.max(0, box.height - 3)] });
  const accent = c.accent;

  return (
    <View
      style={[styles.frame, { width, height, backgroundColor: '#0B0F14' }]}
      accessible
      accessibilityLabel="Reading the page"
      accessibilityLiveRegion="polite">
      {aspect !== null && (
        <Image source={{ uri }} style={{ position: 'absolute', left: off.x, top: off.y, width: fit.w, height: fit.h }} resizeMode="stretch" />
      )}
      {/* Dim the page so the part being read stands out. */}
      <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(11,15,20,0.38)' }]} />

      {/* The part being read: glowing outline, with the scan line sweeping inside it. */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.focus,
          box,
          { borderColor: accent, backgroundColor: accent + '22', opacity: still ? 1 : glow, shadowColor: accent },
        ]}
      />
      {!still && (
        <View pointerEvents="none" style={[styles.clip, box]}>
          <Animated.View style={{ transform: [{ translateY: lineY }] }}>
            {/* A soft tail above the bright line. */}
            {Array.from({ length: TRAIL }, (_, i) => (
              <View
                key={i}
                style={{ height: 3, marginTop: i === 0 ? -3 * TRAIL : 0, backgroundColor: accent, opacity: ((i + 1) / TRAIL) * 0.22 }}
              />
            ))}
            <View style={[styles.line, { backgroundColor: accent, shadowColor: accent }]} />
          </Animated.View>
        </View>
      )}

      {/* Viewfinder brackets around the page. */}
      {(
        [
          [0, 0],
          [1, 0],
          [0, 1],
          [1, 1],
        ] as const
      ).map(([cx, cy], i) => (
        <Animated.View
          key={i}
          pointerEvents="none"
          style={[
            styles.bracket,
            {
              left: off.x + cx * fit.w - (cx ? BRACKET : 0) + (cx ? 4 : -4),
              top: off.y + cy * fit.h - (cy ? BRACKET : 0) + (cy ? 4 : -4),
              borderColor: c.markLine,
              borderLeftWidth: cx ? 0 : 3,
              borderRightWidth: cx ? 3 : 0,
              borderTopWidth: cy ? 0 : 3,
              borderBottomWidth: cy ? 3 : 0,
              opacity: still ? 1 : bracketOpacity,
            },
          ]}
        />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: 16, overflow: 'hidden', alignSelf: 'center' },
  focus: { position: 'absolute', borderWidth: 2, borderRadius: 4, shadowOpacity: 0.9, shadowRadius: 10, shadowOffset: { width: 0, height: 0 }, elevation: 6 },
  clip: { position: 'absolute', overflow: 'hidden' },
  line: { height: 3, borderRadius: 2, shadowOpacity: 1, shadowRadius: 8, shadowOffset: { width: 0, height: 0 }, elevation: 8 },
  bracket: { position: 'absolute', width: BRACKET, height: BRACKET, borderRadius: 3 },
});
