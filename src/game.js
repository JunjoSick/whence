// Game orchestrator: round lifecycle, scoring, the two modes, and all the
// in-game UI (guess history, reveal card, daily results).
import { $, el, fmtYear, haversine, bearing, arrowFor, fmtKm, hashStr, rng, shuffle, todayKey, computeDifficulty, heatFor } from './util.js';
import { AutoComplete } from './search.js';
import { buildShare, copyShare } from './share.js';
import * as store from './storage.js';

const MAX_GUESSES = 6;
const DAILY_ROUNDS = 5;
const points = (g) => Math.max(0, 1000 - (g - 1) * 150);

const DIFF_META = {
  easy:   { label: 'Easy',   level: 0 },
  medium: { label: 'Medium', level: 1 },
  hard:   { label: 'Hard',   level: 2 },
  expert: { label: 'Expert', level: 3 },
};

export class Game {
  constructor(figures, gameMap) {
    this.figures = figures;
    this.byId = new Map(figures.map((f) => [f.id, f]));
    this.map = gameMap;

    // figures.json is sorted by pageviews desc, so the index is the fame rank.
    // Tag every figure with a difficulty tier + the reasons it's hard.
    figures.forEach((f, i) => {
      const d = computeDifficulty(f, i);
      f.diff = d.tier;
      f.diffLevel = d.level;
      f.diffReasons = d.reasons;
    });
    // Endless draws from a difficulty bucket; Daily from a recognizable head.
    this.byTier = {
      easy: figures.filter((f) => f.diffLevel === 0),
      medium: figures.filter((f) => f.diffLevel <= 1),
      hard: figures.filter((f) => f.diffLevel >= 2),
    };
    this.dailyPool = figures.slice(0, 320);
    this.endlessDiff = store.getEndlessDiff();

    // cache DOM
    this.elHome = $('#home');
    this.elGame = $('#game');
    this.ac = new AutoComplete($('#guess-input'), $('#suggestions'), figures, (f) => this.onGuess(f));

    $('#giveup').addEventListener('click', () => this.giveUp());
    $('#to-home').addEventListener('click', () => this.goHome());
    $('#reveal-next').addEventListener('click', () => this.nextRound());
  }

  // ---- navigation ---------------------------------------------------------
  goHome() {
    this.elGame.classList.add('hidden');
    this.elHome.classList.remove('hidden');
    $('#reveal').classList.add('hidden');
    $('#results').classList.add('hidden');
    document.dispatchEvent(new CustomEvent('refresh-home'));
  }

  enterGame() {
    this.elHome.classList.add('hidden');
    this.elGame.classList.remove('hidden');
    // Size the map synchronously now that #game is displayed, so the first
    // round's fitBounds runs against a real container size (not 0×0).
    this.map.invalidate();
  }

  // ---- modes --------------------------------------------------------------
  setEndlessDiff(diff) {
    this.endlessDiff = diff;
    store.setEndlessDiff(diff);
  }

  startEndless() {
    this.mode = 'endless';
    const pool = this.byTier[this.endlessDiff] || this.byTier.medium;
    this.endless = { score: 0, streak: 0, count: 0, pool, queue: shuffle(pool) };
    this.enterGame();
    this.nextRound();
  }

  startDaily() {
    this.mode = 'daily';
    const key = todayKey();
    const seed = hashStr('whence|' + key);
    // Pick from the recognizable head, then ramp easiest -> hardest.
    const figs = shuffle(this.dailyPool, rng(seed))
      .slice(0, DAILY_ROUNDS)
      .sort((a, b) => a.diffLevel - b.diffLevel);
    const prev = store.getDaily(key);
    this.daily = { key, figs, idx: 0, results: [], score: 0, replay: !!(prev && prev.done) };
    this.enterGame();
    this.loadRound(figs[0]);
  }

  // ---- round lifecycle ----------------------------------------------------
  nextRound() {
    $('#reveal').classList.add('hidden');
    if (this.mode === 'endless') {
      if (!this.endless.queue.length) this.endless.queue = shuffle(this.endless.pool);
      this.loadRound(this.endless.queue.pop());
    } else {
      this.daily.idx++;
      if (this.daily.idx >= this.daily.figs.length) {
        this.finishDaily();
        return;
      }
      this.loadRound(this.daily.figs[this.daily.idx]);
    }
  }

  loadRound(figure) {
    this.round = { figure, guesses: [], solved: false, over: false };
    this.map.show(figure);
    this.ac.clear();
    $('#guess-input').disabled = false;
    $('#giveup').disabled = false;
    $('#history').innerHTML = '';
    this.renderClue();
    this.renderDiffBadge(figure);
    this.updateAttempts();
    this.updateTopbar();
    setTimeout(() => this.ac.focus(), 300);
  }

