import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadMockDataset } from './data/mock.js';

export const DATASET_PATH = fileURLToPath(new URL('../data/dataset.json', import.meta.url));

/** Prefers a Sportmonks-built data/dataset.json, falls back to the mock set. */
export function loadDataset() {
  if (existsSync(DATASET_PATH)) {
    const ds = JSON.parse(readFileSync(DATASET_PATH, 'utf8'));
    return { source: 'sportmonks', ...ds };
  }
  return loadMockDataset();
}
