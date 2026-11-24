// EMZZ model of SignalCraft in JavaScript: what the game builds from a station file.
//
// Port of signalcraft.emzz.logic.Station (train routes: search, flank protection, conflicts, helper boxes, route
// groups) and Equipment (blocks with their plate texts, signal / point / shunt levers, track locks, block relays) of
// SignalCraft 1.7.10. The generator uses it to check the station the way the game will load it and to show the
// instruments before the export. Speeds, aspects and the operation itself are not ported.
// Messages are Czech like the game's; keep this file in step with the Java classes.

const cs = new Intl.Collator('cs');
const chunks = s => String(s).match(/\d+|\D+/g) || [];
/** localeCompare(b, 'cs', { numeric: true }) of the Java NATURAL comparator */
export const natural = (a, b) => {
    const x = chunks(a), y = chunks(b);
    for (let i = 0; i < Math.min(x.length, y.length); i++) {
        const p = x[i], q = y[i];
        const r = /^\d/.test(p) && /^\d/.test(q) ? (BigInt(p) < BigInt(q) ? -1 : BigInt(p) > BigInt(q) ? 1 : 0) : cs.compare(p, q);
        if (r) return r;
    }
    return x.length - y.length;
};
const parseIntJs = s => parseInt(s, 10) || 0;
const numeric = (a, b) => parseIntJs(a) - parseIntJs(b) || cs.compare(String(a), String(b));
const empty = s => s === undefined || s === null || s === '';
const list = v => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

export const SIGNAL_KINDS = ['vjezdove', 'odjezdove', 'skupinove', 'cestove', 'vlozene', 'vnitrni'];

/**
 * @param {object} def station file (StavedloSim format as written by the export)
 * @returns {{errors: string[], st: object|null}} st: tracks, switches, signals, lines, routes (Map), groups, equipment
 */
