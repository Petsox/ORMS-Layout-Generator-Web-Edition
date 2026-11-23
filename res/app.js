// ORMS Layout Generator v2: wires the grid, editor, palette, inspector, checks, OC preview and exports.
import { Grid } from './grid.js';
import { Editor, cellHTML, enablePan } from './editor.js';
import {
    parseCell, describe, fmt, KIND_TITLE, SIGNAL_CLASSES, SIGNAL_SYMBOL, PLAIN_TRACK, BUFFERS, JUNCTIONS, TUNNELS,
    DIR_ARROW, DIR_NAME, TRACK_DIRS, byteLength,
} from './cells.js';
import { validate } from './validate.js';
import { gridToConfig, configToLua, parseLua, toCSV, parseCSV, download } from './lua.js';
import { buildScreen, paintScreen, centerOffset, switchLabel, signalLabel, COLORS, SCREEN_W, SCREEN_H } from './orms-render.js';
import { initSignalCraft } from './signalcraft-ui.js';
import { DEMO_LUA } from './demo.js';

const $ = s => document.querySelector(s);
const esc = s => String(s).replace(/[&<>"]/g, z => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[z]));
const plural = (n, one, few, many) => `${n} ${n === 1 ? one : n >= 2 && n <= 4 ? few : many}`;

// ------------------------------------------------------------------ storage (per browser convenience only)
const store = {
    get(k, d) { try { const v = localStorage.getItem('ormslg2.' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem('ormslg2.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
};
const settings = Object.assign({
    view: 'split', cs: 30, center: true, swNames: true, sigNames: true, faithful: true, pvGrid: false, pvZoom: 'fit', split: 58, tab: 'cell',
}, store.get('settings', {}));
const saveSettings = () => store.set('settings', settings);

// ------------------------------------------------------------------ icons
const ICONS = {
    filePlus: '<path d="M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
    folder: '<path d="M3 7V5a1 1 0 0 1 1-1h5l2 2h8a1 1 0 0 1 1 1v3"/><path d="M3 7v12h15l3-9H6l-3 9"/>',
    save: '<path d="M5 3h11l3 3v14a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1z"/><path d="M8 3v5h7M8 21v-7h8v7"/>',
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    pointer: '<path d="M5 3l6 17 2.5-7.5L21 10z"/>',
    rails: '<path d="M3 21v-7a9 9 0 0 1 9-9h9"/><path d="M8 21v-7a4 4 0 0 1 4-4h9"/>',
    brush: '<path d="M18.5 2.5l3 3L12 15l-3-3z"/><path d="M9 12c-2.5 0-4.5 1.8-4.5 4.5 0 1.5-1 2.5-2.5 3 4.5 1.5 10 0 10-4.5z"/>',
    eraser: '<path d="M7 21h13"/><path d="M4.5 15.5 14 6a2 2 0 0 1 2.8 0l2.2 2.2a2 2 0 0 1 0 2.8L11 19H8z"/>',
    grid: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    split: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 12h18"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="1.5"/><path d="M8 20h8M12 16v4"/>',
    code: '<path d="m8 8-4 4 4 4M16 8l4 4-4 4M14 5l-4 14"/>',
    signal: '<rect x="8" y="2" width="8" height="14" rx="4"/><circle cx="12" cy="6.5" r="1.2"/><circle cx="12" cy="11.5" r="1.2"/><path d="M12 16v6M8 22h8"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M7 14h10"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.5 2.5 0 1 1 3.4 2.3c-.6.3-.9.8-.9 1.5v.5M12 17h.01"/>',
    copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v9a2 2 0 0 0 2 2h3"/>',
    download: '<path d="M12 3v12M7 10l5 5 5-5M4 21h16"/>',
    center: '<circle cx="12" cy="12" r="3"/><path d="M12 2v5M12 17v5M2 12h5M17 12h5"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
};
const icon = name => `<svg class="i" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ''}</svg>`;
const applyIcons = (root = document) => {
    for (const el of root.querySelectorAll('[data-icon]')) {
        if (!el.querySelector(':scope > svg.i')) el.insertAdjacentHTML('afterbegin', icon(el.dataset.icon));
    }
};

// ------------------------------------------------------------------ toasts
function toast(msg, opts = {}) {
    const el = document.createElement('div');
    el.className = 'toast' + (opts.error ? ' error' : '');
    el.innerHTML = `<span>${esc(msg)}</span>`;
    if (opts.action) {
        const b = document.createElement('button');
        b.textContent = opts.action.label;
        b.onclick = () => { opts.action.fn(); el.remove(); };
        el.appendChild(b);
    }
    $('#toasts').appendChild(el);
    setTimeout(() => el.remove(), opts.timeout || (opts.action ? 6000 : 2600));
}

// ------------------------------------------------------------------ core objects
const app = $('#app');
let emptyDismissed = false;
let started = false; // hooks fire only after everything below is defined
const grid = new Grid();
let check = { issues: [], stats: {}, parsed: [] };
let offset = { dx: 0, dy: 0 };
let scMarks = new Map();
let projectName = store.get('projectName', 'kolejiste');

function nextName(prefix, prev) {
    let max = 0;
    const re = new RegExp('^' + prefix + '(\\d+)$');
    const take = t => {
        const c = parseCell(t);
        const m = c.name && c.name.match(re);
        if (m) max = Math.max(max, +m[1]);
    };
    for (const [, , t] of grid.nonEmpty()) take(t);
    if (prev) take(prev);
    return prefix + (max + 1);
}

const editor = new Editor($('#boardScroll'), grid, {
    onSelect: () => { if (!started) return; updateStatus(); renderInspector(); updatePreviewSelection(); },
    onContextMenu: (x, y) => openContextMenu(x, y),
    nextName: (kind, prev) => nextName('Vy', prev && fmt.switch('═', '╗', prev, false)),
    onToolDone: () => setTool('select'),
    onEditHint: showEditHint,
    onZoom: cs => { settings.cs = cs; saveSettings(); updateZoom(); },
    toast,
});

// ------------------------------------------------------------------ recompute after every change
let recomputeTimer = null;
function scheduleRecompute() {
    clearTimeout(recomputeTimer);
    recomputeTimer = setTimeout(recompute, 90);
}
function recompute() {
    const cfg0 = gridToConfig(grid.cells);
    offset = settings.center ? centerOffset(cfg0, { faithful: true }) : { dx: 0, dy: 0 };
    check = validate(grid.cells, offset);
    applyMarks();
    renderIssues();
    updateStatus();
    renderInspector();
    renderPreview(cfg0);
    $('#emptyState').hidden = check.stats.cells > 0 || emptyDismissed;
}
grid.onChange(() => { scheduleRecompute(); scheduleAutosave(); updateUndoButtons(); });

function applyMarks() {
    const marks = new Map();
    const rank = { error: 3, warn: 2, info: 1 };
    const best = new Map();
    for (const i of check.issues) {
        const k = i.y * grid.cols + i.x;
        if (!best.has(k) || rank[i.level] > rank[best.get(k)]) best.set(k, i.level);
    }
    for (const [k, l] of best) marks.set(k, ' e-' + l);
    for (const [k, cls] of scMarks) marks.set(k, (marks.get(k) || '') + cls);
    editor.setMarks(marks);
}

// ------------------------------------------------------------------ autosave
let saveTimer = null;
function scheduleAutosave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        const ok = store.set('grid', [...grid.nonEmpty()]);
        $('#stSave').textContent = ok ? 'Uloženo v prohlížeči ' + new Date().toLocaleTimeString('cs', { hour: '2-digit', minute: '2-digit' }) : '';
    }, 500);
}
function restore() {
    const saved = store.get('grid', null);
    if (!Array.isArray(saved) || !saved.length) return false;
    for (const [x, y, t] of saved) if (grid.inBounds(x, y) && typeof t === 'string') grid.cells[y][x] = t;
    editor.renderAll();
    return true;
}

// ------------------------------------------------------------------ toolbar
function setTool(tool) {
    if (tool === 'brush') currentBrush = currentBrush || PALETTE[0].items[0];
    editor.setTool(tool, tool === 'brush' ? currentBrush : null);
    for (const b of document.querySelectorAll('[data-tool]')) b.setAttribute('aria-pressed', String(b.dataset.tool === tool));
    $('#paletteHint').textContent = tool === 'brush' ? 'Klik vybere štětec' : 'Klik vloží do výběru';
    markPalette();
    editor.board.focus({ preventScroll: true });
}
function setView(view) {
    settings.view = view; saveSettings();
    app.dataset.view = view;
    for (const b of document.querySelectorAll('[data-view]')) if (b.tagName === 'BUTTON') b.setAttribute('aria-pressed', String(b.dataset.view === view));
    requestAnimationFrame(() => paintPreview());
}
function updateUndoButtons() {
    $('[data-action="undo"]').disabled = !grid.undoStack.length;
    $('[data-action="redo"]').disabled = !grid.redoStack.length;
}
function updateZoom() { $('#zoomVal').textContent = Math.round(editor.cs / 30 * 100) + ' %'; }

const actions = {
    new() {
        if (grid.isEmpty()) return;
        grid.clear('Nové kolejiště');
        projectName = 'kolejiste'; store.set('projectName', projectName);
        toast('Kolejiště vymazáno', { action: { label: 'Vrátit', fn: () => grid.undo() } });
    },
    open() { $('#fileInput').value = ''; $('#fileInput').click(); },
    save() {
        download(projectName + '.csv', toCSV(grid.cells), 'text/csv;charset=utf-8');
        toast(`Uloženo jako ${projectName}.csv`);
    },
    undo() { const l = grid.undo(); if (l) toast('Zpět: ' + l); },
    redo() { const l = grid.redo(); if (l) toast('Znovu: ' + l); },
    lua: openLuaDialog,
    signalcraft: () => signalCraft.open(),
    shortcuts: () => $('#keysDialog').showModal(),
    zoomIn() { editor.zoomBy(1.15); settings.cs = editor.cs; saveSettings(); updateZoom(); },
    zoomOut() { editor.zoomBy(1 / 1.15); settings.cs = editor.cs; saveSettings(); updateZoom(); },
    startPen() { setTool('pen'); },
    demo() { loadTexts(parseLua(DEMO_LUA).texts, 'Ukázkové kolejiště'); projectName = 'ukazka'; },
};
document.addEventListener('click', e => {
    const a = e.target.closest('[data-action]');
    if (a && actions[a.dataset.action]) { e.preventDefault(); actions[a.dataset.action](); return; }
    const t = e.target.closest('button[data-tool]');
    if (t) { setTool(t.dataset.tool); return; }
    const v = e.target.closest('button[data-view]');
    if (v) setView(v.dataset.view);
});

document.addEventListener('keydown', e => {
    const ctrl = e.ctrlKey || e.metaKey;
    const typing = e.target.matches('input, textarea, select') && e.target !== editor.input;
    if (e.key === 'F1') { e.preventDefault(); window.open('help.html', '_blank', 'noopener'); return; }
    if (!ctrl) return;
    const k = e.key.toLowerCase();
    if (k === 's') { e.preventDefault(); actions.save(); }
    else if (k === 'o') { e.preventDefault(); actions.open(); }
    else if (k === 'e') { e.preventDefault(); openLuaDialog(); }
    else if (typing || e.target === editor.input) return;
    else if (k === 'z' && !e.shiftKey) { e.preventDefault(); actions.undo(); }
    else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); actions.redo(); }
});

// ------------------------------------------------------------------ files
function loadTexts(texts, label) {
    const wasEmpty = grid.isEmpty();
    grid.replaceAll(texts, label);
    scMarks = new Map();
    recompute();
    const first = grid.nonEmpty().next().value;
    if (first) editor.flash(first[0], first[1]);
    toast(label, wasEmpty ? {} : { action: { label: 'Vrátit', fn: () => grid.undo() } });
}
function openFile(file) {
    const reader = new FileReader();
    reader.onload = () => {
        const text = String(reader.result);
        const isLua = /\.lua$/i.test(file.name) || /Config\s*\.\s*\w+\s*=/.test(text);
        try {
            if (isLua) {
                const r = parseLua(text);
                if (!r.count) { toast('V souboru nejsou žádné položky Config.Tracks/Signals/…', { error: true }); return; }
                loadTexts(r.texts, `Načteno ${plural(r.count, 'položka', 'položky', 'položek')} z ${file.name}`);
                if (r.outside) toast(`${plural(r.outside, 'položka leží', 'položky leží', 'položek leží')} mimo mřížku 160×50 a byly vynechány`, { error: true });
            } else {
                loadTexts(parseCSV(text), `Načteno z ${file.name}`);
            }
            projectName = file.name.replace(/\.(csv|lua|txt)$/i, '') || 'kolejiste';
            store.set('projectName', projectName);
        } catch (err) {
            toast('Soubor se nepodařilo načíst: ' + err.message, { error: true });
        }
    };
    reader.readAsText(file);
}
$('#fileInput').addEventListener('change', e => { if (e.target.files[0]) openFile(e.target.files[0]); });
let dragDepth = 0;
window.addEventListener('dragenter', e => { if (e.dataTransfer.types.includes('Files')) { dragDepth++; $('#dropOverlay').hidden = false; } });
window.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth = 0; $('#dropOverlay').hidden = true; } });
window.addEventListener('dragover', e => e.preventDefault());
window.addEventListener('drop', e => {
    e.preventDefault(); dragDepth = 0; $('#dropOverlay').hidden = true;
    const f = e.dataTransfer.files[0];
    if (f) openFile(f);
});

