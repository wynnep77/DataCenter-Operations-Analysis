#!/usr/bin/env node
// Smoke test for single-file simulation dashboards (no browser needed).
// CLI:   node smoke_test.js file.html [--ticks 300] [--eval "switchTab('bms');setSub('crac')"] [--dump-svg svgId:out.svg]
//        --eval runs after all tabs are visited (use it to open the view that builds a lazy SVG before dumping).
// Module: const app = require('./smoke_test.js').load('file.html');
//         app.eval('S.util = 1'); app.tick(10); app.click('about'); app.errors
const fs = require('fs'), vm = require('vm');

function parseTags(html) {
  const out = [];
  for (const m of html.matchAll(/<([a-zA-Z][\w-]*)(\s[^<>]*?)?\/?>/g)) {
    const attrs = {};
    for (const a of (m[2] || '').matchAll(/([\w:-]+)\s*=\s*("([^"]*)"|'([^']*)')/g)) attrs[a[1]] = a[3] !== undefined ? a[3] : a[4];
    out.push({ tag: m[1].toLowerCase(), attrs });
  }
  return out;
}

function load(file, opts = {}) {
  const html = fs.readFileSync(file, 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  const errors = [], els = {}, all = [], listeners = { doc: {}, win: {} }, intervals = [];
  const fnProxy = () => new Proxy(function () {}, { get: (t, k) => k === 'measureText' ? () => ({ width: 10 }) : (k in t ? t[k] : fnProxy()), set: (t, k, v) => { t[k] = v; return true; }, apply: () => fnProxy(), construct: () => fnProxy() });

  function mkEl(tag, attrs = {}) {
    const st = { ih: '', tc: '', val: attrs.value || '', attrs: { ...attrs }, ev: {} };
    const cl = new Set((attrs.class || '').split(/\s+/).filter(Boolean));
    const dataset = {};
    for (const k in attrs) if (k.startsWith('data-')) dataset[k.slice(5).replace(/-(\w)/g, (_, c) => c.toUpperCase())] = attrs[k];
    const el = {
      tagName: tag.toUpperCase(), id: attrs.id || '', style: { setProperty() {}, removeProperty() {} }, dataset, children: [], childNodes: [],
      classList: { add: (...c) => c.forEach(x => cl.add(x)), remove: (...c) => c.forEach(x => cl.delete(x)), toggle: (c, f) => { const on = f === undefined ? !cl.has(c) : !!f; on ? cl.add(c) : cl.delete(c); return on; }, contains: c => cl.has(c) },
      get className() { return [...cl].join(' '); }, set className(v) { cl.clear(); String(v).split(/\s+/).filter(Boolean).forEach(x => cl.add(x)); st.clsSet = true; },
      setAttribute: (k, v) => { st.attrs[k] = String(v); if (k === 'class') el.className = v; if (k.startsWith('data-')) dataset[k.slice(5)] = String(v); },
      getAttribute: k => k === 'class' ? el.className : (st.attrs[k] === undefined ? null : st.attrs[k]), removeAttribute: k => { delete st.attrs[k]; }, hasAttribute: k => k in st.attrs,
      addEventListener: (t, f) => { (st.ev[t] = st.ev[t] || []).push(f); }, removeEventListener() {}, dispatchEvent() { return true; },
      appendChild: c => c, removeChild: c => c, insertBefore: c => c, replaceChildren() {}, remove() {}, append() {}, prepend() {}, insertAdjacentHTML() {},
      querySelector: s => query(s)[0] || null, querySelectorAll: s => query(s), closest: () => null, matches: () => false, contains: () => false,
      focus() {}, blur() {}, click() { fire(el, 'click'); }, scrollIntoView() {}, getContext: () => fnProxy(), getTotalLength: () => 100, getBBox: () => ({ x: 0, y: 0, width: 50, height: 12 }),
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 800, height: 400, left: 0, top: 0, right: 800, bottom: 400 }),
      get innerHTML() { return st.ih; }, set innerHTML(v) { st.ih = String(v); }, get textContent() { return st.tc; }, set textContent(v) { st.tc = String(v); st.tcSet = true; },
      get innerText() { return st.tc; }, set innerText(v) { st.tc = String(v); st.tcSet = true; }, get value() { return st.val; }, set value(v) { st.val = v; },
      checked: false, disabled: false, hidden: false, open: false, clientWidth: 800, clientHeight: 400, offsetWidth: 800, offsetHeight: 400, width: 800, height: 400,
      _st: st, onclick: null,
    };
    el.parentNode = el.parentElement = { removeChild() {}, clientWidth: 800, clientHeight: 400, getBoundingClientRect: el.getBoundingClientRect, style: {} };
    return el;
  }
  function fire(el, type) {
    const ev = { type, target: el, currentTarget: el, preventDefault() {}, stopPropagation() {} };
    for (const f of (el._st.ev[type] || [])) f.call(el, ev);
    if (type === 'click' && typeof el.onclick === 'function') el.onclick(ev);
    const inline = el._st.attrs['on' + type];
    if (inline) vm.runInContext(`(function(event){${inline}}).call(__tmpEl, {preventDefault(){},stopPropagation(){}})`, Object.assign(ctx, { __tmpEl: el }));
  }
  for (const t of parseTags(html)) { const el = mkEl(t.tag, t.attrs); all.push(el); if (t.attrs.id && !els[t.attrs.id]) els[t.attrs.id] = el; }
  function matchOne(el, sel) {
    const m = sel.match(/^([a-zA-Z][\w-]*)?((?:[.#][\w-]+)*)((?:\[[^\]]+\])*)$/);
    if (!m) return false;
    if (m[1] && el.tagName !== m[1].toUpperCase()) return false;
    for (const p of (m[2].match(/[.#][\w-]+/g) || [])) { if (p[0] === '.' && !el.classList.contains(p.slice(1))) return false; if (p[0] === '#' && el.id !== p.slice(1)) return false; }
    for (const a of (m[3].match(/\[[^\]]+\]/g) || [])) { const [k, v] = a.slice(1, -1).split('='); const val = el.getAttribute(k.trim()); if (val === null) return false; if (v !== undefined && val !== v.replace(/["']/g, '').trim()) return false; }
    return true;
  }
  function query(sel) { const parts = sel.split(',').map(s => s.trim().split(/\s+|>/).filter(Boolean).pop()); return all.filter(el => parts.some(p => matchOne(el, p))); }

  const document = {
    getElementById: id => els[id] || (els[id] = mkEl('div', { id })), createElement: t => mkEl(t), createElementNS: (_, t) => mkEl(t), createTextNode: () => mkEl('#text'),
    querySelector: s => query(s)[0] || null, querySelectorAll: s => query(s), addEventListener: (t, f) => { (listeners.doc[t] = listeners.doc[t] || []).push(f); }, removeEventListener() {},
    body: mkEl('body'), documentElement: mkEl('html'), head: mkEl('head'), readyState: 'loading', hidden: false, title: '',
  };
  const ctx = {
    document, console: { log() {}, info() {}, debug() {}, warn() {}, error: (...a) => errors.push('console.error: ' + a.join(' ')) }, Math, Date, JSON, Intl, Number, String, Array, Object, Promise, Map, Set,
    setInterval: f => { intervals.push(f); return intervals.length; }, clearInterval() {}, setTimeout: () => 0, clearTimeout() {}, requestAnimationFrame: () => 0, cancelAnimationFrame() {},
    getComputedStyle: () => ({ getPropertyValue: () => '#888888' }), matchMedia: () => ({ matches: false, addEventListener() {}, addListener() {} }),
    localStorage: { _d: {}, getItem(k) { return this._d[k] ?? null; }, setItem(k, v) { this._d[k] = String(v); }, removeItem(k) { delete this._d[k]; } },
    devicePixelRatio: 1, ResizeObserver: function () { return { observe() {}, disconnect() {} }; }, IntersectionObserver: function () { return { observe() {}, disconnect() {} }; },
    addEventListener: (t, f) => { (listeners.win[t] = listeners.win[t] || []).push(f); }, removeEventListener() {}, innerWidth: 1400, innerHeight: 900, navigator: { userAgent: 'node', clipboard: { writeText: async () => {} } },
    performance: { now: () => Date.now() }, location: { hash: '', href: 'file://local' }, Chart: fnProxy(), alert() {}, confirm: () => true, prompt: () => null,
  };
  ctx.window = ctx; ctx.self = ctx; vm.createContext(ctx);
  const run = (label, f) => { try { return f(); } catch (e) { errors.push(`${label}: ${e.message} @ ${(e.stack || '').split('\n')[1]?.trim() || ''}`); } };
  scripts.forEach((s, i) => run('SCRIPT ' + (i + 1), () => vm.runInContext(s, ctx, { filename: `script${i + 1}.js` })));
  document.readyState = 'complete';
  for (const f of [...(listeners.doc.DOMContentLoaded || []), ...(listeners.win.DOMContentLoaded || [])]) run('DOMContentLoaded', () => f({}));
  if (typeof ctx.onload === 'function') run('window.onload', () => ctx.onload({}));
  for (const f of listeners.win.load || []) run('window.load', () => f({}));
  const has = n => vm.runInContext(`typeof ${n} === 'function'`, ctx);
  const app = {
    ctx, els, errors, html,
    eval: code => run('eval', () => vm.runInContext(code, ctx)),
    tick(n = 1) { for (let i = 0; i < n; i++) { if (has('tick')) run('tick#' + i, () => vm.runInContext('tick()', ctx)); else intervals.forEach((f, j) => run(`interval${j}#${i}`, () => f())); } },
    tabs: () => [...new Set(all.filter(e => e.dataset.tab).map(e => e.dataset.tab))],
    click(tab) { const el = all.find(e => e.dataset.tab === tab); if (el && (el._st.ev.click || el._st.attrs.onclick || el.onclick)) run('click ' + tab, () => fire(el, 'click')); else if (has('switchTab')) run('switchTab ' + tab, () => vm.runInContext(`switchTab(${JSON.stringify(tab)})`, ctx)); },
    status: () => has('overallStatus') ? run('overallStatus', () => vm.runInContext('overallStatus()', ctx)) : null,
    dumpSvg(svgId) {
      const m = html.match(new RegExp(`<svg[^>]*id=["']${svgId}["'][\\s\\S]*?<\\/svg>`));
      const el = els[svgId];
      let svg = el && el._st.ih ? `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${el.getAttribute('viewBox') || '0 0 1200 600'}">${el._st.ih}</svg>` : (m ? m[0] : null);
      if (!svg) return null;
      if (!/xmlns=/.test(svg)) svg = svg.replace('<svg', '<svg xmlns="http://www.w3.org/2000/svg"');
      for (const [id, e] of Object.entries(els)) {
        const re = new RegExp(`(<[a-zA-Z]+[^>]*\\bid=["']${id}["'][^>]*>)([^<]*)`);
        if (e._st.tcSet) svg = svg.replace(re, (_, a) => a + String(e._st.tc).replace(/&/g, '&amp;').replace(/</g, '&lt;'));
        if (e._st.clsSet) svg = svg.replace(new RegExp(`<[a-zA-Z]+[^>]*\\bid=["']${id}["'][^>]*>`), tagStr => {
          const c = `class="${e.className}"`;
          return /\sclass=["'][^"']*["']/.test(tagStr) ? tagStr.replace(/class=["'][^"']*["']/, c) : tagStr.replace(/^(<[a-zA-Z]+)/, `$1 ${c}`);
        });
      }
      return svg;
    },
  };
  return app;
}

if (require.main === module) {
  const argv = process.argv.slice(2);
  if (!argv[0]) { console.log('usage: node smoke_test.js file.html [--ticks 300] [--eval js] [--dump-svg svgId:out.svg]'); process.exit(2); }
  const ticks = +(argv[argv.indexOf('--ticks') + 1] || 0) || 300;
  const dumps = argv.flatMap((a, i) => a === '--dump-svg' ? [argv[i + 1]] : []);
  const evals = argv.flatMap((a, i) => a === '--eval' ? [argv[i + 1]] : []);
  const html = fs.readFileSync(argv[0], 'utf8');
  const scripts = [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(m => m[1]);
  let syntaxOk = true;
  scripts.forEach((s, i) => { try { new vm.Script(s, { filename: `script${i + 1}.js` }); } catch (e) { syntaxOk = false; console.log(`SYNTAX script${i + 1}: ${e.message}`); } });
  const app = load(argv[0]);
  const title = (html.match(/<title>([^<]*)<\/title>/) || [])[1] || '(no title)';
  const tabs = app.tabs();
  app.tick(3);
  for (const t of tabs) { app.click(t); app.tick(2); }
  if (tabs.length && !evals.length) app.click(tabs[0]);
  evals.forEach(code => app.eval(code));
  app.tick(ticks);
  for (const d of dumps) { const [id, out] = d.split(':'); const svg = app.dumpSvg(id); if (svg) { fs.writeFileSync(out, svg); console.log(`dumped #${id} -> ${out}`); } else app.errors.push('dump: svg #' + id + ' not found'); }
  console.log(`title: ${title}`);
  console.log(`size: ${Buffer.byteLength(html)} bytes, ${html.split('\n').length} lines, ${scripts.length} inline script(s)`);
  console.log(`tabs (${tabs.length}): ${tabs.join(', ') || 'none found'}`);
  console.log(`ticks run: ${ticks + 3 + tabs.length * 2}`);
  const st = app.status(); if (st !== null && st !== undefined) console.log(`overallStatus(): ${typeof st === 'object' ? JSON.stringify(st) : st}`);
  const uniq = [...new Set(app.errors)];
  console.log(`syntax: ${syntaxOk ? 'OK' : 'FAIL'} | runtime errors: ${app.errors.length} (${uniq.length} unique)`);
  uniq.slice(0, 15).forEach(e => console.log('  - ' + e));
  process.exit(syntaxOk && !app.errors.length ? 0 : 1);
}
module.exports = { load };