export function buildModel(def) {
    const err = [];
    const st = {
        nodes: new Map(), tracks: new Map(), boxes: new Map(), switches: new Map(), lines: new Map(), signals: new Map(),
        shuntSignals: new Map(), crossings: new Map(), routes: new Map(), signalIndex: new Map(), groups: new Map(), equipment: new Map(),
        scale: def.meritko || 10,
    };
    for (const [id, [x, y]] of Object.entries(def.uzly || {})) st.nodes.set(id, { id, x, y, ends: [], switchId: null, lineId: null });
    for (const k of def.koleje || []) {
        const a = st.nodes.get(k.z), b = st.nodes.get(k.do);
        if (!a || !b) { err.push(`kolej ${k.id}: neznámý uzel ${a ? k.do : k.z}`); continue; }
        const pts = [[a.x, a.y], ...(k.body || []), [b.x, b.y]];
        let geom = 0;
        for (let i = 1; i < pts.length; i++) geom += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
        const t = {
            id: k.id, from: a.id, to: b.id, number: k.cislo ?? null, label: k.oznaceni ?? null, isolated: !!k.izolovana,
            length: k.delka || Math.max(10, Math.round(geom * st.scale)),
        };
        t.name = k.nazev || (t.number != null ? t.number + '. kolej' : t.label != null ? t.label + '. kolej' : '');
        st.tracks.set(t.id, t);
        a.ends.push({ track: t.id, dir: 1 });
        b.ends.push({ track: t.id, dir: -1 });
    }
    const endsIn = (tid, nid) => { const t = st.tracks.get(tid); return !!t && (t.from === nid || t.to === nid); };
    for (const s of def.stavedla || []) st.boxes.set(s.id, { id: s.id, name: s.nazev || s.id, indicators: s.kontrolkyIK });
    for (const v of def.vyhybky || []) {
        const n = st.nodes.get(v.uzel);
        if (!n) { err.push(`výhybka ${v.id}: neznámý uzel ${v.uzel}`); continue; }
        for (const [leg, tid] of [['hrot', v.hrot], ['plus', v.plus], ['minus', v.minus]]) if (!endsIn(tid, n.id)) err.push(`výhybka ${v.id}: kolej "${tid}" (${leg}) nekončí v uzlu ${n.id}`);
        if (!st.boxes.has(v.stavedlo)) err.push(`výhybka ${v.id}: neznámé stavědlo ${v.stavedlo}`);
        n.switchId = v.id;
        st.switches.set(v.id, { id: v.id, node: n.id, point: v.hrot, normal: v.plus, reverse: v.minus, box: v.stavedlo, speed: v.rychlost || 40 });
    }
    for (const t of def.trate || []) {
        const n = st.nodes.get(t.uzel);
        if (!n || !endsIn(t.kolej, n.id)) { err.push(`trať ${t.id}: kolej ${t.kolej} nekončí v uzlu ${t.uzel}`); continue; }
        n.lineId = t.id;
        const name = t.nazev || t.id;
        st.lines.set(t.id, {
            id: t.id, node: n.id, track: t.kolej, name, fromText: t.od || 'z ' + name, toText: t.do || 'do ' + name,
            side: t.strana || 'L', label: t.oznaceni || t.id, shortName: t.zkratka || null, traffic: t.provoz || 'oba',
        });
    }
    for (const n of def.navestidla || []) {
        const k = st.tracks.get(n.kolej);
        if (!k || !endsIn(n.kolej, n.uzel)) { err.push(`návěstidlo ${n.id}: kolej ${n.kolej} nekončí v uzlu ${n.uzel}`); continue; }
        if (!st.boxes.has(n.stavedlo)) err.push(`návěstidlo ${n.id}: neznámé stavědlo ${n.stavedlo}`);
        if (n.druh && !SIGNAL_KINDS.includes(n.druh)) err.push(`návěstidlo ${n.id}: neznámý druh "${n.druh}"`);
        const s = {
            id: n.id, node: n.uzel, track: n.kolej, box: n.stavedlo, entry: (n.typ || 'odjezdove') === 'vjezdove', dir: k.to === n.uzel ? 1 : -1,
            kind: n.druh || null,
        };
        s.repeater = s.kind ? s.kind === 'cestove' : /^(Sc|Lc)/.test(n.id);
        s.inserted = s.kind ? s.kind === 'vlozene' : /^(VS|VL)/.test(n.id);
        s.validity = n.platnost || null;
        if (n.platnost && !['vlak', 'oba'].includes(n.platnost)) err.push(`návěstidlo ${n.id}: "platnost" musí být "vlak" nebo "oba" (návěstidlo jen pro posun patří do "posunova")`);
        st.signals.set(n.id, s);
        st.signalIndex.set(n.uzel + '|' + n.kolej, n.id);
    }
    for (const n of def.posunova || []) {
        if (!st.boxes.has(n.stavedlo)) err.push(`posunové návěstidlo ${n.id}: neznámé stavědlo ${n.stavedlo}`);
        st.shuntSignals.set(n.id, { id: n.id, box: n.stavedlo, track: n.kolej });
    }
    for (const p of def.prejezdy || []) {
        if (!st.boxes.has(p.stavedlo)) err.push(`přejezd ${p.id}: neznámé stavědlo ${p.stavedlo}`);
        st.crossings.set(p.id, { id: p.id, name: p.nazev || 'Přejezd ' + p.id, box: p.stavedlo, tracks: list(p.koleje) });
    }
    if (err.length) return { errors: err, st: null };

    // ---------- moving through the layout ----------
    const away = (tid, nid) => (st.tracks.get(tid).from === nid ? 1 : -1);
    function next(tid, dir) {
        const t = st.tracks.get(tid);
        const nid = dir > 0 ? t.to : t.from;
        const n = st.nodes.get(nid);
        const res = { node: nid, line: null, options: [] };
        if (n.lineId && st.lines.get(n.lineId).track === tid) { res.line = n.lineId; return res; }
        if (n.switchId) {
            const s = st.switches.get(n.switchId);
            if (tid === s.point) {
                res.options.push({ track: s.normal, dir: away(s.normal, nid), sw: s.id, position: '+' });
                res.options.push({ track: s.reverse, dir: away(s.reverse, nid), sw: s.id, position: '-' });
            } else res.options.push({ track: s.point, dir: away(s.point, nid), sw: s.id, position: tid === s.normal ? '+' : '-' });
            return res;
        }
        for (const e of n.ends) if (e.track !== tid) res.options.push({ track: e.track, dir: e.dir, sw: null, position: null });
        return res;
    }
    st.next = next;
    function flankSwitches(sw) {
        const flank = new Map(), disputed = new Set();
        for (const [id, pos] of sw) {
            const s = st.switches.get(id);
            const leg = pos === '+' ? s.reverse : s.normal;
            const t = st.tracks.get(leg);
            const other = st.nodes.get(t.from === s.node ? t.to : t.from);
            if (!other.switchId) continue;
            const s2 = st.switches.get(other.switchId);
            if (s2.point === leg || sw.has(s2.id)) continue;
            const wanted = s2.normal === leg ? '-' : '+';
            if (flank.has(s2.id) && flank.get(s2.id) !== wanted) disputed.add(s2.id);
            flank.set(s2.id, wanted);
        }
        for (const id of disputed) flank.delete(id);
        return flank;
    }
    const score = (segs, sw) => [...sw.values()].filter(p => p === '-').length * 100000 + segs.reduce((a, s) => a + st.tracks.get(s.track).length, 0);
    /** passable = main signals the route may pass (route signals); empty = as StavedloSim */
    function search(tid, dir, path, sw, goal, line, via, best, passable = new Set()) {
        if (path.length > 80) return;
        const nx = next(tid, dir);
        if (nx.line) return;
        for (const o of nx.options) {
            if (path.some(e => e.track === o.track)) continue;
            let sw2 = sw;
            if (o.sw) {
                if (sw.has(o.sw) && sw.get(o.sw) !== o.position) continue;
                const forced = via && via[o.sw];
                if (forced && forced !== o.position) continue;
                sw2 = new Map(sw).set(o.sw, o.position);
            }
            path.push({ track: o.track, dir: o.dir });
            if (o.track === goal) {
                if (!line || line.id === next(o.track, o.dir).line) {
                    const s = score(path, sw2);
                    if (!best.b || s < best.b.score) best.b = { score: s, segments: [...path], switches: sw2 };
                }
            } else {
                const t = st.tracks.get(o.track);
                const sig = st.signalIndex.get((o.dir > 0 ? t.to : t.from) + '|' + o.track);
                if (!passable.size) { if (!sig && empty(t.number)) search(o.track, o.dir, path, sw2, goal, line, via, best); }
                else if (!sig || passable.has(sig)) search(o.track, o.dir, path, sw2, goal, line, via, best, passable);
            }
            path.pop();
        }
    }
    const trackNumber = id => { const t = st.tracks.get(id); return !t || empty(t.number) ? id : t.number; };
    st.trackNumber = trackNumber;

    function buildRoute(dc, target) {
        const from = dc.od;
        const sig = st.signals.get(from);
        if (!sig) { err.push(`cesta od ${from}: neznámé návěstidlo`); return null; }
        const line = st.lines.get(target) || null;
        const goal = line ? line.track : target;
        if (!st.tracks.has(goal)) { err.push(`cesta od ${from}: neznámý cíl ${target}`); return null; }
        const passable = new Set(list(dc.mijene));
        let startTrack = dc.z || null;
        if (startTrack === sig.track) startTrack = null;
        const approach = [];
        let approachSw = new Map();
        if (startTrack) {
            if (!st.tracks.has(startTrack)) { err.push(`cesta od ${from}: neznámá výchozí kolej ${startTrack}`); return null; }
            const back = {};
            search(sig.track, -sig.dir, [], new Map(), startTrack, null, dc.pres, back);
            if (!back.b) { err.push(`cestu od ${from} z koleje ${trackNumber(startTrack)} k návěstidlu nelze v kolejišti najít`); return null; }
            for (let i = back.b.segments.length - 1; i >= 0; i--) approach.push({ track: back.b.segments[i].track, dir: -back.b.segments[i].dir });
            approach.push({ track: sig.track, dir: sig.dir });
            approachSw = back.b.switches;
        }
        const best = {};
        search(sig.track, sig.dir, [...approach], new Map(approachSw), goal, line, dc.pres, best, passable);
        if (best.b && approach.length) best.b.segments = best.b.segments.slice(approach.length);
        const goalName = line ? line.name : (st.tracks.get(goal).name || goal);
        if (!best.b) { err.push(`cestu ${from}${startTrack ? ' z koleje ' + trackNumber(startTrack) : ''} → ${goalName} nelze v kolejišti najít`); return null; }
        const flank = dc.bezOdvratu ? new Map() : flankSwitches(best.b.switches);
        // flank protection only by switches of the boxes with switches in the route (SignalCraft extension)
        const routeBoxes = new Set([sig.box, ...[...best.b.switches.keys()].map(k => st.switches.get(k).box)]);
        for (const k of [...flank.keys()]) if (!routeBoxes.has(st.switches.get(k).box)) flank.delete(k);
        for (const [k, v] of Object.entries(dc.odvrat || {})) flank.set(k, v);
        for (const k of [...flank.keys()]) if (best.b.switches.has(k)) flank.delete(k);
        const type = line ? 'EXIT' : sig.entry ? 'ENTRY' : 'INTERNAL';
        const number = st.tracks.get(goal).number;
        const id = dc.id || from + '-' + (startTrack ? trackNumber(startTrack) + '-' : '') + (line ? line.id : (!empty(number) ? number : goal));
        const r = {
            id, from, to: target, type, box: sig.box, line: line ? line.id : null, startTrack, approach,
            name: dc.nazev || from + (startTrack ? ` (${trackNumber(startTrack)}. k.)` : '') + ' → ' + (line ? line.name : (!empty(number) ? number + '. k.' : goalName)),
            segments: best.b.segments, switches: best.b.switches, flank, conflicts: [], crossings: [], helpers: [], passed: [],
        };
        r.allSegments = () => [...r.approach, ...r.segments];
        r.allPositions = () => { const p = new Map(r.flank); for (const [k, v] of r.switches) p.set(k, v); return p; };
        r.uses = box => r.box === box || r.helpers.includes(box);
        const segs = r.segments;
        for (let i = 0; i + 1 < segs.length; i++) {
            const t = st.tracks.get(segs[i].track);
            const ps = st.signalIndex.get((segs[i].dir > 0 ? t.to : t.from) + '|' + segs[i].track);
            if (ps && passable.has(ps)) r.passed.push(ps);
        }
        return r;
    }

    for (const dc of def.cesty || []) {
        for (const target of list(dc.na)) {
            const r = buildRoute(dc, target);
            if (!r) continue;
            if (st.routes.has(r.id)) err.push(`cesta ${r.id} je definována dvakrát`);
            st.routes.set(r.id, r);
        }
    }
    if (err.length) return { errors: err, st };
    const routes = [...st.routes.values()];
    for (const r of routes) {
        for (const c of st.crossings.values()) if (c.tracks.some(ct => r.allSegments().some(s => s.track === ct))) r.crossings.push(c.id);
        for (const sw of r.allPositions().keys()) {
            const b = st.switches.get(sw).box;
            if (b !== r.box && !r.helpers.includes(b)) r.helpers.push(b);
        }
        r.helpers.sort(natural);
    }
    const inConflict = (a, b) => {
        const segA = new Set(a.allSegments().map(s => s.track));
        if (b.allSegments().some(s => segA.has(s.track))) return true;
        const pb = b.allPositions();
        for (const [k, v] of a.allPositions()) if (pb.has(k) && pb.get(k) !== v) return true;
        return false;
    };
    for (let i = 0; i < routes.length; i++) for (let j = i + 1; j < routes.length; j++) {
        if (inConflict(routes[i], routes[j])) { routes[i].conflicts.push(routes[j].id); routes[j].conflicts.push(routes[i].id); }
    }

    // ---------- route groups (one per line track and signal box) ----------
    const trackY = id => { const t = st.tracks.get(id); return (st.nodes.get(t.from).y + st.nodes.get(t.to).y) / 2; };
    st.trackY = trackY;
    const movementTrack = r => (r.type === 'ENTRY' ? r.to : r.startTrack || st.signals.get(r.from).track);
    st.movementTrack = movementTrack;
    for (const r of routes) {
        let l = null;
        if (r.type === 'EXIT') l = st.lines.get(r.line);
        else for (const x of st.lines.values()) if (x.track === st.signals.get(r.from).track) { l = x; break; }
        r.group = l ? l.id : null;
    }
    for (const box of st.boxes.values()) {
        // routes the box sets; routes of other boxes over its switches get a consent block (souhlasové hradlo)
        const own = routes.filter(r => r.box === box.id);
        const ids = [...new Set(own.filter(r => r.group).map(r => r.group))].sort((a, b) => natural(st.lines.get(a).label, st.lines.get(b).label));
        const groups = ids.map(lid => {
            const g = { id: lid, label: st.lines.get(lid).label, name: st.lines.get(lid).name, directions: [], orders: new Map(), tracks: [] };
            const rs = own.filter(r => r.group === lid);
            for (const t of ['ENTRY', 'EXIT']) if (rs.some(r => r.type === t)) g.directions.push(t);
            for (const r of rs) {
                const key = r.type + '|' + movementTrack(r);
                if (g.orders.has(key)) err.push(`${box.name}: pro ${r.type === 'ENTRY' ? 'vjezd' : 'odjezd'} na/z ${st.tracks.get(movementTrack(r)).name} po trati ${lid} existuje více cest (${g.orders.get(key)}, ${r.id})`);
                g.orders.set(key, r.id);
            }
            for (const r of rs) if (!g.tracks.includes(movementTrack(r))) g.tracks.push(movementTrack(r));
            g.tracks.sort((a, b) => trackY(a) - trackY(b));
            return g;
        });
        st.groups.set(box.id, groups);
    }
    if (err.length) return { errors: err, st };
    buildEquipment(st, def, err);
    return { errors: err, st };
}