// ------------------------------------------------------------------ palette
const SIGNAL_NAMES = { main: 'S', distant: 'PrS', shunt: 'Se', inserted: 'VL', repeater: 'Lc' };
const track = (g, title) => ({ title, text: g, preview: g });
const PALETTE = [
    { title: 'Koleje', items: [track('═', 'Vodorovná kolej'), track('║', 'Svislá kolej'), track('╔', 'Oblouk ╔'), track('╗', 'Oblouk ╗'), track('╚', 'Oblouk ╚'), track('╝', 'Oblouk ╝')] },
    {
        title: 'Výhybky', note: 'základní / odbočka', items: [['═', '╗'], ['═', '╝'], ['═', '╔'], ['═', '╚'], ['║', '╗'], ['║', '╝'], ['║', '╔'], ['║', '╚']].map(([a, b]) => ({
            title: `Výhybka ${a} / ${b}`, preview: fmt.switch(a, b, '', false), make: prev => fmt.switch(a, b, nextName('Vy', prev), false),
        })),
    },
    ...['main', 'distant', 'shunt'].map(cls => ({
        title: { main: 'Hlavní návěstidla', distant: 'Předvěsti', shunt: 'Seřaďovací návěstidla' }[cls],
        note: SIGNAL_NAMES[cls] + '…',
        items: ['W', 'E', 'N', 'S'].map(d => ({
            title: `${SIGNAL_CLASSES[cls].title} návěstidlo, platí ${DIR_ARROW[d]}`,
            preview: fmt.signal(SIGNAL_SYMBOL[SIGNAL_CLASSES[cls].look][d], SIGNAL_NAMES[cls]),
            make: prev => fmt.signal(SIGNAL_SYMBOL[SIGNAL_CLASSES[cls].look][d], nextName(SIGNAL_NAMES[cls], prev)),
        })),
    })),
    {
        title: 'Vložená a cestová', note: 'VL… / Lc…', items: [['inserted', 'W'], ['inserted', 'E'], ['repeater', 'W'], ['repeater', 'E']].map(([cls, d]) => ({
            title: `${SIGNAL_CLASSES[cls].title} návěstidlo (${SIGNAL_NAMES[cls]}…), platí ${DIR_ARROW[d]}`,
            preview: fmt.signal(SIGNAL_SYMBOL.main[d], SIGNAL_NAMES[cls]),
            make: prev => fmt.signal(SIGNAL_SYMBOL.main[d], nextName(SIGNAL_NAMES[cls], prev)),
        })),
    },
    {
        title: 'Přejezdy', items: [['╪', 'na vodorovné koleji'], ['╫', 'na svislé koleji']].map(([g, t]) => ({
            title: 'Přejezd ' + t, preview: fmt.crossing(g, ''), make: prev => fmt.crossing(g, nextName('P', prev)),
        })),
    },
    { title: 'Zarážedla', note: 'konec koleje', items: [track('╞', 'Zarážedlo, kolej vede doprava'), track('╡', 'Zarážedlo, kolej vede doleva'), track('╥', 'Zarážedlo, kolej vede dolů'), track('╨', 'Zarážedlo, kolej vede nahoru')] },
    { title: 'Tunely', items: TUNNELS.map(g => track(g, 'Portál tunelu ' + g)) },
    { title: 'Pevná rozvětvení', note: 'bez výhybky', items: JUNCTIONS.map(g => track(g, 'Pevné rozvětvení ' + g + ' (nejde přestavit; SignalCraft ho nepřijme)')) },
    {
        title: 'Popisky', wide: true, items: [
            { title: 'Popisek (libovolný text)', label: 'Popisek', text: 'L Popisek', edit: 'L ' },
            { title: 'Název stanice', label: 'Stanice', text: 'L Název stanice', edit: 'L ' },
            { title: 'Číslo koleje (např. L 1)', label: 'Kolej 1', make: () => 'L 1', edit: 'L ' },
            { title: 'Stavědlo pro SignalCraft (L ST1)', label: 'ST1', make: prev => 'L ST' + nextLabelNumber(/^L ST(\d+)$/, prev) },
            { title: 'Trať pro SignalCraft (L T1 Sousední stanice)', label: 'T1 Trať', text: 'L T1 Sousední stanice', edit: 'L T1 ' },
        ],
    },
];
function nextLabelNumber(re, prev) {
    let max = 0;
    for (const [, , t] of grid.nonEmpty()) { const m = t.match(re); if (m) max = Math.max(max, +m[1]); }
    if (prev) { const m = prev.match(re); if (m) max = Math.max(max, +m[1]); }
    return max + 1;
}
let currentBrush = null;
function renderPalette() {
    const body = $('#paletteBody');
    body.innerHTML = PALETTE.map((g, gi) => `
        <div class="pal-group">
            <h3>${esc(g.title)}${g.note ? `<span>${esc(g.note)}</span>` : ''}</h3>
            <div class="pal-items${g.wide ? ' wide' : ''}">
                ${g.items.map((it, ii) => it.label
                    ? `<button class="pal-item text" data-pal="${gi}.${ii}" title="${esc(it.title)}"><span class="lb">${esc(it.label)}</span></button>`
                    : `<button class="pal-item" data-pal="${gi}.${ii}" title="${esc(it.title)}"><span class="mini">${cellHTML(parseCell(it.preview || it.text))}</span></button>`).join('')}
            </div>
        </div>`).join('');
    for (const n of body.querySelectorAll('.mini .nm')) n.remove();
}
function markPalette() {
    for (const b of document.querySelectorAll('.pal-item')) {
        const [gi, ii] = b.dataset.pal.split('.').map(Number);
        b.setAttribute('aria-pressed', String(editor.tool === 'brush' && PALETTE[gi].items[ii] === currentBrush));
    }
}
$('#paletteBody').addEventListener('click', e => {
    const b = e.target.closest('[data-pal]');
    if (!b) return;
    const [gi, ii] = b.dataset.pal.split('.').map(Number);
    const it = PALETTE[gi].items[ii];
    if (editor.tool === 'brush') {
        currentBrush = it;
        editor.setTool('brush', it);
        markPalette();
        editor.board.focus({ preventScroll: true });
        return;
    }
    if (editor.tool !== 'select') setTool('select');
    insertItem(it);
});
function insertItem(it) {
    const r = editor.rect;
    const single = r.x1 === r.x2 && r.y1 === r.y2;
    editor.fillSelection(it.make || it.text, 'Vložit: ' + it.title);
    editor.board.focus({ preventScroll: true });
    if (single && it.edit) editor.startEdit(it.edit);
}

