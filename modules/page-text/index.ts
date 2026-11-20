import { Platform } from 'react-native';
import { requireOptionalNativeModule } from 'expo-modules-core';

import type { TextLine } from '@inkstat/ocr-engine';

interface NativePageText {
  recognize(uri: string): Promise<TextLine[]>;
}

const native: NativePageText | null =
  Platform.OS === 'android' ? requireOptionalNativeModule<NativePageText>('PageText') : null;

/** Text on a page photo with where it is (fractions of the image), or null where unsupported. */
export async function recognizePageText(uri: string): Promise<TextLine[] | null> {
  if (!native) return null;
  try {
    return await native.recognize(uri);
  } catch {
    return null;
  }
}
