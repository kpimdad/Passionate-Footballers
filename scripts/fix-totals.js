/**
 * fix-totals.js
 * Rebuilds every user's totalPoints, computedExact, computedWinner, predictionsSubmitted
 * directly from Firestore prediction documents (admin SDK bypasses security rules).
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json" node fix-totals.js
 *
 * Optional — rescore first (recalculates pointsAwarded from match results):
 *   GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json" node fix-totals.js --rescore
 */

'use strict';
const admin = require('firebase-admin');

admin.initializeApp({
  credential: admin.credential.applicationDefault(),
  projectId:  'passionate-footballers-wc',
});
const db = admin.firestore();

const RESCORE = process.argv.includes('--rescore');

async function run() {
  // ── Optional: rescore every prediction from stored match results ──────────
  if (RESCORE) {
    console.log('── RESCORE MODE: recalculating pointsAwarded for all completed matches ──');
    const matchSnap = await db.collection('matches').where('status', '==', 'completed').get();
    let rescored = 0;

    for (const mDoc of matchSnap.docs) {
      const { resultA, resultB } = mDoc.data();
      if (resultA == null || resultB == null) continue;

      const pSnap = await db.collection('predictions').where('matchId', '==', mDoc.id).get();
      if (pSnap.empty) continue;

      const batch = db.batch();
      pSnap.docs.forEach(d => {
        const { predictedA, predictedB } = d.data();
        let pts = 0;
        if (predictedA === resultA && predictedB === resultB) pts = 13;
        else if ((predictedA - predictedB === resultA - resultB) ||
                 (predictedA > predictedB && resultA > resultB) ||
                 (predictedA < predictedB && resultA < resultB)) pts = 10;
        batch.update(d.ref, { pointsAwarded: pts });
        rescored++;
      });
      await batch.commit();
    }
    console.log(`Rescored ${rescored} predictions across ${matchSnap.size} matches.\n`);
  }

  // ── Rebuild user totals from pointsAwarded ────────────────────────────────
  console.log('── Rebuilding user totals ──');
  const uSnap = await db.collection('users').get();
  const totals   = {};
  const exact    = {};
  const winner   = {};
  const played   = {};

  uSnap.docs.forEach(d => {
    totals[d.id] = 0; exact[d.id] = 0; winner[d.id] = 0; played[d.id] = 0;
  });

  const pSnap = await db.collection('predictions').get();
  pSnap.docs.forEach(d => {
    const { userId, pointsAwarded } = d.data();
    if (!totals.hasOwnProperty(userId)) return; // unknown user, skip
    if (pointsAwarded == null) return;
    totals[userId]  += pointsAwarded;
    played[userId]  += 1;
    if (pointsAwarded === 13) exact[userId]  += 1;
    if (pointsAwarded === 10) winner[userId] += 1;
  });

  // Write in batches of 400 (safe under 500 limit)
  const entries = Object.keys(totals);
  for (let i = 0; i < entries.length; i += 400) {
    const batch = db.batch();
    entries.slice(i, i + 400).forEach(uid => {
      batch.update(db.collection('users').doc(uid), {
        totalPoints:          totals[uid],
        computedExact:        exact[uid],
        computedWinner:       winner[uid],
        predictionsSubmitted: played[uid],
      });
    });
    await batch.commit();
  }

  // ── Print results ──────────────────────────────────────────────────────────
  console.log('\nUser totals after rebuild:\n');
  const sorted = uSnap.docs
    .map(d => ({ name: d.data().nickname || d.id, pts: totals[d.id], ex: exact[d.id], win: winner[d.id], played: played[d.id] }))
    .sort((a, b) => b.pts - a.pts);

  sorted.forEach((u, i) => {
    console.log(`${String(i+1).padStart(2)}. ${u.name.padEnd(20)} ${String(u.pts).padStart(4)} pts  🎯${u.ex}  ✅${u.win}  MP:${u.played}`);
  });

  console.log('\n✅ Done.');
  process.exit(0);
}

run().catch(e => { console.error(e); process.exit(1); });