// ------------------------------------------------------------------ inline edit hint
function showEditHint(value) {
    const el = $('#editHint');
    if (value === null || value === undefined) { el.hidden = true; return; }
    el.hidden = false;
    const v = value.trim();
    if (!v) {
        el.innerHTML = '<b>Napište obsah buňky</b><div class="ex">Kolej <code>═</code> (stačí <code>-</code>) · výhybka <code>═ V ╗ Vy1</code> · návěstidlo <code>◀ N S1</code> · přejezd <code>╪ P ═ P1</code> · popisek <code>L Text</code>. Symboly najdete v paletě.</div>';
        return;
    }
    const shown = v === '-' || v === '=' ? '═' : v === '|' ? '║' : v;
    const c = parseCell(shown);
    const probs = c.problems.map(p => `<div class="p-${p.level}">${esc(p.msg)}</div>`).join('');
    el.innerHTML = `<b>${esc(describe(c))}</b>${probs}`;
}

// ------------------------------------------------------------------ context menu
const ctx = $('#ctxMenu');
let clip = '';
function openContextMenu(x, y) {
    ctx.hidden = false;
    const w = ctx.offsetWidth, h = ctx.offsetHeight;
    ctx.style.left = Math.min(x, innerWidth - w - 8) + 'px';
    ctx.style.top = Math.min(y, innerHeight - h - 8) + 'px';
}
document.addEventListener('mousedown', e => { if (!ctx.hidden && !ctx.contains(e.target)) ctx.hidden = true; });
window.addEventListener('blur', () => { ctx.hidden = true; });
ctx.addEventListener('click', async e => {
    const li = e.target.closest('[data-cmd]');
    if (!li) return;
    ctx.hidden = true;
    const cmd = li.dataset.cmd;
    const copy = () => { clip = editor.copyText(); navigator.clipboard && navigator.clipboard.writeText(clip).catch(() => {}); };
    switch (cmd) {
        case 'edit': editor.startEdit(); return;
        case 'copy': copy(); toast('Zkopírováno'); break;
        case 'cut': copy(); editor.clearSelection(); break;
        case 'paste': {
            let text = clip;
            try { if (navigator.clipboard && navigator.clipboard.readText) text = await navigator.clipboard.readText() || clip; } catch (err) { /* no permission */ }
            if (text) editor.pasteText(text); else toast('Schránka je prázdná');
            break;
        }
        case 'clear': editor.clearSelection(); break;
        case 'track': insertItem(PALETTE[0].items[0]); return;
        case 'switch': insertItem(PALETTE[1].items[0]); return;
        case 'signal': insertItem(PALETTE[2].items[0]); return;
        case 'label': insertItem(PALETTE.at(-1).items[0]); return;
        case 'showPreview': if (settings.view === 'editor') setView('split'); flashPreview(); break;
    }
    editor.board.focus({ preventScroll: true });
});

