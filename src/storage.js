// Thin localStorage wrapper holding stats, streaks and daily history.

const KEY = 'whence.v1';

const DEFAULTS = {
  endlessBest: 0,
  endlessBestStreak: 0,
  played: 0,
  solved: 0,
  guessDist: [0, 0, 0, 0, 0, 0], // index = guesses-1 used to solve
  fails: 0,
  daily: {}, // dateKey -> { score, results:[guessesUsedOrNull], done:true }
  dailyStreak: 0,
  dailyLastDate: null,
};

function load() {
  try {
    return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch {
    return { ...DEFAULTS };
  }
}

let state = load();

function save() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state));
  } catch {
    /* private mode / quota — ignore, game still playable in-memory */
  }
}

export const stats = () => state;

/** Record a finished round (any mode) for aggregate stats. */
export function recordRound(solved, guessesUsed) {
  state.played++;
  if (solved) {
    state.solved++;
    state.guessDist[Math.min(guessesUsed, 6) - 1]++;
  } else {
    state.fails++;
  }
  save();
}

export function recordEndless(score, streak) {
  state.endlessBest = Math.max(state.endlessBest, score);
  state.endlessBestStreak = Math.max(state.endlessBestStreak, streak);
  save();
}

export function getDaily(dateKey) {
  return state.daily[dateKey] || null;
}

/** Persist the completed daily run and update the day-streak. */
export function recordDaily(dateKey, payload) {
  state.daily[dateKey] = payload;
  // streak: increment if yesterday was played, else reset to 1.
  const prev = new Date(dateKey + 'T00:00:00Z');
  prev.setUTCDate(prev.getUTCDate() - 1);
  const yKey = prev.toISOString().slice(0, 10);
  if (state.dailyLastDate === yKey) state.dailyStreak += 1;
  else if (state.dailyLastDate !== dateKey) state.dailyStreak = 1;
  state.dailyLastDate = dateKey;
  save();
}
