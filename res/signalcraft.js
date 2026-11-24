// Layout export for SignalCraft (electro-mechanical station interlocking, EMZZ).
//
// Turns the generator grid into a station description in the format used by StavedloSim (nodes, tracks,
// switches, signals, lines, level crossings, train routes) and checks that the layout is connected and makes
// sense. The module does not touch the page, so it also runs in Node.
// The output keeps the StavedloSim keys (Czech); messages for the user are Czech like the rest of the UI.
//
// Labels read by the export:
//   "L ST1", "L ST2" ...      signal box; switches, signals and crossings belong to the nearest one (along the tracks)
//   "L 1", "L 3a" ...         number of a main track, the label stands next to the track
//   "L T1 Kamenice"           line at a free end of a track: designation and name of the neighbouring station
// Signal name prefixes: Pr = distant signal, Se = shunting signal, others are main signals.
//
// Everything the export would otherwise guess can be set in the SignalCraft mode of the generator (options.sc, kept
// with the layout): signal box of an element, kind of a main signal and the tracks of a group signal, "+" / "−" of a
// switch, which numbered tracks are main tracks, texts of the lines, coupled switches, train routes on or off.
// The finished station is then loaded by the port of the SignalCraft logic (emzz-model.js) exactly as the game will
// load it: its errors are export errors and its equipment is the preview of the instruments.
import { buildModel, natural, SIGNAL_KINDS } from './emzz-model.js';

const DIRS = { N: [0, -1], S: [0, 1], W: [-1, 0], E: [1, 0] };
const OPPOSITE = { N: 'S', S: 'N', W: 'E', E: 'W' };

const TRACK = {
    '═': 'WE', '║': 'NS', '╔': 'ES', '╗': 'WS', '╚': 'NE', '╝': 'NW',
    '︹': 'WE', '︺': 'WE', '⦘': 'WE', '⦗': 'WE',   // tunnels
};
const BUFFER = { '╡': 'W', '╞': 'E', '╨': 'N', '╥': 'S' };
const FIXED_JUNCTION = new Set(['╠', '╣', '╦', '╩']);
const CROSSING = { '╪': 'WE', '╫': 'NS' };
const SIGNAL = {
    '▶': ['E', 'main'], '◀': ['W', 'main'], '▲': ['N', 'main'], '▼': ['S', 'main'],
    '▷': ['E', 'distant'], '◁': ['W', 'distant'], '△': ['N', 'distant'], '▽': ['S', 'distant'],
    '˃': ['E', 'shunt'], '˂': ['W', 'shunt'], '˄': ['N', 'shunt'], '˅': ['S', 'shunt'],
    '>': ['E', 'shunt'], '<': ['W', 'shunt'],   // ASCII form of shunting signals
};
const AXIS = { E: 'WE', W: 'WE', N: 'NS', S: 'NS' };
const METRES_PER_CELL = 25;

const key = (x, y) => x + ',' + y;
/** key of a train route in the settings: signal | start track | target (line or track id) */
export const routeKey = (od, z, na) => [od, z || '', na].join('|');
const at = (x, y) => `[sloupec ${x + 1}, řádek ${y + 1}]`;

/**
 * @param {string[][]} grid  cell texts by rows (grid[row][column])
 * @param {{name?: string, id?: string, sc?: object}} options  sc = SignalCraft settings of the layout (see scDefaults)
 * @returns {{station: object|null, errors: string[], warnings: string[], assignment: object, info: object, model: object|null}}
 */