// ------------------------------------------------------------------ inspector
let inspectorKey = '';
function renderInspector(force = false) {
    const panel = $('#tabCell');
    const r = editor.rect;
    const { cx: x, cy: y } = editor.sel;
    const text = grid.get(x, y);
    const cellIssues = check.issues.filter(i => i.x === x && i.y === y);
    const key = [r.x1, r.y1, r.x2, r.y2, x, y, text, cellIssues.map(i => i.msg).join('|'), offset.dx, offset.dy].join('¦');
    if (!force && key === inspectorKey) return;
    if (!force && panel.contains(document.activeElement) && document.activeElement.matches('input[type="text"]') && inspectorKey.split('¦').slice(0, 7).join('¦') === key.split('¦').slice(0, 7).join('¦')) return;
    inspectorKey = key;

    if (r.x1 !== r.x2 || r.y1 !== r.y2) {
        let filled = 0;
        for (let yy = r.y1; yy <= r.y2; yy++) for (let xx = r.x1; xx <= r.x2; xx++) if (grid.get(xx, yy)) filled++;
        panel.innerHTML = `
            <div class="ins-head"><div class="ins-title"><b>Výběr ${r.x2 - r.x1 + 1} × ${r.y2 - r.y1 + 1}</b>
            <span>X ${r.x1}–${r.x2} · Y ${r.y1}–${r.y2}</span></div></div>
            <p class="note">${plural(filled, 'obsazená buňka', 'obsazené buňky', 'obsazených buněk')}. Klik v paletě vyplní celý výběr (názvy se číslují postupně), čtvereček v rohu výběru ho rozkopíruje dál.</p>
            <div class="btn-row">
                <button class="btn" data-ins="copy" data-icon="copy">Kopírovat</button>
                <button class="btn danger" data-ins="clear" data-icon="trash">Smazat</button>
            </div>`;
        applyIcons(panel);
        return;
    }

    const c = parseCell(text);
    const sx = x + offset.dx, sy = y + offset.dy;
    let html = `
        <div class="ins-head">
            <div class="ins-preview"><div class="c">${cellHTML(c)}</div></div>
            <div class="ins-title"><b>${esc(KIND_TITLE[c.kind])}</b><span>X ${x} · Y ${y}${offset.dx || offset.dy ? ` → v ORMS ${sx}, ${sy}` : ''}</span></div>
        </div>`;
    if (cellIssues.length) {
        html += `<ul class="cell-issues">${cellIssues.map(i => `<li class="${i.level}">${esc(i.msg)}</li>`).join('')}</ul>`;
    }
    const glyphButtons = (list, field, current) => `<div class="glyphs">${list.map(g =>
        `<button type="button" data-f="${field}" data-v="${esc(g)}" aria-pressed="${g === current}" title="${esc(g)}"><span class="mini">${cellHTML(parseCell(g))}</span></button>`).join('')}</div>`;

    switch (c.kind) {
        case 'empty':
            html += `<p class="note">Začněte psát, nebo vložte prvek:</p><div class="quick">
                ${[['═', 'Kolej ═'], ['║', 'Kolej ║'], ['sw', 'Výhybka'], ['sig', 'Návěstidlo'], ['cr', 'Přejezd'], ['lb', 'Popisek']].map(([k, t]) =>
                    `<button class="btn" data-quick="${k}">${t}</button>`).join('')}</div>
                <p class="note">Tip: nástrojem <b>Kolej</b> nakreslíte trať tažením myši, oblouky i výhybky se doplní samy.</p>`;
            break;
        case 'track':
            html += `<div class="field">Kolej${glyphButtons(PLAIN_TRACK, 'set', c.glyph)}</div>
                <div class="field">Zarážedla${glyphButtons(BUFFERS, 'set', c.glyph)}</div>
                <div class="field">Tunely${glyphButtons(TUNNELS, 'set', c.glyph)}</div>
                <div class="field">Pevná rozvětvení${glyphButtons(JUNCTIONS, 'set', c.glyph)}</div>`;
            if (JUNCTIONS.includes(c.glyph)) html += '<p class="note warn">Pevné rozvětvení nejde přestavit. ORMS jím cestu najde, export do SignalCraftu ho ale nepřijme; tam použijte výhybku.</p>';
            break;
        case 'switch': {
            html += `<div class="field">Základní poloha (první symbol)${glyphButtons(PLAIN_TRACK, 'a', c.a)}</div>
                <div class="field">Odbočka (druhý symbol)${glyphButtons(PLAIN_TRACK, 'b', c.b)}</div>
                <label class="field">Název <input type="text" data-f="name" value="${esc(c.name)}" autocomplete="off"></label>
                <label class="chk block"><input type="checkbox" data-f="inv" ${c.inverted ? 'checked' : ''}> Invertovaná (fyzicky zapojená obráceně, oddělovač „I“)</label>`;
            if (c.point) {
                html += `<dl class="kv"><dt>Hrot</dt><dd>${DIR_ARROW[c.point]} ${DIR_NAME[c.point]}</dd>
                    <dt>V ORMS</dt><dd>${esc(c.a)} vypnuto · ${esc(c.b)} zapnuto</dd>
                    <dt>Popisek v ORMS</dt><dd>${labelShown(switchLabel(c.name, settings.faithful))}</dd></dl>`;
            }
            break;
        }
        case 'signal': {
            const clsButtons = Object.entries(SIGNAL_CLASSES).map(([k, v]) =>
                `<button type="button" data-f="cls" data-v="${k}" aria-pressed="${c.cls === k}">${v.title}</button>`).join('');
            const dirButtons = ['W', 'E', 'N', 'S'].map(d =>
                `<button type="button" class="txt" data-f="dir" data-v="${d}" aria-pressed="${c.dir === d}" title="Platí ${DIR_NAME[d]}">${DIR_ARROW[d]}</button>`).join('');
            html += `<div class="field">Druh (ORMS ho pozná podle předpony názvu)<div class="glyphs">${clsButtons.replace(/<button type="button"/g, '<button type="button" class="txt"')}</div></div>
                <div class="field">Směr jízdy, pro který platí<div class="glyphs">${dirButtons}</div></div>
                <label class="field">Název <input type="text" data-f="name" value="${esc(c.name)}" autocomplete="off">
                <small>${esc(SIGNAL_HELP[c.cls])}</small></label>
                <dl class="kv"><dt>Popisek v ORMS</dt><dd>${labelShown(signalLabel(c.name, settings.faithful), c.symbol)}</dd></dl>`;
            break;
        }
        case 'crossing':
            html += `<div class="field">Orientace<div class="glyphs">
                    <button type="button" class="txt" data-f="cross" data-v="╪" aria-pressed="${c.symbol === '╪'}">╪ vodorovná kolej</button>
                    <button type="button" class="txt" data-f="cross" data-v="╫" aria-pressed="${c.symbol === '╫'}">╫ svislá kolej</button></div></div>
                <label class="field">Název <input type="text" data-f="name" value="${esc(c.name)}" autocomplete="off">
                <small>Přejezd přes více kolejí: na každou kolej stejný název, ORMS je ovládá společně.</small></label>`;
            break;
        case 'label': {
            const len = byteLength(c.label);
            const x1 = Math.ceil(x - len / 2);
            html += `<label class="field">Text popisku <input type="text" data-f="label" value="${esc(c.label)}" autocomplete="off"></label>
                <dl class="kv"><dt>Význam</dt><dd>${esc(labelMeaning(c.label))}</dd>
                <dt>Šířka v ORMS</dt><dd>${len + 2} znaků, sloupce ${x1}–${x1 + len + 1}</dd></dl>
                <p class="note">ORMS popisek vycentruje na tuto buňku a vykreslí ho přes všechno ostatní. Nikdy ho nedávejte doprostřed koleje.</p>`;
            break;
        }
        default:
            html += '<p class="note warn">Obsahu buňky generátor nerozumí, do Lua se nevyexportuje. Opravte text níže nebo buňku smažte.</p>';
    }
    if (c.kind !== 'empty') {
        html += `<label class="field">Text buňky <input type="text" class="mono" data-f="raw" value="${esc(text)}" autocomplete="off" spellcheck="false">
            <small>Tak, jak se uloží do CSV. Enter potvrdí.</small></label>
            <div class="btn-row"><button class="btn danger" data-ins="clear" data-icon="trash">Smazat buňku</button></div>`;
    }
    panel.innerHTML = html;
    applyIcons(panel);
}
const SIGNAL_HELP = {
    main: 'Hlavní návěstidlo. Konvence: L/S + číslo koleje (L1, S3), ORMS písmena nekontroluje.',
    distant: 'Předvěst: „Pr“ + název hlavního návěstidla, ke kterému patří (PrL1). ORMS ji nastavuje automaticky.',
    shunt: 'Seřaďovací návěstidlo: předpona „Se“ (Se1).',
    inserted: 'Vložené návěstidlo (VS/VL): označuje kolej, když více kolejí sdílí jedno odjezdové návěstidlo.',
    repeater: 'Cestové návěstidlo (Sc/Lc): samostatné odjezdové, nebo opakuje návěst dalšího hlavního („OpakVolno“).',
};
function labelShown(label, symbol) {
    if (!label) return '<span class="muted">(nic, ORMS název celý odřízne)</span>';
    if (symbol && settings.faithful && ['<', '◀', '◁', '>', '▶', '▷'].includes(symbol) && byteLength(label) % 2 === 1) {
        return `„${esc(label)}“ <span class="muted">(lichá délka, ORMS ho nevykreslí)</span>`;
    }
    return '„' + esc(label) + '“';
}
function labelMeaning(t) {
    if (/^ST\s*\d+$/i.test(t)) return 'Stavědlo (pro SignalCraft)';
    if (/^T\S*(\s+.+)?$/.test(t)) return 'Trať do sousední stanice (pro SignalCraft)';
    if (/^(?:k(?:ol(?:ej)?)?\.?\s*)?\d+[a-z]?$/i.test(t) || /^\d+[a-z]?\.?\s*k(?:ol(?:ej)?)?\.?$/i.test(t)) return 'Číslo dopravní koleje';
    return 'Popisek / název stanice';
}
function renameForClass(name, cls) {
    const base = name.replace(/^(Se|Pr|VS|VL|Sc|Lc)/, '');
    const digits = (base.match(/\d+\w*$/) || [''])[0];
    switch (cls) {
        case 'main': return !base || /^\d/.test(base) ? 'S' + (digits || '1') : base;
        case 'distant': return 'Pr' + (base && !/^\d/.test(base) ? base : 'S' + (digits || '1'));
        case 'shunt': return 'Se' + (digits || '1');
        case 'inserted': return 'VL' + (digits || '1');
        default: return 'Lc' + (digits || '1');
    }
}
function applyField(f, v) {
    const { cx: x, cy: y } = editor.sel;
    const c = parseCell(grid.get(x, y));
    let t = null;
    if (f === 'raw' || f === 'set') t = v;
    else if (c.kind === 'switch') {
        const s = { a: c.a, b: c.b, inv: c.inverted, name: c.name };
        if (f === 'a') s.a = v; else if (f === 'b') s.b = v; else if (f === 'inv') s.inv = v; else if (f === 'name') s.name = v.trim();
        t = fmt.switch(s.a, s.b, s.name, s.inv);
    } else if (c.kind === 'signal') {
        let { name, symbol } = c;
        const dir = f === 'dir' ? v : c.dir || 'W';
        let cls = c.cls;
        if (f === 'cls') { cls = v; name = renameForClass(name, cls); }
        if (f === 'name') { name = v.trim(); cls = parseCell(fmt.signal('◀', name)).cls; }
        if (f === 'cls' || f === 'dir' || f === 'name') symbol = SIGNAL_SYMBOL[SIGNAL_CLASSES[cls].look][dir];
        if (f === 'name' && c.look === SIGNAL_CLASSES[cls].look && c.dir) symbol = c.symbol;
        t = fmt.signal(symbol, name);
    } else if (c.kind === 'crossing') {
        t = fmt.crossing(f === 'cross' ? v : c.symbol, f === 'name' ? v.trim() : c.name);
    } else if (c.kind === 'label' && f === 'label') t = fmt.label(v);
    if (t !== null) grid.edit('Vlastnosti buňky', () => grid.set(x, y, t));
}
$('#tabCell').addEventListener('click', e => {
    const b = e.target.closest('button[data-f]');
    if (b) { applyField(b.dataset.f, b.dataset.v); return; }
    const q = e.target.closest('[data-quick]');
    if (q) {
        const item = { '═': PALETTE[0].items[0], '║': PALETTE[0].items[1], sw: PALETTE[1].items[0], sig: PALETTE[2].items[0], cr: PALETTE.find(g => g.title === 'Přejezdy').items[0], lb: PALETTE.at(-1).items[0] }[q.dataset.quick];
        insertItem(item);
        return;
    }
    const a = e.target.closest('[data-ins]');
    if (a && a.dataset.ins === 'clear') editor.clearSelection();
    if (a && a.dataset.ins === 'copy') { clip = editor.copyText(); navigator.clipboard && navigator.clipboard.writeText(clip).catch(() => {}); toast('Zkopírováno'); }
});
$('#tabCell').addEventListener('change', e => {
    const el = e.target.closest('[data-f]');
    if (!el || el.tagName !== 'INPUT') return;
    applyField(el.dataset.f, el.type === 'checkbox' ? el.checked : el.value);
});
$('#tabCell').addEventListener('keydown', e => {
    if (e.key === 'Enter' && e.target.matches('input[type="text"]')) { e.target.blur(); editor.board.focus({ preventScroll: true }); }
});

