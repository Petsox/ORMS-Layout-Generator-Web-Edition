// Cell formats of the ORMS Layout Generator.
//
// Every grid cell holds plain text, exactly like the original generator, so CSV and Lua files stay
// compatible. This module knows what that text means: track glyphs, switches ("═ V ╗ Vy1"),
// signals ("◀ N S1"), level crossings ("╪ P ═ P1") and labels ("L text"). The rules mirror the Lua
// exporter (fixed character positions) and the way ORMS reads the generated config.

export const COLS = 160;
export const ROWS = 50;

export const DELTA = { N: [0, -1], S: [0, 1], E: [1, 0], W: [-1, 0] };
export const OPP = { N: 'S', S: 'N', E: 'W', W: 'E' };
export const DIR_NAME = { N: 'nahoru', S: 'dolů', E: 'doprava', W: 'doleva' };
export const DIR_ARROW = { N: '↑', S: '↓', E: '→', W: '←' };
export const DIR_SIDE = { N: 'nad', S: 'pod', E: 'vpravo od', W: 'vlevo od' };

/** Track glyph -> sides it connects (same table as ORMS route.lua). */
export const TRACK_DIRS = {
    '═': 'WE', '║': 'NS', '╔': 'ES', '╗': 'WS', '╚': 'NE', '╝': 'NW',
    '╞': 'E', '╡': 'W', '╥': 'S', '╨': 'N',
    '╠': 'NSE', '╣': 'NSW', '╦': 'WES', '╩': 'WEN',
    '⦗': 'WE', '⦘': 'WE', '︹': 'NS', '︺': 'NS',
};
export const PLAIN_TRACK = ['═', '║', '╔', '╗', '╚', '╝'];
export const JUNCTIONS = ['╠', '╣', '╦', '╩'];
export const BUFFERS = ['╞', '╡', '╥', '╨'];
export const TUNNELS = ['⦗', '⦘', '︹', '︺'];
export const SWITCH_GLYPHS = PLAIN_TRACK;

/** Signal glyph -> [direction of travel, look]. ORMS decides the behaviour by the name prefix. */
export const SIGNAL_GLYPHS = {
    '◀': ['W', 'main'], '▶': ['E', 'main'], '▲': ['N', 'main'], '▼': ['S', 'main'],
    '◁': ['W', 'distant'], '▷': ['E', 'distant'], '△': ['N', 'distant'], '▽': ['S', 'distant'],
    '<': ['W', 'shunt'], '>': ['E', 'shunt'], '˂': ['W', 'shunt'], '˃': ['E', 'shunt'],
    '˄': ['N', 'shunt'], '˅': ['S', 'shunt'], '^': ['N', 'shunt'], 'V': ['S', 'shunt'],
};
export const SIGNAL_SYMBOL = {
    main: { W: '◀', E: '▶', N: '▲', S: '▼' },
    distant: { W: '◁', E: '▷', N: '△', S: '▽' },
    shunt: { W: '<', E: '>', N: '˄', S: '˅' },
};
export const CROSSING_GLYPHS = { '╪': '═', '╫': '║' };

/** ORMS signal classes (route.classifySignal): decided by the first two letters of the name. */
export const SIGNAL_CLASSES = {
    main: { title: 'Hlavní', prefix: 'S', look: 'main' },
    distant: { title: 'Předvěst', prefix: 'Pr', look: 'distant' },
    shunt: { title: 'Seřaďovací', prefix: 'Se', look: 'shunt' },
    inserted: { title: 'Vložené', prefix: 'VL', look: 'main' },
    repeater: { title: 'Cestové', prefix: 'Lc', look: 'main' },
};
export const LOOK_TITLE = { main: 'hlavního návěstidla', distant: 'předvěsti', shunt: 'seřaďovacího návěstidla' };

export function signalClass(name) {
    const p = (name || '').slice(0, 2);
    if (p === 'Se') return 'shunt';
    if (p === 'Pr') return 'distant';
    if (p === 'VS' || p === 'VL') return 'inserted';
    if (p === 'Sc' || p === 'Lc') return 'repeater';
    return 'main';
}

