// Lua config for ORMS (config.lua); reading CSV projects of the first version.
//
// gridToConfig() reads the grid exactly like the original "Převést do LUA" button did (fixed
// character positions, horizontal runs of track glyphs), so the output is byte-for-byte the same
// for the same layout. Only the optional offset is new: it moves the whole layout on the screen
// (automatic centering).
import { COLS, ROWS } from './cells.js';

const TRACK_START = ['═', '╗', '╝', '╚', '╔', '╥', '╨', '╡', '╞', '║', '︹', '︺', '⦘', '⦗', '╠', '╣', '╦', '╩'];
const TRACK_RUN = ['═', '︹', '︺', '⦘', '⦗'];
const TRACK_TAIL = ['╗', '╝', '╚', '╔', '╥', '╨', '╡', '╞', '║', '︹', '︺', '⦘', '⦗', '╠', '╣', '╦', '╩'];

/**
 * @param {string[][]} texts  texts[y][x]
 * @param {{dx?: number, dy?: number}} offset  shift of all coordinates
 * Entries keep the ORMS order of fields; gx/gy are the grid cell the entry came from.
 */
export function gridToConfig(texts, offset = {}) {
    const dx = offset.dx || 0, dy = offset.dy || 0;
    const cfg = { Signals: [], Tracks: [], Switches: [], Crossings: [], Labels: [] };
    for (let row = 0; row < texts.length; row++) {
        const line = texts[row];
        for (let col = 0; col < line.length; col++) {
            const t = (line[col] || '').trim();
            const x = col + dx, y = row + dy;
            const src = { gx: col, gy: row };
            if (t.length > 2) {
                if (t.charAt(0) === 'L') cfg.Labels.push({ x, y, text: t.substring(2), ...src });
                else if (t.charAt(2) === 'V' || t.charAt(2) === 'I') {
                    cfg.Switches.push({ x, y, a: t.charAt(0), b: t.charAt(4), name: t.substring(6), inverted: t.charAt(2) === 'I', ...src });
                } else if (t.charAt(2) === 'N') cfg.Signals.push({ x, y, name: t.substring(4), symbol: t.charAt(0), ...src });
                else if (t.charAt(2) === 'P') cfg.Crossings.push({ x, y, symbol: t.charAt(0), orient: t.charAt(4), name: t.substring(6), ...src });
            } else if (TRACK_START.includes(t)) {
                let run = t, n = 1;
                const at = i => (col + i < line.length ? (line[col + i] || '').trim() : null);
                while (TRACK_RUN.includes(at(n))) run += at(n++);
                if (TRACK_TAIL.includes(at(n))) run += at(n++);
                cfg.Tracks.push({ x, y, text: run, ...src });
                col += n - 1;
            }
        }
    }
    return cfg;
}

export function configToLua(cfg) {
    const block = (name, rows) => `Config.${name} = {\n` + rows.map(r => r + ',\n').join('') + '}\n';
    const q = s => `"${s}"`;
    return 'Config = {}\n' +
        block('Signals', cfg.Signals.map(s => `{${s.x}, ${s.y}, ${q(s.name)}, ${q(s.symbol)}}`)) +
        block('Tracks', cfg.Tracks.map(t => `{${t.x}, ${t.y}, ${q(t.text)}}`)) +
        // 6th element: inverted; 7th: speed through the curved position in km/h (ORMS: 40 when missing)
        block('Switches', cfg.Switches.map(s => `{${s.x}, ${s.y}, ${q(s.a)}, ${q(s.b)}, ${q(s.name)}${s.inverted || s.speed ? ', ' + (s.inverted ? 'true' : 'false') : ''}${s.speed ? ', ' + s.speed : ''}}`)) +
        block('Crossings', cfg.Crossings.map(c => `{${c.x}, ${c.y}, ${q(c.symbol)}, ${q(c.orient)}, ${q(c.name)}}`)) +
        block('Labels', cfg.Labels.map(l => `{${l.x}, ${l.y}, ${q(l.text)}}`)) +
        'return Config';
}

/**
 * Reads a config.lua (as written by configToLua) back into cell texts.
 * @returns {{texts: string[][], count: number, outside: number, speeds: Object<string, number>}}
 *   speeds: switch name -> speed through the curved position (7th element of a Config.Switches entry)
 */
export function parseLua(content) {
    const texts = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
    let count = 0, outside = 0;
    const speeds = {};
    content = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
    const sectionPattern = /Config\.(\w+)\s*=\s*\{([\s\S]*?)\n\s*\}/g;
    const entryPattern = /\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*"((?:[^"\\]|\\.)*)"(?:\s*,\s*"((?:[^"\\]|\\.)*)")?(?:\s*,\s*"((?:[^"\\]|\\.)*)")?(?:\s*,\s*(true|false))?(?:\s*,\s*(\d+(?:\.\d+)?))?\s*\}/g;
    const put = (x, y, text) => {
        if (y < 0 || y >= ROWS || x < 0 || x >= COLS) { outside++; return; }
        texts[y][x] = text;
    };
    let section;
    while ((section = sectionPattern.exec(content)) !== null) {
        const name = section[1];
        entryPattern.lastIndex = 0;
        let e;
        while ((e = entryPattern.exec(section[2])) !== null) {
            const x = parseInt(e[1], 10), y = parseInt(e[2], 10);
            const [f1, f2, f3, inverted] = [e[3], e[4], e[5], e[6] === 'true'];
            count++;
            switch (name) {
                case 'Tracks': [...f1].forEach((ch, i) => put(x + i, y, ch)); break;
                case 'Switches':
                    put(x, y, `${f1} ${inverted ? 'I' : 'V'} ${f2} ${f3}`);
                    if (e[7]) speeds[f3] = +e[7];
                    break;
                case 'Signals': put(x, y, `${f2} N ${f1}`); break;
                case 'Crossings': put(x, y, `${f1} P ${f2} ${f3}`); break;
                case 'Labels': put(x, y, `L ${f1}`); break;
                default: count--;
            }
        }
    }
    return { texts, count, outside, speeds };
}

/** Reads a CSV project of the first version ("null" = empty cell, every value followed by a comma). */
export function parseCSV(content) {
    content = content.replace(/^﻿/, '');
    // the generator always wrote commas; a file re-saved in a Czech Excel uses semicolons
    const firstLine = content.slice(0, content.search(/\r|\n|$/));
    const sep = (firstLine.split(';').length > firstLine.split(',').length) ? ';' : ',';
    const rows = [];
    let row = [], field = '', quoted = false;
    for (let i = 0; i < content.length; i++) {
        const ch = content[i];
        if (quoted) {
            if (ch === '"') {
                if (content[i + 1] === '"') { field += '"'; i++; } else quoted = false;
            } else field += ch;
        } else if (ch === '"' && field === '') quoted = true;
        else if (ch === sep) { row.push(field); field = ''; }
        else if (ch === '\n' || ch === '\r') {
            if (ch === '\r' && content[i + 1] === '\n') i++;
            row.push(field); rows.push(row); row = []; field = '';
        } else field += ch;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const texts = Array.from({ length: ROWS }, (_, y) => Array.from({ length: COLS }, (_, x) => {
        const v = ((rows[y] || [])[x] || '').trim();
        return v === 'null' ? '' : v;
    }));
    return texts;
}

export function download(name, content, type) {
    const blob = new Blob([content], { type });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
