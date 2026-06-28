/**
 * sync-knockout-teams.js
 * Fetches confirmed knockout fixtures from football-data.org and writes
 * teamA / teamB / flagA / flagB to Firestore so the app shows real teams.
 *
 * Run manually via GitHub Actions workflow_dispatch, or locally:
 *   FOOTBALL_API_KEY=xxx FIREBASE_SERVICE_ACCOUNT='...' node sync-knockout-teams.js
 */

'use strict';
const https = require('https');
const admin = require('firebase-admin');

const MATCHES = require('./matches-index.json');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Flag map (all 48 WC 2026 teams) ──────────────────────────────────────────
const FLAG = {
  'Mexico':               '🇲🇽',
  'South Africa':         '🇿🇦',
  'South Korea':          '🇰🇷',
  'Czechia':              '🇨🇿',
  'Czech Republic':       '🇨🇿',
  'Canada':               '🇨🇦',
  'Bosnia & Herzegovina': '🇧🇦',
  'Bosnia and Herzegovina':'🇧🇦',
  'Qatar':                '🇶🇦',
  'Switzerland':          '🇨🇭',
  'Brazil':               '🇧🇷',
  'Morocco':              '🇲🇦',
  'Haiti':                '🇭🇹',
  'Scotland':             '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'USA':                  '🇺🇸',
  'United States':        '🇺🇸',
  'Paraguay':             '🇵🇾',
  'Australia':            '🇦🇺',
  'Türkiye':              '🇹🇷',
  'Turkey':               '🇹🇷',
  'Germany':              '🇩🇪',
  'Curaçao':              '🇨🇼',
  'Curacao':              '🇨🇼',
  'Ivory Coast':          '🇨🇮',
  "Côte d'Ivoire":        '🇨🇮',
  'Ecuador':              '🇪🇨',
  'Netherlands':          '🇳🇱',
  'Japan':                '🇯🇵',
  'Sweden':               '🇸🇪',
  'Tunisia':              '🇹🇳',
  'Belgium':              '🇧🇪',
  'Egypt':                '🇪🇬',
  'Iran':                 '🇮🇷',
  'IR Iran':              '🇮🇷',
  'New Zealand':          '🇳🇿',
  'Spain':                '🇪🇸',
  'Cape Verde':           '🇨🇻',
  'Saudi Arabia':         '🇸🇦',
  'Uruguay':              '🇺🇾',
  'France':               '🇫🇷',
  'Senegal':              '🇸🇳',
  'Iraq':                 '🇮🇶',
  'Norway':               '🇳🇴',
  'Argentina':            '🇦🇷',
  'Algeria':              '🇩🇿',
  'Austria':              '🇦🇹',
  'Jordan':               '🇯🇴',
  'Portugal':             '🇵🇹',
  'DR Congo':             '🇨🇩',
  'Congo DR':             '🇨🇩',
  'Uzbekistan':           '🇺🇿',
  'Colombia':             '🇨🇴',
  'England':              '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'Croatia':              '🇭🇷',
  'Ghana':                '🇬🇭',
  'Panama':               '🇵🇦',
};

function flag(name) {
  return FLAG[name] || '🏳';
}

// Normalise team names returned by football-data.org
function normaliseName(apiName) {
  const MAP = {
    'United States':        'USA',
    'Turkey':               'Türkiye',
    'Curacao':              'Curaçao',
    "Côte d'Ivoire":        'Ivory Coast',
    'IR Iran':              'Iran',
    'Czech Republic':       'Czechia',
    'Bosnia and Herzegovina':'Bosnia & Herzegovina',
    'Congo DR':             'DR Congo',
  };
  return MAP[apiName] || apiName;
}

function fetchAPI(path) {
  return new Promise((resolve, reject) => {
    https.get({
      hostname: 'api.football-data.org',
      path,
      headers: { 'X-Auth-Token': process.env.FOOTBALL_API_KEY },
    }, res => {
      let data = '';
      res.on('data', c => data += c);
      res.on('end', () => {
        if (res.statusCode !== 200) { reject(new Error(`API ${res.statusCode}: ${data}`)); return; }
        try { resolve(JSON.parse(data)); } catch(e) { reject(e); }
      });
    }).on('error', reject);
  });
}

