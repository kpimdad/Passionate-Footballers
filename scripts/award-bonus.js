/**
 * award-bonus.js
 * Runs via GitHub Actions (manual trigger) after the tournament ends.
 * Awards bonus points for champion and golden boot picks, then locks picks.
 *
 * Rules (WC 2026):
 *   +50 pts  → championPick  === 'Spain'
 *   +25 pts  → goldenBootPick === 'France' OR 'England'
 *
 * Idempotent: tracks championBonusAwarded / goldenBootBonusAwarded per user.
 * Also sets config/game { picksLocked: true } so the UI disables editing.
 *
 * Required env var:
 *   FIREBASE_SERVICE_ACCOUNT — Firebase service account JSON (as a string)
 */

'use strict';
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Bonus rules ───────────────────────────────────────────────────────────────
const CHAMPION           = 'Spain';
const GOLDEN_BOOT_TEAMS  = new Set(['France', 'England']);
const CHAMPION_BONUS     = 50;
const GOLDEN_BOOT_BONUS  = 25;

async function main() {
  console.log(`[${new Date().toISOString()}] Starting bonus award run…`);
  console.log(`  Champion: ${CHAMPION} → +${CHAMPION_BONUS} pts`);
  console.log(`  Golden Boot: ${[...GOLDEN_BOOT_TEAMS].join(' or ')} → +${GOLDEN_BOOT_BONUS} pts`);

  const usersSnap = await db.collection('users').get();
  console.log(`  Found ${usersSnap.size} user(s)`);

  let champAwarded = 0;
  let bootAwarded  = 0;
  let skipped      = 0;

  const batch = db.batch();

  usersSnap.forEach(docSnap => {
    const u   = docSnap.data();
    const ref = docSnap.ref;

    const champAlready = u.championBonusAwarded  === true;
    const bootAlready  = u.goldenBootBonusAwarded === true;

    if (champAlready && bootAlready) { skipped++; return; }

    const updates = {};
    let ptsDelta = 0;

    if (!champAlready) {
      const won = u.championPick === CHAMPION;
      updates.championBonusAwarded = true;
      if (won) {
        ptsDelta += CHAMPION_BONUS;
        champAwarded++;
        console.log(`  ✅ Champion bonus → ${u.nickname} picked ${u.championPick} (+${CHAMPION_BONUS})`);
      } else {
        console.log(`  ❌ Champion miss  → ${u.nickname} picked ${u.championPick || '(none)'}`);
      }
    }

    if (!bootAlready) {
      const won = GOLDEN_BOOT_TEAMS.has(u.goldenBootPick);
      updates.goldenBootBonusAwarded = true;
      if (won) {
        ptsDelta += GOLDEN_BOOT_BONUS;
        bootAwarded++;
        console.log(`  ✅ Boot bonus     → ${u.nickname} picked ${u.goldenBootPick} (+${GOLDEN_BOOT_BONUS})`);
      } else {
        console.log(`  ❌ Boot miss      → ${u.nickname} picked ${u.goldenBootPick || '(none)'}`);
      }
    }

    if (ptsDelta > 0) {
      updates.totalPoints = admin.firestore.FieldValue.increment(ptsDelta);
    }

    if (Object.keys(updates).length > 0) {
      batch.update(ref, updates);
    }
  });

  await batch.commit();
  console.log(`\nBonus commit done.`);
  console.log(`  Champion bonuses awarded: ${champAwarded}`);
  console.log(`  Golden Boot bonuses awarded: ${bootAwarded}`);
  console.log(`  Already processed (skipped): ${skipped}`);

  // Lock picks globally
  await db.collection('config').doc('game').set({
    picksLocked: true,
    champion: CHAMPION,
    goldenBootTeams: [...GOLDEN_BOOT_TEAMS],
    lockedAt: admin.firestore.FieldValue.serverTimestamp(),
  }, { merge: true });

  console.log(`\n🔒 config/game.picksLocked = true`);
  console.log(`Done.`);
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
