/**
 * seed-r32-teams.js — confirmed from FIFA official fixture list (screenshot)
 */
'use strict';
const admin = require('firebase-admin');
const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

const FLAG = {
  'South Africa':         '🇿🇦', 'Canada':               '🇨🇦',
  'Germany':              '🇩🇪', 'Paraguay':             '🇵🇾',
  'Netherlands':          '🇳🇱', 'Morocco':              '🇲🇦',
  'Brazil':               '🇧🇷', 'Japan':                '🇯🇵',
  'France':               '🇫🇷', 'Sweden':               '🇸🇪',
  'Ivory Coast':          '🇨🇮', 'Norway':               '🇳🇴',
  'Mexico':               '🇲🇽', 'Ecuador':              '🇪🇨',
  'England':              '🏴󠁧󠁢󠁥󠁮󠁧󠁿', 'DR Congo':             '🇨🇩',
  'USA':                  '🇺🇸', 'Bosnia & Herzegovina': '🇧🇦',
  'Belgium':              '🇧🇪', 'Senegal':              '🇸🇳',
  'Portugal':             '🇵🇹', 'Croatia':              '🇭🇷',
  'Spain':                '🇪🇸', 'Austria':              '🇦🇹',
  'Switzerland':          '🇨🇭', 'Algeria':              '🇩🇿',
  'Argentina':            '🇦🇷', 'Cape Verde':           '🇨🇻',
  'Colombia':             '🇨🇴', 'Ghana':                '🇬🇭',
  'Australia':            '🇦🇺', 'Egypt':                '🇪🇬',
};

// Correct mapping per FIFA official fixture numbers (from screenshot)
const FIXTURES = [
  { id: 'm073', teamA: 'South Africa',       teamB: 'Canada'               },
  { id: 'm074', teamA: 'Germany',            teamB: 'Paraguay'             },
  { id: 'm075', teamA: 'Netherlands',        teamB: 'Morocco'              },
  { id: 'm076', teamA: 'Brazil',             teamB: 'Japan'                },
  { id: 'm077', teamA: 'France',             teamB: 'Sweden'               },
  { id: 'm078', teamA: 'Ivory Coast',        teamB: 'Norway'               },
  { id: 'm079', teamA: 'Mexico',             teamB: 'Ecuador'              },
  { id: 'm080', teamA: 'England',            teamB: 'DR Congo'             },
  { id: 'm081', teamA: 'USA',                teamB: 'Bosnia & Herzegovina' },
  { id: 'm082', teamA: 'Belgium',            teamB: 'Senegal'              },
  { id: 'm083', teamA: 'Portugal',           teamB: 'Croatia'              },
  { id: 'm084', teamA: 'Spain',              teamB: 'Austria'              },
  { id: 'm085', teamA: 'Switzerland',        teamB: 'Algeria'              },
  { id: 'm086', teamA: 'Argentina',          teamB: 'Cape Verde'           },
  { id: 'm087', teamA: 'Colombia',           teamB: 'Ghana'                },
  { id: 'm088', teamA: 'Australia',          teamB: 'Egypt'                },
];

async function main() {
  const batch = db.batch();
  for (const { id, teamA, teamB } of FIXTURES) {
    const flagA = FLAG[teamA] || '🏳';
    const flagB = FLAG[teamB] || '🏳';
    batch.set(db.collection('matches').doc(id), { teamA, teamB, flagA, flagB }, { merge: true });
    console.log(`✅ ${id}: ${flagA} ${teamA} vs ${teamB} ${flagB}`);
  }
  await batch.commit();
  console.log(`\nDone. All 16 R32 fixtures written.`);
  process.exit(0);
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
