/**
 * fetch-results.js
 * Runs via GitHub Actions (server-side, no CORS).
 * Fetches finished WC 2026 matches from football-data.org,
 * scores predictions, and updates Firestore.
 *
 * Required env vars:
 *   FOOTBALL_API_KEY          — football-data.org token
 *   FIREBASE_SERVICE_ACCOUNT  — Firebase service account JSON (as a string)
 */

'use strict';
const https   = require('https');
const admin   = require('firebase-admin');

// ── Load MATCHES index (matchId + kickoffUTC + teams) ─────────────────────────
const MATCHES = require('./matches-index.json');
console.log('Fixtures loaded:', MATCHES.length);

// ── Firebase Admin ────────────────────────────────────────────────────────────
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Scoring (mirror of app.js) ────────────────────────────────────────────────
function calculatePoints(pA, pB, rA, rB) {
  if (pA === rA && pB === rB) return 13;
  const predWin = pA > pB ? 1 : pA < pB ? -1 : 0;
  const realWin = rA > rB ? 1 : rA < rB ? -1 : 0;
  return predWin === realWin ? 10 : 0;
}

// ── Fetch from football-data.org ──────────────────────────────────────────────
function fetchAPI(path) {
  return new Promise((resolve, reject) => {
    const options = {
      hostname: 'api.football-data.org',
      path,
      headers: { 'X-Auth-Token': process.env.FOOTBALL_API_KEY }
    };
    https.get(options, res => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        if (res.statusCode !== 200) {
          reject(new Error(`API error ${res.statusCode}: ${data}`));
          return;
        }
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('JSON parse error: ' + e.message)); }
      });
    }).on('error', reject);
  });
}