// ---------------------------------------------------------------- equipment (Equipment.build)
function signalRange(ids) {
    if (ids.length > 1) {
        let prefix = null; const n = [];
        for (const i of ids) {
            const m = i.match(/^(\D*)(\d+)$/);
            if (!m || (prefix !== null && prefix !== m[1])) { prefix = undefined; break; }
            prefix = m[1]; n.push(+m[2]);
        }
        if (prefix !== undefined) { n.sort((a, b) => a - b); return prefix + n[0] + '–' + prefix + n[n.length - 1]; }
    }
    return ids.join(', ');
}
const lineName = (st, id) => { const l = st.lines.get(id); return !l ? '' : l.shortName || l.toText.replace(/^do\s+/i, ''); };
const directionText = g => (g.directions.length === 2 ? 'od/do' : g.directions[0] === 'ENTRY' ? 'od' : 'do');
const capitalizeParts = s => s.replace(/(^|\/)(\S)/g, (m, a, b) => a + b.toUpperCase());

function buildEquipment(st, def, err) {
    const coupled = (def.sprazene || []).map(list);
    for (const sk of coupled) {
        const owners = new Set(sk.map(v => (st.switches.has(v) ? st.switches.get(v).box : null)));
        for (const v of sk) if (!st.switches.has(v)) err.push(`spřažení ${sk.join('/')}: neznámá výhybka ${v}`);
        if (owners.size > 1) err.push(`spřažené výhybky ${sk.join('/')} musí patřit jednomu stavědlu`);
        for (const r of st.routes.values()) {
            const pos = r.allPositions();
            const p = new Set(sk.filter(v => pos.has(v)).map(v => pos.get(v)));
            if (p.size > 1) err.push(`cesta ${r.name} potřebuje spřažené výhybky ${sk.join('/')} v různých polohách`);
        }
    }
    const leverName = id => { const sk = coupled.find(x => x.includes(id)); return sk ? sk.join('/') : id; };
    for (const box of st.boxes.values()) {
        const all = [...st.routes.values()].filter(r => r.uses(box.id));
        const routes = all.filter(r => r.box === box.id);
        const eq = {
            box: box.id, name: box.name, blocks: new Map(), rowDK: [], rowBox: [], signalLevers: [], pointLevers: [], tracks: [], trackLocks: new Map(),
            lockSets: [], routeLock: new Map(), groups: st.groups.get(box.id) || [], callingOn: [], shuntLevers: [], crossings: [], relays: [],
            consentRow: [],
        };
        const entrySignals = [...new Set(routes.filter(r => r.type === 'ENTRY').map(r => r.from))].sort();
        let side = null;
        for (const nid of entrySignals) for (const l of st.lines.values()) if (l.track === st.signals.get(nid).track) side = l.side;
        if (!side) {
            const own = [...st.switches.values()].filter(s => s.box === box.id);
            const xs = [...st.nodes.values()].map(n => n.x);
            const avg = own.reduce((a, s) => a + st.nodes.get(s.node).x, 0) / (own.length || 1);
            side = own.length && avg > (Math.min(...xs) + Math.max(...xs)) / 2 ? 'S' : 'L';
        }
        eq.side = side;
        const block = (id, kind, extra) => { const b = { id, kind, signals: [], text: [], group: null, stop: null, line: null, ...extra }; eq.blocks.set(id, b); return b; };
        const entries = [], exits = [];
        for (const nid of entrySignals) {
            const r = routes.find(x => x.from === nid && x.type === 'ENTRY');
            const nm = r.group ? [lineName(st, r.group)] : [];
            const b = block('N' + nid, 'ENTRY', { group: r.group, stop: 'H' + nid });
            b.signals.push(nid); b.text.push('Náv.', nid, 'od', ...nm);
            block('H' + nid, 'STOP', { signalBlock: 'N' + nid }).text.push('Hradlová', 'zarážka', nid, 'od', ...nm);
            entries.push('N' + nid);
        }
        const exitLines = [...new Set(routes.filter(r => r.type === 'EXIT').map(r => r.line))];
        for (const lid of exitLines) {
            const sigs = [...new Set(routes.filter(r => r.type === 'EXIT' && r.line === lid).map(r => r.from))].sort(natural);
            const b = block('N' + lid, 'EXIT', { line: lid, group: lid, stop: 'H' + lid });
            b.signals.push(...sigs); b.text.push('Náv.', signalRange(sigs), 'do', lineName(st, lid));
            block('H' + lid, 'STOP', { signalBlock: 'N' + lid }).text.push('Hradlová', 'zarážka', signalRange(sigs), 'do', lineName(st, lid));
            exits.push('N' + lid);
        }
        for (const g of eq.groups) block('ZV' + g.id, 'LOCK', { group: g.id }).text.push('Závěr', 'výměn', g.label + ' ' + directionText(g), lineName(st, g.id));
        for (const bid of entries) if (!eq.blocks.get(bid).group) { eq.rowBox.push(eq.blocks.get(bid).stop, bid); eq.rowDK.push(bid); }
        for (const g of eq.groups) {
            for (const b of entries) if (eq.blocks.get(b).group === g.id) { eq.rowBox.push(eq.blocks.get(b).stop, b); eq.rowDK.push(b); }
            eq.rowBox.push('ZV' + g.id); eq.rowDK.push('ZV' + g.id);
            for (const b of exits) if (eq.blocks.get(b).group === g.id) { eq.rowBox.push(b, eq.blocks.get(b).stop); eq.rowDK.push(b); }
        }
        if (side === 'S') { eq.rowDK.reverse(); eq.rowBox.reverse(); }

        // signal levers
        const routesOfBlocks = bids => routes.filter(r => bids.some(bid => {
            const b = eq.blocks.get(bid);
            return b.kind === 'ENTRY' ? r.type === 'ENTRY' && 'N' + r.from === bid : r.type === 'EXIT' && 'N' + r.line === bid;
        }));
        const excludeEachOther = (b1, b2) => routesOfBlocks(b1).every(r1 => routesOfBlocks(b2).every(r2 => r1.conflicts.includes(r2.id)));
        const exitSets = [], exitKeys = [];
        for (const bid of exits) {
            const key = eq.blocks.get(bid).signals.join(',');
            const i = exitKeys.indexOf(key);
            if (i >= 0) exitSets[i].push(bid); else { exitKeys.push(key); exitSets.push([bid]); }
        }
        const pairs = [], free = [...exitSets];
        for (const bid of entries) {
            const i = free.findIndex(f => excludeEachOther([bid], f));
            pairs.push([[bid], i >= 0 ? free.splice(i, 1)[0] : null]);
        }
        for (const o of free) pairs.push([null, o]);
        pairs.forEach((p, i) => eq.signalLevers.push({ id: 'K' + (i + 1), a: side === 'S' ? p[1] : p[0], b: side === 'S' ? p[0] : p[1] }));

        // point levers
        const sws = [...st.switches.values()].filter(s => s.box === box.id).sort((a, b) => numeric(a.id, b.id));
        const done = new Set();
        for (const s of sws) {
            if (done.has(s.id)) continue;
            const sk = coupled.find(x => x.includes(s.id)) || [s.id];
            sk.forEach(x => done.add(x));
            eq.pointLevers.push({ id: sk.join('/'), switches: sk });
        }

        // track locks
        for (const r of routes) if (!eq.tracks.includes(st.movementTrack(r))) eq.tracks.push(st.movementTrack(r));
        eq.tracks.sort((a, b) => st.trackY(a) - st.trackY(b));
        let n = 0;
        const byY = (a, b) => st.trackY(st.movementTrack(a)) - st.trackY(st.movementTrack(b));
        for (const g of eq.groups) {
            const set = { group: g.id, name: capitalizeParts(directionText(g)) + ' ' + lineName(st, g.id), locks: [] };
            const rs = [];
            for (const t of g.directions) rs.push(...routes.filter(r => r.group === g.id && r.type === t).sort(byY));
            n = addLocks(st, eq, set, g.id, rs, leverName, box.id, n);
            eq.lockSets.push(set);
        }
        // consents to other boxes (souhlasová hradla): per signal box of the routes and line track one consent block
        // and a set of track locks of this box's switches
        const foreign = new Map();
        for (const r of all) {
            if (r.box === box.id) continue;
            const k = r.box + '|' + (r.group || '');
            if (!foreign.has(k)) foreign.set(k, []);
            foreign.get(k).push(r);
        }
        for (const [k, rs] of foreign) {
            const [to, g] = k.split('|');
            const hasIn = rs.some(r => r.type === 'ENTRY'), hasOut = rs.some(r => r.type !== 'ENTRY');
            const dir = hasIn && hasOut ? 'od/do' : hasIn ? 'od' : 'do';
            const b = block('SD_' + to + '_' + g, 'CONSENT', { group: g || null, giver: box.id, receiver: to, partner: 'SP_' + box.id + '_' + g });
            b.text.push('Souhlas', 'pro', shortBox(to));
            if (g) b.text.push(st.lines.get(g).label, dir, lineName(st, g));
            eq.consentRow.push(b.id);
            const set = { group: b.id, name: 'Souhlas ' + shortBox(to) + (g ? ' ' + dir + ' ' + lineName(st, g) : ''), locks: [], consent: true };
            n = addLocks(st, eq, set, b.id, [...rs].sort(byY), leverName, box.id, n);
            eq.lockSets.push(set);
        }
        for (const r of all) if (!eq.routeLock.has(r.id)) err.push(`${box.name}: cesta ${r.name} nemá kolejový závěrník (nevede po žádné traťové koleji)`);
        for (const nid of entrySignals) eq.callingOn.push({ id: 'PN' + nid, signals: [nid], name: nid });
        if (side === 'S') eq.callingOn.reverse();
        // shunt levers: main signals valid for shunting too (red plate; without "platnost" the exit signals), shunting
        // signals (blue plate)
        const shunt = [];
        const red = new Set(routes.filter(r => r.type === 'EXIT' && !st.signals.get(r.from).validity).map(r => r.from));
        for (const s of st.signals.values()) if (s.box === box.id && s.validity === 'oba') red.add(s.id);
        for (const nid of [...red].sort(natural)) shunt.push({ signal: nid, colour: 'cerveny' });
        for (const id of [...st.shuntSignals.values()].filter(s => s.box === box.id).map(s => s.id).sort(natural)) shunt.push({ signal: id, colour: 'modry' });
        for (let i = 0; i < shunt.length; i += 2) eq.shuntLevers.push({ id: 'P' + (i / 2 + 1), a: shunt[i], b: shunt[i + 1] || null });
        for (const c of st.crossings.values()) if (c.box === box.id) eq.crossings.push(c.id);
        for (const g of eq.groups) {
            if (![...eq.blocks.values()].some(b => (b.kind === 'ENTRY' || b.kind === 'EXIT') && b.group === g.id)) continue;
            const tracks = g.tracks.map(t => st.tracks.get(t).number ?? t).sort(numeric);
            eq.relays.push({ id: 'R' + g.id, group: g.id, tracks, text: g.label + ' ' + directionText(g) + ' ' + lineName(st, g.id) });
        }
        if (side === 'S') eq.relays.reverse();
        eq.rowBox.push(...eq.consentRow);
        eq.indicators = box.indicators || def.kontrolkyIK || 'pristroj';
        st.equipment.set(box.id, eq);
    }
    // the receiving side of every consent block: in the signal box of the routes, next to the point lock of the line
    for (const giver of st.equipment.values()) {
        for (const bid of giver.consentRow) {
            const gb = giver.blocks.get(bid);
            const eq = st.equipment.get(gb.receiver);
            if (!eq) continue;
            const b = { id: gb.partner, kind: 'CONSENT', signals: [], text: ['Souhlas', 'od', shortBox(gb.giver), ...gb.text.slice(3)], group: gb.group, giver: gb.giver, receiver: gb.receiver, partner: gb.id };
            eq.blocks.set(b.id, b);
            const at = b.group ? eq.rowBox.indexOf('ZV' + b.group) : -1;
            if (at < 0) eq.rowBox.push(b.id); else eq.rowBox.splice(eq.side === 'S' ? at + 1 : at, 0, b.id);
        }
    }
}