  renderDiffBadge(f) {
    const meta = DIFF_META[f.diff] || DIFF_META.medium;
    const badge = $('#diff-badge');
    badge.className = `diff-badge diff-${f.diff}`;
    const reason = f.diffReasons && f.diffReasons.length ? ` · ${f.diffReasons[0]}` : '';
    badge.innerHTML = `<span class="diff-dots">${'●'.repeat(meta.level + 1)}${'○'.repeat(3 - meta.level)}</span>` +
      `<span class="diff-label">${meta.label}</span><span class="diff-why">${reason}</span>`;
  }

  renderClue() {
    const f = this.round.figure;
    const born = `Born ${fmtYear(f.birthYear)}`;
    const died = f.deathYear != null ? `Died ${fmtYear(f.deathYear)}` : 'Still living';
    $('#clue-life').innerHTML =
      `<span class="cl-b">${born}</span>` +
      (f.deathYear != null ? `<span class="cl-sep">—</span><span class="cl-d">${died}</span>` : '<span class="cl-living">Still living</span>');
    $('#clue-life').setAttribute('aria-label', `${born}, ${died}`);
  }

  updateAttempts() {
    const used = this.round.guesses.length;
    const dots = $('#attempts');
    dots.innerHTML = '';
    for (let i = 0; i < MAX_GUESSES; i++) {
      const wrong = i < used && !(this.round.solved && i === used - 1);
      const ok = this.round.solved && i === used - 1;
      dots.append(el('span', { class: 'dot' + (ok ? ' dot-ok' : wrong ? ' dot-x' : '') }));
    }
    $('#attempts-left').textContent = this.round.over
      ? ''
      : `${MAX_GUESSES - used} ${MAX_GUESSES - used === 1 ? 'guess' : 'guesses'} left`;
  }

  // ---- guessing -----------------------------------------------------------
  onGuess(figure) {
    if (this.round.over) return;
    if (this.round.guesses.some((g) => g.id === figure.id)) {
      this.flashInput();
      return;
    }
    const target = this.round.figure;
    this.round.guesses.push(figure);

    if (figure.id === target.id) {
      this.round.solved = true;
      this.endRound(true);
      return;
    }

    this.renderFeedback(figure, target);
    this.map.addGuessGhost(figure);
    this.updateAttempts();

    if (this.round.guesses.length >= MAX_GUESSES) this.endRound(false);
  }

  renderFeedback(guess, target) {
    const dist = haversine(guess.birthLat, guess.birthLng, target.birthLat, target.birthLng);
    const brg = bearing(guess.birthLat, guess.birthLng, target.birthLat, target.birthLng);
    const dy = target.birthYear - guess.birthYear;
    const yearText = dy === 0 ? 'same year' : `${Math.abs(dy)} yrs ${dy > 0 ? 'newer' : 'older'}`;
    const shared = guess.occupations.filter((o) => target.occupations.includes(o));
    const { label, key, closeness } = heatFor(dist);
    const arrow = dist < 40 ? '◎' : arrowFor(brg);

    const row = el(
      'div',
      { class: `guess-row heat-${key}` },
      el('div', { class: 'gr-top' },
        el('span', { class: 'gr-name', text: guess.name }),
        el('span', { class: 'gr-heat', text: label })
      ),
      el('div', { class: 'gr-bar' }, el('i', { style: `width:${Math.round(closeness * 100)}%` })),
      el('div', { class: 'gr-meta' },
        el('span', { class: 'gr-geo', html: `<b>${arrow}</b> ${fmtKm(dist)}` }),
        el('span', { class: 'gr-year', html: `${dy > 0 ? '▲' : dy < 0 ? '▼' : '='} ${yearText}` }),
        shared.length ? el('span', { class: 'gr-occ', text: `also ${shared[0]}` }) : null
      )
    );
    $('#history').prepend(row);
  }

  flashInput() {
    const inp = $('#guess-input');
    inp.classList.remove('shake');
    void inp.offsetWidth;
    inp.classList.add('shake');
  }

  giveUp() {
    if (this.round.over) return;
    this.endRound(false);
  }

  endRound(solved) {
    this.round.over = true;
    $('#guess-input').disabled = true;
    $('#giveup').disabled = true;
    this.ac.close();
    const used = this.round.guesses.length || MAX_GUESSES;
    const gained = solved ? points(used) : 0;

    store.recordRound(solved, used);

    if (this.mode === 'endless') {
      this.endless.count++;
      this.endless.score += gained;
      this.endless.streak = solved ? this.endless.streak + 1 : 0;
      store.recordEndless(this.endless.score, this.endless.streak);
    } else {
      this.daily.results.push(solved ? used : null);
      this.daily.score += gained;
    }
    this.updateAttempts();
    this.updateTopbar();
    this.showReveal(solved, gained);
  }

  updateTopbar() {
    if (this.mode === 'endless') {
      $('#tb-mode').textContent = 'Endless';
      $('#tb-stat').innerHTML = `<b>${this.endless.score.toLocaleString()}</b> pts · 🔥 ${this.endless.streak}`;
    } else {
      $('#tb-mode').textContent = `Daily · ${Math.min(this.daily.idx + 1, DAILY_ROUNDS)}/${DAILY_ROUNDS}`;
      $('#tb-stat').innerHTML = `<b>${this.daily.score.toLocaleString()}</b> pts`;
    }
  }

