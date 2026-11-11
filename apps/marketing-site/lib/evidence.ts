// Доказательства цен конкурентов для «Дешевле всех аналогов» (lib/priceClaim.ts).
// Снимает scripts/evidence/capture-competitor-prices.cjs → evidence/prices/<дата>/.
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';

export const EVIDENCE_DIR = process.env.EVIDENCE_DIR || '/var/www/hhpilot/evidence/prices';

export type EvidenceItem = { id: string; name: string; url: string; finalUrl?: string; file: string; ok: boolean; priceLines?: string[]; error?: string };
export type EvidenceSnapshot = { day: string; capturedAtMsk: string; items: EvidenceItem[] };

/** Последний снимок цен (или null, если снимков нет). */
export async function latestEvidence(): Promise<EvidenceSnapshot | null> {
  try {
    const days = (await readdir(EVIDENCE_DIR)).filter((d) => /^\d{4}-\d{2}-\d{2}$/.test(d)).sort();
    const day = days.at(-1);
    if (!day) return null;
    const m = JSON.parse(await readFile(path.join(EVIDENCE_DIR, day, 'manifest.json'), 'utf8'));
    return { day, capturedAtMsk: m.capturedAtMsk, items: m.items };
  } catch {
    return null;
  }
}