const ORDER = 'NESW';
export const normDirs = dirs => [...new Set(dirs)].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b)).join('');
const GLYPH_BY_DIRS = {};
for (const g of PLAIN_TRACK) GLYPH_BY_DIRS[normDirs(TRACK_DIRS[g])] = g;
/** Two sides -> plain track glyph (═ ║ ╔ ╗ ╚ ╝), or undefined. */
export const glyphFor = dirs => GLYPH_BY_DIRS[normDirs(dirs)];

export const fmt = {
    switch: (a, b, name, inverted) => `${a} ${inverted ? 'I' : 'V'} ${b} ${name}`,
    signal: (symbol, name) => `${symbol} N ${name}`,
    crossing: (symbol, name) => `${symbol} P ${CROSSING_GLYPHS[symbol] || '═'} ${name}`,
    label: text => `L ${text}`,
};

const EMPTY = Object.freeze({ kind: 'empty', text: '', dirs: '', problems: [] });
const cache = new Map();

/**
 * Reads a cell text the same way the Lua exporter does (fixed character positions).
 * @returns {{kind: string, text: string, dirs: string, problems: {level: string, msg: string}[], ...}}
 *   kind: empty | track | switch | signal | crossing | label | invalid
 */
export function parseCell(raw) {
    const t = (raw || '').trim();
    if (!t) return EMPTY;
    let c = cache.get(t);
    if (!c) {
        c = parse(t);
        if (cache.size > 5000) cache.clear();
        cache.set(t, c);
    }
    return c;
}

