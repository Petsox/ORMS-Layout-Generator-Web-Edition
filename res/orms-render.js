// What ORMS draws on the OpenComputers screen for a given config.
//
// buildScreen() follows init.lua of ORMS step by step (draw order, colours, where switch and signal
// names go, how labels are centred) on a 160×50 character screen. With `faithful` on it also keeps
// the quirks of the current ORMS code: names are shortened (switch "Vy…" → string.sub(name, 3, -3),
// signal → string.sub(name, 1, -3)), label widths are counted in UTF-8 bytes, and text placed at a
// half-cell position is not drawn at all.
// paintScreen() then draws the character buffer on a canvas in the look of the OC font.
import { byteLength } from './cells.js';

export const SCREEN_W = 160;
export const SCREEN_H = 50;
const GRAY = 0xB2B2B2, WHITE = 0xFFFFFF, BLUE = 0x0000FF, GREEN = 0x19ED15, RED = 0xFF0000;
const TUNNEL = ['⦗', '⦘', '︹', '︺'];
const TITLE = 'Open Rail Management System';
const CREDITS = 'By Petsox and tpeterka1';

const luaSub = (s, i, j) => {
    // string.sub on UTF-8 bytes, decoded back (a cut multi-byte character becomes "?")
    const b = new TextEncoder().encode(s);
    const n = b.length;
    let a = i < 0 ? Math.max(n + i + 1, 1) : Math.max(i, 1);
    let e = j < 0 ? n + j + 1 : Math.min(j, n);
    if (a > e) return '';
    return new TextDecoder().decode(b.slice(a - 1, e)).replace(/�/g, '?');
};

export function switchLabel(name, faithful) {
    if (name.slice(0, 2).toLowerCase() === 'vy') return faithful ? luaSub(name, 3, -3) : name.slice(2);
    return name.trim();
}
export const signalLabel = (name, faithful) => (faithful ? luaSub(name, 1, -3) : name);

function switchTextPos(x, y, a, b, label) {
    const has = g => a === g || b === g;
    if (has('╗')) y -= 1;
    else if (has('╝')) y += 1;
    else if (has('╚')) y += 1;
    else if (has('╔')) y -= 1;
    return { x: byteLength(label) === 1 ? x : x - 1, y };
}

function signalTextPos(x, y, symbol, label) {
    const len = byteLength(label);
    if (['<', '◀', '◁'].includes(symbol)) return { x: x - len / 2 + (len % 2 === 0 ? 1 : 0), y: y - 1 };
    if (['>', '▶', '▷'].includes(symbol)) return { x: x - len / 2 + (len % 2 === 0 ? 1 : 0), y: y + 1 };
    if (['^', '▲', '△'].includes(symbol)) return { x: x + 1, y };
    if (['V', '▼', '▽'].includes(symbol)) return { x: x - len, y };
    return { x, y };
}

/**
 * @param cfg  result of gridToConfig()
 * @param opts {faithful, switchNames, signalNames, chrome, sim: {switches:Set, crossings:Set, signals:Map}}
 * @returns screen {w, h, ch[], fg[], bg[], who[]} indexed (y-1)*w + (x-1); who = grid object at that place
 */
