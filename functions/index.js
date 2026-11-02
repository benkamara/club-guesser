import { onRequest } from 'firebase-functions/v2/https';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { loadDataset } from './src/dataset.js';
import { RoundStore } from './src/game.js';
import { createApi } from './src/api.js';
import { FirestoreRoundRepo } from './src/firestoreRoundRepo.js';

initializeApp();

const dataset = loadDataset();
const store = new RoundStore(dataset, { repo: new FirestoreRoundRepo(getFirestore()) });
const handle = createApi(dataset, store);

// Firebase Hosting rewrites /api/** to this function (see firebase.json).
export const api = onRequest({ region: 'us-central1', maxInstances: 10 }, async (req, res) => {
  const { status, body } = await handle(req.method, req.path, req.body);
  res.status(status).json(body);
});