const shortBox = id => { const m = String(id).match(/^ST\s*(\d+)$/i); return m ? 'St. ' + m[1] : id; };

/** track locks of a set: two positions per lock; routes of other boxes share a position with the same switches */
function addLocks(st, eq, set, group, rs, leverName, box, n) {
    const pos = [], byKey = new Map();
    for (const r of rs) {
        const p = lockPosition(st, r, leverName, box);
        const foreign = r.box !== box;
        const key = (foreign ? 'H|' : p.track + '|') + p.minus.join(' ') + '|' + p.plus.join(' ');
        if (byKey.has(key)) {
            const q = byKey.get(key);
            q.routes.push(r.id);
            if (foreign) {
                if (!q.tracks.includes(p.number)) q.tracks.push(p.number);
                if (q.type !== p.type) q.type = 'BOTH';
                const s = [...q.tracks].sort(numeric);
                q.number = s.length > 3 ? s[0] + '–' + s[s.length - 1] : s.join(', ');
            } else q.type = 'BOTH';
            continue;
        }
        p.routes.push(r.id);
        p.tracks = [p.number];
        byKey.set(key, p);
        pos.push(p);
    }
    for (let i = 0; i < pos.length; i += 2) {
        n++;
        const kz = { id: 'KZ' + n, number: n, group, positions: [pos[i], pos[i + 1] || null] };
        eq.trackLocks.set(kz.id, kz);
        for (let j = i; j < Math.min(i + 2, pos.length); j++) for (const rid of pos[j].routes) eq.routeLock.set(rid, kz.id);
        set.locks.push(kz.id);
    }
    return n;
}

function lockPosition(st, r, leverName, box) {
    const pos = r.allPositions();
    const levers = [];
    for (const k of pos.keys()) {
        if (st.switches.get(k).box !== box) continue;
        const n = leverName(k);
        if (!levers.includes(n)) levers.push(n);
    }
    levers.sort(numeric);
    const tid = st.movementTrack(r);
    const p = { route: r.id, track: tid, number: st.trackNumber(tid), type: r.type, minus: [], plus: [], routes: [] };
    for (const k of levers) {
        const v = k.split('/').map(x => pos.get(x)).find(x => x);
        if (v === '-') p.minus.push(k);
        if (v === '+') p.plus.push(k);
    }
    return p;
}