  // ---- reveal -------------------------------------------------------------
  showReveal(solved, gained) {
    const f = this.round.figure;
    const used = this.round.guesses.length || MAX_GUESSES;
    const life = f.deathYear != null ? `${fmtYear(f.birthYear)} – ${fmtYear(f.deathYear)}` : `b. ${fmtYear(f.birthYear)}`;
    const span = f.deathLat != null
      ? haversine(f.birthLat, f.birthLng, f.deathLat, f.deathLng)
      : null;

    const img = $('#rv-img');
    if (f.image) {
      img.style.display = '';
      img.src = f.image;
      img.alt = f.name;
      img.onerror = () => { img.style.display = 'none'; };
    } else {
      img.style.display = 'none';
    }

    $('#rv-verdict').className = 'rv-verdict ' + (solved ? 'win' : 'lose');
    $('#rv-verdict').textContent = solved
      ? `Solved in ${used} ${used === 1 ? 'guess' : 'guesses'}  ·  +${gained}`
      : 'Out of guesses';

    const meta = DIFF_META[f.diff] || DIFF_META.medium;
    const diffEl = $('#rv-diff');
    diffEl.className = `rv-diff diff-${f.diff}`;
    diffEl.textContent = meta.label + (f.diffReasons.length ? ` · ${f.diffReasons.join(' · ')}` : '');

    $('#rv-name').textContent = f.name;
    $('#rv-life').textContent = life;
    $('#rv-desc').textContent = f.desc || '';

    // Closest guess — turns a miss into a "so close!" beat.
    const wrong = this.round.guesses.filter((g) => g.id !== f.id);
    const closeEl = $('#rv-closest');
    if (wrong.length) {
      let best = null;
      let bestD = Infinity;
      for (const g of wrong) {
        const d = haversine(g.birthLat, g.birthLng, f.birthLat, f.birthLng);
        if (d < bestD) { bestD = d; best = g; }
      }
      closeEl.innerHTML = `Closest: <b>${best.name}</b> — born ${fmtKm(bestD)} away`;
      closeEl.style.display = '';
    } else {
      closeEl.style.display = 'none';
    }

    const occWrap = $('#rv-occ');
    occWrap.innerHTML = '';
    f.occupations.slice(0, 5).forEach((o) => occWrap.append(el('span', { class: 'chip', text: o })));

    const route = $('#rv-route');
    if (f.birthPlace || f.deathPlace) {
      const parts = [];
      if (f.birthPlace) parts.push(`<span class="rt-b">Born ${f.birthPlace}</span>`);
      if (f.deathPlace) parts.push(`<span class="rt-d">Died ${f.deathPlace}</span>`);
      route.innerHTML = parts.join('<span class="rt-arr">→</span>') +
        (span ? `<span class="rt-span">${fmtKm(span)} apart</span>` : '');
      route.style.display = '';
    } else {
      route.style.display = 'none';
    }

    const link = $('#rv-wiki');
    if (f.wiki) { link.href = f.wiki; link.style.display = ''; } else link.style.display = 'none';

    const btn = $('#reveal-next');
    const lastDaily = this.mode === 'daily' && this.daily.idx >= DAILY_ROUNDS - 1;
    btn.textContent = lastDaily ? 'See results →' : 'Next →';

    $('#reveal').classList.remove('hidden');
  }

  // ---- daily results ------------------------------------------------------
  finishDaily() {
    const { key, results, score, replay } = this.daily;
    if (!replay) store.recordDaily(key, { score, results, done: true });

    $('#res-date').textContent = key;
    $('#res-score').textContent = score.toLocaleString();
    const solved = results.filter((r) => r != null).length;
    $('#res-sub').textContent = `${solved}/${DAILY_ROUNDS} solved` + (replay ? '  ·  practice replay' : '');

    const grid = $('#res-grid');
    grid.innerHTML = '';
    this.daily.figs.forEach((f, i) => {
      const g = results[i];
      const e = g == null ? '⬛' : g <= 1 ? '🟩' : g <= 2 ? '🟢' : g <= 4 ? '🟨' : '🟧';
      grid.append(
        el('div', { class: 'res-row' },
          el('span', { class: 'res-emoji', text: e }),
          el('span', { class: 'res-name', text: f.name }),
          el('span', { class: 'res-g', text: g == null ? 'missed' : `${g}/${MAX_GUESSES}` })
        )
      );
    });

    const dstreak = store.stats().dailyStreak;
    $('#res-streak').textContent = dstreak > 1 ? `🔥 ${dstreak}-day streak` : '';

    const shareBtn = $('#res-share');
    shareBtn.textContent = 'Share result';
    shareBtn.onclick = async () => {
      const ok = await copyShare(buildShare(key, results, score));
      shareBtn.textContent = ok ? 'Copied to clipboard ✓' : 'Copy failed';
      setTimeout(() => (shareBtn.textContent = 'Share result'), 1800);
    };

    $('#reveal').classList.add('hidden');
    $('#results').classList.remove('hidden');
  }
}