export function buildScreen(cfg, opts = {}) {
    const w = SCREEN_W, h = SCREEN_H, n = w * h;
    const scr = { w, h, ch: Array(n).fill(' '), fg: Array(n).fill(WHITE), bg: Array(n).fill(0), who: Array(n).fill(null), hidden: [] };
    const faithful = opts.faithful !== false;
    const sim = opts.sim || {};

    const text = (x, y, color, s, who) => {
        if (!Number.isInteger(x)) {
            if (faithful) { if (who) scr.hidden.push({ who, s }); return; }
            x = Math.floor(x);
        }
        if (y < 1 || y > h) return;
        let i = 0;
        for (const ch of s) {
            const cx = x + i++;
            if (cx < 1 || cx > w) continue;
            const k = (y - 1) * w + cx - 1;
            scr.ch[k] = ch; scr.fg[k] = color;
            if (who) scr.who[k] = who;
        }
    };
    const rect = (x, y, width, color, who) => {
        for (let i = 0; i < width; i++) {
            const cx = x + i;
            if (cx < 1 || cx > w || y < 1 || y > h) continue;
            const k = (y - 1) * w + cx - 1;
            scr.bg[k] = color; scr.ch[k] = ' ';
            if (who) scr.who[k] = who;
        }
    };

    if (opts.chrome !== false) {
        text(Math.floor(1 + w / 2 - TITLE.length / 2), 1, WHITE, TITLE);
        text(Math.floor(1 + w / 2 - CREDITS.length / 2), h, WHITE, CREDITS);
        text(w - 5, h, WHITE, '[Exit]');
        text(1, h, WHITE, '[Settings]');
        text(12, h, WHITE, '[Route]');
    }

    for (const t of cfg.Tracks) {
        const s = t.text.trim();
        const color = TUNNEL.includes(s) ? BLUE : GRAY;
        [...s].forEach((ch, i) => text(t.x + i, t.y, color, ch, { kind: 'track', gx: t.gx + i, gy: t.gy }));
    }
    for (const s of cfg.Switches) {
        const who = { kind: 'switch', name: s.name, gx: s.gx, gy: s.gy };
        const on = sim.switches && sim.switches.has(s.name);
        text(s.x, s.y, GRAY, on ? s.b : s.a, who);
        if (opts.switchNames !== false) {
            const label = switchLabel(s.name, faithful);
            const p = switchTextPos(s.x, s.y, s.a, s.b, label);
            text(p.x, p.y, WHITE, label, { ...who, part: 'name' });
        }
    }
    for (const c of cfg.Crossings) {
        const on = sim.crossings && sim.crossings.has(c.name);
        text(c.x, c.y, on ? RED : GRAY, on ? c.orient : c.symbol, { kind: 'crossing', name: c.name, gx: c.gx, gy: c.gy });
    }
    for (const s of cfg.Signals) {
        const who = { kind: 'signal', name: s.name, gx: s.gx, gy: s.gy };
        rect(s.x, s.y, 1, 0, who);
        const color = (sim.signals && sim.signals.get(s.name)) || GRAY;
        text(s.x, s.y, color, s.symbol, who);
        if (opts.signalNames !== false) {
            const label = signalLabel(s.name, faithful);
            const p = signalTextPos(s.x, s.y, s.symbol, label);
            text(p.x, p.y, WHITE, label, { ...who, part: 'name' });
        }
    }
    for (const l of cfg.Labels) {
        const len = faithful ? byteLength(l.text) : [...l.text].length;
        const x = Math.ceil(l.x - len / 2), width = len + 2;
        const who = { kind: 'label', name: l.text, gx: l.gx, gy: l.gy };
        rect(x, l.y, width, BLUE, who);
        text(Math.floor(x + width / 2 - [...l.text].length / 2), l.y, WHITE, l.text, who);
    }
    return scr;
}

/** Bounding box of everything the layout draws (in screen coordinates, without clipping). */
export function layoutBounds(cfg, opts = {}) {
    const faithful = opts.faithful !== false;
    let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
    const add = (x, y, len = 1) => {
        if (len <= 0 || !Number.isFinite(x)) return;
        x = Math.floor(x);
        x1 = Math.min(x1, x); x2 = Math.max(x2, x + len - 1);
        y1 = Math.min(y1, y); y2 = Math.max(y2, y);
    };
    for (const t of cfg.Tracks) add(t.x, t.y, [...t.text.trim()].length);
    for (const s of cfg.Switches) {
        add(s.x, s.y);
        if (opts.switchNames !== false) {
            const label = switchLabel(s.name, faithful), p = switchTextPos(s.x, s.y, s.a, s.b, label);
            add(p.x, p.y, [...label].length);
        }
    }
    for (const c of cfg.Crossings) add(c.x, c.y);
    for (const s of cfg.Signals) {
        add(s.x, s.y);
        if (opts.signalNames !== false) {
            const label = signalLabel(s.name, faithful), p = signalTextPos(s.x, s.y, s.symbol, label);
            if (Number.isInteger(p.x) || !faithful) add(p.x, p.y, [...label].length);
        }
    }
    for (const l of cfg.Labels) {
        const len = faithful ? byteLength(l.text) : [...l.text].length;
        add(Math.ceil(l.x - len / 2), l.y, len + 2);
    }
    return x1 === Infinity ? null : { x1, y1, x2, y2 };
}

