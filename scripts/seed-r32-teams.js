/**
 * seed-r32-teams.js
 * One-time script to hardcode confirmed R32 fixture teams into Firestore.
 * Run manually: FIREBASE_SERVICE_ACCOUNT='...' node seed-r32-teams.js
 *
 * Source: Al Jazeera / NBC Sports / Olympics.com (June 28, 2026)
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
  'USA':                   '🇺🇸',
  'Bosnia & Herzegovina':  '🇧🇦',
  'Spain':                 '🇪🇸',
  'Switzerland':           '🇨🇭',
  'Australia':             '🇦🇺',
  'Argentina':             '🇦🇷',
  'Cape Verde':            '🇨🇻',
};

// Confirmed R32 fixtures (source: Al Jazeera, NBC Sports, Olympics.com - June 28 2026)
// matchId ordering follows our matches-index.json kickoff times (m073–m088)
const FIXTURES = {
  m073: { teamA: 'South Africa', teamB: 'Canada'    },   // Jun 28, 19:00Z — Los Angeles ✓
  m074: { teamA: 'Brazil',       teamB: 'Japan'      },   // Jun 29 day    — Houston
  m075: { teamA: 'Germany',      teamB: 'Paraguay'   },   // Jun 29, 20:30Z — Boston ✓
  m076: { teamA: 'Netherlands',  teamB: 'Morocco'    },   // Jun 29/30 night — Monterrey
  m077: { teamA: 'Ivory Coast',  teamB: 'Norway'     },   // Jun 30, 17:00Z — Dallas ✓
  m078: { teamA: 'France',       teamB: 'Sweden'     },   // Jun 30 evening — New York
  m079: { teamA: 'Mexico',       teamB: 'TBD'        },   // Jul 1, 01:00Z  — Mexico City (3rd place TBD)
  m080: { teamA: 'TBD',          teamB: 'TBD'        },   // Jul 1, 16:00Z  — Atlanta (1L vs 3rd)
  m081: { teamA: 'TBD',          teamB: 'TBD'        },   // Jul 1, 20:00Z  — Seattle (1G vs 3rd)
  m082: { teamA: 'USA',          teamB: 'Bosnia & Herzegovina' }, // Jul 1/2 — San Francisco
  m083: { teamA: 'Spain',        teamB: 'TBD'        },   // Jul 2          — Los Angeles (Spain vs 2J)
  m084: { teamA: 'TBD',          teamB: 'TBD'        },   // Jul 2, 23:00Z  — Toronto (2K vs 2L)
  m085: { teamA: 'Switzerland',  teamB: 'TBD'        },   // Jul 2/3        — Vancouver (3rd TBD)
  m086: { teamA: 'Australia',    teamB: 'TBD'        },   // Jul 3          — Dallas (vs 2G)
  m087: { teamA: 'Argentina',    teamB: 'Cape Verde'  },   // Jul 3          — Miami ✓
  m088: { teamA: 'TBD',          teamB: 'TBD'        },   // Jul 3/4        — Kansas City (1K vs 3rd)
};

async function main() {
  const batch = db.batch();
  let count = 0;

  for (const [matchId, { teamA, teamB }] of Object.entries(FIXTURES)) {
    // Only write if at least one team is known
    if (teamA === 'TBD' && teamB === 'TBD') {
      console.log(`  ⏭  ${matchId}: both TBD — skipping`);
      continue;
    }

    const flagA = FLAG[teamA] || '🏳';
    const flagB = FLAG[teamB] || '🏳';

    const ref = db.collection('matches').doc(matchId);
    batch.set(ref, { teamA, teamB, flagA, flagB }, { merge: true });
    console.log(`  ✅ ${matchId}: ${flagA} ${teamA} vs ${teamB} ${flagB}`);
    count++;
  }

  await batch.commit();
  console.log(`\nDone. ${count} fixtures written to Firestore.`);
  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