// ── Knockout matchIds we want to fill ────────────────────────────────────────
const KNOCKOUT_IDS = new Set([
  'R32', // will be replaced per-stage
]);

// All knockout matchIds from matches-index.json (m073–m104)
const KNOCKOUT_MATCHES = MATCHES.filter(m => {
  const n = parseInt(m.matchId.replace('m', ''), 10);
  return n >= 73;
});

async function main() {
  console.log(`Knockout matches to fill: ${KNOCKOUT_MATCHES.length}`);

  // Fetch all WC 2026 scheduled/upcoming matches
  // Try stage=LAST_32 first, fall back to date range for all knockout rounds
  let apiMatches = [];

  try {
    const data = await fetchAPI('/v4/competitions/WC/matches?season=2026&status=SCHEDULED');
    apiMatches = data.matches || [];
    console.log(`API SCHEDULED: ${apiMatches.length} match(es)`);
  } catch(e) {
    console.warn('SCHEDULED fetch failed:', e.message);
  }

  if (apiMatches.length === 0) {
    try {
      const data = await fetchAPI('/v4/competitions/WC/matches?season=2026&status=TIMED');
      apiMatches = data.matches || [];
      console.log(`API TIMED: ${apiMatches.length} match(es)`);
    } catch(e) {
      console.warn('TIMED fetch failed:', e.message);
    }
  }

  // Also grab already-in-progress or recently started ones
  try {
    const data = await fetchAPI('/v4/competitions/WC/matches?season=2026&status=IN_PLAY');
    apiMatches = [...apiMatches, ...(data.matches || [])];
  } catch(_) {}

  // Filter to knockout rounds only (LAST_32, LAST_16, QUARTER_FINALS, SEMI_FINALS, FINAL)
  const knockoutStages = new Set(['LAST_32','LAST_16','QUARTER_FINALS','SEMI_FINALS','FINAL']);
  const knockoutAPI = apiMatches.filter(m => knockoutStages.has(m.stage));
  console.log(`Knockout fixtures from API: ${knockoutAPI.length}`);

  if (knockoutAPI.length === 0) {
    console.log('No knockout fixtures found in API yet — nothing to write.');
    process.exit(0);
  }

  const batch = db.batch();
  let written = 0;

  for (const apiM of knockoutAPI) {
    const apiTime = new Date(apiM.utcDate).getTime();

    // Match to our fixture by kickoff time (±10 min tolerance)
    const ourMatch = KNOCKOUT_MATCHES.find(
      m => Math.abs(new Date(m.kickoffUTC).getTime() - apiTime) < 10 * 60 * 1000
    );

    if (!ourMatch) {
      console.log(`  ⚠️  No match found for API fixture: ${apiM.homeTeam?.name} vs ${apiM.awayTeam?.name} @ ${apiM.utcDate}`);
      continue;
    }

    const teamA = normaliseName(apiM.homeTeam?.name || 'TBD');
    const teamB = normaliseName(apiM.awayTeam?.name || 'TBD');
    const flagA = flag(teamA);
    const flagB = flag(teamB);

    // Skip if both teams are still unknown
    if (teamA === 'TBD' && teamB === 'TBD') continue;

    const ref = db.collection('matches').doc(ourMatch.matchId);
    batch.set(ref, { teamA, teamB, flagA, flagB }, { merge: true });
    console.log(`  ✅ ${ourMatch.matchId}: ${flagA} ${teamA} vs ${teamB} ${flagB}`);
    written++;
  }

  if (written > 0) {
    await batch.commit();
    console.log(`\nDone. ${written} knockout fixture(s) written to Firestore.`);
  } else {
    console.log('\nNothing written — all fixtures already matched or teams unknown.');
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