// tabs
function setTab(tab) {
    settings.tab = tab; saveSettings();
    for (const b of document.querySelectorAll('[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    $('#tabCell').hidden = tab !== 'cell';
    $('#tabCheck').hidden = tab !== 'check';
}
document.querySelector('.tabs').addEventListener('click', e => { const b = e.target.closest('[data-tab]'); if (b) setTab(b.dataset.tab); });

// ------------------------------------------------------------------ check list
let issueFilter = 'all';
function renderIssues() {
    const { issues, stats } = check;
    const n = { error: 0, warn: 0, info: 0 };
    for (const i of issues) n[i.level]++;
    const badge = $('#checkBadge');
    badge.className = 'badge ' + (n.error ? 'error' : n.warn ? 'warn' : '');
    badge.textContent = n.error || n.warn || '';

    let box;
    if (!stats.cells) box = '<div class="summary-box ok">Kolejiště je prázdné.</div>';
    else if (n.error) box = `<div class="summary-box error">${plural(n.error, 'chyba', 'chyby', 'chyb')} k opravě${n.warn ? ', ' + plural(n.warn, 'upozornění', 'upozornění', 'upozornění') : ''}</div>`;
    else if (n.warn) box = `<div class="summary-box warn">Bez chyb, ${plural(n.warn, 'upozornění', 'upozornění', 'upozornění')}</div>`;
    else box = '<div class="summary-box ok">✓ Kolejiště je v pořádku</div>';
    const chips = [[stats.track, 'kolej', 'koleje', 'kolejí'], [stats.switch, 'výhybka', 'výhybky', 'výhybek'], [stats.signal, 'návěstidlo', 'návěstidla', 'návěstidel'],
        [stats.crossing, 'přejezd. buňka', 'přejezd. buňky', 'přejezd. buněk'], [stats.label, 'popisek', 'popisky', 'popisků']]
        .filter(p => p[0]).map(p => `<span class="chip">${plural(...p).replace(/^(\d+)/, '<b>$1</b>')}</span>`).join('');
    $('#checkSummary').innerHTML = box + (chips ? `<div class="chips">${chips}</div>` : '');

    for (const b of document.querySelectorAll('[data-filter]')) {
        b.setAttribute('aria-pressed', String(b.dataset.filter === issueFilter));
        const k = b.dataset.filter;
        b.textContent = { all: 'Vše', error: 'Chyby', warn: 'Upozornění', info: 'Info' }[k] + (k === 'all' ? '' : ` (${n[k]})`);
    }
    const list = issues.filter(i => issueFilter === 'all' || i.level === issueFilter);
    $('#issueList').innerHTML = list.length
        ? list.slice(0, 600).map((i, k) => `<li class="${i.level}" data-issue="${k}"><span class="pos">${i.x}·${i.y}</span><span>${esc(i.msg)}</span></li>`).join('')
        : `<li class="empty">${issues.length ? 'V tomto filtru nic není.' : 'Žádné problémy.'}</li>`;
    renderIssues.list = list;
}
$('#issueList').addEventListener('click', e => {
    const li = e.target.closest('[data-issue]');
    if (!li) return;
    const i = renderIssues.list[+li.dataset.issue];
    if (settings.view === 'preview') setView('split');
    editor.flash(i.x, i.y);
});
document.querySelector('.check-filter').addEventListener('click', e => {
    const b = e.target.closest('[data-filter]');
    if (b) { issueFilter = b.dataset.filter; renderIssues(); }
});

// ------------------------------------------------------------------ status bar
function updateStatus() {
    const { cx: x, cy: y } = editor.sel;
    const c = parseCell(grid.get(x, y));
    $('#stPos').textContent = `X ${x} · Y ${y}`;
    $('#stDesc').textContent = describe(c);
    const s = check.stats;
    $('#stStats').textContent = s.cells ? [plural(s.switch || 0, 'výhybka', 'výhybky', 'výhybek'), plural(s.signal || 0, 'návěstidlo', 'návěstidla', 'návěstidel')].join(' · ') : '';
    const n = { error: 0, warn: 0 };
    for (const i of check.issues) if (n[i.level] !== undefined) n[i.level]++;
    const b = $('#stCheck');
    b.className = 'st-check ' + (n.error ? 'error' : n.warn ? 'warn' : 'ok');
    b.textContent = n.error ? `✕ ${plural(n.error, 'chyba', 'chyby', 'chyb')}` : n.warn ? `⚠ ${plural(n.warn, 'upozornění', 'upozornění', 'upozornění')}` : '✓ Bez chyb';
}
$('#stCheck').addEventListener('click', () => setTab('check'));

// ------------------------------------------------------------------ OC preview
const pv = {
    canvas: $('#previewCanvas'), frame: $('#previewFrame'), scroll: $('#previewScroll'),
    screen: null, cell: 8, sim: { switches: new Set(), crossings: new Set(), signals: new Map() },
};
const optMap = { optCenter: 'center', optSwNames: 'swNames', optSigNames: 'sigNames', optFaithful: 'faithful', optGrid: 'pvGrid' };
for (const [id, key] of Object.entries(optMap)) {
    const el = document.getElementById(id);
    el.checked = !!settings[key];
    el.addEventListener('change', () => {
        settings[key] = el.checked; saveSettings();
        if (key === 'center') $('#luaCenter').checked = el.checked;
        recompute();
        inspectorKey = ''; renderInspector();
    });
}
$('#optPvZoom').value = String(settings.pvZoom);
$('#optPvZoom').addEventListener('change', e => {
    settings.pvZoom = e.target.value; saveSettings(); paintPreview();
    pv.scroll.scrollLeft = (pv.scroll.scrollWidth - pv.scroll.clientWidth) / 2;
    pv.scroll.scrollTop = (pv.scroll.scrollHeight - pv.scroll.clientHeight) / 2;
});
$('#optSim').addEventListener('change', e => {
    pv.frame.classList.toggle('sim', e.target.checked);
    if (!e.target.checked) { pv.sim = { switches: new Set(), crossings: new Set(), signals: new Map() }; renderPreview(); }
    toast(e.target.checked ? 'Simulace: klikáním přehazujete výhybky, přejezdy a návěsti' : 'Simulace vypnuta');
});

function shifted(cfg, o) {
    if (!o.dx && !o.dy) return cfg;
    const m = list => list.map(e => ({ ...e, x: e.x + o.dx, y: e.y + o.dy }));
    return { Signals: m(cfg.Signals), Tracks: m(cfg.Tracks), Switches: m(cfg.Switches), Crossings: m(cfg.Crossings), Labels: m(cfg.Labels) };
}
function renderPreview(cfg0) {
    cfg0 = cfg0 || gridToConfig(grid.cells);
    pv.screen = buildScreen(shifted(cfg0, offset), {
        faithful: settings.faithful, switchNames: settings.swNames, signalNames: settings.sigNames, sim: pv.sim,
    });
    $('#pvOffset').textContent = settings.center
        ? (offset.dx || offset.dy ? `auto-centrování: posun ${offset.dx >= 0 ? '+' : ''}${offset.dx} sl., ${offset.dy >= 0 ? '+' : ''}${offset.dy} ř.` : 'auto-centrování: už uprostřed')
        : 'bez centrování (souřadnice = mřížka)';
    paintPreview();
}
function paintPreview() {
    if (!pv.screen || settings.view === 'editor') return;
    const availW = pv.scroll.clientWidth - 32, availH = pv.scroll.clientHeight - 32;
    if (availW <= 0 || availH <= 0) return;
    pv.cell = settings.pvZoom === 'fit' ? Math.max(3, Math.floor(Math.min(availW / SCREEN_W, availH / (SCREEN_H * 2)) * 4) / 4) : +settings.pvZoom;
    paintScreen(pv.canvas, pv.screen, pv.cell, { grid: settings.pvGrid });
    updatePreviewSelection();
}
function updatePreviewSelection() {
    const el = $('#pvSel');
    if (!pv.screen) return;
    const r = editor.rect, cw = pv.cell, ch = pv.cell * 2;
    // screen columns/rows are 1-based; keep only the part that is on the screen
    const x1 = Math.max(1, r.x1 + offset.dx), x2 = Math.min(SCREEN_W, r.x2 + offset.dx);
    const y1 = Math.max(1, r.y1 + offset.dy), y2 = Math.min(SCREEN_H, r.y2 + offset.dy);
    el.hidden = x1 > x2 || y1 > y2;
    el.style.left = 15 + (x1 - 1) * cw + 'px';
    el.style.top = 15 + (y1 - 1) * ch + 'px';
    el.style.width = (x2 - x1 + 1) * cw + 'px';
    el.style.height = (y2 - y1 + 1) * ch + 'px';
}
function flashPreview() {
    const el = $('#pvSel');
    el.animate([{ boxShadow: '0 0 0 0 rgba(91,143,240,.9)' }, { boxShadow: '0 0 0 10px rgba(91,143,240,0)' }], { duration: 700, iterations: 2 });
    el.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'smooth' });
}
new ResizeObserver(() => paintPreview()).observe(pv.scroll);
enablePan(pv.scroll);

