/**
 * audit-late-predictions.js
 * Finds predictions that were saved/updated AFTER a match kicked off.
 * These are suspicious — user may have edited after seeing the result.
 *
 * Usage:
 *   GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json" node audit-late-predictions.js
 */

'use strict';
const admin = require('firebase-admin');

const credential = process.env.GOOGLE_APPLICATION_CREDENTIALS
  ? admin.credential.applicationDefault()
  : (() => { console.error('Set GOOGLE_APPLICATION_CREDENTIALS'); process.exit(1); })();

admin.initializeApp({ credential, projectId: 'passionate-footballers-wc' });
const db = admin.firestore();

// ── Import local match list ───────────────────────────────────────────────────
// matches.js uses `const MATCHES = [...]` — strip the JS and parse
const fs   = require('fs');
const path = require('path');
const raw  = fs.readFileSync(path.join(__dirname, '..', 'matches.js'), 'utf8');
const json = raw.replace(/^const MATCHES\s*=\s*/, '').replace(/;\s*$/, '');
const MATCHES = JSON.parse(json);
const matchMap = Object.fromEntries(MATCHES.map(m => [m.matchId, m]));

async function run() {
  console.log('Fetching completed matches from Firestore…');
  const matchSnap = await db.collection('matches').where('status', '==', 'FINISHED').get();
  const finishedIds = new Set(matchSnap.docs.map(d => d.id));

  console.log(`Found ${finishedIds.size} completed matches. Scanning predictions…\n`);

  const predsSnap = await db.collection('predictions').get();

  // Fetch users for name lookup
  const usersSnap = await db.collection('users').get();
  const users = {};
  usersSnap.docs.forEach(d => { users[d.id] = d.data().nickname || d.id; });

  const offenders = [];

  predsSnap.docs.forEach(doc => {
    const p = doc.data();
    const { userId, matchId, updatedAt, submittedAt } = p;

    if (!finishedIds.has(matchId)) return; // match not finished — skip

    const localMatch = matchMap[matchId];
    if (!localMatch) return;

    const kickoffMs  = new Date(localMatch.kickoffUTC).getTime();
    const lockMs     = kickoffMs - 5 * 60 * 1000; // 5 min before kickoff

    const updatedMs  = updatedAt?._seconds  ? updatedAt._seconds  * 1000 : null;
    const submitted  = submittedAt?._seconds ? submittedAt._seconds * 1000 : null;

    // Flag if updatedAt is after lock time
    if (updatedMs && updatedMs > lockMs) {
      const minutesLate = Math.round((updatedMs - lockMs) / 60000);
      offenders.push({
        user:       users[userId] || userId,
        userId,
        matchId,
        match:      `${localMatch.teamA} vs ${localMatch.teamB}`,
        kickoff:    new Date(kickoffMs).toISOString(),
        updatedAt:  new Date(updatedMs).toISOString(),
        minutesLate,
        firstSubmit: submitted ? new Date(submitted).toISOString() : 'unknown',
        prediction: `${p.predictedA}–${p.predictedB}`,
        pointsAwarded: p.pointsAwarded ?? 'not scored',
      });
    }
  });

  if (offenders.length === 0) {
    console.log('✅ No late predictions found.');
    return;
  }

  offenders.sort((a, b) => b.minutesLate - a.minutesLate);

  console.log(`⚠️  ${offenders.length} late prediction(s) found:\n`);
  offenders.forEach(o => {
    console.log(`👤 ${o.user}`);
    console.log(`   Match:       ${o.match} (${o.matchId})`);
    console.log(`   Kickoff:     ${o.kickoff}`);
    console.log(`   Updated at:  ${o.updatedAt}  (${o.minutesLate} min AFTER lock)`);
    console.log(`   First saved: ${o.firstSubmit}`);
    console.log(`   Prediction:  ${o.prediction}  →  Points: ${o.pointsAwarded}`);
    console.log('');
  });

  // Summary by user
  const byUser = {};
  offenders.forEach(o => {
    byUser[o.user] = (byUser[o.user] || 0) + 1;
  });
  console.log('── Summary ──────────────────────────────────');
  Object.entries(byUser).sort((a,b) => b[1]-a[1]).forEach(([name, count]) => {
    console.log(`  ${name}: ${count} late edit(s)`);
  });
}

run().catch(e => { console.error(e); process.exit(1); });
