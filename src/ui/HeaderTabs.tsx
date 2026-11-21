import { Pressable, StyleSheet, Text, View } from 'react-native';

import { teamAbbr } from '@/lib/teamColor';
import { fonts } from './theme';

/** Underlined tabs on a dark or coloured header, as on a sports app's league and team pages. */
export function HeaderTabs<K extends string>({
  tabs,
  value,
  onChange,
  color = '#FFFFFF',
}: {
  tabs: { key: K; label: string }[];
  value: K;
  onChange: (k: K) => void;
  color?: string;
}) {
  return (
    <View accessibilityRole="tablist" style={styles.tabs}>
      {tabs.map((t) => {
        const on = t.key === value;
        return (
          <Pressable
            key={t.key}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => onChange(t.key)}
            style={[styles.tab, { borderBottomColor: on ? color : 'transparent' }]}>
            <Text style={[styles.label, { color, opacity: on ? 1 : 0.65 }]}>{t.label}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

/** A team's round badge: its initials on its colour. */
export function TeamBadge({ name, color, size = 26, inverted }: { name: string; color: string; size?: number; inverted?: boolean }) {
  return (
    <View
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: inverted ? '#FFFFFF' : color,
        alignItems: 'center',
        justifyContent: 'center',
      }}>
      <Text style={{ color: inverted ? color : '#FFFFFF', fontFamily: fonts.bodyBold, fontSize: Math.round(size * (teamAbbr(name).length > 2 ? 0.32 : 0.38)) }}>
        {teamAbbr(name)}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tabs: { flexDirection: 'row', gap: 22 },
  tab: { minHeight: 44, justifyContent: 'center', borderBottomWidth: 3 },
  label: { fontFamily: fonts.bodySemiBold, fontSize: 14.5 },
});
