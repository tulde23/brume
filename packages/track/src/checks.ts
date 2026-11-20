import { markedParts, type PartCheck } from '@inkstat/ocr-engine';

import { TRACK_CATALOG, type TrackPart } from './catalog';
import { better } from './marks';
import type { TrackPage, TrackTemplate } from './read';

/**
 * One line per marked part after a test read. The track cross-check: places
 * must agree with results (a faster time or longer mark never places lower).
 */
export function trackChecks(t: TrackTemplate, page: TrackPage): PartCheck<TrackPart>[] {
  const athletes = page.athletes;
  const text = (part: TrackPart, v: string | null): PartCheck<TrackPart> =>
    v ? { part, value: v, ok: true } : { part, value: 'Not read', ok: false, note: 'Box just the printed or written value.' };

  return markedParts(t, TRACK_CATALOG)
    .filter((part) => TRACK_CATALOG.parts.find((p) => p.id === part)!.status !== 'planned')
    .map((part): PartCheck<TrackPart> => {
      switch (part) {
        case 'rows':
        case 'athlete':
          return athletes.length
            ? { part, value: `${athletes.length} athletes`, ok: true }
            : { part, value: 'No athletes', ok: false, note: 'Check the rows box and the name column.' };
        case 'result': {
          const read = athletes.filter((a) => a.result);
          const unparsed = read.filter((a) => a.result!.value === null && !a.result!.status);
          if (!read.length) return { part, value: 'Not read', ok: false, note: 'Check the band covers just the final time or mark.' };
          if (unparsed.length)
            return {
              part,
              value: `${read.length - unparsed.length} of ${read.length} understood`,
              ok: false,
              note: `Couldn’t understand ${unparsed.map((a) => `"${a.result!.text}"`).slice(0, 3).join(', ')}. Is the result type right (time, distance or height)?`,
            };
          return { part, value: `${read.length} read`, ok: true };
        }
        case 'place': {
          const placed = athletes.filter((a) => a.place !== null && a.result?.value != null);
          if (!athletes.some((a) => a.place !== null)) return { part, value: 'Not read', ok: false, note: 'Check the band covers the place column.' };
          // Every pair: a better result must not have a worse (higher) place.
          const clash = placed.find((a) =>
            placed.some((b) => better(page.kind, a.result!.value!, b.result!.value!) && a.place! > b.place!),
          );
          return clash
            ? { part, value: 'out of order', ok: false, note: `${clash.name} has place ${clash.place} but a better result than someone placed ahead. Check places and results.` }
            : { part, value: `${placed.length} agree with results`, ok: true };
        }
        case 'team': {
          const n = athletes.filter((a) => a.team).length;
          return n ? { part, value: `${n} of ${athletes.length}`, ok: n === athletes.length } : { part, value: 'Not read', ok: false };
        }
        case 'lane':
        case 'bib':
        case 'seed': {
          const n = athletes.filter((a) => a[part]).length;
          return n ? { part, value: `${n} of ${athletes.length}`, ok: true } : { part, value: 'Not read', ok: false };
        }
        case 'eventName':
          return text(part, page.eventName);
        case 'heat':
          return text(part, page.heat);
        case 'round':
          return text(part, page.round);
        case 'division':
          return text(part, page.division);
        case 'meet':
          return text(part, page.meet);
        case 'date':
          return text(part, page.date);
        case 'wind':
          return text(part, page.wind);
        default:
          return { part, value: 'Not read yet', ok: true };
      }
    });
}
