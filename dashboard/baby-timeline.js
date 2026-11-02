// baby-timeline v1 (2 Nov 2026): Baby page History tab for Ed and Jackie.
// Cards: custom:baby-timeline-card (Day / Week / List / Summary, details sheet, edit, delete, undo,
// overlays), custom:baby-edit-card (edit block inside the existing Add pop-ups),
// custom:baby-chips-card (one-tap chips for an input_select).
// Data: huckleberry.list_entries (fork ehhwerd/huckleberry-homeassistant). Glass look per bubble-card-design.md.
(() => {
  const V = 'v2';
  const DEV = 'bdf819090a6a92dc84381c2f6f0f7b5c';
  const CHILD = 'Florence';
  const C = {
    sleep: '#4dd0e1', night: '#1fa3c4', breast: '#ff9f43', bottle: '#f78fb3', solids: '#a3cb38',
    diaper: '#a1785c', potty: '#a1785c', medication: '#b39ddb', temperature: '#ff6b6b', growth: '#7bd389',
    pump: '#9b8cf2', activity: '#c6e15a', now: '#4caf50', cry: '#dc2626', snoo: '#38bdf8',
  };
  const ICON = {
    sleep: 'mdi:sleep', breast: 'mdi:mother-nurse', bottle: 'mdi:baby-bottle-outline', solids: 'mdi:food-apple-outline',
    diaper: 'mdi:human-baby-changing-table', potty: 'mdi:toilet', medication: 'mdi:pill', temperature: 'mdi:thermometer',
    growth: 'mdi:human-male-height-variant', pump: 'mdi:water-pump', activity: 'mdi:shape-outline',
  };
  const ACT = {
    bath: 'Bath', tummyTime: 'Tummy time', storyTime: 'Story time', screenTime: 'Screen time',
    skinToSkin: 'Skin to skin', outdoorPlay: 'Outdoor play', indoorPlay: 'Indoor play', brushTeeth: 'Brush teeth',
  };
  const POPUP = { sleep: '#baby-sleep', breast: '#baby-nursing', bottle: '#baby-bottle', diaper: '#baby-nappy', medication: '#baby-medicine' };
  const LOC = { onOwnInBed: 'On own in bed', nursing: 'Nursing', wornOrHeld: 'Worn or held', nextToCarer: 'Next to carer', coSleep: 'Co-sleep', stroller: 'Stroller', car: 'Car', swing: 'Swing', bottle: 'Bottle' };
  const COND = { happy: 'Content', upset: 'Upset', under_10_minutes: 'Under 10 min to fall asleep', '10-20_minutes': '10-20 min to fall asleep', longTimeToFallAsleep: 'Long time to fall asleep', wokeUpChild: 'Woken up' };

  // ------------------------------------------------------------ helpers
  const H = () => document.querySelector('home-assistant')?.hass;
  const base = (k) => (k || '').split(':')[0];
  const pad = (n) => String(n).padStart(2, '0');
  const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dayKey = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const sod = (d) => { const x = new Date(d); x.setHours(0, 0, 0, 0); return x; };
  const addD = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };
  const tm = (d) => { const h = d.getHours(); return `${h % 12 || 12}:${pad(d.getMinutes())} ${h >= 12 ? 'pm' : 'am'}`; };
  const dur = (s, secs) => {
    s = Math.max(0, Math.round(s || 0));
    const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60);
    if (h) return `${h}h ${m}m`;
    if (secs && m < 10) return `${m}m ${s % 60}s`;
    return `${m}m`;
  };
  const WD = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  const MO = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const dayName = (d) => {
    const t = sod(new Date());
    const diff = Math.round((t - sod(d)) / 864e5);
    if (diff === 0) return 'Today';
    if (diff === 1) return 'Yesterday';
    return `${WD[d.getDay()]} ${d.getDate()} ${MO[d.getMonth()]}`;
  };
  const isNight = (e) => {
    if (base(e.kind) !== 'sleep') return false;
    const s = new Date(e.ts * 1000), mid = new Date((e.ts + (e.duration || 0) / 2) * 1000).getHours();
    return (e.duration || 0) >= 3 * 3600 || mid >= 19 || mid < 6 || s.getHours() >= 19;
  };
  const color = (e) => (base(e.kind) === 'sleep' && isNight(e)) ? C.night : (C[base(e.kind)] || C[e.kind] || '#9aa4b2');
  const actName = (e) => ACT[(e.kind || '').split(':')[1]] || 'Activity';
  const qty = (q, what) => (q ? `a ${q} ${what}` : `a ${what}`);
  const sentence = (e) => {
    const k = base(e.kind);
    if (k === 'sleep') return `${CHILD} slept ${dur(e.duration)}`;
    if (k === 'breast') return `${CHILD} nursed for ${dur(e.duration)}`;
    if (k === 'bottle') return `${CHILD} drank ${e.amount ?? ''} ${e.units || 'ml'}${e.bottle_type ? ' of ' + String(e.bottle_type).toLowerCase() : ''}`;
    if (k === 'solids') return `${CHILD} ate ${(e.foods || []).join(', ') || 'solids'}`;
    if (k === 'diaper' || k === 'potty') {
      const m = e.mode;
      if (m === 'dry') return `${CHILD} had a dry nappy`;
      if (m === 'pee') return `${CHILD} had ${qty(e.pee, 'pee')}`;
      if (m === 'poo') return `${CHILD} had ${qty(e.poo, 'poo')}`;
      return `${CHILD} had ${qty(e.poo, 'poo')} and ${qty(e.pee, 'pee')}`;
    }
    if (k === 'medication') return `${CHILD} had ${e.medicine || 'medicine'}${e.amount ? ` · ${e.amount} ${e.units || ''}` : ''}`;
    if (k === 'temperature') return `Temperature ${e.amount ?? ''}${e.units === 'F' ? ' °F' : ' °C'}`;
    if (k === 'growth') return `Growth: ${[e.weight && e.weight + ' kg', e.height && e.height + ' cm', e.head && 'head ' + e.head + ' cm'].filter(Boolean).join(', ')}`;
    if (k === 'pump') return `Pumped ${(+(e.left || 0) + +(e.right || 0)) || ''} ${e.units || 'ml'}`;
    if (k === 'activity') return e.kind === 'activity:bath' ? `${CHILD} had a bath${e.duration ? ' (' + dur(e.duration) + ')' : ''}` : `${CHILD} did ${actName(e).toLowerCase()}${e.duration ? ' for ' + dur(e.duration) : ''}`;
    return k;
  };
  const shortLabel = (e) => {
    const k = base(e.kind);
    if (k === 'sleep') return `${isNight(e) ? 'Night sleep' : 'Nap'} ${dur(e.duration)}`;
    if (k === 'breast') return `Breast ${dur(e.duration)}`;
    if (k === 'bottle') return `${e.amount ?? ''} ${e.units || 'ml'}`;
    if (k === 'diaper') return { pee: 'Wet', poo: 'Dirty', both: 'Mixed', dry: 'Dry' }[e.mode] || 'Nappy';
    if (k === 'medication') return e.medicine || 'Medicine';
    if (k === 'activity') return actName(e);
    if (k === 'pump') return 'Pump';
    return sentence(e);
  };
  const sideDetail = (e) => {
    if (base(e.kind) !== 'breast') return '';
    const L = e.last_side === 'left' ? 'L*' : 'L', R = e.last_side === 'right' ? 'R*' : 'R';
    return `(${L}) ${dur(e.left, true)}, (${R}) ${dur(e.right, true)}`;
  };
  const range = (e) => {
    const s = new Date(e.ts * 1000);
    if (!e.duration) return tm(s);
    return `${tm(s)} – ${tm(new Date((e.ts + e.duration) * 1000))}`;
  };
  const toast = (msg, actionLabel, onAction, ms = 30000) => {
    let t = document.querySelector('baby-toast');
    if (!t) { t = document.createElement('baby-toast'); document.body.appendChild(t); }
    t.show(msg, actionLabel, onAction, ms);
  };
  const runSvc = async (service, data) => {
    const r = await H().callWS({
      type: 'execute_script',
      sequence: [{ action: `huckleberry.${service}`, data: { device_id: DEV, ...data }, response_variable: 'r' }, { stop: 'done', response_variable: 'r' }],
    });
    return r.response;
  };
  window._bhRun = runSvc;

  // ------------------------------------------------------------ data store (shared by all cards)
  const store = window._bhStore || (window._bhStore = { days: {}, listeners: new Set(), pending: null, sig: '' });
  store.emit = () => store.listeners.forEach((f) => f());
  store.drop = (keys) => { (keys || Object.keys(store.days)).forEach((k) => delete store.days[k]); store.emit(); };
  store.ensure = async (from, to) => {
    // from/to: Date (start of day), inclusive. One list call for the missing span.
    const miss = [];
    for (let d = sod(from); d <= to; d = addD(d, 1)) if (!store.days[dayKey(d)]) miss.push(new Date(d));
    if (!miss.length) return;
    const a = miss[0], b = addD(miss[miss.length - 1], 1);
    const key = a.toISOString() + b.toISOString();
    if (store.inflight && store.inflight[key]) return store.inflight[key];
    store.inflight = store.inflight || {};
    const p = (async () => {
      try {
        const res = await runSvc('list_entries', { start: a.toISOString(), end: b.toISOString() });
        const by = {};
        miss.forEach((d) => (by[dayKey(d)] = []));
        for (const e of res.entries || []) {
          const k = dayKey(new Date(e.ts * 1000));
          if (by[k]) by[k].push(e);
        }
        Object.assign(store.days, by);
        store.err = null;
      } catch (err) {
        store.err = String(err && err.message || err);
      } finally {
        delete store.inflight[key];
        store.emit();
      }
    })();
    store.inflight[key] = p;
    return p;
  };
  store.between = (a, b) => {
    // entries overlapping [a, b)
    const out = [];
    for (let d = addD(sod(a), -1); d < b; d = addD(d, 1)) {
      for (const e of store.days[dayKey(d)] || []) {
        const s = e.ts * 1000, en = s + (e.duration || 0) * 1000;
        if (en >= +a && s < +b) out.push(e);
      }
    }
    return out.sort((x, y) => x.ts - y.ts);
  };
  store.have = (a, b) => { for (let d = addD(sod(a), -1); d < b; d = addD(d, 1)) if (!store.days[dayKey(d)]) return false; return true; };
  const WATCH = ['sensor.florence_sleep', 'sensor.florence_nursing', 'sensor.florence_bottle', 'sensor.florence_diaper',
    'sensor.florence_medication', 'sensor.florence_activity', 'sensor.florence_pumping', 'sensor.florence_growth'];
  store.watch = (hass) => {
    const sig = WATCH.map((id) => { const s = hass.states[id]; return s ? s.state + (s.attributes.previous_start || '') + (s.attributes.time || '') : ''; }).join('|');
    if (store.sig && sig !== store.sig) {
      clearTimeout(store.t);
      store.t = setTimeout(() => { const t = sod(new Date()); store.drop([dayKey(t), dayKey(addD(t, -1))]); }, 2500);
    }
    store.sig = sig;
  };

  // HA-only overlays: sleep scores (+ cry spells), SNOO running, who logged it
  const extra = window._bhExtra || (window._bhExtra = { scores: {}, snoo: {}, who: {} });
  extra.load = async (a, b) => {
    const k = dayKey(a) + dayKey(b), old = extra.scores[k];
    if (old && (old.pending || Date.now() - old.t < 300000)) return;
    extra.scores[k] = Object.assign(old || {}, { pending: true });
    const hass = H();
    try {
      const [ev, hist, lb] = await Promise.all([
        hass.callApi('GET', `calendars/calendar.baby_sleep_scores?start=${encodeURIComponent(addD(a, -1).toISOString())}&end=${encodeURIComponent(b.toISOString())}`).catch(() => []),
        hass.callApi('GET', `history/period/${encodeURIComponent(addD(a, -1).toISOString())}?end_time=${encodeURIComponent(b.toISOString())}&filter_entity_id=sensor.florence_s_snoo_state&minimal_response&no_attributes`).catch(() => [[]]),
        hass.callWS({ type: 'logbook/get_events', start_time: addD(a, -1).toISOString(), end_time: b.toISOString(), entity_ids: ['script.baby_hb_call', 'script.baby_edit_save'] }).catch(() => []),
      ]);
      const scores = [];
      for (const e of ev || []) {
        const m = /Sleep score (\d+)/.exec(e.summary || '');
        const lg = /Log: (\d+)\|(\d+)\|(\d+)\|([\d,\-]*)/.exec(e.description || '');
        const s = new Date(e.start.dateTime || e.start).getTime() / 1000, en = new Date(e.end.dateTime || e.end).getTime() / 1000;
        const cries = [];
        if (lg && lg[4]) for (const r of lg[4].split(',')) { const [x, y] = r.split('-').map(Number); if (!isNaN(x)) cries.push([+lg[1] + x * 10, +lg[1] + (y || x) * 10]); }
        scores.push({ s, en, score: m ? +m[1] : null, word: (e.summary || '').split('·')[1]?.trim() || '', cries });
      }
      const runs = [];
      const rows = (hist && hist[0]) || [];
      for (let i = 0; i < rows.length; i++) {
        const st = rows[i].state, t0 = new Date(rows[i].last_changed || rows[i].lu * 1000).getTime() / 1000;
        const t1 = i + 1 < rows.length ? new Date(rows[i + 1].last_changed || rows[i + 1].lu * 1000).getTime() / 1000 : Date.now() / 1000;
        if (/^(baseline|level\d|weaning_baseline|manual)$/.test(st)) runs.push([t0, t1, st]);
      }
      const people = {};
      for (const [id, s] of Object.entries(hass.states)) if (id.startsWith('person.') && s.attributes.user_id) people[s.attributes.user_id] = s.attributes.friendly_name;
      const who = (lb || []).filter((x) => x.context_user_id).map((x) => ({ t: x.when, name: people[x.context_user_id] || 'Someone' }));
      extra.scores[k] = { scores, runs, who, t: Date.now() };
    } catch (err) {
      extra.scores[k] = { scores: [], runs: [], who: [], t: Date.now() };
    }
    store.emit();
  };
  extra.get = (a, b) => { const x = extra.scores[dayKey(a) + dayKey(b)]; return x && x.scores ? x : null; };
  extra.whoFor = (e, x) => {
    if (!x || !e.logged_at) return null;
    let best = null;
    for (const w of x.who || []) { const d = e.logged_at - w.t; if (d >= -5 && d < 150 && (!best || d < best.d)) best = { d, name: w.name }; }
    return best ? best.name : null;
  };

  // ------------------------------------------------------------ shared styles
  const CSS = `
:host{display:block;color:#e8edf4;font-family:inherit;-webkit-tap-highlight-color:transparent}
*{box-sizing:border-box}
.seg{display:flex;gap:6px;padding:2px;margin:2px 0 10px}
.seg button,.btn,.chip{font:inherit;color:rgba(255,255,255,.88);background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.3);border-radius:20px;cursor:pointer;transition:transform .08s}
.seg button{flex:1;height:38px;font-size:14px;font-weight:600}
.seg button.on,.btn.blue{color:#fff;background:linear-gradient(135deg,rgba(56,189,248,.80),rgba(37,99,235,.70));border-color:rgba(255,255,255,.35);text-shadow:0 1px 2px rgba(0,0,0,.35)}
button:active,.tap:active{transform:scale(.96)}
.nav{display:flex;align-items:center;gap:8px;margin:0 0 8px}
.nav .t{flex:1;text-align:center;font-size:17px;font-weight:700}
.nav button{width:42px;height:38px;font:inherit;font-size:20px;color:#fff;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.3);border-radius:20px;cursor:pointer}
.nav button[disabled]{opacity:.3;pointer-events:none}
.line{font-size:15px;line-height:1.35;text-align:center;margin:2px 4px 10px;color:rgba(255,255,255,.92)}
.nudges{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:-2px 0 10px}
.nudge{display:flex;align-items:center;gap:6px;padding:6px 12px;border-radius:20px;font-size:13px;font-weight:600;color:#fff;background:rgba(245,158,11,.16);border:1px solid rgba(245,158,11,.65)}
.nudge ha-icon{--mdc-icon-size:16px;color:#f59e0b}
.tot{display:grid;grid-template-columns:repeat(3,1fr);gap:8px;margin-bottom:12px}
.tile{padding:10px 8px;border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);box-shadow:inset 0 1px 0 rgba(255,255,255,.3);text-align:center;min-width:0}
.tile .v{font-size:19px;font-weight:700;white-space:nowrap}
.tile .k{font-size:12px;color:rgba(255,255,255,.7);margin-top:2px;line-height:1.25}
.tile .k b{color:rgba(255,255,255,.92);font-weight:600}
.dot{display:inline-block;width:10px;height:10px;border-radius:50%;margin-right:4px;vertical-align:middle}
.strip{position:relative;isolation:isolate;margin:4px 0 6px;touch-action:pan-y;user-select:none;-webkit-user-select:none}
.hr{position:absolute;left:34px;right:0;border-top:1px solid rgba(255,255,255,.07)}
.hl{position:absolute;left:0;width:30px;text-align:right;font-size:11px;color:rgba(255,255,255,.55);transform:translateY(-50%)}
.blk{position:absolute;border-radius:10px;overflow:hidden;cursor:pointer;box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 2px 6px rgba(0,0,0,.25);border:1px solid rgba(255,255,255,.18);color:#0b0e14;font-size:12px;font-weight:700;padding:3px 6px;line-height:1.2;white-space:nowrap;text-overflow:ellipsis}
.blk.live{background-image:repeating-linear-gradient(135deg,rgba(255,255,255,.25) 0 6px,transparent 6px 12px)!important}
.blk.over{box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 0 0 2px rgba(11,14,20,.55),0 3px 8px rgba(0,0,0,.4)}
.blk .sc{display:inline-block;margin-left:6px;padding:0 6px;border-radius:10px;background:rgba(11,14,20,.75);color:#fff;font-size:11px;line-height:14px;vertical-align:top}
.blk .who{display:inline-block;margin-left:4px;width:14px;height:14px;border-radius:50%;background:rgba(11,14,20,.6);color:#fff;font-size:10px;line-height:14px;text-align:center;vertical-align:top}
.cry{position:absolute;left:0;width:9px;height:3px;border-radius:0 2px 2px 0;background:${C.cry};pointer-events:none}
.snoo{position:absolute;width:4px;border-radius:2px;background:${C.snoo};opacity:.85;pointer-events:none}
.mk{position:absolute;height:24px;border-radius:12px;display:flex;align-items:center;gap:3px;padding:0 7px 0 4px;font-size:11px;font-weight:700;color:#0b0e14;cursor:pointer;white-space:nowrap;box-shadow:inset 0 1px 0 rgba(255,255,255,.35),0 0 0 2px rgba(11,14,20,.55),0 3px 8px rgba(0,0,0,.4);transform:translateY(-50%);border:1px solid rgba(255,255,255,.2);z-index:20}
.mk ha-icon{--mdc-icon-size:15px}
.nowl{position:absolute;left:30px;right:0;border-top:2px solid ${C.now};pointer-events:none;z-index:21}
.nowl:before{content:'';position:absolute;left:-4px;top:-5px;width:8px;height:8px;border-radius:50%;background:${C.now}}
.gap{position:absolute;left:34px;z-index:19;border-radius:10px;border:1.5px dashed rgba(77,208,225,.85);background:rgba(77,208,225,.12);color:#fff;font-size:12px;font-weight:600;display:flex;align-items:center;justify-content:center;pointer-events:none}
.wk{display:grid;grid-template-columns:30px repeat(7,1fr);gap:3px;position:relative}
.wk .h{font-size:11px;text-align:center;color:rgba(255,255,255,.7);padding-bottom:4px;line-height:1.2}
.wk .h b{display:block;font-size:13px;color:#fff}
.wk .col{position:relative;border-radius:10px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08)}
.wk .col.today{border-color:rgba(56,189,248,.5)}
.wk .bar{position:absolute;border-radius:4px;cursor:pointer}
.wk .ax{position:relative}
.sel{margin:10px 0 0;padding:10px 12px;border-radius:20px;background:rgba(255,255,255,.06);border:1px solid rgba(255,255,255,.14);display:flex;align-items:center;gap:10px;cursor:pointer;min-height:56px}
.row{display:flex;align-items:center;gap:10px;padding:10px 8px;border-bottom:1px solid rgba(255,255,255,.07);cursor:pointer}
.row:last-child{border-bottom:none}
.row .tx{flex:1;min-width:0}
.row .s{font-size:14px;font-weight:600;line-height:1.3}
.row .d{font-size:12px;color:rgba(255,255,255,.65);margin-top:2px}
.row .who{font-size:11px;color:rgba(255,255,255,.55)}
.chev{color:rgba(255,255,255,.45);--mdc-icon-size:20px}
.dh{font-size:13px;font-weight:700;color:rgba(255,255,255,.75);margin:14px 4px 4px;text-transform:none}
.grp{border-radius:20px;background:rgba(255,255,255,.04);border:1px solid rgba(255,255,255,.08);padding:2px 6px}
.empty{padding:22px 8px;text-align:center;color:rgba(255,255,255,.6);font-size:14px}
.load{padding:30px 0;text-align:center;color:rgba(255,255,255,.55);font-size:14px}
.err{padding:12px;margin:8px 0;border-radius:20px;background:rgba(220,38,38,.15);border:1px solid rgba(220,38,38,.6);font-size:13px}
.sum h3{margin:14px 4px 6px;font-size:15px}
.bars{display:flex;align-items:flex-end;gap:3px;height:120px;padding:4px 2px 0;border-bottom:1px solid rgba(255,255,255,.12)}
.bars .b{flex:1;display:flex;flex-direction:column-reverse;border-radius:4px 4px 0 0;overflow:hidden;min-width:0}
.bl{display:flex;gap:3px;font-size:10px;color:rgba(255,255,255,.55);padding:3px 2px 0}
.bl span{flex:1;text-align:center;overflow:hidden}
.leg{display:flex;gap:12px;justify-content:center;font-size:12px;color:rgba(255,255,255,.75);margin:6px 0 2px;flex-wrap:wrap}
.donut{display:flex;align-items:center;gap:14px;justify-content:center;margin:6px 0}
`;

  // ------------------------------------------------------------ toast (body level)
  class BabyToast extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' }).innerHTML = `<style>
