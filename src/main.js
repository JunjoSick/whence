// Bootstrap: load data + map, wire the home screen, launch modes.
import { $, todayKey } from './util.js';
import { GameMap } from './map.js';
import { Game } from './game.js';
import * as store from './storage.js';

// Keep the bottom panel above the on-screen keyboard on mobile by tracking the
// visual viewport (the area not covered by the keyboard) and exposing the
// overlap as --kb, which the panel's `bottom` reads.
function setupKeyboardInset() {
  const vv = window.visualViewport;
  if (!vv) return;
  const update = () => {
    const overlap = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
    document.documentElement.style.setProperty('--kb', overlap + 'px');
  };
  vv.addEventListener('resize', update);
  vv.addEventListener('scroll', update);
  update();
}

async function boot() {
  setupKeyboardInset();
  const loader = $('#loader');
  try {
    const [figures, gameMap] = await Promise.all([
      fetch('data/figures.json').then((r) => r.json()),
      Promise.resolve(new GameMap('map')),
    ]);
    await gameMap.ready();

    const game = new Game(figures, gameMap);
    window.__game = game; // handy for debugging

    $('#play-daily').addEventListener('click', () => game.startDaily());
    $('#play-endless').addEventListener('click', () => game.startEndless());
    $('#how-open').addEventListener('click', () => $('#howto').classList.remove('hidden'));
    $('#how-close').addEventListener('click', () => $('#howto').classList.add('hidden'));
    $('#res-home').addEventListener('click', () => game.goHome());
    $('#res-endless').addEventListener('click', () => game.startEndless());

    document.addEventListener('refresh-home', renderHome);
    renderHome();

    $('#stat-count').textContent = figures.length.toLocaleString();
    loader.classList.add('gone');
  } catch (err) {
    loader.innerHTML = `<div class="load-err">Couldn't load the game.<br><small>${err}</small></div>`;
    console.error(err);
  }
}

function renderHome() {
  const s = store.stats();
  const key = todayKey();
  const today = store.getDaily(key);

  const dailyBtn = $('#play-daily');
  const sub = $('#daily-sub');
  if (today && today.done) {
    sub.textContent = `Done today · ${today.score.toLocaleString()} pts · tap to replay`;
    dailyBtn.classList.add('done');
  } else {
    sub.textContent = 'Five lives. Six guesses each.';
    dailyBtn.classList.remove('done');
  }

  const acc = s.played ? Math.round((s.solved / s.played) * 100) : 0;
  $('#hs-best').textContent = s.endlessBest.toLocaleString();
  $('#hs-streak').textContent = s.dailyStreak || 0;
  $('#hs-acc').textContent = s.played ? acc + '%' : '—';
}

boot();