export function convertToStation(grid, options = {}) {
    const errors = [], warnings = [];
    const cells = new Map();   // key -> track cell
    const labels = [];
    const sc = options.sc || {};
    const cfg = name => (sc.prvky && sc.prvky[name]) || {};

    // ---------- 1. cells ----------
    for (let y = 0; y < grid.length; y++) {
        for (let x = 0; x < grid[y].length; x++) {
            const t = (grid[y][x] || '').trim();
            if (!t) continue;
            const c = parseCell(t, x, y, errors);
            if (!c) continue;
            if (c.type === 'label') labels.push(c);
            else cells.set(key(x, y), c);
        }
    }
    // validity of a signal in the settings ("platnost"): a main signal valid only for shunting is a shunting signal,
    // a shunting signal valid for trains is a main signal
    for (const c of cells.values()) {
        if (c.type !== 'signal') continue;
        c.look = c.kind;
        const v = cfg(c.name).platnost;
        if (v === 'posun' && c.kind === 'main') c.kind = 'shunt';
        else if ((v === 'vlak' || v === 'oba') && c.kind === 'shunt') c.kind = 'main';
    }
    // a switch with "+" and "−" swapped in the settings
    for (const c of cells.values()) {
        if (c.type !== 'switch') continue;
        c.swapped = !!cfg(c.name).zamenit;
        if (c.swapped) [c.normal, c.reverse] = [c.reverse, c.normal];
    }

    // ---------- 2. connections between neighbouring cells ----------
    const freeEnds = [];
    for (const c of cells.values()) {
        for (const d of c.dirs) {
            const [dx, dy] = DIRS[d];
            const n = cells.get(key(c.x + dx, c.y + dy));
            if (n && n.dirs.includes(OPPOSITE[d])) continue;
            if (n) {
                errors.push(`${at(c.x, c.y)} kolej nenavazuje na sousední buňku ${at(n.x, n.y)} (díra nebo špatný symbol)`);
                c.broken = true;
                continue;
            }
            if (c.type !== 'track') {
                errors.push(`${at(c.x, c.y)} ${typeName(c)} ${c.name || ''} nemá kolej na straně ${d}`);
                c.broken = true;
                continue;
            }
            // a label right behind the end of a track is fine; it is an error when the track continues behind it
            const label = labels.find(p => p.x === c.x + dx && p.y === c.y + dy);
            const behind = label && cells.get(key(c.x + 2 * dx, c.y + 2 * dy));
            if (behind && behind.dirs.includes(OPPOSITE[d])) {
                if (d === 'E' || d === 'S') errors.push(`${at(c.x + dx, c.y + dy)} popisek "${label.text}" stojí v koleji a přerušuje ji; dejte ho vedle koleje`);
                c.broken = true;
            } else if (!label) {
                // the track continues behind a gap of one or two cells: a hole
                for (const k of [2, 3]) {
                    const z = cells.get(key(c.x + k * dx, c.y + k * dy));
                    if (z && z.dirs.includes(OPPOSITE[d])) {
                        if (d === 'E' || d === 'S') errors.push(`${at(c.x + dx, c.y + dy)} díra v koleji (${k - 1} ${k === 2 ? 'prázdná buňka' : 'prázdné buňky'})`);
                        c.broken = true;
                        break;
                    }
                    if (k > 2 && cells.has(key(c.x + (k - 1) * dx, c.y + (k - 1) * dy))) break;
                }
            }
            freeEnds.push({ c, d });
        }
    }

    // ---------- 3. nodes ----------
    // a node is a switch, a signal, a buffer stop and a free end of a track
    const isEnd = c => c.buffer || freeEnds.some(v => v.c === c);
    // a distant signal and a crossing are only places on a track, they do not split it
    const passThrough = c => c.type === 'track' || c.type === 'distant' || c.type === 'crossing';
    const isNode = c => !passThrough(c) || isEnd(c);
    const nodes = new Map();   // key -> node id
    for (const c of cells.values()) {
        if (!isNode(c)) continue;
        nodes.set(key(c.x, c.y), c.type === 'switch' ? 'v' + c.name : c.type === 'signal' ? 'n' + c.name : `e${c.x}_${c.y}`);
    }

    // ---------- 4. tracks between nodes ----------
    const edges = [];
    const done = new Set();
    for (const c of cells.values()) {
        if (!isNode(c)) continue;
        for (const d of c.dirs) {
            if (done.has(key(c.x, c.y) + d)) continue;
            const [dx, dy] = DIRS[d];
            let n = cells.get(key(c.x + dx, c.y + dy));
            if (!n || !n.dirs.includes(OPPOSITE[d])) continue;
            const points = [[c.x, c.y]];
            const crossings = [], distants = [];
            let came = OPPOSITE[d];
            let steps = 0;
            while (!isNode(n) && steps++ < 100000) {
                points.push([n.x, n.y]);
                if (n.type === 'crossing') crossings.push(n);
                if (n.type === 'distant') distants.push(n);
                const out = n.dirs.find(s => s !== came);
                const [ex, ey] = DIRS[out];
                came = OPPOSITE[out];
                n = cells.get(key(n.x + ex, n.y + ey));
            }
            points.push([n.x, n.y]);
            done.add(key(c.x, c.y) + d);
            done.add(key(n.x, n.y) + came);
            edges.push({ a: c, aDir: d, b: n, bDir: came, points, crossings, distants, cells: points.length - 1 });
        }
    }
    const edgeAt = (c, d) => edges.find(e => (e.a === c && e.aDir === d) || (e.b === c && e.bDir === d));
    const other = (e, c) => (e.a === c ? e.b : e.a);
    const entryInto = (e, c) => (e.a === c ? e.bDir : e.aDir); // direction in which the track enters the other node

    // ---------- 5. labels: signal boxes, lines, track numbers ----------
    const boxes = [];
    const lines = [];
    for (const p of labels) {
        const box = p.text.match(/^ST\s*(\d+)$/i);
        const line = p.text.match(/^(T\S*)(?:\s+(.+))?$/);
        if (box) {
            const id = 'ST' + box[1];
            if (boxes.some(s => s.id === id)) errors.push(`${at(p.x, p.y)} stavědlo ${id} je v kolejišti dvakrát`);
            else boxes.push({ id, name: 'Stavědlo ' + box[1], x: p.x, y: p.y });
        } else if (line) {
            const end = nearest(freeEnds.map(v => v.c), p, 3);
            if (!end) { errors.push(`${at(p.x, p.y)} trať ${line[1]}: vedle popisku není volný konec koleje`); continue; }
            if (end.buffer) { errors.push(`${at(p.x, p.y)} trať ${line[1]}: kolej končí zarážedlem`); continue; }
            if (lines.some(t => t.end === end)) { errors.push(`${at(p.x, p.y)} na jednom konci koleje jsou dvě tratě`); continue; }
            lines.push({ label: line[1], name: line[2] || line[1], end });
            if (!line[2]) warnings.push(`${at(p.x, p.y)} trať ${line[1]} nemá jméno sousední stanice (např. "L ${line[1]} Kamenice")`);
        } else {
            // "1", "3a", "K. 5", "K5", "kol. 3", "Kolej 3a", "5. kolej"
            const n = p.text.match(/^(?:k(?:ol(?:ej)?)?\.?\s*)?(\d+[a-z]?)$/i) || p.text.match(/^(\d+[a-z]?)\.?\s*k(?:ol(?:ej)?)?\.?$/i);
            if (n) p.number = n[1];
        }
    }
    // the same line (label and station) at two track ends = a double-track line: two line tracks, numbered from the
    // top; trains depart on the right-hand track in the direction of travel, enter on every track with an entry signal
    const allX = [...cells.values()].map(c => c.x);
    const centre = (Math.min(...allX) + Math.max(...allX)) / 2;
    for (const t of lines) {
        const same = lines.filter(u => u.label === t.label);
        const twin = same.filter(u => u.name === t.name).sort((a, b) => a.end.y - b.end.y);
        t.id = same.length === 1 ? t.label : t.label + '_' + slug(t.name);
        t.code = t.label;
        if (twin.length > 1) {
            const i = twin.indexOf(t);
            t.id += (same.length === twin.length ? '_' : '') + (i + 1);
            t.code = t.label + '/' + (i + 1);
            const left = t.end.x < centre;
            // departing to the left the right-hand track is the upper one, to the right the lower one
            t.exitTrack = t === (left ? twin[0] : twin[twin.length - 1]);
            if (twin.length > 2) errors.push(`${at(t.end.x, t.end.y)} trať ${t.label} ${t.name} má víc než dvě traťové koleje`);
        }
    }
    if (!boxes.length) {
        boxes.push({ id: 'ST1', name: 'Stavědlo 1', x: null, y: null, whole: true });
        warnings.push('V kolejišti není popisek stavědla: celou stanici obsluhuje jedno stavědlo ST1. ' +
            'Pro dvě stavědla dejte ke zhlavím popisky "L ST1" a "L ST2".');
    }
    // signal boxes in the order of the settings, otherwise by number (ST1, ST2 …); names and indicators from the settings
    const boxCfg = id => (sc.stavedla && sc.stavedla[id]) || {};
    boxes.sort((a, b) => (boxCfg(a.id).poradi ?? 1e9) - (boxCfg(b.id).poradi ?? 1e9) || natural(a.id, b.id));
    for (const b of boxes) {
        b.autoName = b.name;
        if (boxCfg(b.id).nazev) b.name = boxCfg(b.id).nazev;
        if (boxCfg(b.id).kontrolkyIK) b.indicators = boxCfg(b.id).kontrolkyIK;
    }
    // lines: name of the neighbouring station and the texts of the plates from the settings
    for (const t of lines) {
        const o = (sc.trate && sc.trate[t.id]) || {};
        t.autoName = t.name;
        t.twin = lines.filter(u => u.label === t.label && u.name === t.name).length > 1;
        t.autoExit = t.exitTrack;
        if (o.nazev) t.name = o.nazev;
        t.fromText = o.od || 'z ' + t.name;
        t.toText = o.do || 'do ' + t.name;
        t.shortName = o.zkratka || null;
        if (o.odjezd === false) t.exitTrack = false;
        else if (o.odjezd === true) t.exitTrack = true;
    }

    const trackNumbers = new Map(); // edge -> number (main tracks)
    const labelNumbers = new Map(); // edge -> number written at it (also a track that is not a main track)
    for (const p of labels.filter(p => p.number)) {
        // the nearest track; at the same distance the one below the label (numbers are written above the track)
        let e = null, best = 4;
        for (const ed of edges) {
            for (const [x, y] of ed.points) {
                const dist = Math.max(Math.abs(x - p.x), Math.abs(y - p.y)) + (y > p.y ? 0 : 0.5);
                if (dist < best) { best = dist; e = ed; }
            }
        }
        if (!e) { warnings.push(`${at(p.x, p.y)} popisek ${p.number} nestojí u žádné koleje`); continue; }
        if (trackNumbers.has(e) && trackNumbers.get(e) !== p.number) {
            errors.push(`${at(p.x, p.y)} kolej má dvě čísla: ${trackNumbers.get(e)} a ${p.number}`);
            continue;
        }
        if ([...trackNumbers.entries()].some(([ed, n]) => n === p.number && ed !== e)) {
            errors.push(`${at(p.x, p.y)} číslo koleje ${p.number} je použité dvakrát`);
            continue;
        }
        trackNumbers.set(e, p.number);
        labelNumbers.set(e, p.number);
    }
    // a numbered track that is not a main track in the settings (e.g. a connecting track): routes run over it
    for (const [e, n] of [...trackNumbers]) if (sc.koleje && sc.koleje[n] && sc.koleje[n].dopravni === false) trackNumbers.delete(e);

    // ---------- 6. assignment to signal boxes (nearest along the tracks) ----------
    const assignment = {};
    const distance = new Map(); // cell key -> [distance, box]
    const queue = [];
    for (const s of boxes) {
        if (s.whole) continue;
        for (const c of cells.values()) {
            const v = Math.max(Math.abs(c.x - s.x), Math.abs(c.y - s.y));
            if (v <= 4) queue.push([v, c, s.id]);
        }
        if (!queue.some(f => f[2] === s.id)) errors.push(`${at(s.x, s.y)} popisek ${s.id} nestojí u koleje`);
    }
    queue.sort((a, b) => a[0] - b[0]);
    while (queue.length) {
        const [v, c, box] = queue.shift();
        const k = key(c.x, c.y);
        if (distance.has(k) && distance.get(k)[0] <= v) continue;
        distance.set(k, [v, box]);
        for (const d of c.dirs) {
            const [dx, dy] = DIRS[d];
            const n = cells.get(key(c.x + dx, c.y + dy));
            if (n && n.dirs.includes(OPPOSITE[d])) {
                const nk = key(n.x, n.y);
                if (!distance.has(nk) || distance.get(nk)[0] > v + 1) {
                    const i = queue.findIndex(f => f[0] > v + 1); // the queue is small, insert in place
                    queue.splice(i < 0 ? queue.length : i, 0, [v + 1, n, box]);
                }
            }
        }
    }
    for (const c of cells.values()) {
        if (c.type === 'track') continue;
        const box = (distance.get(key(c.x, c.y)) || [])[1] || (boxes.length === 1 && boxes[0].whole ? boxes[0].id : undefined);
        if (!box && boxes.length) errors.push(`${at(c.x, c.y)} ${typeName(c)} ${c.name}: žádné stavědlo k němu nevede po kolejích`);
        c.box = box;
        c.autoBox = box;
        // signal box chosen in the settings
        const want = c.name && cfg(c.name).stavedlo;
        if (want && want !== box) {
            if (boxes.some(b => b.id === want)) c.box = want;
            else warnings.push(`${at(c.x, c.y)} ${typeName(c)} ${c.name}: stavědlo ${want} z nastavení v kolejišti není, platí ${box}`);
        }
        if (c.name) assignment[typeName(c) + ' ' + c.name] = c.box;
    }

    // ---------- 7. names, duplicates ----------
    for (const type of ['switch', 'signal', 'distant', 'crossing']) {
        const seen = new Map();
        for (const c of cells.values()) {
            if (c.type !== type) continue;
            if (!c.name) { errors.push(`${at(c.x, c.y)} ${typeName(c)} nemá název`); continue; }
            // a crossing drawn on several tracks under the same name is one crossing over all of them
            if (seen.has(c.name) && type !== 'crossing') errors.push(`${at(c.x, c.y)} ${typeName(c)} ${c.name} je v kolejišti dvakrát (také ${seen.get(c.name)})`);
            seen.set(c.name, at(c.x, c.y));
        }
    }
    for (const c of cells.values()) {
        if (c.type === 'signal' && c.kind === 'main' && /^(Pr|Se)/.test(c.name)) {
            warnings.push(`${at(c.x, c.y)} návěstidlo ${c.name} má předponu ${c.name.slice(0, 2)}, ale symbol hlavního návěstidla`);
        }
    }

    // ---------- 8. track ids ----------
    let counter = 0;
    for (const e of edges) {
        const line = lines.find(t => t.end === e.a || t.end === e.b);
        if (labelNumbers.has(e)) e.id = 'k' + labelNumbers.get(e);
        else if (line) e.id = 't_' + line.id;
        else e.id = 'u' + (++counter);
    }

    // ---------- 9. signals: track they stand on and their kind ----------
    const signals = [...cells.values()].filter(c => c.type === 'signal');
    for (const c of signals) {
        const e = edgeAt(c, OPPOSITE[c.dir]); // track before the signal (where trains come from)
        if (!e) continue;
        c.track = e;
        if (c.kind === 'main') c.entry = !!lineBehind(c, e);
    }
    function lineBehind(c, e) {
        // against the signal direction, without a switch or another main signal, to the end of a line
        let node = c, edge = e;
        for (let i = 0; i < 1000; i++) {
            const next = other(edge, node);
            const line = lines.find(t => t.end === next);
            if (line) return line;
            if (next.type === 'switch' || (next.type === 'signal' && next.kind === 'main') || isEnd(next)) return null;
            const out = next.dirs.find(s => s !== entryInto(edge, node));
            node = next;
            edge = edgeAt(next, out);
            if (!edge) return null;
        }
        return null;
    }

    // ---------- 10. kinds of main signals ----------
    // automatic kind, the settings may change it ("druh"): vjezdové (a line behind it), odjezdové, skupinové (stands in
    // the switch zone, valid for several tracks), cestové (Sc / Lc: repeats the next main signal), vložené (VS / VL on a
    // track under a group signal), vnitřní (e.g. S3a: its trains go on only past another main signal; no routes)
    const turnedBack = new Map();
    const overTrack = new Map(); // exit signal -> main tracks its routes would cross without a signal at their end
    let permissive = false;      // search also over main tracks: which lines the signal would reach that way
    const horizontal = d => (d === 'E' || d === 'W' ? d : null);
    let inner = new Set();
    const mains = signals.filter(c => c.kind === 'main' && c.track);
    for (const c of mains) c.autoKind = c.entry ? 'vjezdove' : /^(Sc|Lc)/.test(c.name) ? 'cestove' : /^(VS|VL)/.test(c.name) ? 'vlozene' : 'odjezdove';
    for (const c of mains.filter(c => c.autoKind === 'odjezdove')) {
        const targets = new Map();
        search(c, c.dir, new Set(), targets, false, [], c);
        if (targets.size && [...targets.values()].every(t => !t.direct)) c.autoKind = 'vnitrni';
    }
    turnedBack.clear(); overTrack.clear();
    for (const c of mains) {
        c.behind = c.autoKind === 'vjezdove' || trackNumbers.has(c.track) ? [] : tracksBehind(c);
        if (c.autoKind === 'odjezdove' && c.behind.length) c.autoKind = 'skupinove';
        const want = cfg(c.name).druh;
        c.sigKind = want && SIGNAL_KINDS.includes(want) ? want : c.autoKind;
        c.entry = c.sigKind === 'vjezdove';
        if (c.entry && !lineBehind(c, c.track)) warnings.push(`${at(c.x, c.y)} vjezdové návěstidlo ${c.name}: za ním není trať (bez výhybky a jiného hlavního návěstidla)`);
    }
    inner = new Set(mains.filter(c => c.sigKind === 'vnitrni').map(c => c.name));

    /**
     * Main tracks a group exit signal in the switch zone is valid for: against its direction, the first numbered track
     * on every branch. A track with its own inserted / route signal in front of the group signal (VS, Sc) is "by" it.
     */
    function tracksBehind(c) {
        const out = [];
        const walk = (node, dir, visited) => {
            const e = edgeAt(node, dir);
            if (!e || visited.has(e)) return;
            visited = new Set(visited).add(e);
            if (e !== c.track && trackNumbers.has(e)) { if (!out.some(b => b.edge === e)) out.push({ edge: e, by: null }); return; }
            const n = other(e, node), into = entryInto(e, node);
            if (n.type === 'signal' && n.kind === 'main' && n.dir === c.dir) {
                const own = edgeAt(n, OPPOSITE[n.dir]);
                if (own && trackNumbers.has(own) && !out.some(b => b.edge === own)) out.push({ edge: own, by: n.name });
                return;
            }
            if (n.type === 'switch') {
                if (into === n.point) { walk(n, n.normal, visited); walk(n, n.reverse, visited); }
                else walk(n, n.point, visited);
                return;
            }
            if (n.dirs.length === 2 && !isEnd(n)) walk(n, n.dirs.find(s => s !== into), visited);
        };
        walk(c, OPPOSITE[c.dir], new Set());
        return out;
    }

    // ---------- 11. train routes ----------
    // an exit route continues past a main signal in its direction (route signals Sc / Lc before a group exit
    // signal, ORMS "repeater"); the signals it passes show the route too (mijene = main signals the route may pass).
    // An inner main signal has no routes, point lock or signal block of its own: entry routes pass it.
    // A group exit signal in the switch zone has a route from every track it is valid for ("z" = start track), except
    // the tracks with their own inserted / route signal. A route that turns back to the other end of the station (a
    // switch drawn the wrong way round) is not a route: it is reported instead.
    const lineUse = new Map(lines.map(t => [t, { entry: false, exit: false }]));
    const found = [];
    const routeList = [];  // every route the layout gives: {key, od, z, na, mijene, auto}
    const off = new Set((sc.cesty && sc.cesty.vypnute) || []);
    for (const c of mains) {
        if (c.sigKind === 'vnitrni') continue;
        if (c.entry) { const line = lineBehind(c, c.track); if (line) lineUse.get(line).entry = true; }
        const targets = new Map();
        search(c, c.dir, new Set(), targets, c.entry, [], c);
        found.push({ c, targets });
        let starts = [null];
        if (c.sigKind === 'skupinove' && !trackNumbers.has(c.track)) {
            const want = cfg(c.name).koleje;
            const free = c.behind.filter(b => !b.by);
            starts = Array.isArray(want) ? free.filter(b => want.map(String).includes(labelNumbers.get(b.edge))).map(b => b.edge) : free.map(b => b.edge);
            if (Array.isArray(want)) {
                // ["-"] = the settings switched all tracks off
                for (const n of want) if (n !== '-' && !free.some(b => labelNumbers.get(b.edge) === String(n))) {
                    warnings.push(`${at(c.x, c.y)} skupinové návěstidlo ${c.name}: kolej ${n} pod ním není (nebo má vlastní vložené / cestové návěstidlo)`);
                }
            }
            if (!starts.length) continue; // every track has its own signal (VS / Sc): no routes of its own
        }
        if (!targets.size) {
            warnings.push(`${at(c.x, c.y)} od návěstidla ${c.name} nevede žádná vlaková cesta ` + (c.entry ? '(na číslovanou dopravní kolej)' : 'na trať, zůstane na Stůj'));
            continue;
        }
        for (const z of starts) {
            for (const [id, t] of targets) {
                const k = routeKey(c.name, z && z.id, id);
                routeList.push({ key: k, od: c.name, z: z ? z.id : null, na: id, mijene: [...new Set(t.passed)], auto: true, off: off.has(k) });
            }
        }
    }
    for (const r of (sc.cesty && sc.cesty.pridane) || []) {
        const k = routeKey(r.od, r.z || null, r.na);
        if (routeList.some(x => x.key === k)) continue;
        routeList.push({ key: k, od: r.od, z: r.z || null, na: r.na, mijene: r.mijene || [], auto: false, off: off.has(k) });
    }
    const pres = (sc.cesty && sc.cesty.pres) || {};
    const routes = [];
    for (const r of routeList) {
        if (r.off) continue;
        // routes of one signal from one track with the same passed signals and forced positions form one record
        const via = pres[r.key];
        const rec = routes.find(x => x.od === r.od && (x.z || null) === r.z && JSON.stringify(x.mijene || []) === JSON.stringify(r.mijene)
            && JSON.stringify(x.pres || null) === JSON.stringify(via || null));
        if (rec) { rec.na = [].concat(rec.na, r.na); continue; }
        const out = { od: r.od };
        if (r.z) out.z = r.z;
        out.na = r.na;
        if (r.mijene.length) out.mijene = r.mijene;
        if (via && Object.keys(via).length) out.pres = via;
        routes.push(out);
        const l = lines.find(t => t.id === r.na);
        if (l) lineUse.get(l).exit = true;
    }
    for (const r of routes) if (Array.isArray(r.na) && r.na.length === 1) r.na = r.na[0];

    function search(node, dir, visited, targets, entry, passed, start) {
        const add = id => {
            if (!targets.has(id)) targets.set(id, { direct: false, passed: [] });
            const t = targets.get(id);
            if (!passed.length) t.direct = true;
            t.passed.push(...passed);
        };
        const e = edgeAt(node, dir);
        if (!e || visited.has(e)) return;
        visited = new Set(visited).add(e);
        const next = other(e, node);
        const into = entryInto(e, node);
        const line = lines.find(t => t.end === next);
        if (line) {
            // double-track line: departures only on the right-hand track
            const back = horizontal(start.dir) && (start.dir === 'W') !== (line.end.x < centre);
            if (!entry && back) turnedBack.set(start.name, line.name);
            else if (!entry && line.exitTrack !== false) add(line.id);
            return;
        }
        // an entry route ends on the first numbered (main) track it runs onto, also when no signal stands at its end
        // (tracks under a group exit signal); a signal at the end is handled below (inner signals are passed)
        if (entry && trackNumbers.has(e) && !(next.type === 'signal' && next.kind === 'main' && next.dir === OPPOSITE[into])) {
            const travel = OPPOSITE[into];
            if (horizontal(start.dir) && horizontal(travel) && start.dir !== travel) { turnedBack.set(start.name, 'kolej ' + trackNumbers.get(e)); return; }
            add(e.id);
            return;
        }
        // an exit route does not run over another main track of the station (StavedloSim), only up to a signal at its
        // end that it passes (a group or inner signal)
        if (!permissive && !entry && trackNumbers.has(e) && e !== start.track && !(next.type === 'signal' && next.kind === 'main' && next.dir === OPPOSITE[into])) {
            if (!overTrack.has(start.name)) overTrack.set(start.name, new Set());
            overTrack.get(start.name).add(trackNumbers.get(e));
            return;
        }
        if (next.type === 'signal' && next.kind === 'main' && next.dir === OPPOSITE[into]) {
            // a signal in the direction of travel: an entry route ends here on its track, an exit route passes it
            if (entry) {
                if (horizontal(start.dir) && horizontal(next.dir) && start.dir !== next.dir) { turnedBack.set(start.name, 'kolej ' + (trackNumbers.get(e) || e.id)); return; }
                if (trackNumbers.has(e)) add(e.id);
                // an inner main signal: the entry route may go on past it to the next tracks
                if (inner.has(next.name) && next.dirs.length === 2) search(next, next.dirs.find(s => s !== into), visited, targets, entry, passed.concat(next.name), start);
                return;
            }
            if (next.dirs.length === 2) search(next, next.dirs.find(s => s !== into), visited, targets, entry, passed.concat(next.name), start);
            return;
        }
        if (next.type === 'switch') {
            if (into === next.point) { search(next, next.normal, visited, targets, entry, passed, start); search(next, next.reverse, visited, targets, entry, passed, start); }
            else search(next, next.point, visited, targets, entry, passed, start);
            return;
        }
        if (next.dirs.length === 2 && !isEnd(next)) search(next, next.dirs.find(s => s !== into), visited, targets, entry, passed, start);
        // a numbered track ending freely continues outside the drawing (only one station end is drawn)
        else if (isEnd(next) && entry && trackNumbers.has(e)) add(e.id);
    }

    // reported only when a line cannot be reached because of a main track on the way
    for (const [name, tracks] of overTrack) {
        const f = found.find(x => x.c.name === name);
        if (!f || inner.has(name)) continue;
        const all = new Map();
        permissive = true;
        search(f.c, f.c.dir, new Set(), all, false, [], f.c);
        permissive = false;
        const missing = [...all.keys()].filter(id => !f.targets.has(id)).map(id => lines.find(t => t.id === id)).filter(Boolean);
        if (!missing.length) continue;
        warnings.push(`${at(f.c.x, f.c.y)} odjezd od návěstidla ${name} do ${missing.map(t => t.name).join(', ')} by vedl přes dopravní kolej ` +
            `${[...tracks].join(', ')}; vlaková cesta přes jinou dopravní kolej v EMZZ nejde – na konec té koleje dejte odjezdové návěstidlo, ` +
            `nebo v nastavení SignalCraftu (Koleje) kolej označte jako nedopravní`);
    }
    for (const [name, where] of turnedBack) {
        const c = signals.find(x => x.name === name);
        warnings.push(`${at(c.x, c.y)} od návěstidla ${name} by vlaková cesta vedla zpět na druhý konec stanice (${where}); ` +
            'nejspíš je některá výhybka nakreslená obráceně (hrot na špatné straně), taková cesta se nevytvoří');
    }

    // ---------- 12. checks of lines and tracks ----------
    for (const t of lines) {
        const u = lineUse.get(t);
        if (!u.entry && !u.exit) warnings.push(`${at(t.end.x, t.end.y)} trať ${t.id}: nevede na ni ani z ní žádná vlaková cesta`);
        t.traffic = u.entry && u.exit ? 'oba' : u.entry ? 'vjezd' : u.exit ? 'odjezd' : 'oba';
    }
    for (const v of freeEnds) {
        const e = edges.find(e => e.a === v.c || e.b === v.c);
        if (!v.c.broken && !lines.some(t => t.end === v.c) && !(e && trackNumbers.has(e))) {
            warnings.push(`${at(v.c.x, v.c.y)} kolej končí bez zarážedla a bez trati; bere se jako kusá kolej`);
        }
    }
    if (!lines.length) errors.push('V kolejišti není žádná trať: dejte k volnému konci koleje popisek "L T1 Jméno stanice"');

    // ---------- crossovers: two switches joined directly by their reverse branches are thrown together ----------
    // (spřažené výhybky, one point lever; otherwise a train could run from one track into the other's flank)
    const coupledAuto = [];
    // the diverging branch is the one not opposite the point (the "+" glyph of ORMS may be the curved one)
    const diverging = c => { const d = [c.normal, c.reverse].filter(x => x !== OPPOSITE[c.point]); return d.length === 1 ? d[0] : null; };
    for (const a of cells.values()) {
        if (a.type !== 'switch' || !diverging(a)) continue;
        const e = edgeAt(a, diverging(a));
        const b = e && other(e, a);
        if (!b || b.type !== 'switch' || b === a || !diverging(b) || edgeAt(b, diverging(b)) !== e || a.name > b.name) continue;
        coupledAuto.push([a.name, b.name]);
    }
    // the settings may add couplings and drop the automatic ones
    const pairKey = p => [...p].sort(natural).join('/');
    const dropped = new Set(((sc.sprazene && sc.sprazene.odebrat) || []).map(pairKey));
    const coupled = coupledAuto.filter(p => !dropped.has(pairKey(p)));
    const switchNames = new Set([...cells.values()].filter(c => c.type === 'switch').map(c => c.name));
    for (const p of (sc.sprazene && sc.sprazene.pridat) || []) {
        if (p.some(n => !switchNames.has(n))) { warnings.push(`spřažení ${p.join('/')} z nastavení: výhybka ${p.find(n => !switchNames.has(n))} v kolejišti není`); continue; }
        if (!coupled.some(q => pairKey(q) === pairKey(p))) coupled.push([...p]);
    }
    for (const [an, bn] of coupled) {
        const a = [...cells.values()].find(c => c.type === 'switch' && c.name === an), b = [...cells.values()].find(c => c.type === 'switch' && c.name === bn);
        if (a.box === b.box) continue;
        if (cfg(an).stavedlo || cfg(bn).stavedlo) {
            errors.push(`${at(b.x, b.y)} spřažené výhybky ${an}/${bn} mají jednu výměnovou kličku, musí patřit jednomu stavědlu (nastaveno ${a.box} a ${b.box})`);
            continue;
        }
        // one lever: both belong to the signal box of the first one
        b.box = a.box;
        assignment[typeName(b) + ' ' + b.name] = a.box;
    }

    // ---------- what the settings show: every element with its automatic and chosen values ----------
    const crossingNames = [...new Set([...cells.values()].filter(c => c.type === 'crossing').map(c => c.name))];
    // a main signal: only for trains (no shunt lever) or for trains and shunting (shunt lever with a red plate);
    // automatically an entry or inner signal is only for trains, the others for both (as StavedloSim)
    function autoValidity(c) { return c.look === 'shunt' ? 'posun' : c.sigKind === 'vjezdove' || c.sigKind === 'vnitrni' ? 'vlak' : 'oba'; }
    function validity(c) { const v = cfg(c.name).platnost; return v === 'vlak' || v === 'oba' ? v : c.look === 'shunt' ? 'oba' : autoValidity(c); }
    const info = {
        boxes: boxes.map(b => ({ id: b.id, name: b.name, autoName: b.autoName, indicators: b.indicators || 'pristroj' })),
        signals: mains.map(c => ({
            name: c.name, x: c.x, y: c.y, box: c.box, autoBox: c.autoBox, kind: c.sigKind, autoKind: c.autoKind,
            behind: (c.behind || []).map(b => ({ number: labelNumbers.get(b.edge), by: b.by })),
            tracks: cfg(c.name).koleje || null, validity: validity(c), autoValidity: autoValidity(c),
        })).sort((a, b) => natural(a.name, b.name)),
        shunts: signals.filter(c => c.kind === 'shunt').map(c => ({
            name: c.name, x: c.x, y: c.y, box: c.box, autoBox: c.autoBox, validity: 'posun', autoValidity: c.look === 'shunt' ? 'posun' : 'oba',
        })).sort((a, b) => natural(a.name, b.name)),
        switches: [...cells.values()].filter(c => c.type === 'switch').map(c => ({
            name: c.name, x: c.x, y: c.y, box: c.box, autoBox: c.autoBox, swapped: c.swapped, speed: cfg(c.name).rychlost || null,
            plus: c.normal === OPPOSITE[c.point] ? 'přímo' : 'do odbočky', minus: c.reverse === OPPOSITE[c.point] ? 'přímo' : 'do odbočky',
        })).sort((a, b) => natural(a.name, b.name)),
        crossings: crossingNames.map(n => { const c = [...cells.values()].find(x => x.type === 'crossing' && x.name === n); return { name: n, x: c.x, y: c.y, box: c.box, autoBox: c.autoBox }; }),
        tracks: [...labelNumbers].map(([e, n]) => ({ number: n, main: trackNumbers.has(e), x: e.points[1] ? e.points[1][0] : e.a.x, y: e.points[1] ? e.points[1][1] : e.a.y }))
            .sort((a, b) => natural(a.number, b.number)),
        lines: lines.map(t => ({
            id: t.id, code: t.code, name: t.name, autoName: t.autoName, fromText: t.fromText, toText: t.toText, shortName: t.shortName,
            twin: t.twin, exit: t.exitTrack !== false, autoExit: t.autoExit !== false, x: t.end.x, y: t.end.y,
        })),
        routes: routeList, coupledAuto, coupled,
        trackName: id => { const e = edges.find(x => x.id === id); return e && labelNumbers.has(e) ? labelNumbers.get(e) : id; },
        lineName: id => { const l = lines.find(t => t.id === id); return l ? l.name : null; },
    };

    if (errors.length) return { station: null, errors, warnings, assignment, info, model: null };

    // ---------- 13. output in the StavedloSim format ----------
    const xs = [...cells.values()].map(c => c.x);
    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    const nodeIds = {};
    for (const [k, id] of nodes) { const [x, y] = k.split(',').map(Number); nodeIds[id] = [x, y]; }
    const name = (sc.stanice && sc.stanice.nazev) || options.name || 'Stanice';
    const station = {
        id: options.id || slug(name),
        nazev: name,
        popis: 'Export z ORMS Layout Generatoru pro SignalCraft',
        zz: 'EMZZ',
        meritko: METRES_PER_CELL,
        stavedla: boxes.map(s => ({ id: s.id, nazev: s.name, ...(s.indicators ? { kontrolkyIK: s.indicators } : {}) })),
        vyhybkarskeOkruhy: [boxes.map(s => s.id)],
        uzly: nodeIds,
        koleje: edges.map(e => {
            const k = { id: e.id, z: nodes.get(key(e.a.x, e.a.y)), do: nodes.get(key(e.b.x, e.b.y)), delka: e.cells * METRES_PER_CELL };
            if (e.points.length > 2) k.body = e.points.slice(1, -1);
            if (trackNumbers.has(e)) k.cislo = trackNumbers.get(e);
            else if (labelNumbers.has(e)) k.oznaceni = labelNumbers.get(e);
            return k;
        }),
        vyhybky: [...cells.values()].filter(c => c.type === 'switch').map(c => ({
            id: c.name, uzel: nodes.get(key(c.x, c.y)),
            hrot: edgeAt(c, c.point).id, plus: edgeAt(c, c.normal).id, minus: edgeAt(c, c.reverse).id,
            stavedlo: c.box, ...(c.inverted ? { invertovana: true } : {}), ...(cfg(c.name).rychlost ? { rychlost: +cfg(c.name).rychlost } : {}),
        })),
        sprazene: coupled,
        trate: lines.map(t => {
            const e = edges.find(e => e.a === t.end || e.b === t.end);
            return {
                id: t.id, oznaceni: t.code, uzel: nodes.get(key(t.end.x, t.end.y)), kolej: e.id, nazev: t.name,
                od: t.fromText, do: t.toText, ...(t.shortName ? { zkratka: t.shortName } : {}), strana: t.end.x < middle ? 'L' : 'S', provoz: t.traffic,
            };
        }),
        navestidla: [], posunova: [], predvesti: [],
        prejezdy: crossingNames.map(name => {
            const parts = [...cells.values()].filter(c => c.type === 'crossing' && c.name === name);
            return {
                id: name, nazev: 'Přejezd ' + name, x: parts[0].x,
                koleje: edges.filter(e => e.crossings.some(c => parts.includes(c))).map(e => e.id), stavedlo: parts[0].box,
            };
        }),
        cesty: routes,
    };
    for (const c of signals.filter(c => c.track)) {
        const rec = { id: c.name, uzel: nodes.get(key(c.x, c.y)), kolej: c.track.id, stavedlo: c.box };
        if (c.kind === 'main') station.navestidla.push({ ...rec, typ: c.entry ? 'vjezdove' : 'odjezdove', druh: c.sigKind, platnost: validity(c) });
        else if (c.kind === 'shunt') station.posunova.push(rec);
    }
    for (const e of edges) {
        for (const c of e.distants) {
            station.predvesti.push({ id: c.name, patri: c.name.replace(/^Pr/, ''), kolej: e.id, x: c.x, y: c.y, smer: c.dir, stavedlo: c.box });
        }
    }
    const mainNames = new Set(station.navestidla.map(n => n.id));
    for (const p of station.predvesti) {
        if (!mainNames.has(p.patri)) warnings.push(`předvěst ${p.id}: v kolejišti není hlavní návěstidlo ${p.patri}`);
    }

    // ---------- 14. the station loaded as SignalCraft loads it ----------
    const model = buildModel(station);
    if (model.errors.length) {
        for (const m of model.errors) errors.push('SignalCraft: ' + m);
        return { station: null, errors, warnings, assignment, info, model };
    }
    // a route over switches of other signal boxes: each of them locks its part (information)
    const notes = [];
    for (const r of model.st.routes.values()) {
        if (r.helpers.length) notes.push(`cesta ${r.name} vede i přes výhybky ${r.helpers.join(', ')}: to stavědlo je zamkne kolejovým závěrníkem a dá souhlasovým hradlem souhlas ${r.box}; bez souhlasu ${r.box} neuzavře závěr výměn`);
    }
    return { station, errors, warnings, notes, assignment, info, model };
}

