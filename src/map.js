// Borderless, label-free world map built on Leaflet with no tile layer —
// just bundled land geometry, a faint graticule, and glowing life pins.
import { fmtYear } from './util.js';

const L = window.L;

export class GameMap {
  constructor(elId) {
    this.map = L.map(elId, {
      preferCanvas: true,
      worldCopyJump: false,
      zoomControl: false,
      attributionControl: false,
      zoomSnap: 0.25,
      minZoom: 1.4,
      maxZoom: 9,
      maxBoundsViscosity: 0.9,
    });
    this.map.setView([25, 10], 1.6);
    L.control.zoom({ position: 'bottomright' }).addTo(this.map);

    this.roundLayer = L.layerGroup().addTo(this.map);
    this._ready = this._loadLand();
  }

  async _loadLand() {
    const res = await fetch('data/land.geojson');
    const land = await res.json();
    this._drawGraticule();
    this.landLayer = L.geoJSON(land, {
      interactive: false,
      style: {
        color: 'var(--coast)',
        weight: 0.6,
        fillColor: 'var(--land)',
        fillOpacity: 1,
      },
    }).addTo(this.map);
    // CSS variables don't resolve inside canvas; resolve them to real colors.
    this._applyColors();
  }

  _applyColors() {
    const cs = getComputedStyle(document.documentElement);
    const land = cs.getPropertyValue('--land').trim() || '#26344f';
    const coast = cs.getPropertyValue('--coast').trim() || '#3a4d70';
    this.landLayer.setStyle({ color: coast, fillColor: land });
  }

  _drawGraticule() {
    const style = { color: 'var(--grid)', weight: 0.5, interactive: false, opacity: 0.5 };
    const cs = getComputedStyle(document.documentElement);
    style.color = cs.getPropertyValue('--grid').trim() || '#2a3656';
    const lines = [];
    for (let lng = -180; lng <= 180; lng += 30) {
      lines.push([[-85, lng], [85, lng]]);
    }
    for (let lat = -60; lat <= 80; lat += 30) {
      lines.push([[lat, -180], [lat, 180]]);
    }
    this.graticule = L.layerGroup(lines.map((l) => L.polyline(l, style))).addTo(this.map);
  }

  ready() {
    return this._ready;
  }

  invalidate() {
    this.map.invalidateSize();
  }

  _pin(kind, lat, lng, year) {
    const cls = kind === 'birth' ? 'pin pin-birth' : 'pin pin-death';
    const label = kind === 'birth' ? 'Born' : 'Died';
    const icon = L.divIcon({
      className: 'pin-wrap',
      html: `<div class="${cls}"><span class="pin-dot"></span>
             <span class="pin-chip">${label}&nbsp;${fmtYear(year)}</span></div>`,
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    return L.marker([lat, lng], { icon, interactive: false, keyboard: false });
  }

  /** Show one figure's birth (and death, if present) with an animated fit. */
  show(figure, { animate = true } = {}) {
    this.map.invalidateSize({ animate: false });
    this.roundLayer.clearLayers();
    const pts = [[figure.birthLat, figure.birthLng]];
    this._pin('birth', figure.birthLat, figure.birthLng, figure.birthYear).addTo(this.roundLayer);

    if (figure.deathLat != null) {
      pts.push([figure.deathLat, figure.deathLng]);
      this._pin('death', figure.deathLat, figure.deathLng, figure.deathYear).addTo(this.roundLayer);
      L.polyline(pts, {
        className: 'lifeline',
        color: '#9fb2d8',
        weight: 1.5,
        dashArray: '2 7',
        opacity: 0.7,
        interactive: false,
      }).addTo(this.roundLayer);
    }

    const bounds = L.latLngBounds(pts).pad(0.35);
    const sized = this.map.getSize().x > 0;
    const opts = { paddingTopLeft: [60, 120], paddingBottomRight: [60, 230], maxZoom: 4.5 };
    if (animate && sized) this.map.flyToBounds(bounds, { ...opts, duration: 0.9 });
    else this.map.fitBounds(bounds, { ...opts, animate: false });
  }

  /** Drop a faint marker where a wrong guess was born (deduction aid). */
  addGuessGhost(figure) {
    if (figure.birthLat == null) return;
    const icon = L.divIcon({
      className: 'pin-wrap',
      html: '<div class="pin pin-ghost"><span class="pin-dot"></span></div>',
      iconSize: [0, 0],
      iconAnchor: [0, 0],
    });
    L.marker([figure.birthLat, figure.birthLng], { icon, interactive: false }).addTo(this.roundLayer);
  }
}
