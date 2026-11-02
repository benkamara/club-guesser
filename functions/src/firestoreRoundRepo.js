import { httpError } from './game.js';

/** Round storage on Firestore. Updates run in a transaction so double-clicks can't double-score. */
export class FirestoreRoundRepo {
  constructor(db, collection = 'rounds') {
    this.db = db;
    this.col = db.collection(collection);
  }

  async create(round) {
    const ref = this.col.doc();
    await ref.set(round);
    return ref.id;
  }

  update(id, fn) {
    // Firestore ids are 20 chars of [A-Za-z0-9]; reject anything else before touching the db.
    if (!/^[A-Za-z0-9]{1,40}$/.test(id)) throw httpError(404, 'Unknown round');
    const ref = this.col.doc(id);
    return this.db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      if (!snap.exists) throw httpError(404, 'Unknown round');
      const { round, result } = fn(snap.data());
      tx.set(ref, round);
      return result;
    });
  }
}
