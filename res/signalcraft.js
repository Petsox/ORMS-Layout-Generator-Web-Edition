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
const at = (x, y) => `[sloupec ${x + 1}, řádek ${y + 1}]`;

/**
 * @param {string[][]} grid  cell texts by rows (grid[row][column])
 * @param {{name?: string, id?: string}} options
 * @returns {{station: object|null, errors: string[], warnings: string[], assignment: object}}
 */
export function convertToStation(grid, options = {}) {
    const errors = [], warnings = [];
    const cells = new Map();   // key -> track cell
    const labels = [];

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

    const trackNumbers = new Map(); // edge -> number
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
    }

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
        if (c.name) assignment[typeName(c) + ' ' + c.name] = box;
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
        if (trackNumbers.has(e)) e.id = 'k' + trackNumbers.get(e);
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

    // ---------- 10. train routes ----------
    const routes = [];
    const lineUse = new Map(lines.map(t => [t, { entry: false, exit: false }]));
    // an exit route continues past a main signal in its direction (route signals Sc / Lc before a group exit
    // signal, ORMS "repeater"); the signals it passes show the route too (mijene = main signals the route may pass)
    // An inner main signal (e.g. S3a at the end of track 3a, its trains go on only past another main signal) has no
    // routes, point lock or signal block of its own: entry routes pass it and it shows their aspect.
    // a route that turns back to the other end of the station (a switch drawn the wrong way round, its point on the
    // other side) is not a route: it is reported instead
    const turnedBack = new Map();
    const horizontal = d => (d === 'E' || d === 'W' ? d : null);
    const found = [];
    let inner = new Set();
    const mains = signals.filter(c => c.kind === 'main' && c.track);
    for (const c of mains.filter(c => !c.entry)) {
        const targets = new Map();
        search(c, c.dir, new Set(), targets, false, [], c);
        found.push({ c, targets });
    }
    for (const { c, targets } of found) {
        if (!/^(Sc|Lc|VS|VL)/.test(c.name) && targets.size && [...targets.values()].every(t => !t.direct)) inner.add(c.name);
    }
    for (const c of mains.filter(c => c.entry)) {
        const targets = new Map();
        const line = lineBehind(c, c.track);
        if (line) lineUse.get(line).entry = true;
        search(c, c.dir, new Set(), targets, true, [], c);
        found.push({ c, targets });
    }
    // exits of inner signals are not routes: the lines are used only by the real routes
    for (const t of lines) lineUse.get(t).exit = false;
    for (const { c, targets } of found) {
        if (c.entry || inner.has(c.name)) continue;
        for (const id of targets.keys()) { const l = lines.find(t => t.id === id); if (l) lineUse.get(l).exit = true; }
    }
    // a group exit signal standing in the switch zone, passed by the routes of route signals, has no routes of its own
    // (no train can stand in front of it)
    const passedAll = new Set();
    for (const f of found) if (!inner.has(f.c.name)) for (const t of f.targets.values()) for (const n of t.passed) passedAll.add(n);
    for (const { c, targets } of found) {
        if (inner.has(c.name)) continue;
        if (passedAll.has(c.name) && !trackNumbers.has(c.track)) continue;
        const to = [...targets.keys()];
        if (!to.length) {
            warnings.push(`${at(c.x, c.y)} od návěstidla ${c.name} nevede žádná vlaková cesta ` +
                (c.entry ? '(na číslovanou dopravní kolej)' : 'na trať, zůstane na Stůj'));
            continue;
        }
        const r = { od: c.name, na: to.length === 1 ? to[0] : to };
        const passed = [...new Set([...targets.values()].flatMap(t => t.passed))];
        if (passed.length) r.mijene = passed;
        routes.push(r);
    }
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

    for (const [name, where] of turnedBack) {
        const c = signals.find(x => x.name === name);
        warnings.push(`${at(c.x, c.y)} od návěstidla ${name} by vlaková cesta vedla zpět na druhý konec stanice (${where}); ` +
            'nejspíš je některá výhybka nakreslená obráceně (hrot na špatné straně), taková cesta se nevytvoří');
    }

    // ---------- 11. checks of lines and tracks ----------
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
    const coupled = [];
    // the diverging branch is the one not opposite the point (the "+" glyph of ORMS may be the curved one)
    const diverging = c => { const d = [c.normal, c.reverse].filter(x => x !== OPPOSITE[c.point]); return d.length === 1 ? d[0] : null; };
    for (const a of cells.values()) {
        if (a.type !== 'switch' || !diverging(a)) continue;
        const e = edgeAt(a, diverging(a));
        const b = e && other(e, a);
        if (!b || b.type !== 'switch' || b === a || !diverging(b) || edgeAt(b, diverging(b)) !== e || a.name > b.name) continue;
        if (a.box !== b.box) {
            // one lever: both belong to the signal box of the first one
            b.box = a.box;
            assignment[typeName(b) + ' ' + b.name] = a.box;
        }
        coupled.push([a.name, b.name]);
    }

    if (errors.length) return { station: null, errors, warnings, assignment };

    // ---------- 12. output in the StavedloSim format ----------
    const xs = [...cells.values()].map(c => c.x);
    const middle = (Math.min(...xs) + Math.max(...xs)) / 2;
    const nodeIds = {};
    for (const [k, id] of nodes) { const [x, y] = k.split(',').map(Number); nodeIds[id] = [x, y]; }
    const name = options.name || 'Stanice';
    const station = {
        id: options.id || slug(name),
        nazev: name,
        popis: 'Export z ORMS Layout Generatoru pro SignalCraft',
        zz: 'EMZZ',
        meritko: METRES_PER_CELL,
        stavedla: boxes.map(s => ({ id: s.id, nazev: s.name })),
        vyhybkarskeOkruhy: [boxes.map(s => s.id)],
        uzly: nodeIds,
        koleje: edges.map(e => {
            const k = { id: e.id, z: nodes.get(key(e.a.x, e.a.y)), do: nodes.get(key(e.b.x, e.b.y)), delka: e.cells * METRES_PER_CELL };
            if (e.points.length > 2) k.body = e.points.slice(1, -1);
            if (trackNumbers.has(e)) k.cislo = trackNumbers.get(e);
            return k;
        }),
        vyhybky: [...cells.values()].filter(c => c.type === 'switch').map(c => ({
            id: c.name, uzel: nodes.get(key(c.x, c.y)),
            hrot: edgeAt(c, c.point).id, plus: edgeAt(c, c.normal).id, minus: edgeAt(c, c.reverse).id,
            stavedlo: c.box, ...(c.inverted ? { invertovana: true } : {}),
        })),
        sprazene: coupled,
        trate: lines.map(t => {
            const e = edges.find(e => e.a === t.end || e.b === t.end);
            return {
                id: t.id, oznaceni: t.code, uzel: nodes.get(key(t.end.x, t.end.y)), kolej: e.id, nazev: t.name,
                od: 'z ' + t.name, do: 'do ' + t.name, strana: t.end.x < middle ? 'L' : 'S', provoz: t.traffic,
            };
        }),
        navestidla: [], posunova: [], predvesti: [],
        prejezdy: [...new Set([...cells.values()].filter(c => c.type === 'crossing').map(c => c.name))].map(name => {
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
        if (c.kind === 'main') station.navestidla.push({ ...rec, typ: c.entry ? 'vjezdove' : 'odjezdove' });
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
    return { station, errors, warnings, assignment };
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
        const normal = [...a].find(s => s !== point), reverse = [...b].find(s => s !== point);
        // first symbol = normal position (+), second = reverse (−)
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
