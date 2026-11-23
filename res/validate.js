// Live checks of the layout for ORMS. Returns a list of issues (error / warn / info), each tied to a
// grid cell, plus the parsed grid and counts for the status bar.
import { parseCell, DELTA, OPP, DIR_NAME, byteLength, signalClass } from './cells.js';
import { SCREEN_W, SCREEN_H } from './orms-render.js';

/**
 * @param {string[][]} texts
 * @param {{dx: number, dy: number}} offset  where the grid lands on the screen (centering)
 */
export function validate(texts, offset = { dx: 0, dy: 0 }) {
    const rows = texts.length, cols = texts[0].length;
    const parsed = texts.map(r => r.map(parseCell));
    const issues = [];
    const add = (level, x, y, msg, code) => issues.push({ level, x, y, msg, code });
    const at = (x, y) => (x >= 0 && y >= 0 && x < cols && y < rows ? parsed[y][x] : null);
    const stats = { track: 0, switch: 0, signal: 0, crossing: 0, label: 0, invalid: 0, cells: 0 };
    const names = { switch: new Map(), signal: new Map() };
    const crossingNames = new Set();

    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const c = parsed[y][x];
            if (c.kind === 'empty') continue;
            stats.cells++;
            stats[c.kind]++;
            for (const p of c.problems) add(p.level, x, y, p.msg, 'format');

            // ---- screen position
            const sx = x + offset.dx, sy = y + offset.dy;
            if (sx < 1 || sy < 1 || sx > SCREEN_W || sy > SCREEN_H) {
                add('warn', x, y, `Na obrazovce ORMS (${SCREEN_W}×${SCREEN_H}) leží mimo viditelnou plochu (X ${sx}, Y ${sy}), nebude vidět. Zapněte automatické centrování nebo prvek posuňte.`, 'screen');
            } else if (sy === 1 && sx >= 67 && sx <= 93) {
                add('info', x, y, 'Na obrazovce ORMS překryje nadpis „Open Rail Management System“ v prvním řádku.', 'screen');
            } else if (sy === SCREEN_H) {
                add('info', x, y, 'Poslední řádek obrazovky ORMS patří tlačítkům [Settings], [Route] a [Exit].', 'screen');
            }

            // ---- names
            if ((c.kind === 'switch' || c.kind === 'signal') && c.name.trim()) {
                const m = names[c.kind];
                if (m.has(c.name)) {
                    const o = m.get(c.name);
                    add('error', x, y, `${c.kind === 'switch' ? 'Výhybka' : 'Návěstidlo'} „${c.name}“ už v kolejišti je (X ${o[0]}, Y ${o[1]}). ORMS ovládá prvky podle názvu, oba by se přestavovaly spolu.`, 'duplicate');
                } else m.set(c.name, [x, y]);
            }
            if (c.kind === 'crossing' && c.name) crossingNames.add(c.name);
        }
    }

    // ---- track connections
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const c = parsed[y][x];
            if (c.kind === 'label') {
                for (const [d1, d2] of [['W', 'E'], ['N', 'S']]) {
                    const a = at(x + DELTA[d1][0], y + DELTA[d1][1]), b = at(x + DELTA[d2][0], y + DELTA[d2][1]);
                    if (a && b && a.dirs.includes(d2) && b.dirs.includes(d1)) {
                        add('error', x, y, `Popisek „${c.label}“ stojí uprostřed koleje a přerušuje ji. ORMS s popisky při hledání cesty nepočítá, mezera je pro něj díra. Dejte popisek nad nebo pod kolej.`, 'label-in-track');
                    }
                }
                continue;
            }
            if (!c.dirs) continue;
            for (const d of c.dirs) {
                const [dx, dy] = DELTA[d];
                const n = at(x + dx, y + dy);
                if (!n || n.kind === 'empty') {
                    // a hole: the track continues one cell further
                    const far = at(x + 2 * dx, y + 2 * dy);
                    if ((d === 'E' || d === 'S') && far && far.dirs.includes(OPP[d]) && n) {
                        add('warn', x + dx, y + dy, `Díra v koleji: kolej sem vede ${d === 'E' ? 'zleva i zprava' : 'shora i zdola'}, ale buňka je prázdná.`, 'hole');
                    }
                    continue;
                }
                if (n.kind === 'label' || n.kind === 'invalid') continue;
                if (!n.dirs) continue;
                if (!n.dirs.includes(OPP[d])) {
                    add('warn', x, y, `Kolej vede ${DIR_NAME[d]}, ale sousední buňka (X ${x + dx}, Y ${y + dy}) na ni nenavazuje.`, 'connection');
                }
            }
            if (c.kind === 'signal' && c.dirs) {
                const ok = [...c.dirs].some(d => {
                    const n = at(x + DELTA[d][0], y + DELTA[d][1]);
                    return n && n.dirs.includes(OPP[d]);
                });
                if (!ok) add('warn', x, y, `Návěstidlo „${c.name}“ nestojí na koleji: ani z jedné strany ve směru jízdy na něj nenavazuje kolej.`, 'signal-off-track');
            }
            if (c.kind === 'switch' && c.dirs) {
                const loose = [...c.dirs].filter(d => {
                    const n = at(x + DELTA[d][0], y + DELTA[d][1]);
                    return !n || !n.dirs.includes(OPP[d]);
                });
                if (loose.length === c.dirs.length) {
                    add('warn', x, y, `Výhybka „${c.name}“ nemá připojenou žádnou kolej.`, 'connection');
                }
            }
        }
    }

    // ---- distant signals need their main signal
    for (const [name, [x, y]] of names.signal) {
        if (signalClass(name) === 'distant') {
            const main = name.slice(2);
            if (main && !names.signal.has(main)) {
                add('warn', x, y, `Předvěst „${name}“ patří k návěstidlu „${main}“, které v kolejišti není. ORMS nastavuje předvěst podle návěstidla se stejným názvem bez „Pr“.`, 'distant');
            }
        }
    }

    // ---- labels drawn by ORMS: centred, as wide as the text in bytes + 2, drawn over everything
    for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
            const c = parsed[y][x];
            if (c.kind !== 'label') continue;
            const len = byteLength(c.label);
            const x1 = Math.ceil(x - len / 2), x2 = x1 + len + 1;
            const hit = [];
            for (let i = Math.max(0, x1); i <= Math.min(cols - 1, x2); i++) {
                if (i === x) continue;
                const n = parsed[y][i];
                if (n.kind !== 'empty' && n.kind !== 'label') hit.push(i);
            }
            if (hit.length) {
                add('warn', x, y, `Popisek „${c.label}“ ORMS vykreslí na střed buňky přes sloupce ${x1}–${x2} a zakryje ${hit.length === 1 ? 'prvek ve sloupci' : hit.length + (hit.length < 5 ? ' prvky' : ' prvků') + ' ve sloupcích'} ${hit.join(', ')}. Posuňte ho o řádek výš nebo níž.`, 'label-overlap');
            }
            const sx1 = x1 + offset.dx, sx2 = x2 + offset.dx;
            if ((sx1 < 1 || sx2 > SCREEN_W) && x + offset.dx >= 1 && x + offset.dx <= SCREEN_W) {
                add('warn', x, y, `Popisek „${c.label}“ přesahuje okraj obrazovky ORMS (sloupce ${sx1}–${sx2}), část nebude vidět.`, 'screen');
            }
        }
    }

    const order = { error: 0, warn: 1, info: 2 };
    issues.sort((a, b) => order[a.level] - order[b.level] || a.y - b.y || a.x - b.x);
    stats.crossingNames = crossingNames.size;
    return { issues, parsed, stats };
}
