import { applyCrop, afterChange } from '../actions';
import { $, toast } from '../dom';
import { snap } from '../history';
import { setPref } from '../prefs';
import { dirty } from '../render';
import { posterGeo, st, V } from '../state';
import { fitView } from '../view';
import type { LayoutGuide } from '../types';

function changeGuides(next: LayoutGuide[]) {
  applyCrop();
  snap();
  st.layoutGuides = next;
  st.sheetsOn = true;
  afterChange();
}

export function removeGuide(guide: LayoutGuide) {
  if (st.layoutGuides.includes(guide)) changeGuides(st.layoutGuides.filter(line => line !== guide));
}

export function placeGuide(axis: LayoutGuide['axis'], at: number, original: LayoutGuide | null = null) {
  if (original && (!st.layoutGuides.includes(original) || original.at === at)) return;
  if (!Number.isFinite(at)) return;
  const g = posterGeo(), limit = axis === 'x' ? g.W : g.H;
  if (at < 0 || at > limit) {
    toast(`La guía debe estar entre 0 y ${Number(limit.toFixed(3)).toLocaleString('es')} mm.`);
    return;
  }
  if (st.layoutGuides.some((g) => g.axis === axis && g.at === at)) { toast('Ya hay una guía en esa posición'); return; }
  const line = { axis, at };
  changeGuides(original ? st.layoutGuides.map(g => g === original ? line : g) : [...st.layoutGuides, line]);
}

export function initGuides() {
  const rulers = $<HTMLInputElement>('#rulers');
  rulers.checked = st.rulers;
  rulers.onchange = () => {
    st.rulers = rulers.checked; setPref('rulers', String(st.rulers));
    if (V.fitted) fitView(); else dirty();
  };
  for (const key of ['showGuides', 'snapGuides'] as const) {
    const field = $<HTMLInputElement>('#' + key);
    field.checked = st[key];
    field.onchange = () => { st[key] = field.checked; setPref(key, String(field.checked)); dirty(); };
  }
}
