import { MODEL_CATALOG, type ModelSpec } from '@inkstat/ocr-engine';
import { deleteModel, downloadModel, modelStatus, type ModelStatus } from '@inkstat/ocr-engine/native';
import { useSQLiteContext } from 'expo-sqlite';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Alert, ScrollView, View } from 'react-native';

import { GEMINI_NANO_ID, getActiveModelId, nanoStatusDetail, setActiveModelId, unloadModel } from '@/engine/host';
import { GeminiNanoBackend } from '@/engine/geminiNanoBackend';

import { GeminiNano, type NanoStatus } from '../../modules/gemini-nano';
import { Button, Card, ProgressBar, T, formatBytes } from '@/ui/components';
import { base, fonts, space, useColors } from '@/ui/theme';

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
      {GeminiNanoBackend.isSupported() && (
        <NanoCard
          active={active === GEMINI_NANO_ID}
          onUse={async () => {
            await setActiveModelId(db, GEMINI_NANO_ID);
            setActive(GEMINI_NANO_ID);
          }}
        />
      )}
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

const NANO_STATUS_TEXT: Record<NanoStatus, string> = {
  available: 'Ready',
  downloadable: 'Not downloaded',
  downloading: 'Downloading',
  unavailable: 'Not supported',
};

/**
 * Gemini Nano is installed and updated by Android (AICore), not by InkStat. On
 * Pixel 10 it runs on the Tensor TPU, far faster than the downloadable models.
 */
function NanoCard({ active, onUse }: { active: boolean; onUse: () => void }) {
  const c = useColors();
  const [status, setStatus] = useState<NanoStatus | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [progress, setProgress] = useState<{ bytes: number; total: number } | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(() => {
    nanoStatusDetail().then((r) => {
      setStatus(r.status);
      setDetail(r.detail);
    });
  }, []);
  useEffect(refresh, [refresh]);

  const download = async () => {
    if (!GeminiNano) return;
    setError(null);
    setProgress({ bytes: 0, total: 0 });
    const sub = GeminiNano.addListener('onDownloadProgress', setProgress);
    try {
      await GeminiNano.download();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      sub.remove();
      setProgress(null);
      refresh();
    }
  };

  return (
    <Card style={active ? { borderColor: c.accent, borderWidth: 2 } : undefined}>
      <View style={[base.row, { justifyContent: 'space-between' }]}>
        <T style={base.h2}>Gemini Nano</T>
        <T muted>{active ? 'In use' : status ? NANO_STATUS_TEXT[status] : '…'}</T>
      </View>
      <T muted>
        Built into Android and runs on this phone&apos;s AI chip, so it is much faster where supported. Managed by
        Android; InkStat only needs InkStat to stay open while reading.
      </T>
      {progress && (
        <View style={{ gap: space.xs }}>
          <ProgressBar fraction={progress.total ? progress.bytes / progress.total : 0} />
          <T muted style={base.small}>
            {progress.total ? `${formatBytes(progress.bytes)} of ${formatBytes(progress.total)}` : 'Starting…'}
          </T>
        </View>
      )}
      {error && <T style={{ color: c.error }}>{error}</T>}
      {status === 'unavailable' && (
        <T muted style={base.small}>
          This phone does not offer Gemini Nano to apps (or Android has not set it up yet). Use a downloadable
          model below.
        </T>
      )}
      {detail && (
        <T muted style={[base.small, { fontFamily: fonts.mono }]}>
          {detail}
        </T>
      )}
      <View style={[base.row, { flexWrap: 'wrap' }]}>
        {status === 'available' && !active && <Button title="Use this model" onPress={onUse} />}
        {(status === 'downloadable' || status === 'downloading') && !progress && (
          <Button title={status === 'downloading' ? 'Check progress' : 'Download'} onPress={download} />
        )}
      </View>
    </Card>
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
