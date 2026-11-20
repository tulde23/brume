/**
 * Anchors for a built-in template, from the OCR of its reference page:
 *
 *   npx tsx scripts/make-anchors.ts <ocr.json> [exclude.json] > packages/basketball/src/library/<id>.anchors.json
 *
 * The OCR JSON is a [bench-ocr] line captured from the phone (text recognition output).
 * Anchors must be PRINTED labels only: the repo is public and reference pages may be
 * filled in with players' (often minors') names. So this drops:
 *   - anything inside the rectangles in exclude.json (player rows, handwriting fields),
 *     given as fractions of the page: [{ "x": 0.15, "y": 0.18, "w": 0.7, "h": 0.8 }, ...];
 *   - items that are not plain words (OCR of handwritten cells: "10203q4q", "xrx45").
 * Review the output by eye before committing it.
 */
import { readFileSync } from 'node:fs';

import { anchorsFrom, type NormRect, type TextLine } from '../packages/ocr-engine/src/index';

const lines = JSON.parse(readFileSync(process.argv[2], 'utf8')) as TextLine[];
const exclude = process.argv[3] ? (JSON.parse(readFileSync(process.argv[3], 'utf8')) as NormRect[]) : [];
const inside = (x: number, y: number) => exclude.some((r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h);
const round = (n: number) => Math.round(n * 1000) / 1000;

const anchors = anchorsFrom(lines)
  .filter((a) => !inside(a.x, a.y))
  // Printed labels: letters only (whole lines joined), or ordinals like 1st / 2nd.
  .filter((a) => /^[a-z]+$/.test(a.text) || /^\d(st|nd|rd|th)$/.test(a.text))
  .map((a) => ({ text: a.text, x: round(a.x), y: round(a.y) }));
process.stdout.write(JSON.stringify(anchors) + '\n');