/**
 * Shift that puts the layout in the middle of the usable screen: columns 1–160, rows 2–49
 * (row 1 holds the ORMS title, row 50 the buttons). Returns {dx, dy} (0, 0 for an empty layout).
 * limits: optional {minX, maxX, minY, maxY} the grid cells must stay in after the shift.
 */
export function centerOffset(cfg, opts = {}, cells = null, limits = null) {
    const b = layoutBounds(cfg, opts);
    if (!b) return { dx: 0, dy: 0 };
    const fit = (lo, hi, a, z) => {
        const free = (hi - lo) - (z - a);
        if (free <= 0) return lo - a; // larger than the screen: align to the start
        return lo + Math.floor(free / 2) - a;
    };
    let dx = fit(1, SCREEN_W, b.x1, b.x2);
    let dy = fit(2, SCREEN_H - 1, b.y1, b.y2);
    if (cells && limits) {
        dx = Math.min(Math.max(dx, limits.minX - cells.x1), limits.maxX - cells.x2);
        dy = Math.min(Math.max(dy, limits.minY - cells.y1), limits.maxY - cells.y2);
    }
    return { dx, dy };
}

// ---------------------------------------------------------------- canvas
const hex = c => '#' + c.toString(16).padStart(6, '0');
const BOX = {
    '═': 'EW', '║': 'NS', '╔': 'ES', '╗': 'SW', '╚': 'NE', '╝': 'NW',
    '╠': 'NES', '╣': 'NSW', '╦': 'ESW', '╩': 'NEW',
};
const TRIANGLES = {
    '◀': ['W', true], '▶': ['E', true], '▲': ['N', true], '▼': ['S', true],
    '◁': ['W', false], '▷': ['E', false], '△': ['N', false], '▽': ['S', false],
};

/** Paints the screen; cell = width of one character in CSS px (height is double). */
export function paintScreen(canvas, scr, cell, opts = {}) {
    const dpr = window.devicePixelRatio || 1;
    const cw = cell, chh = cell * 2;
    const W = scr.w * cw, H = scr.h * chh;
    if (canvas.width !== Math.round(W * dpr) || canvas.height !== Math.round(H * dpr)) {
        canvas.width = Math.round(W * dpr);
        canvas.height = Math.round(H * dpr);
    }
    canvas.style.width = W + 'px';
    canvas.style.height = H + 'px';
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#000';
    ctx.fillRect(0, 0, W, H);
    const line = Math.max(1, Math.round(cell / 8));
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `${Math.round(chh * 0.78)}px "Cascadia Mono", Consolas, "DejaVu Sans Mono", "Courier New", monospace`;

    for (let y = 0; y < scr.h; y++) {
        for (let x = 0; x < scr.w; x++) {
            const k = y * scr.w + x;
            const px = x * cw, py = y * chh;
            if (scr.bg[k]) { ctx.fillStyle = hex(scr.bg[k]); ctx.fillRect(px, py, cw + 0.5, chh + 0.5); }
            const ch = scr.ch[k];
            if (ch === ' ') continue;
            const color = hex(scr.fg[k]);
            ctx.fillStyle = color; ctx.strokeStyle = color;
            if (BOX[ch]) drawDouble(ctx, px, py, cw, chh, BOX[ch], line);
            else if (ch === '╞' || ch === '╡' || ch === '╥' || ch === '╨') drawBuffer(ctx, px, py, cw, chh, ch, line);
            else if (ch === '╪' || ch === '╫') drawCrossing(ctx, px, py, cw, chh, ch, line);
            else if (TRIANGLES[ch]) drawTriangle(ctx, px, py, cw, chh, ...TRIANGLES[ch], line);
            else ctx.fillText(ch, px + cw / 2, py + chh / 2 + 1);
        }
    }
    if (opts.grid) {
        ctx.strokeStyle = 'rgba(255,255,255,.07)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let x = 0; x <= scr.w; x++) { ctx.moveTo(x * cw + 0.5, 0); ctx.lineTo(x * cw + 0.5, H); }
        for (let y = 0; y <= scr.h; y++) { ctx.moveTo(0, y * chh + 0.5); ctx.lineTo(W, y * chh + 0.5); }
        ctx.stroke();
    }
}

