// SignalCraft mode of the generator: settings of everything the export would otherwise guess, checks and a preview
// of the instruments as SignalCraft builds them (EMZZ). The settings belong to the layout: they are saved in the .lua
// file (a Lua comment ORMS ignores) and with the autosave of the browser.
import { convertToStation, routeKey } from './signalcraft.js';
import { natural } from './emzz-model.js';

const POSITION = /^\[sloupec (\d+), řádek (\d+)\]\s*/; // 1-based in the messages of signalcraft.js
const esc = s => String(s ?? '').replace(/[&<>"']/g, z => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[z]));
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const count = (n, one, few, many) => n + ' ' + plural(n, one, few, many);
const path = p => `data-sc="${esc(JSON.stringify(p))}"`;

export const KIND_TITLE = {
    vjezdove: 'vjezdové', odjezdove: 'odjezdové', skupinove: 'skupinové', cestove: 'cestové', vlozene: 'vložené', vnitrni: 'vnitřní',
};
const KIND_HELP = {
    vjezdove: 'za ním je trať; cesty vedou na první dopravní kolej',
    odjezdove: 'stojí na konci dopravní koleje; cesty vedou na trať',
    skupinove: 'stojí ve zhlaví a platí pro víc kolejí; cesta z každé koleje pod ním',
    cestove: 'Sc / Lc: cesta vede přes další hlavní návěstidlo, opakuje jeho návěst',
    vlozene: 'VS / VL na koleji pod skupinovým: „Odjezdové návěstidlo dovoluje jízdu“',
    vnitrni: 'nemá vlastní cesty, rozsvítí se, když přes něj vede vjezd',
};
// speed through the diverging position of a switch (EMZZ: 40–160 km/h, ORMS: 40 when not given)
export const SPEEDS = [40, 50, 60, 80, 100, 120];
export const VALIDITY_TITLE = { posun: 'pro posun', vlak: 'pro jízdu vlaku', oba: 'pro posun i jízdu vlaku' };
const TABS = [
    ['prehled', 'Přehled'], ['stavedla', 'Stavědla'], ['navestidla', 'Návěstidla'], ['vyhybky', 'Výhybky'],
    ['koleje', 'Koleje a tratě'], ['cesty', 'Cesty'], ['pristroje', 'Přístroje'],
];
export const BOX_COLOURS = 6;

/** removes empty values, objects and lists (in place) */
function prune(o) {
    if (!o || typeof o !== 'object' || Array.isArray(o)) return o;
    for (const k of Object.keys(o)) {
        const v = prune(o[k]);
        if (v === undefined || v === null || v === '' || (typeof v === 'object' && !Array.isArray(v) && !Object.keys(v).length) || (Array.isArray(v) && !v.length)) delete o[k];
    }
    return o;
}

/** "Vy5-, Vy6 +" -> {Vy5: "-", Vy6: "+"}; null when it cannot be read */
function parseVia(s) {
    const out = {};
    for (const part of s.split(/[,;\s]+/).filter(Boolean)) {
        const m = part.match(/^(.+?)([+\-−])$/);
        if (!m) return null;
        out[m[1]] = m[2] === '+' ? '+' : '-';
    }
    return out;
}
const viaText = o => Object.entries(o || {}).map(([k, v]) => k + (v === '+' ? '+' : '−')).join(' ');

/**
 * @param {{grid, load: () => object, save: (sc: object) => void, locate: (x:number, y:number) => void,
 *          setMarks: (m: Map) => void, toast: Function, onResult: () => void, tab?: string, onTab?: (t: string) => void}} env
 */
export function initSignalCraft(env) {
    const $ = s => document.querySelector(s);
    const body = $('#scBody');
    let sc = env.load() || {};
    let res = null;
    let tab = TABS.some(t => t[0] === env.tab) ? env.tab : 'prehled';
    let active = false;
    let timer = null;

    $('#scTabs').innerHTML = TABS.map(([id, t]) => `<button type="button" role="tab" data-sctab="${id}" aria-selected="${id === tab}">${t} <span class="badge" data-scbadge="${id}"></span></button>`).join('');
    $('#scTabs').addEventListener('click', e => {
        const b = e.target.closest('[data-sctab]');
        if (!b) return;
        tab = b.dataset.sctab;
        env.onTab && env.onTab(tab);
        for (const x of document.querySelectorAll('[data-sctab]')) x.setAttribute('aria-selected', String(x.dataset.sctab === tab));
        body.scrollTop = 0;
        render();
    });
    $('#scRecheck').addEventListener('click', () => {
        if (!active) return;
        run();
        const r = res;
        env.toast(r.errors.length ? `Přepočítáno: ${count(r.errors.length, 'chyba', 'chyby', 'chyb')}` : `Přepočítáno: stanice je v pořádku${r.warnings.length ? ', ' + count(r.warnings.length, 'upozornění', 'upozornění', 'upozornění') : ''}`, { error: !!r.errors.length });
    });
    const nameInput = $('#scName');
    nameInput.value = (sc.stanice && sc.stanice.nazev) || '';
    nameInput.addEventListener('change', () => change(s => { s.stanice = { ...(s.stanice || {}), nazev: nameInput.value.trim() }; }));

    // ---------------------------------------------------------------- running the export
    function run() {
        res = convertToStation(env.grid.cells, { sc, name: 'Stanice' });
        marks();
        render();
        env.onResult && env.onResult();
    }
    function schedule() {
        if (!active) return;
        clearTimeout(timer);
        timer = setTimeout(run, 120);
    }
    function change(fn) {
        fn(sc);
        prune(sc);
        env.save(sc);
        if (active) run();
    }
    function boxIndex(id) { return res && res.info ? res.info.boxes.findIndex(b => b.id === id) : -1; }

    function marks() {
        const m = new Map();
        const cols = env.grid.cols;
        if (res && res.info) {
            const put = (x, y, box) => { const i = boxIndex(box); if (i >= 0) m.set(y * cols + x, ' scb scb-' + (i % BOX_COLOURS)); };
            for (const list of [res.info.switches, res.info.signals, res.info.shunts, res.info.crossings]) for (const e of list) put(e.x, e.y, e.box);
        }
        const mark = (texts, cls) => {
            for (const t of texts) {
                const p = t.match(POSITION);
                if (p) { const k = (+p[2] - 1) * cols + (+p[1] - 1); m.set(k, (m.get(k) || '') + cls); }
            }
        };
        if (res) { mark(res.warnings, ' sc-warn'); mark(res.errors, ' sc-error'); }
        env.setMarks(m);
    }

    // ---------------------------------------------------------------- input handling (panel and inspector)
    function setPath(s, p, value) {
        let o = s;
        for (const k of p.slice(0, -1)) o = o[k] = o[k] && typeof o[k] === 'object' ? o[k] : {};
        o[p[p.length - 1]] = value;
    }
    function onChange(e) {
        const el = e.target;
        if (el.dataset.sc) {
            let v = el.type === 'checkbox' ? el.checked : el.value.trim();
            if (el.dataset.default !== undefined && String(v) === el.dataset.default) v = '';
            if (el.dataset.type === 'number' && v !== '') v = +v;
            change(s => setPath(s, JSON.parse(el.dataset.sc), v));
            return;
        }
        if (el.dataset.routeOff !== undefined) {
            const k = el.dataset.routeOff;
            change(s => {
                const c = s.cesty = s.cesty || {};
                c.vypnute = (c.vypnute || []).filter(x => x !== k);
                if (!el.checked) c.vypnute.push(k);
            });
            return;
        }
        if (el.dataset.routeVia !== undefined) {
            const k = el.dataset.routeVia, v = parseVia(el.value.trim());
            if (v === null) { env.toast('Polohy výhybek pište jako „Vy5− Vy6+“', { error: true }); return; }
            change(s => { const c = s.cesty = s.cesty || {}; c.pres = c.pres || {}; if (Object.keys(v).length) c.pres[k] = v; else delete c.pres[k]; });
            return;
        }
        if (el.dataset.couple !== undefined) {
            const p = el.dataset.couple.split('/');
            const key = q => [...q].sort(natural).join('/');
            change(s => {
                const c = s.sprazene = s.sprazene || {};
                c.odebrat = (c.odebrat || []).filter(q => key(q) !== key(p));
                if (!el.checked) c.odebrat.push(p);
            });
            return;
        }
        if (el.dataset.groupTrack !== undefined) {
            const name = el.dataset.groupTrack;
            const root = el.closest('.sc-body, .tabpanel') || document;
            const boxes = [...root.querySelectorAll('[data-group-track]')].filter(b => b.dataset.groupTrack === name);
            const on = boxes.filter(b => b.checked).map(b => b.value);
            change(s => setPath(s, ['prvky', name, 'koleje'], on.length === boxes.length ? '' : on.length ? on : ['-']));
        }
    }
    function onClick(e) {
        const loc = e.target.closest('[data-locate]');
        if (loc) { const [x, y] = loc.dataset.locate.split(',').map(Number); env.locate(x, y); return; }
        const del = e.target.closest('[data-route-del]');
        if (del) {
            const k = del.dataset.routeDel;
            change(s => { const c = s.cesty || {}; c.pridane = (c.pridane || []).filter(r => routeKey(r.od, r.z || null, r.na) !== k); });
            return;
        }
        const unc = e.target.closest('[data-uncouple]');
        if (unc) {
            const p = unc.dataset.uncouple;
            change(s => { const c = s.sprazene || {}; c.pridat = (c.pridat || []).filter(q => q.join('/') !== p); });
            return;
        }
        if (e.target.closest('#scAddRoute')) {
            const od = $('#scNewOd').value, z = $('#scNewZ').value || null, na = $('#scNewNa').value;
            if (!od || !na) { env.toast('Vyberte návěstidlo a cíl cesty', { error: true }); return; }
            change(s => {
                const c = s.cesty = s.cesty || {};
                c.pridane = c.pridane || [];
                c.pridane.push({ od, ...(z ? { z } : {}), na });
                c.vypnute = (c.vypnute || []).filter(k => k !== routeKey(od, z, na));
            });
            return;
        }
        if (e.target.closest('#scAddCouple')) {
            const a = $('#scNewCa').value, b = $('#scNewCb').value;
            if (!a || !b || a === b) { env.toast('Vyberte dvě různé výhybky', { error: true }); return; }
            change(s => { const c = s.sprazene = s.sprazene || {}; c.pridat = c.pridat || []; c.pridat.push([a, b].sort(natural)); });
        }
    }
    for (const root of [body, $('#tabCell')]) {
        root.addEventListener('change', onChange);
        root.addEventListener('click', onClick);
    }

    // ---------------------------------------------------------------- rendering
    const where = (x, y, text) => `<button type="button" class="sc-loc" data-locate="${x},${y}" title="Ukázat v mřížce">${esc(text ?? (x + '·' + y))}</button>`;
    const boxSelect = (p, value, auto, boxes) => `<select ${path(p)} data-default="">
        <option value="">${esc(auto ? 'auto (' + auto + ')' : 'auto')}</option>
        ${boxes.map(b => `<option value="${esc(b.id)}"${value === b.id ? ' selected' : ''}>${esc(b.id)}</option>`).join('')}</select>`;
    const cfg = name => (sc.prvky && sc.prvky[name]) || {};
    const boxDot = id => { const i = boxIndex(id); return i < 0 ? '' : `<span class="sc-dot scb-${i % BOX_COLOURS}"></span>`; };
    const kindSelect = (s, o) => `<select ${path(['prvky', s.name, 'druh'])} data-default="">
        <option value="">auto (${KIND_TITLE[s.autoKind]})</option>
        ${Object.entries(KIND_TITLE).map(([k, t]) => `<option value="${k}"${o.druh === k ? ' selected' : ''} title="${esc(KIND_HELP[k])}">${t}</option>`).join('')}</select>`;
    // validity: "posun" makes a main signal a shunting one (blue shunt lever, no train routes), "vlak" = no shunt
    // lever, "oba" = shunt lever with a red plate
    const validitySelect = (s, o) => `<select ${path(['prvky', s.name, 'platnost'])} data-default="">
        <option value="">auto (${VALIDITY_TITLE[s.autoValidity]})</option>
        ${Object.entries(VALIDITY_TITLE).map(([k, t]) => `<option value="${k}"${o.platnost === k ? ' selected' : ''}>${t}</option>`).join('')}</select>`;
    const speedSelect = (name, o) => `<select ${path(['prvky', name, 'rychlost'])} data-type="number" data-default="40">${SPEEDS.map(v => `<option value="${v}"${(o.rychlost || 40) === v ? ' selected' : ''}>${v} km/h</option>`).join('')}</select>`;
    const groupTracks = s => {
        const free = s.behind.filter(b => !b.by), by = s.behind.filter(b => b.by);
        if (!s.behind.length) return '<span class="muted">žádná dopravní kolej za ním</span>';
        return free.map(b => `<label class="chk"><input type="checkbox" data-group-track="${esc(s.name)}" value="${esc(b.number)}"${!s.tracks || s.tracks.map(String).includes(b.number) ? ' checked' : ''}> ${esc(b.number)}</label>`).join(' ')
            + by.map(b => ` <span class="muted" title="kolej má vlastní návěstidlo">${esc(b.number)} (${esc(b.by)})</span>`).join('');
    };

    function messages(cls, title, texts) {
        if (!texts.length) return '';
        const items = texts.map(t => {
            const m = t.match(POSITION);
            return `<li>${m ? where(m[1] - 1, m[2] - 1) : ''}<span>${esc(t.replace(POSITION, ''))}</span></li>`;
        });
        const badge = cls === 'chyba' ? 'error' : cls === 'varovani' ? 'warn' : 'ok';
        return `<div class="sc-sekce ${cls}"><h3>${title} <span class="badge ${badge}">${texts.length}</span></h3><ul class="sc-hlasky">${items.join('')}</ul></div>`;
    }

    function render() {
        if (!active || !res) return;
        const nErr = res.errors.length, nWarn = res.warnings.length;
        $('#scStatus').innerHTML = nErr ? `<span class="bad">✕ ${count(nErr, 'chyba', 'chyby', 'chyb')}</span>`
            : `<span class="good">✓ stanici lze stáhnout</span>${nWarn ? ` · ${count(nWarn, 'upozornění', 'upozornění', 'upozornění')}` : ''}`;
        for (const b of document.querySelectorAll('[data-scbadge]')) {
            const first = b.dataset.scbadge === 'prehled';
            b.className = 'badge' + (first && nErr ? ' error' : first && nWarn ? ' warn' : '');
            b.textContent = first ? (nErr || nWarn || '') : '';
        }
        for (const b of document.querySelectorAll('[data-action="scDownload"], [data-action="scCopy"]')) b.disabled = !res.station;
        const scroll = body.scrollTop;
        body.innerHTML = res.info ? ({ prehled, stavedla, navestidla, vyhybky, koleje, cesty, pristroje })[tab]() : messages('chyba', 'Chyby', res.errors);
        body.scrollTop = scroll;
    }

    function prehled() {
        const i = res.info;
        let h = '';
        if (res.errors.length) h += '<div class="banner error">Stanice má chyby, SignalCraft by ji nenačetl. Opravte je v kolejišti nebo v nastavení.</div>';
        else h += '<div class="banner ok">✓ Stanice je v pořádku. <span class="muted">Stáhněte ji nebo zkopírujte (vpravo nahoře) a ve hře ji vložte klíčem do přístroje v DK.</span></div>';
        const routes = res.model && res.model.st ? res.model.st.routes.size : 0;
        h += '<div class="sc-cisla">' + [
            [i.boxes.length, 'stavědlo', 'stavědla', 'stavědel'], [i.switches.length, 'výhybka', 'výhybky', 'výhybek'],
            [i.signals.length, 'hlavní návěstidlo', 'hlavní návěstidla', 'hlavních návěstidel'],
            [i.tracks.filter(t => t.main).length, 'dopravní kolej', 'dopravní koleje', 'dopravních kolejí'],
            [i.lines.length, 'trať', 'tratě', 'tratí'], [i.crossings.length, 'přejezd', 'přejezdy', 'přejezdů'],
            [routes, 'vlaková cesta', 'vlakové cesty', 'vlakových cest'],
        ].filter(p => p[0]).map(p => `<span class="chip"><b>${p[0]}</b> ${plural(...p)}</span>`).join('') + '</div>';
        h += messages('chyba', 'Chyby', res.errors);
        h += messages('varovani', 'Upozornění', res.warnings);
        h += messages('info', 'Cesty přes víc stavědel (souhlasová hradla)', res.notes || []);
        h += `<div class="sc-sekce"><h3>Co projít, než stanici stáhnete</h3><ol class="sc-kroky">
            <li><b>Stavědla</b>: každá výhybka a návěstidlo patří správnému stavědlu (v mřížce jsou obarvené podle stavědla).</li>
            <li><b>Návěstidla</b>: druh (vjezdové, odjezdové, skupinové …) a u skupinových koleje, pro které platí.</li>
            <li><b>Koleje a tratě</b>: dopravní koleje (spojovací kolej mezi zhlavími dopravní není) a texty na štítcích (od / do …).</li>
            <li><b>Cesty</b>: vypněte cesty, které nechcete, případně určete polohy výhybek.</li>
            <li><b>Přístroje</b>: zkontrolujte hradla, kličky a závěrníky každého stavědla i v dopravní kanceláři.</li></ol></div>`;
        return h;
    }

    function stavedla() {
        const i = res.info, eq = res.model && res.model.st ? res.model.st.equipment : new Map();
        const rows = i.boxes.map((b, n) => {
            const o = (sc.stavedla && sc.stavedla[b.id]) || {};
            const e = eq.get(b.id);
            const cnt = list => list.filter(x => x.box === b.id).length;
            return `<tr><td>${boxDot(b.id)}<b>${esc(b.id)}</b></td>
                <td><input type="text" ${path(['stavedla', b.id, 'nazev'])} data-default="${esc(b.autoName)}" value="${esc(o.nazev || '')}" placeholder="${esc(b.autoName)}"></td>
                <td><input type="number" min="1" max="99" class="short" ${path(['stavedla', b.id, 'poradi'])} data-type="number" value="${esc(o.poradi ?? '')}" placeholder="${n + 1}"></td>
                <td><select ${path(['stavedla', b.id, 'kontrolkyIK'])} data-default="pristroj">
                    <option value="pristroj"${b.indicators !== 'relief' ? ' selected' : ''}>na přístroji (krabička na poličce)</option>
                    <option value="relief"${b.indicators === 'relief' ? ' selected' : ''}>na reliéfu</option></select></td>
                <td>${e ? (e.side === 'L' ? 'levé' : 'pravé') : ''}</td>
                <td class="num">${cnt(i.switches)}</td><td class="num">${cnt(i.signals)}</td><td class="num">${e ? e.rowBox.length : ''}</td></tr>`;
        });
        return `<p class="sc-pozn">Stavědla se berou z popisků <b>L ST1</b>, <b>L ST2</b> … v kolejišti. Pořadí určuje pořadí skupin v dopravní kanceláři (v rámci strany stanice).</p>
            <table class="sc-tab"><thead><tr><th>Stavědlo</th><th>Název na přístroji</th><th>Pořadí</th><th>Kontrolky izolovaných kolejnic</th><th>Zhlaví</th><th class="num">Výhybek</th><th class="num">Návěstidel</th><th class="num">Hradel</th></tr></thead>
            <tbody>${rows.join('')}</tbody></table>`;
    }

    function navestidla() {
        const i = res.info;
        const routesOf = name => (res.model && res.model.st ? [...res.model.st.routes.values()].filter(r => r.from === name).length : 0);
        const rows = i.signals.map(s => {
            const o = cfg(s.name);
            return `<tr><td>${where(s.x, s.y, s.name)}</td><td>${kindSelect(s, o)}</td><td>${validitySelect(s, o)}</td><td>${boxDot(s.box)}${boxSelect(['prvky', s.name, 'stavedlo'], o.stavedlo, s.autoBox, i.boxes)}</td>
                <td>${s.kind === 'skupinove' ? groupTracks(s) : ''}</td><td class="num">${routesOf(s.name) || '<span class="muted">–</span>'}</td></tr>`;
        });
        const simple = (list, title, valid) => list.length ? `<h3 class="sc-h">${title}</h3><table class="sc-tab narrow"><thead><tr><th>Název</th>${valid ? '<th>Platí</th>' : ''}<th>Stavědlo</th></tr></thead><tbody>${list.map(s =>
            `<tr><td>${where(s.x, s.y, s.name)}</td>${valid ? `<td>${validitySelect(s, cfg(s.name))}</td>` : ''}<td>${boxDot(s.box)}${boxSelect(['prvky', s.name, 'stavedlo'], cfg(s.name).stavedlo, s.autoBox, i.boxes)}</td></tr>`).join('')}</tbody></table>` : '';
        return `<p class="sc-pozn">Druh se odhaduje z kolejiště a předpony názvu. <b>Platí</b>: hlavní návěstidlo platné i pro posun má posunovou kličku (červený štítek), platné jen pro jízdu vlaku ji nemá; platné jen pro posun se stane seřaďovacím (modrý štítek, bez vlakových cest). <b>Skupinové</b> návěstidlo ve zhlaví dostane cestu z každé zaškrtnuté koleje (na závěrníku pak je číslo koleje); kolej s vlastním vloženým nebo cestovým návěstidlem (VS, Sc) ho nepotřebuje.</p>
            <table class="sc-tab"><thead><tr><th>Návěstidlo</th><th>Druh</th><th>Platí</th><th>Stavědlo</th><th>Skupinové: platí pro koleje</th><th class="num">Cest</th></tr></thead><tbody>${rows.join('')}</tbody></table>
            ${simple(i.shunts, 'Seřaďovací návěstidla (posunové kličky s modrým štítkem)', true)}${simple(i.crossings, 'Přejezdy (krabička na poličce stavědla)')}`;
    }

    function vyhybky() {
        const i = res.info;
        const pairOf = name => i.coupled.find(p => p.includes(name));
        const rows = i.switches.map(s => {
            const o = cfg(s.name);
            const p = pairOf(s.name);
            return `<tr><td>${where(s.x, s.y, s.name)}</td><td>${boxDot(s.box)}${boxSelect(['prvky', s.name, 'stavedlo'], o.stavedlo, s.autoBox, i.boxes)}</td>
                <td>${s.plus}</td><td>${s.minus}</td>
                <td><label class="chk"><input type="checkbox" ${path(['prvky', s.name, 'zamenit'])} data-default="false"${s.swapped ? ' checked' : ''}> zaměnit</label></td>
                <td>${speedSelect(s.name, o)}</td><td>${p ? esc(p.join('/')) : ''}</td></tr>`;
        });
        const auto = i.coupledAuto.map(p => {
            const on = i.coupled.some(q => q.join('/') === p.join('/'));
            return `<li><label class="chk"><input type="checkbox" data-couple="${esc(p.join('/'))}"${on ? ' checked' : ''}> ${esc(p.join('/'))}</label> <span class="muted">spojka nalezená v kolejišti</span></li>`;
        });
        const added = ((sc.sprazene && sc.sprazene.pridat) || []).map(p => `<li>${esc(p.join('/'))} <button type="button" class="btn small" data-uncouple="${esc(p.join('/'))}">Odebrat</button></li>`);
        const opts = i.switches.map(s => `<option>${esc(s.name)}</option>`).join('');
        return `<p class="sc-pozn"><b>+</b> je základní poloha výměnové kličky. Export bere „+“ jako přímý směr; „zaměnit“ to u výhybky obrátí (např. když je přímá větev nakreslená obloukem).</p>
            <table class="sc-tab"><thead><tr><th>Výhybka</th><th>Stavědlo</th><th>+ vede</th><th>− vede</th><th>+ / −</th><th>Rychlost do odbočky</th><th>Spřažená</th></tr></thead><tbody>${rows.join('')}</tbody></table>
            <h3 class="sc-h">Spřažené výhybky (jedna výměnová klička)</h3>
            <ul class="sc-seznam">${auto.join('')}${added.join('')}${auto.length || added.length ? '' : '<li class="muted">žádné</li>'}</ul>
            <div class="sc-pridat"><select id="scNewCa"><option value="">výhybka…</option>${opts}</select> + <select id="scNewCb"><option value="">výhybka…</option>${opts}</select>
            <button type="button" class="btn" id="scAddCouple">Spřáhnout</button></div>`;
    }

    function koleje() {
        const i = res.info;
        const tracks = i.tracks.map(t => `<tr><td>${where(t.x, t.y, t.number)}</td>
            <td><label class="chk"><input type="checkbox" ${path(['koleje', t.number, 'dopravni'])} data-default="true"${t.main ? ' checked' : ''}> dopravní kolej</label></td>
            <td class="muted">${t.main ? 'vlakové cesty na ní končí a začínají' : 'cesty přes ni vedou (spojovací, manipulační kolej)'}</td></tr>`);
        const lines = i.lines.map(l => {
            const o = (sc.trate && sc.trate[l.id]) || {};
            const inp = (k, ph) => `<input type="text" ${path(['trate', l.id, k])} value="${esc(o[k] || '')}" placeholder="${esc(ph)}">`;
            return `<tr><td>${where(l.x, l.y, l.code)}</td><td>${inp('nazev', l.autoName)}</td><td>${inp('od', 'z ' + l.name)}</td><td>${inp('do', 'do ' + l.name)}</td>
                <td>${inp('zkratka', l.toText.replace(/^do\s+/i, ''))}</td>
                <td><label class="chk"><input type="checkbox" ${path(['trate', l.id, 'odjezd'])} data-default="${l.autoExit}"${l.exit ? ' checked' : ''}> odjezd</label></td></tr>`;
        });
        return `<h3 class="sc-h">Číslované koleje</h3>
            <p class="sc-pozn">Každá očíslovaná kolej je dopravní kolej: vjezd na ní končí, odjezd z ní začíná a jiná cesta přes ni nevede. Spojovací kolej mezi zhlavími odškrtněte.</p>
            <table class="sc-tab narrow"><thead><tr><th>Kolej</th><th></th><th></th></tr></thead><tbody>${tracks.join('')}</tbody></table>
            <h3 class="sc-h">Tratě</h3>
            <p class="sc-pozn">Texty jsou na štítcích hradel („Náv. L od …“, „Závěr výměn T1 do …“) a na reliéfu. <b>Na štítcích</b> nahradí jméno, když se nevejde. <b>Odjezd</b>: na dvoukolejné trati se odjíždí po pravé koleji.</p>
            <table class="sc-tab"><thead><tr><th>Trať</th><th>Sousední stanice</th><th>Vjezd „z …“</th><th>Odjezd „do …“</th><th>Na štítcích</th><th></th></tr></thead><tbody>${lines.join('')}</tbody></table>`;
    }

    function cesty() {
        const i = res.info;
        const model = res.model && res.model.st ? res.model.st : null;
        const byKey = new Map();
        if (model) for (const r of model.routes.values()) byKey.set(routeKey(r.from, r.startTrack, r.to), r);
        const via = (sc.cesty && sc.cesty.pres) || {};
        const target = id => (i.lineName(id) ? 'trať ' + i.lineName(id) : 'kolej ' + i.trackName(id));
        const sigBox = name => (i.signals.find(s => s.name === name) || {}).box;
        let last = '';
        const rows = i.routes.map(r => {
            const m = byKey.get(r.key);
            const sw = m ? [...m.switches].sort((a, b) => natural(a[0], b[0])).map(([k, v]) => k + (v === '+' ? '+' : '−')).join(' ') : '';
            const cls = [r.od !== last ? 'sc-first' : '', r.off ? 'off' : ''].filter(Boolean).join(' ');
            last = r.od;
            const state = r.off ? '<span class="muted">vypnutá</span>' : m ? '' : res.errors.length ? '' : '<span class="bad">nenalezena</span>';
            return `<tr${cls ? ` class="${cls}"` : ''}><td><input type="checkbox" data-route-off="${esc(r.key)}"${r.off ? '' : ' checked'} title="Cesta zapnutá"></td>
                <td><b>${esc(r.od)}</b></td><td>${r.z ? esc(i.trackName(r.z)) : ''}</td><td>${esc(target(r.na))}</td>
                <td>${boxDot(sigBox(r.od))}${esc(sigBox(r.od) || '')}</td><td>${m && m.helpers.length ? m.helpers.map(h => boxDot(h) + esc(h)).join(' ') : ''}</td>
                <td class="mono">${esc(sw)}${r.mijene.length ? ` <span class="muted">· míjí ${esc(r.mijene.join(', '))}</span>` : ''}</td>
                <td><input type="text" class="mono" data-route-via="${esc(r.key)}" value="${esc(viaText(via[r.key]))}" placeholder="Vy5−"></td>
                <td>${r.auto ? '' : `<button type="button" class="btn small" data-route-del="${esc(r.key)}">Odebrat</button>`}${state}</td></tr>`;
        });
        const sigOpts = i.signals.filter(s => s.kind !== 'vnitrni').map(s => `<option>${esc(s.name)}</option>`).join('');
        const trackOpts = i.tracks.filter(t => t.main).map(t => `<option value="k${esc(t.number)}">${esc(t.number)}</option>`).join('');
        const naOpts = i.lines.map(l => `<option value="${esc(l.id)}">trať ${esc(l.code)} ${esc(l.name)}</option>`).join('')
            + i.tracks.filter(t => t.main).map(t => `<option value="k${esc(t.number)}">kolej ${esc(t.number)}</option>`).join('');
        return `<p class="sc-pozn">Cesty se odvodí z kolejiště. Vypnutá cesta se do stanice nedostane (na přístroji nebude). <b>Přes</b>: polohy výhybek, kterými má cesta vést, když je víc možností (např. „Vy5− Vy9+“). <b>Souhlas od</b>: stavědla, přes jejichž výhybky cesta vede; zamknou je kolejovým závěrníkem a dají souhlasovým hradlem souhlas, bez něj stavědlo s návěstidlem neuzavře závěr výměn.</p>
            <table class="sc-tab"><thead><tr><th></th><th>Od</th><th>Z koleje</th><th>Na</th><th>Stavědlo</th><th>Souhlas od</th><th>Výhybky v cestě</th><th>Přes</th><th></th></tr></thead><tbody>${rows.join('')}</tbody></table>
            <h3 class="sc-h">Přidat cestu</h3>
            <div class="sc-pridat">od <select id="scNewOd"><option value="">návěstidlo…</option>${sigOpts}</select>
            z koleje <select id="scNewZ"><option value="">(kolej návěstidla)</option>${trackOpts}</select>
            na <select id="scNewNa"><option value="">cíl…</option>${naOpts}</select>
            <button type="button" class="btn" id="scAddRoute">Přidat</button></div>`;
    }

    function plate(b) {
        if (!b) return '';
        const cls = b.kind === 'LOCK' ? 'zv' : b.kind === 'STOP' ? 'hz' : b.kind === 'CONSENT' ? 'sh' : 'nh';
        return `<div class="sc-plate ${cls}" title="${esc(b.text.join(' '))}">${esc(b.text.join(' '))}</div>`;
    }
    function pristroje() {
        const model = res.model && res.model.st;
        if (!model || !model.equipment.size) return '<div class="banner error">Přístroje nejde sestavit, dokud stanice má chyby (záložka Přehled).</div>';
        const blockName = (eq, id) => { const b = eq.blocks.get(id); return b.kind === 'EXIT' ? b.text[1] + ' do ' + b.text.at(-1) : b.text[1] + ' od ' + (b.text[3] || ''); };
        const cards = [...model.equipment.values()].map(eq => {
            const groups = eq.groups.map(g => `<span class="chip">${esc(g.label)} ${g.directions.map(d => (d === 'ENTRY' ? 'vjezd' : 'odjezd')).join('/')}: ${g.tracks.map(t => esc(model.trackNumber(t))).join(', ')}</span>`).join(' ');
            const signal = eq.signalLevers.map(k => `<li><b>${esc(k.id)}</b> vlevo: ${esc((k.a || []).map(id => blockName(eq, id)).join(', ')) || '–'} · vpravo: ${esc((k.b || []).map(id => blockName(eq, id)).join(', ')) || '–'}</li>`).join('');
            const shunt = eq.shuntLevers.map(k => `<li><b>${esc(k.id)}</b> ${[k.a, k.b].filter(Boolean).map(s => `<span class="sc-pl ${s.colour === 'modry' ? 'blue' : 'red'}">${esc(s.signal)}</span>`).join(' ')}</li>`).join('');
            const locks = eq.lockSets.map(set => `<div class="sc-set"><div class="sc-set-name">${esc(set.name)}</div><div class="sc-locks">${set.locks.map(id => {
                const k = eq.trackLocks.get(id);
                const col = p => (p ? `<div class="n">${esc(p.number)}${p.type === 'ENTRY' ? ' od' : p.type === 'EXIT' ? ' do' : ''}</div><div class="m${p.minus.length ? '' : ' e'}">${esc(p.minus.join(' ')) || '&nbsp;'}</div><div class="p${p.plus.length ? '' : ' e'}">${esc(p.plus.join(' ')) || '&nbsp;'}</div>` : '<div class="n">&nbsp;</div>');
                return `<div class="sc-lock" title="kolejový závěrník ${k.number}"><div>${col(k.positions[0])}</div><div>${col(k.positions[1])}</div></div>`;
            }).join('')}</div></div>`).join('');
            return `<div class="sc-dev"><h3>${boxDot(eq.box)}${esc(eq.name)} <span class="muted">(${esc(eq.box)}, ${eq.side === 'L' ? 'levé' : 'pravé'} zhlaví)</span></h3>
                <div class="sc-lbl">Hradla na stavědle</div><div class="sc-plates">${eq.rowBox.map(id => plate(eq.blocks.get(id))).join('') || '<span class="muted">žádná</span>'}</div>
                <div class="sc-lbl">Jeho skupina v dopravní kanceláři</div><div class="sc-plates">${eq.rowDK.map(id => plate(eq.blocks.get(id))).join('') || '<span class="muted">žádná</span>'}</div>
                <div class="sc-lbl">Posuvné knoflíky a směrové závěrníky v DK</div><div>${groups || '<span class="muted">žádné</span>'}</div>
                <div class="sc-cols">
                    <div><div class="sc-lbl">Návěstní kličky</div><ul class="sc-seznam">${signal || '<li class="muted">žádné</li>'}</ul>
                         <div class="sc-lbl">Posunové kličky</div><ul class="sc-seznam">${shunt || '<li class="muted">žádné</li>'}</ul></div>
                    <div><div class="sc-lbl">Výměnové kličky</div><div class="sc-levers">${eq.pointLevers.map(k => `<span class="sc-pl">${esc(k.id)}</span>`).join('') || '<span class="muted">žádné</span>'}</div>
                         ${eq.crossings.length ? `<div class="sc-lbl">Přejezdy</div><div>${eq.crossings.map(c => `<span class="chip">${esc(c)}</span>`).join(' ')}</div>` : ''}
                         ${eq.relays.length ? `<div class="sc-lbl">Izolované kolejnice (${eq.indicators === 'relief' ? 'na reliéfu' : 'krabička na poličce'})</div><div>${eq.relays.map(r => `<span class="chip">${esc(r.tracks.join(', '))} · ${esc(r.text)}</span>`).join(' ')}</div>` : ''}</div>
                </div>
                <div class="sc-lbl">Kolejové závěrníky <span class="muted">(číslo koleje, výhybky v − a v +)</span></div>${locks || '<span class="muted">žádné</span>'}</div>`;
        });
        return `<p class="sc-pozn">Takhle SignalCraft přístroje postaví (stejná logika jako ve hře), hradla zleva doprava jako na přístroji. Červený štítek = návěstní hradlo, bílý se zeleným písmem = závěr výměn, černý = hradlová zarážka, bílý s černým písmem = souhlasové hradlo mezi stavědly.</p>${cards.join('')}`;
    }

    // ---------------------------------------------------------------- inspector section for the selected cell
    function cellSection(c) {
        if (!active || !res || !res.info) return '';
        const i = res.info;
        const head = '<div class="sc-ins"><h4>SignalCraft</h4>';
        if (c.kind === 'switch') {
            const s = i.switches.find(x => x.name === c.name);
            if (!s) return '';
            const o = cfg(s.name);
            return head + `<label class="field">Stavědlo ${boxSelect(['prvky', s.name, 'stavedlo'], o.stavedlo, s.autoBox, i.boxes)}</label>
                <label class="chk block"><input type="checkbox" ${path(['prvky', s.name, 'zamenit'])} data-default="false"${s.swapped ? ' checked' : ''}> Zaměnit + a − <span class="muted">(+ vede ${s.plus})</span></label>
                <label class="field">Rychlost do odbočky ${speedSelect(s.name, o)}</label></div>`;
        }
        if (c.kind === 'signal') {
            const s = i.signals.find(x => x.name === c.name), sh = i.shunts.find(x => x.name === c.name);
            if (sh) return head + `<label class="field">Platí ${validitySelect(sh, cfg(sh.name))}</label><label class="field">Stavědlo ${boxSelect(['prvky', sh.name, 'stavedlo'], cfg(sh.name).stavedlo, sh.autoBox, i.boxes)}</label></div>`;
            if (!s) return '';
            const o = cfg(s.name);
            let h = head + `<label class="field">Druh ${kindSelect(s, o)}<small>${esc(KIND_HELP[s.kind])}</small></label>
                <label class="field">Platí ${validitySelect(s, o)}</label>
                <label class="field">Stavědlo ${boxSelect(['prvky', s.name, 'stavedlo'], o.stavedlo, s.autoBox, i.boxes)}</label>`;
            if (s.kind === 'skupinove') h += `<div class="field">Platí pro koleje<div>${groupTracks(s)}</div></div>`;
            return h + '</div>';
        }
        if (c.kind === 'crossing') {
            const s = i.crossings.find(x => x.name === c.name);
            return s ? head + `<label class="field">Stavědlo ${boxSelect(['prvky', s.name, 'stavedlo'], cfg(s.name).stavedlo, s.autoBox, i.boxes)}</label></div>` : '';
        }
        if (c.kind === 'label') {
            const n = String(c.label).match(/^(?:k(?:ol(?:ej)?)?\.?\s*)?(\d+[a-z]?)$/i) || String(c.label).match(/^(\d+[a-z]?)\.?\s*k(?:ol(?:ej)?)?\.?$/i);
            const t = n && i.tracks.find(x => x.number === n[1]);
            if (t) return head + `<label class="chk block"><input type="checkbox" ${path(['koleje', t.number, 'dopravni'])} data-default="true"${t.main ? ' checked' : ''}> Dopravní kolej ${esc(t.number)}</label></div>`;
            if (/^T\S*/.test(c.label)) return head + '<p class="note">Texty tratě nastavíte v panelu SignalCraft, záložka Koleje a tratě.</p></div>';
        }
        return '';
    }

    return {
        activate(on) {
            active = on;
            if (on) run(); else env.setMarks(new Map());
        },
        schedule,
        cellSection,
        get settings() { return sc; },
        /** speed through the diverging position of a switch (km/h, null = not given: 40) */
        switchSpeed(name) { return (sc.prvky && sc.prvky[name] && +sc.prvky[name].rychlost) || null; },
        setSwitchSpeed(name, v) { change(s => setPath(s, ['prvky', name, 'rychlost'], v && +v !== 40 ? +v : '')); },
        /** speeds read from the Config.Switches of an opened config.lua */
        mergeSpeeds(speeds) {
            const names = Object.keys(speeds || {});
            if (!names.length) return;
            change(s => { for (const n of names) setPath(s, ['prvky', n, 'rychlost'], +speeds[n] !== 40 ? +speeds[n] : ''); });
        },
        /** settings of another layout (opened file, new layout) */
        replace(next) {
            sc = next || {};
            env.save(sc);
            nameInput.value = (sc.stanice && sc.stanice.nazev) || '';
            if (active) run();
        },
        get result() { return res; },
    };
}

/** settings as a Lua comment at the end of the saved .lua (ORMS ignores it) */
export function settingsToLua(sc) {
    const json = JSON.stringify(sc || {});
    return json === '{}' ? '' : '\n--[=[SignalCraft\n' + json + '\n]=]\n';
}
export function settingsFromLua(text) {
    const m = String(text).match(/--\[=\[SignalCraft\r?\n([\s\S]*?)\r?\n\]=\]/);
    if (!m) return null;
    try { return JSON.parse(m[1]); } catch (e) { return null; }
}
