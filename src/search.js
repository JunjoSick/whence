// Fuzzy type-to-guess autocomplete over the figure list.
import { normalize, el } from './util.js';

export class AutoComplete {
  constructor(input, list, figures, onPick) {
    this.input = input;
    this.list = list;
    this.onPick = onPick;
    this.active = -1;
    this.matches = [];
    this.index = figures.map((f) => ({ f, norm: normalize(f.name) }));

    input.addEventListener('input', () => this.render(input.value));
    input.addEventListener('keydown', (e) => this.onKey(e));
    document.addEventListener('click', (e) => {
      if (!list.contains(e.target) && e.target !== input) this.close();
    });
  }

  search(query) {
    const q = normalize(query);
    if (q.length < 1) return [];
    const scored = [];
    for (const item of this.index) {
      const n = item.norm;
      let score = -1;
      if (n === q) score = 0;
      else if (n.startsWith(q)) score = 1;
      else if (n.split(' ').some((w) => w.startsWith(q))) score = 2;
      else if (n.includes(q)) score = 3;
      if (score >= 0) scored.push({ item, score });
    }
    scored.sort((a, b) => a.score - b.score || (b.item.f.views || 0) - (a.item.f.views || 0));
    return scored.slice(0, 8).map((s) => s.item.f);
  }

  render(query) {
    this.matches = this.search(query);
    this.active = -1;
    this.list.innerHTML = '';
    if (!this.matches.length) {
      this.close();
      return;
    }
    for (const f of this.matches) {
      const row = el(
        'li',
        { class: 'sugg', onmousedown: (e) => { e.preventDefault(); this.pick(f); } },
        el('span', { class: 'sugg-name', text: f.name })
      );
      this.list.append(row);
    }
    this.list.classList.add('open');
  }

  onKey(e) {
    if (!this.list.classList.contains('open')) {
      if (e.key === 'Enter' && this.matches.length) this.pick(this.matches[0]);
      return;
    }
    const rows = [...this.list.children];
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      this.active = Math.min(this.active + 1, rows.length - 1);
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      this.active = Math.max(this.active - 1, 0);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const f = this.matches[this.active >= 0 ? this.active : 0];
      if (f) this.pick(f);
      return;
    } else if (e.key === 'Escape') {
      this.close();
      return;
    } else {
      return;
    }
    rows.forEach((r, i) => r.classList.toggle('hl', i === this.active));
  }

  pick(figure) {
    this.input.value = '';
    this.close();
    this.onPick(figure);
  }

  close() {
    this.list.classList.remove('open');
    this.list.innerHTML = '';
    this.active = -1;
  }

  focus() {
    this.input.focus();
  }

  clear() {
    this.input.value = '';
    this.close();
  }
}