// Double box-drawing lines like the OC font: each arm has two strokes; where they end depends on
// which other arms are present (corner joins, T-joins, straight run-through).
function drawDouble(ctx, px, py, cw, chh, sides, lw) {
    const cx = px + cw / 2, cy = py + chh / 2;
    const o = Math.max(lw * 1.5, cw / 5);
    const has = d => sides.includes(d);
    const OPPOSITE = { N: 'S', S: 'N', E: 'W', W: 'E' };
    for (const arm of sides) {
        const horiz = arm === 'E' || arm === 'W';
        const sign = arm === 'E' || arm === 'S' ? 1 : -1;
        const half = horiz ? cw / 2 : chh / 2;
        for (const [side, off] of horiz ? [['N', -o], ['S', o]] : [['W', -o], ['E', o]]) {
            // distance from the centre (along the arm) where this stroke starts
            let t0 = 0;
            if (has(side)) t0 = o - lw / 2;                       // meets the neighbouring arm: inner corner
            else if (has(OPPOSITE[arm])) t0 = 0;                  // runs straight through
            else if (has(OPPOSITE[side])) t0 = -o - lw / 2;       // outer corner
            const a = sign * t0, b = sign * half;
            const lo = Math.min(a, b), len = Math.abs(b - a);
            if (horiz) ctx.fillRect(cx + lo, Math.round(cy + off - lw / 2), len, lw);
            else ctx.fillRect(Math.round(cx + off - lw / 2), cy + lo, lw, len);
        }
    }
}

function drawBuffer(ctx, px, py, cw, chh, ch, lw) {
    const cx = px + cw / 2, cy = py + chh / 2;
    const o = Math.max(lw * 1.5, cw / 5);
    if (ch === '╞' || ch === '╡') {
        const x0 = ch === '╞' ? cx : px, x1 = ch === '╞' ? px + cw : cx;
        ctx.fillRect(x0, Math.round(cy - o - lw / 2), x1 - x0, lw);
        ctx.fillRect(x0, Math.round(cy + o - lw / 2), x1 - x0, lw);
        ctx.fillRect(Math.round(cx - lw / 2), py, lw, chh);
    } else {
        const y0 = ch === '╥' ? cy : py, y1 = ch === '╥' ? py + chh : cy;
        ctx.fillRect(Math.round(cx - o - lw / 2), y0, lw, y1 - y0);
        ctx.fillRect(Math.round(cx + o - lw / 2), y0, lw, y1 - y0);
        ctx.fillRect(px, Math.round(cy - lw / 2), cw, lw);
    }
}

function drawCrossing(ctx, px, py, cw, chh, ch, lw) {
    const cx = px + cw / 2, cy = py + chh / 2;
    const o = Math.max(lw * 1.5, cw / 5);
    if (ch === '╪') {
        ctx.fillRect(px, Math.round(cy - o - lw / 2), cw, lw);
        ctx.fillRect(px, Math.round(cy + o - lw / 2), cw, lw);
        ctx.fillRect(Math.round(cx - lw / 2), py, lw, chh);
    } else {
        ctx.fillRect(Math.round(cx - o - lw / 2), py, lw, chh);
        ctx.fillRect(Math.round(cx + o - lw / 2), py, lw, chh);
        ctx.fillRect(px, Math.round(cy - lw / 2), cw, lw);
    }
}

function drawTriangle(ctx, px, py, cw, chh, dir, filled, lw) {
    const cx = px + cw / 2, cy = py + chh / 2;
    const r = cw * 0.42;
    const pts = {
        E: [[cx + r, cy], [cx - r, cy - r * 1.15], [cx - r, cy + r * 1.15]],
        W: [[cx - r, cy], [cx + r, cy - r * 1.15], [cx + r, cy + r * 1.15]],
        N: [[cx, cy - r * 1.3], [cx - r, cy + r * 0.9], [cx + r, cy + r * 0.9]],
        S: [[cx, cy + r * 1.3], [cx - r, cy - r * 0.9], [cx + r, cy - r * 0.9]],
    }[dir];
    ctx.beginPath();
    ctx.moveTo(...pts[0]); ctx.lineTo(...pts[1]); ctx.lineTo(...pts[2]); ctx.closePath();
    if (filled) ctx.fill();
    else { ctx.lineWidth = lw; ctx.stroke(); }
}

export const COLORS = { GRAY, WHITE, GREEN, RED, BLUE, YELLOW: 0xFFFF00 };
