/** Private cloud protocol. Never route these blobs through public share images. */
export const CLOUD_CHUNK_BYTES = 256 * 1024;
export const CLOUD_MAX_DOCUMENT_BYTES = 100 * 1024 * 1024;
export const CLOUD_MAX_CHUNKS = 400;
export const CLOUD_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;
export interface CloudRecord {
  id: string;
  version: number;
  deleted: boolean;
  hash: string;
  chunkHashes: string[];
  byteLength: number;
  updatedAt: string;
  mutationId: string;
}
export interface CloudCommit {
  baseVersion: number;
  mutationId: string;
  hash: string;
  chunkHashes: string[];
  byteLength: number;
}
/** Deterministic JSON for JSON-compatible document values, retaining array order. */
export function stableStringify(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return '[' + value.map(v => stableStringify(v) ?? 'null').join(',') + ']';
  return '{' + Object.keys(value).sort().filter(k => (value as Record<string, unknown>)[k] !== undefined)
    .map(k => JSON.stringify(k) + ':' + stableStringify((value as Record<string, unknown>)[k])).join(',') + '}';
}