function screenCell(e) {
    const r = pv.canvas.getBoundingClientRect();
    const sx = Math.floor((e.clientX - r.left - 1) / pv.cell) + 1, sy = Math.floor((e.clientY - r.top - 1) / (pv.cell * 2)) + 1;
    if (sx < 1 || sy < 1 || sx > SCREEN_W || sy > SCREEN_H) return null;
    return { sx, sy, who: pv.screen.who[(sy - 1) * SCREEN_W + sx - 1] };
}
const WHO = { track: 'kolej', switch: 'výhybka', signal: 'návěstidlo', crossing: 'přejezd', label: 'popisek' };
pv.canvas.addEventListener('mousemove', e => {
    const p = screenCell(e);
    if (!p) return;
    const gx = p.sx - offset.dx, gy = p.sy - offset.dy;
    let s = `obrazovka ${p.sx}, ${p.sy}`;
    if (grid.inBounds(gx, gy)) s += ` · mřížka ${gx}, ${gy}`;
    if (p.who) s += ` · ${WHO[p.who.kind]}${p.who.name ? ' ' + p.who.name : ''}${p.who.part === 'name' ? ' (název)' : ''}`;
    $('#pvInfo').textContent = s;
});
pv.canvas.addEventListener('mouseleave', () => { $('#pvInfo').textContent = 'Najeďte myší na náhled.'; });
pv.canvas.addEventListener('click', e => {
    const p = screenCell(e);
    if (!p) return;
    const w = p.who;
    if ($('#optSim').checked && w && w.part !== 'name') {
        const s = pv.sim;
        if (w.kind === 'switch') s.switches.has(w.name) ? s.switches.delete(w.name) : s.switches.add(w.name);
        else if (w.kind === 'crossing') s.crossings.has(w.name) ? s.crossings.delete(w.name) : s.crossings.add(w.name);
        else if (w.kind === 'signal') {
            const cycle = [COLORS.GRAY, COLORS.GREEN, COLORS.YELLOW, COLORS.WHITE];
            const i = cycle.indexOf(s.signals.get(w.name) || COLORS.GRAY);
            s.signals.set(w.name, cycle[(i + 1) % cycle.length]);
        }
        renderPreview();
        return;
    }
    const gx = w ? w.gx : p.sx - offset.dx, gy = w ? w.gy : p.sy - offset.dy;
    if (!grid.inBounds(gx, gy)) return;
    if (settings.view === 'preview') { editor.select(gx, gy, false, false); return; }
    editor.select(gx, gy, false, false);
    editor.reveal(gx, gy, true);
});