function parse(t) {
    const problems = [];
    const err = msg => problems.push({ level: 'error', msg });
    const warn = msg => problems.push({ level: 'warn', msg });
    const checkName = (name, what) => {
        if (!name.trim()) err(`${what} nemá název.`);
        else if (/["\\]/.test(name)) err(`Název „${name}“ obsahuje uvozovky nebo zpětné lomítko, vygenerovaný Lua soubor by nešel načíst.`);
    };

    if (t.length > 2) {
        if (t[0] === 'L') {
            const text = t.substring(2);
            if (t[1] !== ' ') err(`Za „L“ chybí mezera. Export bere text až od třetího znaku, z „${t}“ by zbylo jen „${text}“.`);
            if (/["\\]/.test(text)) err('Popisek obsahuje uvozovky nebo zpětné lomítko, vygenerovaný Lua soubor by nešel načíst.');
            return { kind: 'label', text: t, label: text, dirs: '', problems };
        }
        if (t[2] === 'V' || t[2] === 'I') {
            const a = t[0], b = t[4], name = t.substring(6);
            const inverted = t[2] === 'I';
            let dirs = '';
            if (t[1] !== ' ' || t[3] !== ' ' || (t.length > 5 && t[5] !== ' ')) {
                err('Špatný formát výhybky, má být „═ V ╗ Vy1“ (symbol, mezera, V, mezera, symbol, mezera, název).');
            } else if (!SWITCH_GLYPHS.includes(a) || !SWITCH_GLYPHS.includes(b)) {
                err(`Výhybka smí mít jen symboly ${SWITCH_GLYPHS.join(' ')}; má „${a}“ a „${b || ''}“.`);
            } else if (a === b) {
                err(`Výhybka má v obou polohách stejný symbol „${a}“, druhý symbol musí být odbočka.`);
            } else {
                const common = [...TRACK_DIRS[a]].filter(d => TRACK_DIRS[b].includes(d));
                if (common.length !== 1) err(`Symboly „${a}“ a „${b}“ nemají právě jeden společný konec (hrot výhybky).`);
                dirs = normDirs(TRACK_DIRS[a] + TRACK_DIRS[b]);
            }
            checkName(name, 'Výhybka');
            const common = dirs ? [...TRACK_DIRS[a]].filter(d => TRACK_DIRS[b].includes(d)) : [];
            return { kind: 'switch', text: t, a, b, name, inverted, dirs, point: common.length === 1 ? common[0] : null, problems };
        }
        if (t[2] === 'N') {
            const symbol = t[0], name = t.substring(4);
            const s = SIGNAL_GLYPHS[symbol];
            if (t[1] !== ' ' || t[3] !== ' ') err('Špatný formát návěstidla, má být „◀ N S1“ (symbol, mezera, N, mezera, název).');
            else if (!s) err(`Neznámý symbol návěstidla „${symbol}“. Použijte ◀ ▶ ▲ ▼ (hlavní), ◁ ▷ △ ▽ (předvěst) nebo < > ˄ ˅ (seřaďovací).`);
            checkName(name, 'Návěstidlo');
            const cls = signalClass(name);
            const look = s ? s[1] : null;
            if (s && name && SIGNAL_CLASSES[cls].look !== look) {
                warn(`Název „${name}“ dělá z návěstidla v ORMS ${SIGNAL_CLASSES[cls].title.toLowerCase()} (podle předpony), ale symbol „${symbol}“ je symbol ${LOOK_TITLE[look]}.`);
            }
            const dir = s ? s[0] : null;
            return { kind: 'signal', text: t, symbol, name, dir, look, cls, dirs: dir ? (dir === 'W' || dir === 'E' ? 'EW' : 'NS') : '', problems };
        }
        if (t[2] === 'P') {
            const symbol = t[0], orient = t[4], name = t.substring(6);
            let dirs = '';
            if (t[1] !== ' ' || t[3] !== ' ' || (t.length > 5 && t[5] !== ' ')) {
                err('Špatný formát přejezdu, má být „╪ P ═ P1“ (symbol, mezera, P, mezera, kolej, mezera, název).');
            } else if (!CROSSING_GLYPHS[symbol]) {
                err(`Přejezd má symbol „${symbol}“, povolené jsou ╪ (vodorovná kolej) a ╫ (svislá kolej).`);
            } else if (!TRACK_DIRS[orient]) {
                err(`Druhý symbol přejezdu „${orient || ''}“ musí být kolej (═ nebo ║), ORMS z něj čte, kudy vede kolej.`);
            } else {
                dirs = normDirs(TRACK_DIRS[orient]);
                if (CROSSING_GLYPHS[symbol] !== orient) warn(`Přejezd „${symbol}“ by měl mít jako druhý symbol „${CROSSING_GLYPHS[symbol]}“, má „${orient}“.`);
            }
            checkName(name, 'Přejezd');
            return { kind: 'crossing', text: t, symbol, orient, name, dirs, problems };
        }
        err(`Neznámý obsah „${t}“. Do Lua se nevyexportuje: třetí znak musí být V, I, N nebo P, popisek začíná „L “.`);
        return { kind: 'invalid', text: t, dirs: '', problems };
    }
    if (TRACK_DIRS[t]) return { kind: 'track', text: t, glyph: t, dirs: normDirs(TRACK_DIRS[t]), problems };
    if (SIGNAL_GLYPHS[t]) err(`Samotný symbol „${t}“ se nevyexportuje, návěstidlo se píše „${t} N S1“.`);
    else if (CROSSING_GLYPHS[t]) err(`Samotný symbol „${t}“ se nevyexportuje, přejezd se píše „${t} P ${CROSSING_GLYPHS[t]} P1“.`);
    else err(`Neznámý obsah „${t}“, do Lua se nevyexportuje.`);
    return { kind: 'invalid', text: t, dirs: '', problems };
}

export const KIND_TITLE = {
    empty: 'Prázdná buňka', track: 'Kolej', switch: 'Výhybka', signal: 'Návěstidlo',
    crossing: 'Přejezd', label: 'Popisek', invalid: 'Neplatný obsah',
};

/** Short human description of a parsed cell, for hints and the inspector. */
export function describe(c) {
    switch (c.kind) {
        case 'empty': return 'Prázdná buňka';
        case 'track':
            if (BUFFERS.includes(c.glyph)) return `Zarážedlo, kolej pokračuje ${DIR_NAME[c.dirs]}`;
            if (TUNNELS.includes(c.glyph)) return 'Portál tunelu';
            if (JUNCTIONS.includes(c.glyph)) return 'Pevné rozvětvení (bez výhybky)';
            return 'Kolej ' + c.glyph;
        case 'switch': return `Výhybka ${c.name || '?'}: ${c.a} → ${c.b}${c.inverted ? ', invertovaná' : ''}`;
        case 'signal': return `${SIGNAL_CLASSES[c.cls].title} návěstidlo ${c.name || '?'}${c.dir ? ', platí ' + DIR_ARROW[c.dir] : ''}`;
        case 'crossing': return `Přejezd ${c.name || '?'}`;
        case 'label': return `Popisek „${c.label}“`;
        default: return 'Neplatný obsah';
    }
}

/** UTF-8 byte length: Lua's string.len, which ORMS uses to place labels and names. */
export const byteLength = s => new TextEncoder().encode(s).length;
