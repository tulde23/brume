import { useSQLiteContext } from 'expo-sqlite';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, TextInput, View } from 'react-native';

import {
  getSyncConfig,
  lastSyncedAt,
  setSyncConfig,
  syncNow,
  testConnection,
  type SyncResult,
} from '@/sync/client';
import { Button, Card, StatusDot, T } from '@/ui/components';
import { base, fonts, radius, space, useColors } from '@/ui/theme';

type Status = { tone: 'ok' | 'error'; text: string } | null;

const describe = (r: SyncResult) =>
  [
    `${r.pushed} sent`,
    `${r.pulled} received`,
    r.deleted ? `${r.deleted} removed` : null,
    r.conflicts ? `${r.conflicts} conflict${r.conflicts === 1 ? '' : 's'} resolved` : null,
  ]
    .filter(Boolean)
    .join(' · ');

export default function SyncScreen() {
  const db = useSQLiteContext();
  const c = useColors();
  const [url, setUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [last, setLast] = useState<number | null>(null);
  const [busy, setBusy] = useState<'test' | 'sync' | null>(null);
  const [status, setStatus] = useState<Status>(null);

  useEffect(() => {
    getSyncConfig(db).then((cfg) => {
      if (cfg) {
        setUrl(cfg.url);
        setApiKey(cfg.apiKey);
      }
    });
    lastSyncedAt(db).then(setLast);
  }, [db]);

  const ready = /^https?:\/\/\S+$/.test(url.trim()) && apiKey.trim().length >= 32;

  const run = async (kind: 'test' | 'sync') => {
    setBusy(kind);
    setStatus(null);
    try {
      await setSyncConfig(db, { url, apiKey });
      if (kind === 'test') {
        const space = await testConnection({ url: url.trim().replace(/\/+$/, ''), apiKey: apiKey.trim() });
        setStatus({ tone: 'ok', text: `Connected to "${space}".` });
      } else {
        const result = await syncNow(db);
        setLast(Date.now());
        setStatus({ tone: 'ok', text: `Synced: ${describe(result)}.` });
      }
    } catch (e) {
      setStatus({ tone: 'error', text: e instanceof Error ? e.message : String(e) });
    } finally {
      setBusy(null);
    }
  };

  const input = [styles.input, { color: c.text, borderColor: c.border, backgroundColor: c.card }];

  return (
    <ScrollView style={[base.screen, { backgroundColor: c.bg }]} contentContainerStyle={base.content} keyboardShouldPersistTaps="handled">
      <T muted>
        Optional. Back up games to your InkStat server and share them across devices. InkStat works fully
        offline without it; page photos stay on this phone.
      </T>

      <Card>
        <View style={{ gap: 4 }}>
          <T muted style={base.small}>Server address</T>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://inkstat-api.up.railway.app"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={input}
            accessibilityLabel="Server address"
          />
        </View>
        <View style={{ gap: 4 }}>
          <T muted style={base.small}>API key</T>
          <TextInput
            value={apiKey}
            onChangeText={setApiKey}
            placeholder="Paste the key for your team"
            placeholderTextColor={c.muted}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={input}
            accessibilityLabel="API key"
          />
        </View>
        <View style={base.row}>
          <View style={{ flex: 1 }}>
            <Button title="Test" kind="secondary" onPress={() => run('test')} disabled={!ready} busy={busy === 'test'} />
          </View>
          <View style={{ flex: 1 }}>
            <Button title="Sync now" onPress={() => run('sync')} disabled={!ready || busy !== null} busy={busy === 'sync'} />
          </View>
        </View>
      </Card>

      {status && (
        <Card style={{ backgroundColor: status.tone === 'ok' ? c.okBg : c.errorBg, borderColor: 'transparent' }}>
          <T style={{ color: status.tone === 'ok' ? c.ok : c.error, fontFamily: fonts.bodySemiBold }}>{status.text}</T>
        </Card>
      )}

      <View style={base.row}>
        <StatusDot tone={last ? 'ok' : 'warn'} />
        <T muted style={base.small}>
          {last ? `Last synced ${new Date(last).toLocaleString()}` : 'Not synced yet'}
        </T>
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  input: {
    borderWidth: 1,
    borderRadius: radius.sm,
    paddingHorizontal: space.md,
    minHeight: 48,
    fontSize: 15,
    fontFamily: fonts.body,
  },
});
