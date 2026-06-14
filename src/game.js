// Game orchestrator: round lifecycle, scoring, the two modes, and all the
// in-game UI (guess history, reveal card, daily results).
import { $, el, fmtYear, haversine, bearing, arrowFor, fmtKm, hashStr, rng, shuffle, todayKey, sleep } from './util.js';
import { AutoComplete } from './search.js';
import { buildShare, copyShare } from './share.js';
import * as store from './storage.js';

const MAX_GUESSES = 6;
const DAILY_ROUNDS = 5;
const points = (g) => Math.max(0, 1000 - (g - 1) * 150);

export class Game {
  constructor(figures, gameMap) {
    this.figures = figures;
    this.byId = new Map(figures.map((f) => [f.id, f]));
    this.map = gameMap;
    // figures.json is sorted by pageviews desc, so the head is the most
    // recognizable. Daily stays tight (household names); Endless casts wider.
    this.dailyPool = figures.slice(0, 220);
    this.endlessPool = figures.slice(0, 650);

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
  startEndless() {
    this.mode = 'endless';
    this.endless = { score: 0, streak: 0, count: 0, queue: shuffle(this.endlessPool) };
    this.enterGame();
    this.nextRound();
  }

  startDaily() {
    this.mode = 'daily';
    const key = todayKey();
    const seed = hashStr('whence|' + key);
    const order = shuffle(this.dailyPool, rng(seed));
    const figs = order.slice(0, DAILY_ROUNDS);
    const prev = store.getDaily(key);
    this.daily = { key, figs, idx: 0, results: [], score: 0, replay: !!(prev && prev.done) };
    this.enterGame();
    this.loadRound(figs[0]);
  }

  // ---- round lifecycle ----------------------------------------------------
  nextRound() {
    $('#reveal').classList.add('hidden');
    if (this.mode === 'endless') {
      if (!this.endless.queue.length) this.endless.queue = shuffle(this.endlessPool);
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
    this.updateAttempts();
    this.updateTopbar();
    setTimeout(() => this.ac.focus(), 300);
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
    const yearText = dy === 0 ? 'same birth year' : `${Math.abs(dy)} yrs ${dy > 0 ? 'newer' : 'older'}`;
    const shared = guess.occupations.filter((o) => target.occupations.includes(o));
    const heat = dist < 400 ? 'hot' : dist < 1500 ? 'warm' : dist < 5000 ? 'cool' : 'cold';

    const row = el(
      'div',
      { class: `guess-row heat-${heat}` },
      el('span', { class: 'gr-name', text: guess.name }),
      el('span', { class: 'gr-geo', html: `${dist < 30 ? '◎' : arrowFor(brg)} ${fmtKm(dist)}` }),
      el('span', { class: 'gr-year', text: yearText }),
      shared.length ? el('span', { class: 'gr-occ', text: `also ${shared[0]}` }) : null
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
    $('#rv-name').textContent = f.name;
    $('#rv-life').textContent = life;
    $('#rv-desc').textContent = f.desc || '';

    const occWrap = $('#rv-occ');
    occWrap.innerHTML = '';
    f.occupations.slice(0, 5).forEach((o) => occWrap.append(el('span', { class: 'chip', text: o })));

    const route = $('#rv-route');
    if (f.birthPlace || f.deathPlace) {
      const parts = [];
      if (f.birthPlace) parts.push(`★ ${f.birthPlace}`);
      if (f.deathPlace) parts.push(`✦ ${f.deathPlace}`);
      route.textContent = parts.join('   →   ') + (span ? `   ·   ${fmtKm(span)} apart` : '');
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