// ── Main ──────────────────────────────────────────────────────────────────────
async function main() {
  const now = Date.now();
  console.log(`[${new Date(now).toISOString()}] Starting WC result sync…`);

  // Today and yesterday in UTC (YYYY-MM-DD)
  const todayStr     = new Date(now).toISOString().slice(0, 10);
  const yesterdayStr = new Date(now - 86400 * 1000).toISOString().slice(0, 10);
  console.log(`Checking matches on: ${yesterdayStr} and ${todayStr}`);

  // ── Step 1: Get all completed match IDs + stored results from Firestore ───────
  const completedSnap = await db.collection('matches').where('status', '==', 'completed').get();
  const completedIds   = new Set();
  const storedResults  = {};   // matchId → { resultA, resultB }
  completedSnap.forEach(d => {
    completedIds.add(d.id);
    const { resultA, resultB } = d.data();
    storedResults[d.id] = { resultA, resultB };
  });
  console.log(`Firestore: ${completedIds.size} match(es) already completed`);

  // ── Step 2: Narrow to today + yesterday only ──────────────────────────────────
  const recentMatches = MATCHES.filter(m => {
    const d = m.kickoffUTC.slice(0, 10);
    return d === todayStr || d === yesterdayStr;
  });
  console.log(`Recent matches (today+yesterday): ${recentMatches.length}`);

  const THRESHOLD = 105 * 60 * 1000; // 105 min after kickoff

  // Matches that need to be fetched for the first time
  const pending = recentMatches.filter(m =>
    new Date(m.kickoffUTC).getTime() + THRESHOLD < now &&
    !completedIds.has(m.matchId)
  );

  // Matches already marked completed but within today/yesterday window —
  // re-verify them in case the API initially returned a wrong result
  const toRecheck = recentMatches.filter(m =>
    new Date(m.kickoffUTC).getTime() + THRESHOLD < now &&
    completedIds.has(m.matchId)
  );

  const allToProcess = [...pending, ...toRecheck];

  console.log(`Pending (new):    ${pending.length}   — ${pending.map(m => `${m.teamA} vs ${m.teamB}`).join(', ') || 'none'}`);
  console.log(`To re-check:      ${toRecheck.length} — ${toRecheck.map(m => `${m.teamA} vs ${m.teamB}`).join(', ') || 'none'}`);

  if (allToProcess.length === 0) {
    console.log('Nothing to do — skipping API call.');
    await db.collection('config').doc('lastSync').set({
      syncedAt: admin.firestore.FieldValue.serverTimestamp(),
      matchesUpdated: 0
    });
    console.log('Done. 0 match(es) updated.');
    process.exit(0);
  }

  // ── Step 3: Fetch today + yesterday from the API ──────────────────────────────
  const dateTo = new Date(now + 86400 * 1000).toISOString().slice(0, 10);

  let data;
  try {
    data = await fetchAPI(`/v4/competitions/WC/matches?status=FINISHED&dateFrom=${yesterdayStr}&dateTo=${dateTo}`);
  } catch (e) {
    console.warn('Date-range fetch failed, retrying with season=2026…', e.message);
    data = await fetchAPI(`/v4/competitions/WC/matches?status=FINISHED&season=2026&dateFrom=${yesterdayStr}&dateTo=${dateTo}`);
  }

  const finished = (data.matches || []).filter(m => m.status === 'FINISHED');
  console.log(`API returned ${finished.length} finished match(es) in range ${yesterdayStr} → ${dateTo}`);

  let updated = 0;

  // ── Step 4: Process each finished match from the API ─────────────────────────
  for (const apiMatch of finished) {
    const rA = apiMatch.score?.fullTime?.home;
    const rB = apiMatch.score?.fullTime?.away;
    if (rA == null || rB == null) continue;

    // Match by kickoff time (±5 min tolerance)
    const apiTime  = new Date(apiMatch.utcDate).getTime();
    const ourMatch = allToProcess.find(
      m => Math.abs(new Date(m.kickoffUTC).getTime() - apiTime) < 5 * 60 * 1000
    );
    if (!ourMatch) continue;

    const isRecheck = completedIds.has(ourMatch.matchId);

    if (isRecheck) {
      const stored = storedResults[ourMatch.matchId];
      if (stored.resultA === rA && stored.resultB === rB) {
        console.log(`  ✓  ${ourMatch.teamA} vs ${ourMatch.teamB}: result ${rA}-${rB} confirmed unchanged`);
        continue;
      }
      console.log(`  ⚠️  CORRECTION: ${ourMatch.teamA} vs ${ourMatch.teamB}: was ${stored.resultA}-${stored.resultB}, API says ${rA}-${rB}`);
    }

    // Write result to Firestore
    const matchRef = db.collection('matches').doc(ourMatch.matchId);
    await matchRef.set({ resultA: rA, resultB: rB, status: 'completed' }, { merge: true });

    // Score all predictions for this match
    const predsSnap = await db.collection('predictions')
      .where('matchId', '==', ourMatch.matchId).get();

    const predBatch   = db.batch();
    const ptsDelta    = {};
    const exactDelta  = {};
    const winnerDelta = {};

    predsSnap.forEach(doc => {
      const p    = doc.data();
      const pts  = calculatePoints(p.predictedA, p.predictedB, rA, rB);
      const prev = p.pointsAwarded ?? 0;

      predBatch.update(doc.ref, { pointsAwarded: pts });

      const uid = p.userId;
      ptsDelta[uid]    = (ptsDelta[uid]    || 0) + (pts - prev);
      exactDelta[uid]  = (exactDelta[uid]  || 0) + (pts === 13 ? 1 : 0) - (prev === 13 ? 1 : 0);
      winnerDelta[uid] = (winnerDelta[uid] || 0) + (pts === 10 ? 1 : 0) - (prev === 10 ? 1 : 0);
    });

    await predBatch.commit();

    // Update user totals (points + exact + winner counts)
    const userBatch = db.batch();
    const allUids   = new Set([
      ...Object.keys(ptsDelta),
      ...Object.keys(exactDelta),
      ...Object.keys(winnerDelta),
    ]);

    for (const uid of allUids) {
      const pd = ptsDelta[uid]    || 0;
      const ed = exactDelta[uid]  || 0;
      const wd = winnerDelta[uid] || 0;
      if (pd === 0 && ed === 0 && wd === 0) continue;

      const uRef  = db.collection('users').doc(uid);
      const uSnap = await uRef.get();
      if (!uSnap.exists) continue;

      const u = uSnap.data();
      userBatch.update(uRef, {
        totalPoints:    (u.totalPoints    || 0) + pd,
        computedExact:  Math.max(0, (u.computedExact  || 0) + ed),
        computedWinner: Math.max(0, (u.computedWinner || 0) + wd),
      });
    }
    await userBatch.commit();

    const tag = isRecheck ? '🔁 CORRECTED' : '✅';
    console.log(`  ${tag} ${ourMatch.teamA} ${rA}–${rB} ${ourMatch.teamB} · ${predsSnap.size} prediction(s) scored`);
    updated++;
  }

  // Write last-sync timestamp
  await db.collection('config').doc('lastSync').set({
    syncedAt: admin.firestore.FieldValue.serverTimestamp(),
    matchesUpdated: updated
  });

  console.log(`Done. ${updated} match(es) updated.`);
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