function parseCell(t, x, y, errors) {
    if (t.length > 2 && t[0] === 'L' && t[1] === ' ') return { type: 'label', text: t.slice(2).trim(), x, y };
    if (t.length > 2 && (t[2] === 'V' || t[2] === 'I')) {
        const a = TRACK[t[0]], b = TRACK[t[4]];
        const name = t.slice(6).trim();
        if (!a || !b || a === b) { errors.push(`${at(x, y)} výhybka ${name}: neplatné symboly "${t[0]}" a "${t[4]}"`); return null; }
        const common = [...a].filter(s => b.includes(s));
        if (common.length !== 1) { errors.push(`${at(x, y)} výhybka ${name}: symboly "${t[0]}" a "${t[4]}" nemají právě jeden společný konec (hrot)`); return null; }
        const point = common[0];
        let normal = [...a].find(s => s !== point), reverse = [...b].find(s => s !== point);
        // in ORMS the first symbol is the "+" position; for the interlocking "+" is the straight track and "−" the
        // diverging one (whatever order the symbols are in), so that a crossover is thrown by one lever ("−" both)
        // and a SignalCraft switch is straight in its normal position; a symmetric switch keeps the ORMS order
        const straight = { N: 'S', S: 'N', E: 'W', W: 'E' }[point];
        if (reverse === straight && normal !== straight) [normal, reverse] = [reverse, normal];
        return { type: 'switch', name, point, normal, reverse, dirs: [point, normal, reverse], inverted: t[2] === 'I', x, y };
    }
    if (t.length > 2 && t[2] === 'N') {
        const s = SIGNAL[t[0]];
        const name = t.slice(4).trim();
        if (!s) { errors.push(`${at(x, y)} návěstidlo ${name}: neznámý symbol směru "${t[0]}"`); return null; }
        return { type: s[1] === 'distant' ? 'distant' : 'signal', name, dir: s[0], kind: s[1], dirs: [...AXIS[s[0]]], x, y };
    }
    if (t.length > 2 && t[2] === 'P') {
        const name = t.slice(6).trim();
        if (!CROSSING[t[0]]) { errors.push(`${at(x, y)} přejezd ${name}: neznámý symbol "${t[0]}"`); return null; }
        return { type: 'crossing', name, dirs: [...CROSSING[t[0]]], x, y };
    }
    if (t.length === 1) {
        if (TRACK[t]) return { type: 'track', dirs: [...TRACK[t]], x, y };
        if (BUFFER[t]) return { type: 'track', dirs: [BUFFER[t]], buffer: true, x, y };
        if (FIXED_JUNCTION.has(t)) {
            errors.push(`${at(x, y)} pevné rozvětvení "${t}" bez výhybky: v EMZZ se nedá stavět cesta, použijte výhybku`);
            return null;
        }
    }
    errors.push(`${at(x, y)} neznámý obsah buňky "${t}"`);
    return null;
}

function nearest(list, p, max) {
    let best = null, d0 = max + 1;
    for (const c of list) {
        const d = Math.max(Math.abs(c.x - p.x), Math.abs(c.y - p.y));
        if (d < d0) { d0 = d; best = c; }
    }
    return best;
}

function typeName(c) {
    return { switch: 'výhybka', signal: 'návěstidlo', distant: 'předvěst', crossing: 'přejezd', track: 'kolej' }[c.type];
}

function slug(s) {
    return s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'stanice';
}
