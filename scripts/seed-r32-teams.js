/**
 * seed-r32-teams.js
 * Writes all 16 confirmed R32 fixtures to Firestore.
 * Source: FIFA official fixtures page (June 28, 2026)
 * Run via GitHub Actions: "Seed R32 Teams" workflow
 */

'use strict';
const admin = require('firebase-admin');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const FLAG = {
  'South Africa':          '🇿🇦',
  'Canada':                '🇨🇦',
  'Brazil':                '🇧🇷',
  'Japan':                 '🇯🇵',
  'Germany':               '🇩🇪',
  'Paraguay':              '🇵🇾',
  'Netherlands':           '🇳🇱',
  'Morocco':               '🇲🇦',
  'Ivory Coast':           '🇨🇮',
  'Norway':                '🇳🇴',
  'France':                '🇫🇷',
  'Sweden':                '🇸🇪',
  'Mexico':                '🇲🇽',
  'Ecuador':               '🇪🇨',
  'England':               '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'DR Congo':              '🇨🇩',
  'Belgium':               '🇧🇪',
  'Senegal':               '🇸🇳',
  'USA':                   '🇺🇸',
  'Bosnia & Herzegovina':  '🇧🇦',
  'Spain':                 '🇪🇸',
  'Austria':               '🇦🇹',
  'Portugal':              '🇵🇹',
  'Croatia':               '🇭🇷',
  'Switzerland':           '🇨🇭',
  'Algeria':               '🇩🇿',
  'Australia':             '🇦🇺',
  'Egypt':                 '🇪🇬',
  'Argentina':             '🇦🇷',
  'Cape Verde':            '🇨🇻',
  'Colombia':              '🇨🇴',
  'Ghana':                 '🇬🇭',
};

// All 16 R32 fixtures — confirmed from FIFA.com (June 28 2026)
// Times shown are UTC. matchIds follow matches-index.json order.
const FIXTURES = [
  { id: 'm073', teamA: 'South Africa',       teamB: 'Canada'              }, // Jun 28 19:00 UTC
  { id: 'm074', teamA: 'Brazil',             teamB: 'Japan'               }, // Jun 29 17:00 UTC
  { id: 'm075', teamA: 'Germany',            teamB: 'Paraguay'            }, // Jun 29 20:30 UTC
  { id: 'm076', teamA: 'Netherlands',        teamB: 'Morocco'             }, // Jun 30 01:00 UTC
  { id: 'm077', teamA: 'Ivory Coast',        teamB: 'Norway'              }, // Jun 30 17:00 UTC
  { id: 'm078', teamA: 'France',             teamB: 'Sweden'              }, // Jun 30 21:00 UTC
  { id: 'm079', teamA: 'Mexico',             teamB: 'Ecuador'             }, // Jul 01 01:00 UTC
  { id: 'm080', teamA: 'England',            teamB: 'DR Congo'            }, // Jul 01 16:00 UTC
  { id: 'm081', teamA: 'Belgium',            teamB: 'Senegal'             }, // Jul 01 20:00 UTC
  { id: 'm082', teamA: 'USA',                teamB: 'Bosnia & Herzegovina'}, // Jul 02 00:00 UTC
  { id: 'm083', teamA: 'Spain',              teamB: 'Austria'             }, // Jul 02 19:00 UTC
  { id: 'm084', teamA: 'Portugal',           teamB: 'Croatia'             }, // Jul 02 23:00 UTC
  { id: 'm085', teamA: 'Switzerland',        teamB: 'Algeria'             }, // Jul 03 03:00 UTC
  { id: 'm086', teamA: 'Australia',          teamB: 'Egypt'               }, // Jul 03 18:00 UTC
  { id: 'm087', teamA: 'Argentina',          teamB: 'Cape Verde'          }, // Jul 03 22:00 UTC
  { id: 'm088', teamA: 'Colombia',           teamB: 'Ghana'               }, // Jul 04 01:30 UTC
];

async function main() {
  const batch = db.batch();

  for (const { id, teamA, teamB } of FIXTURES) {
    const flagA = FLAG[teamA] || '🏳';
    const flagB = FLAG[teamB] || '🏳';
    batch.set(db.collection('matches').doc(id), { teamA, teamB, flagA, flagB }, { merge: true });
    console.log(`  ✅ ${id}: ${flagA} ${teamA} vs ${teamB} ${flagB}`);
  }

  await batch.commit();
  console.log(`\nDone. ${FIXTURES.length} R32 fixtures written to Firestore.`);
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
