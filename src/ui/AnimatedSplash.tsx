import * as SplashScreen from 'expo-splash-screen';
import { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, Easing, StyleSheet, useWindowDimensions, View } from 'react-native';
import Svg, { Path } from 'react-native-svg';

import { fonts, useColors } from './theme';

/**
 * Takes over from the native splash without a jump: it first draws exactly what the
 * native splash shows (the Viewfinder mark, 160 wide, centred on the paper colour),
 * then animates:
 *   1. the brackets close in on the page, like a camera finding focus;
 *   2. a reading line sweeps down through the frame;
 *   3. the mark shrinks and steps left as "InkStat" writes in beside it;
 *   4. everything fades to reveal the app.
 * About 1.7 s. With reduce motion on, it only fades.
 */

const MARK = 160; // dp: matches the splash plugin's imageWidth
const k = MARK / 72;
const FINAL_SCALE = 0.5;
const GAP = 14;

export function AnimatedSplash({ onDone }: { onDone: () => void }) {
  const c = useColors();
  const { height } = useWindowDimensions();
  const [wordWidth, setWordWidth] = useState(0);
  const started = useRef(false);

  const focus = useState(() => new Animated.Value(0))[0]; // 0 → 1 → 0: brackets in and back
  const sweep = useState(() => new Animated.Value(0))[0]; // 0 → 1: reading line top to bottom
  const settle = useState(() => new Animated.Value(0))[0]; // 0 → 1: mark to the left, word in
  const fade = useState(() => new Animated.Value(1))[0]; // overlay opacity

  const start = async () => {
    if (started.current) return;
    started.current = true;
    // The native splash hides only once this exact copy of it is on screen.
    await SplashScreen.hideAsync().catch(() => undefined);
    const reduce = await AccessibilityInfo.isReduceMotionEnabled().catch(() => false);
    const native = { useNativeDriver: true } as const;
    const anim = reduce
      ? Animated.timing(fade, { toValue: 0, duration: 250, ...native })
      : Animated.sequence([
          Animated.parallel([
            Animated.sequence([
              Animated.timing(focus, { toValue: 1, duration: 260, easing: Easing.out(Easing.quad), ...native }),
              Animated.spring(focus, { toValue: 0, friction: 5, tension: 120, ...native }),
            ]),
            Animated.timing(sweep, { toValue: 1, duration: 620, delay: 120, easing: Easing.inOut(Easing.quad), ...native }),
          ]),
          Animated.timing(settle, { toValue: 1, duration: 480, easing: Easing.out(Easing.cubic), ...native }),
          Animated.delay(260),
          Animated.timing(fade, { toValue: 0, duration: 260, easing: Easing.in(Easing.quad), ...native }),
        ]);
    anim.start(() => onDone());
  };

  // Safety net: never hold the app behind the splash.
  useEffect(() => {
    const t = setTimeout(onDone, 4000);
    return () => clearTimeout(t);
  }, [onDone]);

  // Final layout: [mark at FINAL_SCALE] GAP [word], centred as a group.
  const markFinal = MARK * FINAL_SCALE;
  const group = markFinal + GAP + wordWidth;
  const markX = -group / 2 + markFinal / 2;
  const wordX = -group / 2 + markFinal + GAP + wordWidth / 2;

  const bracketScale = focus.interpolate({ inputRange: [0, 1], outputRange: [1, 0.88] });
  const linesScale = focus.interpolate({ inputRange: [0, 1], outputRange: [1, 0.96] });
  const sweepY = sweep.interpolate({ inputRange: [0, 1], outputRange: [10 * k - MARK / 2, 62 * k - MARK / 2] });
  const sweepOpacity = sweep.interpolate({ inputRange: [0, 0.1, 0.85, 1], outputRange: [0, 1, 1, 0] });

  const bracket = { stroke: c.markBracket, strokeWidth: 6, strokeLinecap: 'round', strokeLinejoin: 'round', fill: 'none' } as const;
  const line = (x1: number, x2: number, y: number, opacity: number) => (
    <View
      style={{
        position: 'absolute',
        left: (x1 - 3) * k,
        top: (y - 3) * k,
        width: (x2 - x1 + 6) * k,
        height: 6 * k,
        borderRadius: 3 * k,
        backgroundColor: c.markLine,
        opacity,
      }}
    />
  );

  return (
    <Animated.View
      pointerEvents="none"
      accessible
      accessibilityLabel="InkStat"
      onLayout={() => void start()}
      style={[StyleSheet.absoluteFill, styles.center, { backgroundColor: c.bg, opacity: fade }]}>
      <Animated.View
        style={{
          width: MARK,
          height: MARK,
          transform: [
            { translateX: settle.interpolate({ inputRange: [0, 1], outputRange: [0, wordWidth ? markX : 0] }) },
            { scale: settle.interpolate({ inputRange: [0, 1], outputRange: [1, FINAL_SCALE] }) },
          ],
        }}>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: bracketScale }] }]}>
          <Svg width={MARK} height={MARK} viewBox="0 0 72 72">
            <Path d="M6 22 L6 6 L22 6" {...bracket} />
            <Path d="M50 6 L66 6 L66 22" {...bracket} />
            <Path d="M6 50 L6 66 L22 66" {...bracket} />
            <Path d="M66 50 L66 66 L50 66" {...bracket} />
          </Svg>
        </Animated.View>
        <Animated.View style={[StyleSheet.absoluteFill, { transform: [{ scale: linesScale }] }]}>
          {line(20, 52, 28, 1)}
          {line(16, 56, 38, 0.65)}
          {line(24, 46, 48, 0.4)}
        </Animated.View>
        {/* The reading line: thin, in the mark's blue, sweeping top to bottom. */}
        <Animated.View
          style={{
            position: 'absolute',
            left: 12 * k,
            right: 12 * k,
            top: MARK / 2 - 1,
            height: 2,
            backgroundColor: c.markLine,
            opacity: sweepOpacity,
            transform: [{ translateY: sweepY }],
          }}
        />
      </Animated.View>

      <Animated.Text
        onLayout={(e) => setWordWidth(e.nativeEvent.layout.width)}
        style={[
          styles.word,
          {
            color: c.text,
            top: height / 2 - 34,
            opacity: settle.interpolate({ inputRange: [0, 0.4, 1], outputRange: [0, 0, 1] }),
            transform: [
              { translateX: settle.interpolate({ inputRange: [0, 1], outputRange: [wordX + 24, wordX] }) },
            ],
          },
        ]}>
        Ink<Animated.Text style={{ color: c.markLine }}>Stat</Animated.Text>
      </Animated.Text>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  center: { alignItems: 'center', justifyContent: 'center', zIndex: 1000, elevation: 1000 },
  word: { position: 'absolute', fontFamily: fonts.heading, fontSize: 52, lineHeight: 68, letterSpacing: -0.8 },
});