// splitter
(() => {
    const sp = $('#splitter'), work = document.querySelector('.work');
    const apply = () => {
        document.querySelector('.editor-pane').style.flex = `1 1 ${settings.split}%`;
        document.querySelector('.preview-pane').style.flex = `1 1 ${100 - settings.split}%`;
    };
    apply();
    sp.addEventListener('mousedown', e => {
        e.preventDefault();
        sp.classList.add('drag');
        const r = work.getBoundingClientRect();
        const move = ev => { settings.split = Math.max(18, Math.min(85, (ev.clientY - r.top) / r.height * 100)); apply(); };
        const up = () => { sp.classList.remove('drag'); saveSettings(); document.removeEventListener('mousemove', move); document.removeEventListener('mouseup', up); };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    });
})();

// ------------------------------------------------------------------ Lua export dialog
const luaDlg = $('#luaDialog');
let luaText = '';
function openLuaDialog() {
    $('#luaCenter').checked = settings.center;
    fillLua();
    if (!luaDlg.open) luaDlg.showModal();
}
function fillLua() {
    recompute();
    const cfg = gridToConfig(grid.cells, offset);
    luaText = configToLua(cfg);
    $('#luaCode').innerHTML = esc(luaText)
        .replace(/(&quot;.*?&quot;)/g, '<span class="s">$1</span>')
        .replace(/\b(Config|return)\b/g, '<span class="k">$1</span>')
        .replace(/([{,]\s*)(-?\d+)(?=\s*,)/g, '$1<span class="n">$2</span>')
        .replace(/\btrue\b/g, '<span class="k">true</span>');
    const n = { error: 0, warn: 0 };
    for (const i of check.issues) if (n[i.level] !== undefined) n[i.level]++;
    $('#luaStatus').innerHTML = !check.stats.cells
        ? '<div class="banner warn">Kolejiště je prázdné.</div>'
        : n.error
            ? `<div class="banner error">Kolejiště má ${plural(n.error, 'chybu', 'chyby', 'chyb')}. Export proběhne, ale ORMS nemusí fungovat správně. <button class="btn" data-goto-check>Ukázat chyby</button></div>`
            : n.warn
                ? `<div class="banner warn">Bez chyb, ale ${plural(n.warn, 'upozornění', 'upozornění', 'upozornění')}. <button class="btn" data-goto-check>Ukázat</button></div>`
                : '<div class="banner ok">✓ Kolejiště je v pořádku.</div>';
    $('#luaCenterInfo').textContent = settings.center
        ? (offset.dx || offset.dy ? `(posun o ${offset.dx >= 0 ? '+' : ''}${offset.dx} sloupců a ${offset.dy >= 0 ? '+' : ''}${offset.dy} řádků)` : '(už je uprostřed)')
        : '(souřadnice přesně podle mřížky)';
    const count = cfg.Tracks.length + cfg.Switches.length + cfg.Signals.length + cfg.Crossings.length + cfg.Labels.length;
    $('#luaSize').textContent = `${plural(count, 'položka', 'položky', 'položek')} · ${(new Blob([luaText]).size / 1024).toFixed(1)} kB`;
}
$('#luaCenter').addEventListener('change', e => {
    settings.center = e.target.checked; saveSettings();
    $('#optCenter').checked = settings.center;
    fillLua();
});
$('#luaStatus').addEventListener('click', e => {
    if (!e.target.closest('[data-goto-check]')) return;
    luaDlg.close();
    setTab('check');
    issueFilter = 'all'; renderIssues();
    const first = check.issues[0];
    if (first) editor.flash(first.x, first.y);
});
$('#luaCopy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(luaText); toast('Kód zkopírován do schránky'); }
    catch (e) {
        const r = document.createRange(); r.selectNodeContents($('#luaCode'));
        const s = getSelection(); s.removeAllRanges(); s.addRange(r);
        toast('Kód je označený, zkopírujte ho Ctrl+C');
    }
});
$('#luaDownload').addEventListener('click', () => download('config.lua', luaText, 'text/plain;charset=utf-8'));

// generic dialog close buttons and backdrop click
for (const d of document.querySelectorAll('dialog')) {
    d.addEventListener('click', e => { if (e.target === d || e.target.closest('[data-close]')) d.close(); });
    d.addEventListener('close', () => editor.board.focus({ preventScroll: true }));
}

// ------------------------------------------------------------------ SignalCraft
const signalCraft = initSignalCraft({
    grid,
    locate: (x, y) => { if (settings.view === 'preview') setView('split'); editor.flash(x, y); },
    setMarks: marks => { scMarks = marks; applyMarks(); },
});

// ------------------------------------------------------------------ start
editor.board.addEventListener('mousedown', () => { emptyDismissed = true; $('#emptyState').hidden = true; });
started = true;
editor.setCellSize(settings.cs);
applyIcons();
renderPalette();
setView(settings.view);
setTab(settings.tab);
updateZoom();
const restored = restore();
recompute();
updateUndoButtons();
editor.select(1, 1, false, false);
if (restored) {
    const first = grid.nonEmpty().next().value;
    if (first) editor.reveal(Math.max(0, first[0] - 2), Math.max(0, first[1] - 2), true);
    toast('Obnoveno rozpracované kolejiště z minula');
}
editor.board.focus({ preventScroll: true });
