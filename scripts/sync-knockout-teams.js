/**
 * sync-knockout-teams.js
 * Fetches ALL WC 2026 fixtures from football-data.org and writes confirmed
 * knockout teamA / teamB / flagA / flagB to Firestore.
 *
 * Run manually via GitHub Actions workflow_dispatch.
 */

'use strict';
const https = require('https');
const admin = require('firebase-admin');

const MATCHES = require('./matches-index.json');

const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
admin.initializeApp({ credential: admin.credential.cert(serviceAccount) });
const db = admin.firestore();

// ── Flag map ──────────────────────────────────────────────────────────────────
const FLAG = {
  'Mexico':                '🇲🇽',
  'South Africa':          '🇿🇦',
  'South Korea':           '🇰🇷',
  'Czechia':               '🇨🇿',
  'Czech Republic':        '🇨🇿',
  'Canada':                '🇨🇦',
  'Bosnia & Herzegovina':  '🇧🇦',
  'Bosnia and Herzegovina':'🇧🇦',
  'Qatar':                 '🇶🇦',
  'Switzerland':           '🇨🇭',
  'Brazil':                '🇧🇷',
  'Morocco':               '🇲🇦',
  'Haiti':                 '🇭🇹',
  'Scotland':              '🏴󠁧󠁢󠁳󠁣󠁴󠁿',
  'USA':                   '🇺🇸',
  'United States':         '🇺🇸',
  'Paraguay':              '🇵🇾',
  'Australia':             '🇦🇺',
  'Türkiye':               '🇹🇷',
  'Turkey':                '🇹🇷',
  'Germany':               '🇩🇪',
  'Curaçao':               '🇨🇼',
  'Curacao':               '🇨🇼',
  'Ivory Coast':           '🇨🇮',
  "Côte d'Ivoire":         '🇨🇮',
  'Ecuador':               '🇪🇨',
  'Netherlands':           '🇳🇱',
  'Japan':                 '🇯🇵',
  'Sweden':                '🇸🇪',
  'Tunisia':               '🇹🇳',
  'Belgium':               '🇧🇪',
  'Egypt':                 '🇪🇬',
  'Iran':                  '🇮🇷',
  'IR Iran':               '🇮🇷',
  'New Zealand':           '🇳🇿',
  'Spain':                 '🇪🇸',
  'Cape Verde':            '🇨🇻',
  'Saudi Arabia':          '🇸🇦',
  'Uruguay':               '🇺🇾',
  'France':                '🇫🇷',
  'Senegal':               '🇸🇳',
  'Iraq':                  '🇮🇶',
  'Norway':                '🇳🇴',
  'Argentina':             '🇦🇷',
  'Algeria':               '🇩🇿',
  'Austria':               '🇦🇹',
  'Jordan':                '🇯🇴',
  'Portugal':              '🇵🇹',
  'DR Congo':              '🇨🇩',
  'Congo DR':              '🇨🇩',
  'Uzbekistan':            '🇺🇿',
  'Colombia':              '🇨🇴',
  'England':               '🏴󠁧󠁢󠁥󠁮󠁧󠁿',
  'Croatia':               '🇭🇷',
  'Ghana':                 '🇬🇭',
  'Panama':                '🇵🇦',
};

// Normalise API team names to our app's names
const NAME_MAP = {
  'United States':         'USA',
  'Turkey':                'Türkiye',
  'Curacao':               'Curaçao',
  "Côte d'Ivoire":         'Ivory Coast',
  'IR Iran':               'Iran',
  'Czech Republic':        'Czechia',
  'Bosnia and Herzegovina':'Bosnia & Herzegovina',
  'Congo DR':              'DR Congo',
};

function normaliseName(n) { return NAME_MAP[n] || n; }
function getFlag(name)    { return FLAG[name] || '🏳'; }

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

// Our knockout matchIds (m073 onwards)
const KNOCKOUT_MATCHES = MATCHES.filter(m => parseInt(m.matchId.replace('m', ''), 10) >= 73);

async function main() {
  console.log(`Our knockout fixtures: ${KNOCKOUT_MATCHES.length} (m073–m104)`);

  // Fetch ALL WC 2026 matches — no status filter, get everything
  const data = await fetchAPI('/v4/competitions/WC/matches?season=2026');
  const all = data.matches || [];
  console.log(`API returned ${all.length} total WC 2026 matches`);

  // Log all unique stage names to help debug
  const stages = [...new Set(all.map(m => m.stage))];
  console.log(`Stages seen: ${stages.join(', ')}`);

  const batch = db.batch();
  let written = 0;
  let skipped = 0;

  for (const apiM of all) {
    const homeName = apiM.homeTeam?.name;
    const awayName = apiM.awayTeam?.name;

    // Skip group stage or matches with unknown teams
    if (!homeName || !awayName) { skipped++; continue; }
    // Skip if both teams are placeholder/unknown (API uses empty string or specific placeholders)
    if (homeName.includes('TBD') || awayName.includes('TBD') ||
        homeName === '' || awayName === '') { skipped++; continue; }

    const apiTime = new Date(apiM.utcDate).getTime();

    // Match to our fixture by kickoff time (±10 min)
    const ourMatch = KNOCKOUT_MATCHES.find(
      m => Math.abs(new Date(m.kickoffUTC).getTime() - apiTime) < 10 * 60 * 1000
    );

    if (!ourMatch) {
      // Not a knockout fixture in our index — skip silently
      continue;
    }

    const teamA = normaliseName(homeName);
    const teamB = normaliseName(awayName);
    const flagA = getFlag(teamA);
    const flagB = getFlag(teamB);

    const ref = db.collection('matches').doc(ourMatch.matchId);
    batch.set(ref, { teamA, teamB, flagA, flagB }, { merge: true });
    console.log(`  ✅ ${ourMatch.matchId} [${apiM.stage}]: ${flagA} ${teamA} vs ${teamB} ${flagB}`);
    written++;
  }

  if (written > 0) {
    await batch.commit();
    console.log(`\nDone. ${written} knockout fixture(s) written to Firestore.`);
  } else {
    console.log(`\nNothing written. API may not have confirmed teams yet, or kickoff times don't match.`);
    console.log('Dump of all API knockout-range fixtures:');
    // Jun 28 – Jul 19 = R32 through Final
    const start = new Date('2026-06-28').getTime();
    const end   = new Date('2026-07-20').getTime();
    all.filter(m => {
      const t = new Date(m.utcDate).getTime();
      return t >= start && t <= end;
    }).forEach(m => {
      console.log(`  ${m.utcDate} | stage=${m.stage} | ${m.homeTeam?.name} vs ${m.awayTeam?.name}`);
    });
  }

  process.exit(0);
}

main().catch(e => {
  console.error('Fatal:', e.message);
  process.exit(1);
});