:host{position:fixed;left:50%;bottom:calc(18px + env(safe-area-inset-bottom));transform:translateX(-50%);z-index:12000;display:none}
.t{display:flex;align-items:center;gap:12px;padding:10px 10px 10px 18px;border-radius:24px;background:rgba(32,46,72,.96);border:1px solid rgba(255,255,255,.18);box-shadow:inset 0 1px 0 rgba(255,255,255,.3),0 10px 30px rgba(0,0,0,.5);color:#fff;font-size:15px;font-weight:600;white-space:nowrap}
button{font:inherit;font-size:14px;font-weight:700;color:#fff;padding:8px 16px;border-radius:18px;border:1px solid rgba(255,255,255,.35);background:linear-gradient(135deg,rgba(56,189,248,.8),rgba(37,99,235,.7));cursor:pointer}
button:active{transform:scale(.96)}</style><div class="t"><span id="m"></span><button id="b"></button></div>`;
      this.shadowRoot.getElementById('b').addEventListener('click', () => { const f = this._f; this.hide(); f && f(); });
    }
    show(msg, label, f, ms) {
      this.shadowRoot.getElementById('m').textContent = msg;
      const b = this.shadowRoot.getElementById('b');
      b.textContent = label || ''; b.style.display = label ? '' : 'none';
      this._f = f; this.style.display = 'block';
      clearTimeout(this._t); this._t = setTimeout(() => this.hide(), ms);
    }
    hide() { this.style.display = 'none'; this._f = null; }
  }
  if (!customElements.get('baby-toast')) customElements.define('baby-toast', BabyToast);

  // ------------------------------------------------------------ details sheet (body level)
  class BabySheet extends HTMLElement {
    constructor() {
      super();
      this.attachShadow({ mode: 'open' });
      this.shadowRoot.innerHTML = `<style>${CSS}
:host{position:fixed;inset:0;z-index:11000;display:none}
.bg{position:absolute;inset:0;background:rgba(0,0,0,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px)}
.sh{position:absolute;left:50%;bottom:0;transform:translateX(-50%);width:min(520px,100%);max-height:88vh;overflow:auto;padding:18px 16px calc(18px + env(safe-area-inset-bottom));border-radius:28px 28px 0 0;background:linear-gradient(145deg,rgba(40,52,78,.97),rgba(22,28,42,.97));border:1px solid rgba(255,255,255,.16);box-shadow:0 -10px 30px rgba(0,0,0,.45);animation:up .22s ease}
@keyframes up{from{transform:translate(-50%,40px);opacity:.4}to{transform:translate(-50%,0);opacity:1}}
.hd{display:flex;align-items:center;gap:12px}
.ic{width:44px;height:44px;border-radius:50%;display:flex;align-items:center;justify-content:center;background:rgba(0,0,0,.35);flex:0 0 auto}
.ic ha-icon{--mdc-icon-size:24px}
.ttl{font-size:18px;font-weight:700;line-height:1.25}
.sub{font-size:13px;color:rgba(255,255,255,.7);margin-top:2px}
.chips{display:flex;flex-wrap:wrap;gap:6px;margin:12px 0 4px}
.chips span{padding:5px 11px;border-radius:16px;font-size:12px;font-weight:600;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.14)}
.note{margin:10px 2px;font-size:14px;color:rgba(255,255,255,.85);white-space:pre-wrap}
.acts{display:flex;flex-direction:column;gap:10px;margin-top:16px}
.btn{height:48px;font-size:16px;font-weight:700;width:100%}
.btn.green{color:#fff;background:linear-gradient(135deg,rgba(76,175,80,.9),rgba(46,125,50,.8));border-color:rgba(255,255,255,.35)}
.btn.ghost{background:rgba(255,255,255,.04)}
.slide{position:relative;height:52px;border-radius:26px;background:rgba(220,38,38,.12);border:1px solid rgba(220,38,38,.65);box-shadow:inset 0 1px 0 rgba(255,255,255,.2);overflow:hidden;touch-action:none;user-select:none;-webkit-user-select:none}
.slide .fill{position:absolute;left:0;top:0;bottom:0;width:52px;border-radius:26px;background:linear-gradient(90deg,rgba(220,38,38,.55),rgba(220,38,38,.9))}
.slide .knob{position:absolute;left:3px;top:3px;width:44px;height:44px;border-radius:50%;background:#fff;color:#dc2626;display:flex;align-items:center;justify-content:center;box-shadow:0 2px 8px rgba(0,0,0,.4)}
.slide .lb{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;font-weight:700;font-size:15px;color:#fff;pointer-events:none}
.slide.busy{opacity:.6;pointer-events:none}
.info{font-size:12px;color:rgba(255,255,255,.6);text-align:center;margin-top:8px}
</style><div class="bg"></div><div class="sh no-swipe"></div>`;
      const bg = this.shadowRoot.querySelector('.bg');
      bg.addEventListener('pointerdown', () => (this._bgDown = Date.now()));
      bg.addEventListener('click', () => { if (Date.now() - (this._bgDown || 0) < 800) this.close(); });
      this._onLoc = () => { if (this.style.display === 'block' && location.hash !== '#baby-entry') this.close(true); };
      window.addEventListener('location-changed', this._onLoc);
      window.addEventListener('popstate', this._onLoc);
    }
    open(e, ctx) {
      this._e = e; this._ctx = ctx || {};
      this.render();
      this.style.display = 'block';
      if (location.hash !== '#baby-entry') history.pushState(null, '', location.pathname + location.search + '#baby-entry');
    }
    close(fromNav) {
      this.style.display = 'none';
      if (!fromNav && location.hash === '#baby-entry') history.back();
    }
    render() {
      const e = this._e, k = base(e.kind), x = this._ctx.extra, root = this.shadowRoot.querySelector('.sh');
      const s = new Date(e.ts * 1000);
      const chips = [];
      if (k === 'sleep') {
        (e.start_condition || []).forEach((c) => chips.push(COND[c] || c));
        (e.locations || []).forEach((c) => chips.push(LOC[c] || c));
        (e.end_condition || []).forEach((c) => chips.push('Woke: ' + (COND[c] || c)));
        if (e.live) chips.push('Still asleep');
      }
      if (k === 'breast' && sideDetail(e)) chips.push(sideDetail(e));
      if (k === 'diaper') { if (e.color) chips.push('Colour: ' + e.color); if (e.consistency) chips.push(e.consistency); if (e.rash) chips.push('Nappy rash'); }
      if (k === 'bottle' && e.bottle_type) chips.push(e.bottle_type);
      const sc = x && k === 'sleep' ? (x.scores || []).find((q) => Math.abs(q.s - e.ts) < 900) : null;
      if (sc && sc.score != null) chips.push(`Sleep score ${sc.score}${sc.word ? ' · ' + sc.word : ''}`);
      if (sc && sc.cries.length) chips.push(`${sc.cries.length} cry spell${sc.cries.length > 1 ? 's' : ''}`);
      const snooMin = x && k === 'sleep' ? Math.round((x.runs || []).reduce((t, r) => t + Math.max(0, Math.min(r[1], e.ts + e.duration) - Math.max(r[0], e.ts)), 0) / 60) : 0;
      if (snooMin) chips.push(`SNOO on ${dur(snooMin * 60)}`);
      const who = e.live ? null : extra.whoFor(e, x);
      const canEdit = !e.live && (POPUP[k] || k === 'activity');
      const mergeWith = k === 'sleep' && !e.live ? this._ctx.neighbour : null;
      root.innerHTML = `
<div class="hd"><div class="ic" style="color:${color(e)}"><ha-icon icon="${ICON[k] || 'mdi:circle'}"></ha-icon></div>
<div><div class="ttl">${esc(sentence(e))}</div><div class="sub">${esc(dayName(s))} · ${esc(range(e))}</div></div></div>
${chips.length ? `<div class="chips">${chips.map((c) => `<span>${esc(c)}</span>`).join('')}</div>` : ''}
${e.notes ? `<div class="note">${esc(e.notes)}</div>` : ''}
<div class="info">${e.live ? 'Running now · stop it on the Log tab' : who ? `Logged by ${esc(who)} on the dashboard` : 'Logged in the Huckleberry app'}</div>
<div class="acts">
${canEdit ? '<button class="btn blue" id="ed">Edit</button>' : ''}
${mergeWith ? `<button class="btn" id="mg">Join with the ${esc(tm(new Date(mergeWith.ts * 1000)))} sleep</button>` : ''}
${e.live ? '' : '<div class="slide" id="sl"><div class="fill"></div><div class="knob"><ha-icon icon="mdi:delete-outline"></ha-icon></div><div class="lb">Slide to delete →</div></div>'}
<button class="btn ghost" id="dn">Done</button>
</div>`;
      root.querySelector('#dn').onclick = () => this.close();
      const ed = root.querySelector('#ed'); if (ed) ed.onclick = () => this.edit();
      const mg = root.querySelector('#mg'); if (mg) mg.onclick = () => this.merge(mergeWith);
      const sl = root.querySelector('#sl'); if (sl) this.slide(sl);
    }
    slide(el) {
      const knob = el.querySelector('.knob'), fill = el.querySelector('.fill'), lb = el.querySelector('.lb');
      let x0 = null, w = 0, done = false;
      const set = (dx) => { const p = Math.max(0, Math.min(dx, w - 50)); knob.style.left = 3 + p + 'px'; fill.style.width = 52 + p + 'px'; return p / (w - 50); };
      el.addEventListener('dragstart', (ev) => ev.preventDefault());
      const down = (ev) => { if (done) return; if (ev.pointerType === 'mouse') { ev.preventDefault(); try { el.setPointerCapture(ev.pointerId); } catch (e) { /* ignore */ } } x0 = (ev.touches ? ev.touches[0] : ev).clientX; w = el.clientWidth; knob.style.transition = fill.style.transition = 'none'; };
      const move = (ev) => { if (x0 == null) return; const f = set((ev.touches ? ev.touches[0] : ev).clientX - x0); if (ev.cancelable) ev.preventDefault(); if (f >= 0.7 && !done) { done = true; x0 = null; set(w); el.classList.add('busy'); lb.textContent = 'Deleting…'; navigator.vibrate && navigator.vibrate(30); this.del(); } };
      const up = () => { if (x0 == null) return; x0 = null; knob.style.transition = fill.style.transition = 'all .2s'; set(0); if (!done) { lb.textContent = 'Slide right to delete →'; } };
      el.addEventListener('pointerdown', down); el.addEventListener('touchstart', down, { passive: true });
      window.addEventListener('pointermove', move, { passive: false }); window.addEventListener('touchmove', move, { passive: false });
      window.addEventListener('pointerup', up); window.addEventListener('touchend', up);
    }
    async del() {
      const e = this._e;
      try {
        const r = await runSvc('delete_entry', { tracker: e.tracker, id: e.id, revision: e.revision });
        this.close();
        store.drop([dayKey(new Date(e.ts * 1000))]);
        toast('Deleted', 'Undo', async () => {
          try { await runSvc('restore_entry', { backup: r.backup }); store.drop([dayKey(new Date(e.ts * 1000))]); toast('Put back', null, null, 3000); }
          catch (err) { toast("Couldn't undo: " + (err.message || err), null, null, 6000); }
        });
      } catch (err) {
        this.render();
        toast("Couldn't delete: " + (err.message || err), null, null, 6000);
      }
    }
    async merge(n) {
      const e = this._e, first = e.ts <= n.ts ? e : n, second = first === e ? n : e;
      try {
        const r = await runSvc('merge_sleeps', { first_id: first.id, first_revision: first.revision, second_id: second.id, second_revision: second.revision });
        this.close();
        store.drop([dayKey(new Date(first.ts * 1000)), dayKey(new Date(second.ts * 1000))]);
        toast('Sleeps joined', 'Undo', async () => {
          for (const b of r.backups || []) await runSvc('restore_entry', { backup: b }).catch(() => 0);
          store.drop(); toast('Put back', null, null, 3000);
        });
      } catch (err) { toast("Couldn't join: " + (err.message || err), null, null, 6000); }
    }
    async edit() {
      const e = this._e, k = base(e.kind), hass = H(), s = new Date(e.ts * 1000);
      const en = new Date((e.ts + (e.duration || 0)) * 1000);
      const t = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}:00`;
      const svc = (d, sv, data) => hass.callService(d, sv, data);
      const sel = (id, o) => svc('input_select', 'select_option', { entity_id: id, option: o });
      const meta = { id: e.id, t: e.tracker, k: e.kind, r: e.revision, d: dayKey(s), x: Math.round(Date.now() / 1000) + 900 };
      const jobs = [
        svc('input_datetime', 'set_datetime', { entity_id: 'input_datetime.baby_edit_start', time: t(s) }),
        svc('input_datetime', 'set_datetime', { entity_id: 'input_datetime.baby_edit_end', time: t(en) }),
      ];
      if (k === 'sleep') {
        const sc = e.start_condition || [];
        jobs.push(sel('input_select.baby_sleep_mood', sc.includes('upset') ? 'upset' : sc.includes('happy') ? 'happy' : 'none'));
        jobs.push(sel('input_select.baby_sleep_fall', ['under_10_minutes', '10-20_minutes', 'longTimeToFallAsleep'].find((c) => sc.includes(c)) || 'none'));
        jobs.push(sel('input_select.baby_sleep_how', (e.locations || [])[0] || 'none'));
      } else if (k === 'breast') {
        jobs.push(sel('input_select.baby_edit_side', e.left && e.right ? 'both' : e.right ? 'right' : 'left'));
      } else if (k === 'diaper') {
        jobs.push(sel('input_select.baby_nappy_type', { both: 'mixed' }[e.mode] || e.mode));
        jobs.push(sel('input_select.baby_pee_size', e.pee || 'none'));
        jobs.push(sel('input_select.baby_poo_size', e.poo || 'none'));
        jobs.push(sel('input_select.baby_poo_colour', e.color || 'none'));
        jobs.push(svc('input_boolean', e.rash ? 'turn_on' : 'turn_off', { entity_id: 'input_boolean.baby_nappy_rash' }));
      } else if (k === 'bottle') {
        jobs.push(svc('input_number', 'set_value', { entity_id: 'input_number.baby_bottle_amount', value: Math.min(350, Math.round(e.amount || 0)) }));
        if (e.bottle_type) jobs.push(sel('input_select.baby_bottle_type', /formula/i.test(e.bottle_type) ? 'formula' : 'breast_milk'));
      } else if (k === 'medication') {
        if (e.medicine) jobs.push(sel('input_select.baby_medicine_type', e.medicine).catch(() => 0));
        if (e.units) jobs.push(sel('input_select.baby_medicine_units', e.units).catch(() => 0));
        jobs.push(svc('input_number', 'set_value', { entity_id: 'input_number.baby_medicine_amount', value: Math.min(10, Math.round(e.amount || 0)) }).catch(() => 0));
      } else if (k === 'activity') {
        const m = e.kind.split(':')[1];
        jobs.push(sel('input_select.baby_activity_type', m).catch(() => 0));
      }
      try {
        await Promise.all(jobs);
        await svc('input_text', 'set_value', { entity_id: 'input_text.baby_edit', value: JSON.stringify(meta) });
      } catch (err) { toast("Couldn't start editing: " + (err.message || err), null, null, 6000); return; }
      this.style.display = 'none';
      const hash = POPUP[k] || '#baby-activity';
      history.replaceState(null, '', location.pathname + location.search + hash);
      window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: true } }));
    }
  }
  if (!customElements.get('baby-sheet')) customElements.define('baby-sheet', BabySheet);
  const sheet = () => { let s = document.querySelector('baby-sheet'); if (!s) { s = document.createElement('baby-sheet'); document.body.appendChild(s); } return s; };

  // Edit mode is cleared when its pop-up closes without saving, and expires after 15 min.
  if (!window._bhEditGuard) {
    window._bhEditGuard = true;
    const clear = () => {
      const hass = H(); const st = hass && hass.states['input_text.baby_edit'];
      if (!st || ['none', '', 'unknown'].includes(st.state)) return;
      const POP = ['#baby-sleep', '#baby-nursing', '#baby-bottle', '#baby-nappy', '#baby-medicine', '#baby-activity'];
      if (POP.includes(location.hash)) return;
      setTimeout(() => { if (!POP.includes(location.hash)) hass.callService('script', 'baby_edit_cancel'); }, 400);
    };
    window.addEventListener('location-changed', clear);
    window.addEventListener('popstate', clear);
    // Save result → toast with Undo
    const sub = () => {
      const hass = H();
      if (!hass || !hass.connection) return setTimeout(sub, 2000);
      hass.connection.subscribeEvents((ev) => {
        const d = ev.data || {};
        if (d.ok) {
          store.drop();
          toast(`${d.label || 'Entry'} updated`, d.backup ? 'Undo' : null, async () => {
            try { await runSvc('restore_entry', { backup: d.backup }); store.drop(); toast('Put back', null, null, 3000); }
            catch (err) { toast("Couldn't undo: " + (err.message || err), null, null, 6000); }
          });
        } else toast(`Not saved: ${d.error || 'Huckleberry error'}`, null, null, 8000);
      }, 'baby_edit_result');
    };
    sub();
  }

  // ------------------------------------------------------------ timeline card
  class BabyTimelineCard extends HTMLElement {
    setConfig(c) { this._c = Object.assign({ hour_px: 32 }, c || {}); this._view = this._c.view || 'day'; this._day = sod(new Date()); this._week = sod(new Date()); this._sumDays = 7; }
    getCardSize() { return 12; }
    getGridOptions() { return { columns: 12 }; }
    connectedCallback() {
      if (!this.shadowRoot) {
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.innerHTML = `<style>${CSS}</style><div class="seg" id="seg"></div><div id="body"></div>`;
        this.shadowRoot.addEventListener('click', (ev) => this._click(ev));
        this._swipe();
        new ResizeObserver(() => { const w = this.clientWidth; if (w && Math.abs(w - (this._w || 0)) > 20) { this._w = w; this._render(); } }).observe(this);
      }
      this._l = () => this._render();
      store.listeners.add(this._l);
      clearInterval(this._tick); this._tick = setInterval(() => { if (this._view === 'day') this._render(); }, 60000);
      this._render();
    }
    disconnectedCallback() { store.listeners.delete(this._l); clearInterval(this._tick); }
    set hass(h) { this._hass = h; store.watch(h); if (!this._first) { this._first = true; this._render(); } }

    _swipe() {
      let x0 = null, y0 = null, id = null;
      const body = () => this.shadowRoot.getElementById('body');
      this.shadowRoot.addEventListener('pointerdown', (e) => { if (!e.composedPath().some((n) => n.classList && n.classList.contains('swipe'))) return; x0 = e.clientX; y0 = e.clientY; id = e.pointerId; });
      this.shadowRoot.addEventListener('pointerup', (e) => {
        if (x0 == null || e.pointerId !== id) return;
        const dx = e.clientX - x0, dy = e.clientY - y0; x0 = null;
        if (Math.abs(dx) > 60 && Math.abs(dx) > Math.abs(dy) * 1.5) { this._suppress = Date.now(); this._move(dx < 0 ? 1 : -1); }
      });
      this.shadowRoot.addEventListener('pointercancel', () => (x0 = null));
    }
    _move(n) {
      const today = sod(new Date());
      if (this._view === 'day') { const d = addD(this._day, n); if (d <= today) this._day = d; }
      else if (this._view === 'week' || this._view === 'list') { const d = addD(this._week, 7 * n); if (d <= today) this._week = d; }
      this._render();
    }
    _click(ev) {
      if (this._suppress && Date.now() - this._suppress < 400) return;
      const t = ev.composedPath().find((n) => n.dataset && (n.dataset.v || n.dataset.nav || n.dataset.id || n.dataset.sum || n.dataset.gap || n.dataset.strip));
      if (!t) return;
      if (t.dataset.v) { this._view = t.dataset.v; this._picked = null; this._render(); return; }
      if (t.dataset.nav) { if (t.dataset.nav === 'today') { this._day = sod(new Date()); this._week = sod(new Date()); this._render(); } else this._move(+t.dataset.nav); return; }
      if (t.dataset.sum) { this._sumDays = +t.dataset.sum; this._render(); return; }
      if (t.dataset.id) {
        const e = (this._shown || []).find((x) => x.id === t.dataset.id);
        if (!e) return;
        if (t.dataset.pick && this._view === 'week') { this._picked = e; this._render(); return; }
        this._open(e);
        return;
      }
      if (t.dataset.strip) this._gapTap(ev, t);
    }
    _open(e) {
      const ctx = { extra: this._extra };
      if (base(e.kind) === 'sleep') {
        const sleeps = (this._shown || []).filter((x) => base(x.kind) === 'sleep' && x.id !== e.id && !x.live);
        const end = e.ts + (e.duration || 0);
        ctx.neighbour = sleeps.find((x) => (x.ts >= end && x.ts - end <= 1800) || (x.ts + x.duration <= e.ts && e.ts - (x.ts + x.duration) <= 1800)) || null;
      }
      sheet().open(e, ctx);
    }
    _gapTap(ev, strip) {
      if (this._view !== 'day') return;
      const r = strip.getBoundingClientRect(), y = ev.clientY - r.top, hp = this._c.hour_px;
      const t = this._day.getTime() / 1000 + (y / hp) * 3600;
      if (t > Date.now() / 1000) return;
      const sleeps = store.between(addD(this._day, -1), addD(this._day, 2)).filter((x) => base(x.kind) === 'sleep');
      const live = this._live().find((x) => base(x.kind) === 'sleep');
      if (live) sleeps.push(live);
      if (sleeps.some((x) => t >= x.ts && t <= x.ts + (x.duration || 0))) return;
      const before = sleeps.filter((x) => x.ts + x.duration <= t).pop();
      const after = sleeps.find((x) => x.ts > t);
      let a = before ? before.ts + before.duration : t - 1800, b = after ? after.ts : Math.min(Date.now() / 1000 - 60, t + 1800);
      if (b - a > 6 * 3600) { a = Math.max(a, t - 1800); b = Math.min(b, t + 1800); }
      if (b - a < 300) return;
      this._gap = { a, b };
      this._render();
      const A = new Date(a * 1000), B = new Date(b * 1000);
      toast(`Add sleep ${tm(A)}–${tm(B)}?`, 'Add', async () => {
        this._gap = null;
        try {
          await H().callService('script', 'baby_hb_send', { svc: 'huckleberry.log_sleep', payload: { device_id: DEV, start_time: A.toISOString(), end_time: B.toISOString() }, label: 'Sleep', at: tm(new Date()) });
          toast('Adding sleep…', null, null, 3000);
          setTimeout(() => store.drop([dayKey(A)]), 4000);
        } catch (err) { toast("Couldn't add: " + (err.message || err), null, null, 6000); }
      }, 8000);
      setTimeout(() => { if (this._gap && this._gap.a === a) { this._gap = null; this._render(); } }, 8000);
    }
    _live() {
      const h = this._hass || H(); if (!h) return [];
      const out = [], now = Date.now() / 1000;
      const sl = h.states['sensor.florence_sleep'];
      if (sl && ['active', 'paused'].includes(sl.state) && sl.attributes.current_start) {
        const s = new Date(sl.attributes.current_start).getTime() / 1000;
        out.push({ id: 'live-sleep', kind: 'sleep', ts: s, duration: now - s, live: true, tracker: 'sleep' });
      }
      const nu = h.states['sensor.florence_nursing'];
      if (nu && ['active', 'paused'].includes(nu.state) && nu.attributes.current_start) {
        const s = new Date(nu.attributes.current_start).getTime() / 1000;
        out.push({ id: 'live-feed', kind: 'breast', ts: s, duration: now - s, live: true, tracker: 'feed', left: nu.attributes.current_left_duration, right: nu.attributes.current_right_duration });
      }
      return out;
    }
    _render() {
      if (!this.shadowRoot || !(this._hass || H())) return;
      const seg = this.shadowRoot.getElementById('seg');
      seg.innerHTML = [['day', 'Day'], ['week', 'Week'], ['list', 'List'], ['summary', 'Summary']].map(([v, n]) => `<button data-v="${v}" class="${this._view === v ? 'on' : ''}">${n}</button>`).join('');
      const body = this.shadowRoot.getElementById('body');
      try {
        body.innerHTML = this['_v' + this._view[0].toUpperCase() + this._view.slice(1)]();
      } catch (err) {
        body.innerHTML = `<div class="err">Couldn't draw this view: ${esc(err.message)}</div>`;
      }
      if (store.err) body.insertAdjacentHTML('afterbegin', `<div class="err">Huckleberry didn't answer: ${esc(store.err)}. Pull to refresh or try again shortly.</div>`);
    }
    _navRow(title, canNext) {
      return `<div class="nav"><button data-nav="-1" aria-label="Earlier">‹</button><div class="t" data-nav="today">${esc(title)}</div><button data-nav="1" ${canNext ? '' : 'disabled'} aria-label="Later">›</button></div>`;
    }
    _stats(list, a, b) {
      const o = { sleep: 0, nap: 0, night: 0, feeds: 0, breast: 0, breastS: 0, bottle: 0, ml: 0, nappies: 0, wet: 0, dirty: 0, meds: [] };
      for (const e of list) {
        const k = base(e.kind);
        const s = Math.max(e.ts, a), en = Math.min(e.ts + (e.duration || 0), b);
        if (k === 'sleep') { const d = Math.max(0, en - s); o.sleep += d; if (isNight(e)) o.night += d; else o.nap += d; }
        if (e.ts < a || e.ts >= b) continue;
        if (k === 'breast') { o.feeds++; o.breast++; o.breastS += e.duration || 0; }
        if (k === 'bottle') { o.feeds++; o.bottle++; o.ml += +e.amount || 0; }
        if (k === 'diaper') { o.nappies++; if (['pee', 'both'].includes(e.mode)) o.wet++; if (['poo', 'both'].includes(e.mode)) o.dirty++; }
        if (k === 'medication') o.meds.push(e.medicine || 'medicine');
      }
      return o;
    }

    // ---------------- Day
    _vDay() {
      const day = this._day, next = addD(day, 1), today = sod(new Date()), isToday = +day === +today;
      store.ensure(addD(day, -1), day).then(() => store.ensure(addD(day, -8), addD(day, -2)));
      extra.load(day, next);
      this._extra = extra.get(day, next);
      const head = this._navRow(dayName(day) + (isToday || +day === +addD(today, -1) ? ` · ${WD[day.getDay()]} ${day.getDate()} ${MO[day.getMonth()]}` : ''), !isToday);
      if (!store.have(day, next)) return head + '<div class="load">Loading…</div>';
      const a = day.getTime() / 1000, b = next.getTime() / 1000;
      const list = store.between(day, next).concat(isToday ? this._live() : []);
      this._shown = list;
      const st = this._stats(list, a, Math.min(b, Date.now() / 1000));
      const nudges = isToday ? this._nudges(list) : '';
      const tot = `<div class="tot">
<div class="tile"><div class="v"><span class="dot" style="background:${C.sleep}"></span>${dur(st.sleep)}</div><div class="k">Naps <b>${dur(st.nap)}</b><br>Night <b>${dur(st.night)}</b></div></div>
<div class="tile"><div class="v"><span class="dot" style="background:${C.breast}"></span>${st.feeds} feeds</div><div class="k">Breast <b>${st.breast}</b> · ${dur(st.breastS)}<br>Bottle <b>${st.bottle}</b> · ${Math.round(st.ml)} ml</div></div>
<div class="tile"><div class="v"><span class="dot" style="background:${C.diaper}"></span>${st.nappies} napp${st.nappies === 1 ? 'y' : 'ies'}</div><div class="k">Wet <b>${st.wet}</b> · Dirty <b>${st.dirty}</b>${st.meds.length ? `<br>${esc([...new Set(st.meds)].join(', '))}` : ''}</div></div></div>`;
      return head + nudges + tot + this._strip(list, a, isToday);
    }
    _nudges(list) {
      const now = Date.now() / 1000, hr = new Date().getHours(), out = [];
      if (hr < 7 || hr >= 22) return '';
      const all = store.between(addD(new Date(), -2), new Date()).concat(this._live());
      const last = (k) => all.filter((e) => base(e.kind) === k).map((e) => e.ts + (k === 'sleep' ? e.duration || 0 : 0)).sort((x, y) => y - x)[0];
      const sleeping = this._live().some((e) => base(e.kind) === 'sleep');
      const n = last('diaper'); if (n && now - n > 4 * 3600) out.push(['mdi:human-baby-changing-table', `No nappy logged for ${dur(now - n)}`]);
      const f = Math.max(last('breast') || 0, last('bottle') || 0); if (f && now - f > 3.5 * 3600 && !sleeping) out.push(['mdi:baby-bottle-outline', `No feed logged for ${dur(now - f)}`]);
      const s = last('sleep'); if (s && !sleeping && now - s > 3 * 3600) out.push(['mdi:sleep', `Awake ${dur(now - s)} · was a nap missed?`]);
      return out.length ? `<div class="nudges">${out.slice(0, 2).map(([i, t]) => `<div class="nudge"><ha-icon icon="${i}"></ha-icon>${esc(t)}</div>`).join('')}</div>` : '';
    }
    _strip(list, a, isToday) {
      const hp = this._c.hour_px, H24 = 24 * hp, b = a + 86400;
      const W = this.clientWidth || 360, axis = 34, mainW = W - axis - 4;
      const y = (t) => ((Math.max(a, Math.min(b, t)) - a) / 3600) * hp;
      let h = `<div class="strip swipe no-swipe" data-strip="1" style="height:${H24 + 8}px">`;
      for (let i = 0; i <= 24; i++) {
        h += `<div class="hr" style="top:${i * hp}px"></div>`;
        if (i % 3 === 0 && i < 24) h += `<div class="hl" style="top:${i * hp}px">${i === 0 ? '12a' : i === 12 ? '12p' : i < 12 ? i + 'a' : i - 12 + 'p'}</div>`;
      }
      const spans = list.filter((e) => (e.duration || 0) > 0 && ['sleep', 'breast', 'activity', 'pump'].includes(base(e.kind)));
      const points = list.filter((e) => !spans.includes(e) && e.ts >= a && e.ts < b);
      // Everything is full width. Only a block that really collides with another (as drawn, so
      // the 18 px minimum counts) moves right and sits on top. Longest first, so sleeps stay put.
      const painted = (e) => { const t = y(e.ts); return [t, t + Math.max(18, y(e.ts + e.duration) - t)]; };
      const levels = []; const level = new Map();
      for (const e of [...spans].sort((p, q) => q.duration - p.duration)) {
        const [t0, t1] = painted(e);
        let i = levels.findIndex((l) => !l.some(([a0, a1]) => t0 < a1 - 2 && a0 < t1 - 2));
        if (i < 0) { i = levels.length; levels.push([]); }
        levels[i].push([t0, t1]); level.set(e, i);
      }
      // instant markers float on the right edge, on top of the blocks; close ones sit side by side
      const pills = [];
      for (const e of points) {
        const top = y(e.ts);
        const label = base(e.kind) === 'bottle' ? `${Math.round(e.amount || 0)}` : base(e.kind) === 'diaper' ? shortLabel(e) : '';
        const pw = 32 + label.length * 7;
        const near = pills.filter((r) => Math.abs(r.top - top) < 25);
        const right = Math.min(mainW - pw - 60, near.length ? Math.max(...near.map((r) => r.right + r.pw + 5)) : 2);
        pills.push({ top, right, pw });
        h += `<div class="mk" data-id="${esc(e.id)}" style="top:${top}px;right:${right}px;background:${color(e)}"><ha-icon icon="${ICON[base(e.kind)] || 'mdi:circle'}"></ha-icon>${esc(label)}</div>`;
      }
      const indent = Math.min(mainW - 96, Math.max(172, Math.round(mainW / 2)));
      const overs = spans.filter((e) => level.get(e) > 0).map(painted);
      const x = this._extra;
      for (const e of spans) {
        const top = y(e.ts), ht = Math.max(18, y(e.ts + e.duration) - top);
        const lv = level.get(e), clash = pills.filter((p) => Math.abs(p.top - (top + 9)) < 21);
        // a block on top keeps its label clear of the pills on its row
        const room = mainW - 84 - Math.max(0, ...clash.map((p) => p.right + p.pw));
        const off = lv ? Math.max(60, Math.min(room, mainW - 96, indent + (lv - 1) * 24)) : 0;
        const w = mainW - off, left = axis + 2 + off;
        // and a block underneath moves its label below whatever sits over its top edge
        const pad = lv ? 0 : Math.max(0, ...overs.filter(([t0, t1]) => t0 <= top + 16 && t1 > top).map(([, t1]) => t1 - top));
        const sc = x && base(e.kind) === 'sleep' ? (x.scores || []).find((q) => Math.abs(q.s - e.ts) < 900) : null;
        const who = extra.whoFor(e, x);
        let inner = ht >= 18 ? esc(shortLabel(e)) : '';
        if (sc && sc.score != null && ht >= 40 && w > 110) inner += `<span class="sc">${sc.score}</span>`;
        if (who && ht >= 40) inner += `<span class="who">${esc(who[0])}</span>`;
        if (sc) for (const c of sc.cries) { if (c[0] >= e.ts && c[0] <= e.ts + e.duration) inner += `<div class="cry" style="top:${y(c[0]) - top}px"></div>`; }
        h += `<div class="blk ${e.live ? 'live' : ''} ${lv ? 'over' : ''}" data-id="${esc(e.id)}" style="top:${top}px;height:${ht}px;left:${left}px;width:${w}px;z-index:${lv + 1};${pad && ht >= pad + 20 ? `padding-top:${pad + 3}px;` : ''}background:${color(e)}">${inner}</div>`;
        if (x && base(e.kind) === 'sleep') for (const r of x.runs || []) {
          const s = Math.max(r[0], e.ts), en = Math.min(r[1], e.ts + e.duration);
          if (en - s > 60) h += `<div class="snoo" style="top:${y(s)}px;height:${Math.max(4, y(en) - y(s))}px;left:${left - 6}px"></div>`;
        }
      }
      if (this._gap) h += `<div class="gap" style="top:${y(this._gap.a)}px;height:${Math.max(18, y(this._gap.b) - y(this._gap.a))}px;width:${mainW}px">Add sleep?</div>`;
      if (isToday) h += `<div class="nowl" style="top:${y(Date.now() / 1000)}px"></div>`;
      if (!list.length) h += `<div class="empty" style="position:absolute;top:${H24 / 3}px;left:34px;right:0">Nothing logged this day</div>`;
      return h + '</div>';
    }

    // ---------------- Week (7 columns, 7am-7am, like the app)
    _weekStart() { return addD(this._week, -6); }
    _vWeek() {
      const first = this._weekStart(), today = sod(new Date());
      store.ensure(first, this._week);
      const title = `${first.getDate()} ${MO[first.getMonth()]} – ${this._week.getDate()} ${MO[this._week.getMonth()]}`;
      const head = this._navRow(+this._week === +today ? 'This week' : title, +this._week < +today);
      if (!store.have(first, addD(this._week, 1))) return head + '<div class="load">Loading…</div>';
      const hp = 13, H24 = 24 * hp, now = Date.now() / 1000;
      let cols = '<div class="h"></div>', bodies = '';
      const shown = [];
      let axis = '<div class="ax" style="height:' + H24 + 'px">';
      for (let i = 0; i < 24; i += 6) axis += `<div class="hl" style="top:${i * hp}px;width:28px">${['7a', '1p', '7p', '1a'][i / 6]}</div>`;
      axis += '</div>';
      for (let i = 0; i < 7; i++) {
        const d = addD(first, i), a = d.getTime() / 1000 + 7 * 3600, b = a + 86400;
        cols += `<div class="h">${WD[d.getDay()]}<b>${d.getDate()}</b></div>`;
        const list = store.between(new Date(a * 1000), new Date(b * 1000)).concat(+d === +today || +d === +addD(today, -1) ? this._live() : []);
        let col = `<div class="col ${+d === +today ? 'today' : ''}" style="height:${H24}px">`;
        for (const e of list) {
          const k = base(e.kind), s = Math.max(a, e.ts), en = Math.min(b, e.ts + (e.duration || 0));
          if (e.ts + (e.duration || 0) < a || e.ts >= b) continue;
          shown.push(e);
          const top = ((s - a) / 3600) * hp;
          if (k === 'sleep') col += `<div class="bar" data-id="${esc(e.id)}" data-pick="1" style="top:${top}px;height:${Math.max(3, ((en - s) / 3600) * hp)}px;left:2px;right:40%;background:${color(e)}${this._picked && this._picked.id === e.id ? ';outline:2px solid #fff' : ''}"></div>`;
          else if (k === 'breast' || k === 'bottle' || k === 'activity' || k === 'pump') col += `<div class="bar" data-id="${esc(e.id)}" data-pick="1" style="top:${top}px;height:${Math.max(3, ((en - s) / 3600) * hp)}px;left:62%;right:2px;background:${color(e)}${this._picked && this._picked.id === e.id ? ';outline:2px solid #fff' : ''}"></div>`;
          else col += `<div class="bar" data-id="${esc(e.id)}" data-pick="1" style="top:${top - 3}px;height:6px;left:calc(62% - 9px);width:7px;border-radius:50%;background:${color(e)}"></div>`;
        }
        if (now > a && now < b) col += `<div style="position:absolute;left:0;right:0;top:${((now - a) / 3600) * hp}px;border-top:2px solid ${C.now}"></div>`;
        bodies += col + '</div>';
      }
      this._shown = shown;
      const p = this._picked;
      const sel = p ? `<div class="sel" data-id="${esc(p.id)}"><span class="dot" style="background:${color(p)}"></span><div class="tx" style="flex:1"><div style="font-weight:600;font-size:14px">${esc(sentence(p))}</div><div style="font-size:12px;color:rgba(255,255,255,.65)">${esc(dayName(new Date(p.ts * 1000)))} · ${esc(range(p))}${sideDetail(p) ? ' · ' + esc(sideDetail(p)) : ''}</div></div><ha-icon class="chev" icon="mdi:chevron-right"></ha-icon></div>`
        : `<div class="info" style="text-align:center;font-size:12px;color:rgba(255,255,255,.55);margin-top:8px">Tap a bar to see what it was</div>`;
      return head + `<div class="wk swipe no-swipe">${cols}${axis}${bodies}</div>` + sel +
        `<div class="leg"><span><span class="dot" style="background:${C.sleep}"></span>Sleep</span><span><span class="dot" style="background:${C.breast}"></span>Breast</span><span><span class="dot" style="background:${C.bottle}"></span>Bottle</span><span><span class="dot" style="background:${C.diaper}"></span>Nappy</span><span><span class="dot" style="background:${C.medication}"></span>Medicine</span></div>`;
    }

    // ---------------- List (week pages, newest first)
    _vList() {
      const first = this._weekStart(), today = sod(new Date());
      store.ensure(first, this._week);
      const extraW = extra.get(first, addD(this._week, 1)); extra.load(first, addD(this._week, 1));
      const title = `${first.getDate()} ${MO[first.getMonth()]} – ${this._week.getDate()} ${MO[this._week.getMonth()]}`;
      const head = this._navRow(+this._week === +today ? 'This week' : title, +this._week < +today);
      if (!store.have(first, addD(this._week, 1))) return head + '<div class="load">Loading…</div>';
      let html = head, shown = [];
      for (let i = 0; i < 7; i++) {
        const d = addD(this._week, -i);
        const list = (store.days[dayKey(d)] || []).slice().concat(+d === +today ? this._live() : []).sort((x, y) => y.ts - x.ts);
        shown = shown.concat(list);
        html += `<div class="dh">${esc(dayName(d))}</div>`;
        if (!list.length) { html += '<div class="grp"><div class="empty">Nothing logged</div></div>'; continue; }
        html += '<div class="grp">' + list.map((e) => {
          const who = extra.whoFor(e, extraW);
          return `<div class="row" data-id="${esc(e.id)}"><span class="dot" style="background:${color(e)};width:12px;height:12px"></span><div class="tx"><div class="s">${esc(sentence(e))}${e.live ? ' · now' : ''}</div><div class="d">${esc(range(e))}${sideDetail(e) ? ' · ' + esc(sideDetail(e)) : ''}${who ? ` <span class="who">· ${esc(who)}</span>` : ''}</div></div><ha-icon class="chev" icon="mdi:chevron-right"></ha-icon></div>`;
        }).join('') + '</div>';
      }
      this._shown = shown;
      return `<div class="swipe">${html}</div>`;
    }

    // ---------------- Summary
    _vSummary() {
      const n = this._sumDays, today = sod(new Date()), first = addD(today, -n);
      store.ensure(first, today);
      const pick = `<div class="seg" style="margin-top:0">${[7, 14, 30].map((d) => `<button data-sum="${d}" class="${n === d ? 'on' : ''}">${d} days</button>`).join('')}</div>`;
      if (!store.have(first, today)) return pick + '<div class="load">Loading…</div>';
      const days = [];
      for (let i = n; i >= 1; i--) { const d = addD(today, -i); days.push({ d, s: this._stats(store.between(d, addD(d, 1)), d / 1000, addD(d, 1) / 1000) }); }
      const avg = (f) => days.reduce((t, x) => t + f(x.s), 0) / days.length;
      const lbl = (d, i) => (n <= 7 ? WD[d.getDay()][0] : i % (n <= 14 ? 2 : 5) === 0 ? d.getDate() : '');
      const bars = (vals, max, segs) => `<div class="bars">${vals.map((v) => `<div class="b" style="height:${max ? Math.round((v.reduce((x, y) => x + y, 0) / max) * 100) : 0}%">${v.map((x, j) => `<div style="flex:${x};background:${segs[j]}"></div>`).join('')}</div>`).join('')}</div><div class="bl">${days.map((x, i) => `<span>${lbl(x.d, i)}</span>`).join('')}</div>`;
      const sl = days.map((x) => [x.s.night, x.s.nap]), slMax = Math.max(...sl.map((v) => v[0] + v[1]), 1);
      const fd = days.map((x) => [x.s.breast, x.s.bottle]), fdMax = Math.max(...fd.map((v) => v[0] + v[1]), 1);
      const np = days.map((x) => [x.s.wet, x.s.dirty]), npMax = Math.max(...np.map((v) => v[0] + v[1]), 1);
      const night = avg((s) => s.night), nap = avg((s) => s.nap), tot = night + nap;
      const R = 34, Cc = 2 * Math.PI * R, fN = tot ? night / tot : 0;
      const donut = `<div class="donut"><svg width="90" height="90" viewBox="0 0 90 90"><circle cx="45" cy="45" r="${R}" fill="none" stroke="${C.sleep}" stroke-width="12"/><circle cx="45" cy="45" r="${R}" fill="none" stroke="${C.night}" stroke-width="12" stroke-dasharray="${Cc * fN} ${Cc}" transform="rotate(-90 45 45)"/><text x="45" y="49" text-anchor="middle" fill="#fff" font-size="13" font-weight="700">${dur(tot).replace(' ', '')}</text></svg>
<div><div style="font-size:15px;font-weight:700">${dur(tot)} a day</div><div style="font-size:13px;color:rgba(255,255,255,.75)"><span class="dot" style="background:${C.night}"></span>Night ${dur(night)}<br><span class="dot" style="background:${C.sleep}"></span>Naps ${dur(nap)}</div></div></div>`;
      return `<div class="sum">${pick}
<div class="line">Over the last ${n} days ${CHILD} slept about <b>${dur(tot)}</b> a day, had <b>${avg((s) => s.feeds).toFixed(1)}</b> feeds and <b>${avg((s) => s.nappies).toFixed(1)}</b> nappies a day.</div>
<h3>Sleep</h3>${donut}${bars(sl, slMax, [C.night, C.sleep])}
<h3>Feeds</h3><div class="leg"><span><span class="dot" style="background:${C.breast}"></span>Breast ${avg((s) => s.breast).toFixed(1)}/day · ${dur(avg((s) => s.breastS))}</span><span><span class="dot" style="background:${C.bottle}"></span>Bottle ${avg((s) => s.bottle).toFixed(1)}/day · ${Math.round(avg((s) => s.ml))} ml</span></div>${bars(fd, fdMax, [C.breast, C.bottle])}
<h3>Nappies</h3><div class="leg"><span><span class="dot" style="background:#e9c46a"></span>Wet ${avg((s) => s.wet).toFixed(1)}/day</span><span><span class="dot" style="background:${C.diaper}"></span>Dirty ${avg((s) => s.dirty).toFixed(1)}/day</span></div>${bars(np, npMax, ['#e9c46a', C.diaper])}
</div>`;
    }
  }
  if (!customElements.get('baby-timeline-card')) customElements.define('baby-timeline-card', BabyTimelineCard);

  // ------------------------------------------------------------ chips card (input_select)
  class BabyChipsCard extends HTMLElement {
    setConfig(c) { if (!c.entity) throw new Error('entity required'); this._c = c; }
    getCardSize() { return 1; }
    set hass(h) {
      this._h = h;
      if (!this.shadowRoot) {
        this.attachShadow({ mode: 'open' });
        this.shadowRoot.addEventListener('click', (ev) => {
          const b = ev.composedPath().find((n) => n.dataset && n.dataset.o != null); if (!b) return;
          const cur = this._opt ?? (this._h.states[this._c.entity] || {}).state;
          const o = b.dataset.o === cur && this._c.toggle !== false ? (this._c.none || 'none') : b.dataset.o;
          this._opt = o; this._paint();
          this._h.callService('input_select', 'select_option', { entity_id: this._c.entity, option: o }).finally(() => setTimeout(() => { this._opt = null; this._paint(); }, 800));
        });
      }
      this._paint();
    }
    _paint() {
      const st = (this._h.states[this._c.entity] || {}).state, cur = this._opt ?? st;
      const opts = this._c.options || [];
      const key = cur + JSON.stringify(opts);
      if (key === this._k) return; this._k = key;
      this.shadowRoot.innerHTML = `<style>${CSS}
.w{display:flex;flex-wrap:wrap;gap:6px;justify-content:center;margin:2px 0 6px}
.lb{width:100%;text-align:center;font-size:12px;font-weight:600;color:rgba(255,255,255,.7);margin-bottom:2px}
.chip{height:36px;padding:0 14px;font-size:13px;font-weight:600}
.chip.on{color:#fff;background:linear-gradient(135deg,rgba(56,189,248,.80),rgba(37,99,235,.70));border-color:rgba(255,255,255,.35)}</style>
<div class="w">${this._c.label ? `<div class="lb">${esc(this._c.label)}</div>` : ''}${opts.map(([o, n]) => `<button class="chip ${o === cur ? 'on' : ''}" data-o="${esc(o)}">${esc(n)}</button>`).join('')}</div>`;
    }
  }
  if (!customElements.get('baby-chips-card')) customElements.define('baby-chips-card', BabyChipsCard);

  // ------------------------------------------------------------ edit card (inside the Add pop-ups)
  // Shows only while input_text.baby_edit holds an edit; renders a banner, start (and end) wheels,
  // optional chips, and Save/Cancel when the pop-up has no Save of its own.
  class BabyEditCard extends HTMLElement {
    setConfig(c) { this._c = Object.assign({ end: false, save: false, side: false, sleep: false, title: 'entry' }, c); }
    getCardSize() { return 1; }
    set hass(h) {
      this._h = h;
      const st = (h.states['input_text.baby_edit'] || {}).state;
      let m = null; try { m = st && st !== 'none' ? JSON.parse(st) : null; } catch (e) { m = null; }
      if (m && m.x && m.x < Date.now() / 1000) m = null;
      const on = !!m;
      this.style.display = on ? 'block' : 'none';
      if (!this.shadowRoot) this._build();
      if (on && st !== this._st) { this._st = st; this._banner(m); }
      if (!on) this._st = null;
      for (const c of this._kids || []) if (c._ok !== false && (c.tagName !== 'TIME-WHEEL-CARD' || c._ok)) c.hass = h;
    }
    _build() {
      this.attachShadow({ mode: 'open' });
      const c = this._c;
      this.shadowRoot.innerHTML = `<style>${CSS}
.ban{display:flex;align-items:center;gap:10px;padding:10px 14px;margin:0 0 6px;border-radius:20px;background:rgba(56,189,248,.14);border:1px solid rgba(56,189,248,.6);font-size:14px;font-weight:600}
.ban ha-icon{--mdc-icon-size:20px;color:#38bdf8}
.lab{font-size:12px;font-weight:700;color:rgba(255,255,255,.7);text-align:center;margin-top:4px}
.two{display:grid;grid-template-columns:1fr 1fr;gap:4px}
.acts{display:flex;gap:8px;margin:10px 0 4px}
.btn{flex:1;height:48px;font-size:16px;font-weight:700}
.btn.green{color:#fff;background:linear-gradient(135deg,rgba(76,175,80,.9),rgba(46,125,50,.8));border-color:rgba(255,255,255,.35)}
</style><div class="ban"><ha-icon icon="mdi:pencil"></ha-icon><span id="bt"></span></div><div id="w"></div>${c.save ? '<div class="acts"><button class="btn" id="cx">Cancel</button><button class="btn green" id="sv">Save</button></div>' : '<div class="acts"><button class="btn" id="cx">Cancel edit</button></div>'}`;
      const w = this.shadowRoot.getElementById('w');
      this._kids = [];
      const wheel = (entity, label) => {
        const box = document.createElement('div');
        box.innerHTML = `<div class="lab">${label}</div>`;
        const el = document.createElement('time-wheel-card');
        customElements.whenDefined('time-wheel-card').then(() => { el.setConfig({ entity, rows: 3, preset: true, item_height: 36 }); el._ok = true; if (this._h) el.hass = this._h; });
        box.appendChild(el); this._kids.push(el); return box;
      };
      const row = document.createElement('div'); row.className = c.end ? 'two' : '';
      row.appendChild(wheel('input_datetime.baby_edit_start', c.end ? 'Start' : 'Time'));
      if (c.end) row.appendChild(wheel('input_datetime.baby_edit_end', 'End'));
      w.appendChild(row);
      const chips = (entity, label, options) => { const el = document.createElement('baby-chips-card'); el.setConfig({ entity, label, options, toggle: true }); w.appendChild(el); this._kids.push(el); };
      if (c.side) chips('input_select.baby_edit_side', 'Side', [['left', 'Left'], ['right', 'Right'], ['both', 'Both']]);
      if (c.sleep) {
        chips('input_select.baby_sleep_mood', 'Start of sleep', [['upset', 'Upset'], ['happy', 'Content']]);
        chips('input_select.baby_sleep_fall', 'Time to fall asleep', [['under_10_minutes', 'Under 10 min'], ['10-20_minutes', '10-20 min'], ['longTimeToFallAsleep', 'Long time']]);
        chips('input_select.baby_sleep_how', 'How it happened', Object.entries(LOC));
      }
      const close = () => { history.replaceState(null, '', location.pathname + location.search); window.dispatchEvent(new CustomEvent('location-changed', { detail: { replace: true } })); };
      this.shadowRoot.getElementById('cx').onclick = () => { this._h.callService('script', 'baby_edit_cancel'); close(); };
      const sv = this.shadowRoot.getElementById('sv');
      if (sv) sv.onclick = () => { sv.textContent = 'Saving…'; this._h.callService('script', 'turn_on', { entity_id: 'script.baby_edit_save' }); setTimeout(() => { sv.textContent = 'Save'; close(); }, 150); };
    }
    _banner(m) {
      const d = new Date(m.d + 'T12:00:00');
      const what = { sleep: 'sleep', breast: 'nursing', bottle: 'bottle', diaper: 'nappy', medication: 'medicine' }[base(m.k)] || (ACT[(m.k || '').split(':')[1]] || 'activity').toLowerCase();
      this.shadowRoot.getElementById('bt').textContent = `Editing ${what} from ${dayName(d)}`;
    }
  }
  if (!customElements.get('baby-edit-card')) customElements.define('baby-edit-card', BabyEditCard);

  window.customCards = window.customCards || [];
  window.customCards.push({ type: 'baby-timeline-card', name: 'Baby timeline', description: 'Huckleberry history: Day / Week / List / Summary (' + V + ')' });
})();
