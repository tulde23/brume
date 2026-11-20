import { MODEL_CATALOG, type ModelSpec } from '@brume/ocr-engine';
import { deleteModel, downloadModel, modelStatus, type ModelStatus } from '@brume/ocr-engine/native';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { getActiveModelId, setActiveModelId, unloadModel } from '@/engine/host';
import { Button, Card, ProgressBar, T, formatBytes } from '@/ui/components';
import { base, space, useColors } from '@/ui/theme';

export default function Models() {
  const db = useSQLiteContext();
  const c = useColors();
  const [active, setActive] = useState<string | null>(null);
  const readStatuses = () =>
    Object.fromEntries(MODEL_CATALOG.map((m) => [m.id, modelStatus(m)])) as Record<string, ModelStatus>;
  // File checks are synchronous, so read them on first render and again after each change.
  const [statuses, setStatuses] = useState(readStatuses);
  const refresh = useCallback(() => setStatuses(readStatuses()), []);

  useEffect(() => {
    getActiveModelId(db).then(setActive);
  }, [db]);

  return (
    <ScrollView style={[base.screen, { backgroundColor: c.bg }]} contentContainerStyle={base.content}>
      <T muted>
        Models run entirely on this phone; pages never leave it. Downloads are large, so use Wi-Fi. Phones with
        6 GB of RAM or more work best.
      </T>
      {MODEL_CATALOG.map((m) => (
        <ModelCard
          key={m.id}
          spec={m}
          status={statuses[m.id] ?? 'missing'}
          active={active === m.id}
          onChanged={refresh}
          onUse={async () => {
            await setActiveModelId(db, m.id);
            setActive(m.id);
          }}
        />
      ))}
    </ScrollView>
  );
}

function ModelCard({
  spec,
  status,
  active,
  onChanged,
  onUse,
}: {
  spec: ModelSpec;
  status: ModelStatus;
  active: boolean;
  onChanged: () => void;
  onUse: () => void;
}) {
  const c = useColors();
  const [progress, setProgress] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const abort = useRef<AbortController | null>(null);
  const total = spec.model.sizeBytes + spec.mmproj.sizeBytes;

  useEffect(() => () => abort.current?.abort(), []);

  const download = async () => {
    setError(null);
    setProgress(0);
    abort.current = new AbortController();
    try {
      await downloadModel(spec, (p) => setProgress(p.bytesWritten / p.totalBytes), abort.current.signal);
    } catch (e) {
      if (!abort.current.signal.aborted) setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProgress(null);
      abort.current = null;
      onChanged();
    }
  };

  const remove = () =>
    Alert.alert(`Delete ${spec.name}?`, `Frees ${formatBytes(total)}. You can download it again later.`, [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Delete',
        style: 'destructive',
        onPress: async () => {
          if (active) await unloadModel();
          deleteModel(spec);
          onChanged();
        },
      },
    ]);

  return (
    <Card style={active ? { borderColor: c.accent, borderWidth: 2 } : undefined}>
      <View style={[base.row, { justifyContent: 'space-between' }]}>
        <T style={base.h2}>{spec.name}</T>
        <T muted>{active ? 'In use' : status === 'ready' ? 'Downloaded' : formatBytes(total)}</T>
      </View>
      <T muted>{spec.description}</T>
      {progress !== null && (
        <View style={{ gap: space.xs }}>
          <ProgressBar fraction={progress} />
          <T muted style={base.small}>
            {formatBytes(progress * total)} of {formatBytes(total)}
          </T>
        </View>
      )}
      {error && <T style={{ color: c.error }}>{error}</T>}
      <View style={[base.row, { flexWrap: 'wrap' }]}>
        {progress !== null ? (
          <Button title="Cancel" kind="secondary" onPress={() => abort.current?.abort()} />
        ) : status === 'ready' ? (
          <>
            {!active && <Button title="Use this model" onPress={onUse} />}
            <Button title="Delete" kind="danger" onPress={remove} />
          </>
        ) : (
          <Button title={status === 'partial' ? 'Finish download' : 'Download'} onPress={download} />
        )}
      </View>
    </Card>
  );
}
