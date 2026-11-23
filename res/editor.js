// The grid editor: draws the cells as a track diagram, handles selection, keyboard, mouse tools
// (select, track pen, brush, eraser), the fill handle, inline editing and the clipboard.
import { parseCell, DELTA, OPP, TRACK_DIRS, PLAIN_TRACK, BUFFERS, TUNNELS, glyphFor, fmt, describe } from './cells.js';

const HW = 38, HH = 22; // row header width, column header height

// ------------------------------------------------------------------ cell shapes (CSS masks)
const shapeSheet = document.createElement('style');
document.head.appendChild(shapeSheet);
const shapes = new Map();
function shape(key, body) {
    let cls = shapes.get(key);
    if (cls) return cls;
    cls = 'm' + shapes.size;
    shapes.set(key, cls);
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32" fill="none" stroke="#000" stroke-width="4" stroke-linejoin="round">${body}</svg>`;
    const url = `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
    shapeSheet.sheet.insertRule(`.${cls}{-webkit-mask-image:${url};mask-image:${url}}`, shapeSheet.sheet.cssRules.length);
    return cls;
}
const EDGE = { N: '16 -1', S: '16 33', E: '33 16', W: '-1 16' };
const armsPath = dirs => {
    const d = [...dirs];
    if (d.length === 2) return `<path d="M${EDGE[d[0]]} L16 16 L${EDGE[d[1]]}"/>`;
    return d.map(x => `<path d="M16 16 L${EDGE[x]}"/>`).join('') + (d.length > 2 ? '<circle cx="16" cy="16" r="2" fill="#000" stroke="none"/>' : '');
};
const rail = dirs => shape('t' + dirs, armsPath(dirs));
const bar = dir => shape('b' + dir, dir === 'N' || dir === 'S' ? '<path d="M7 16 H25"/>' : '<path d="M16 7 V25"/>');
const tunnel = g => shape('tu' + g, {
    '⦗': '<path d="M22 6 Q12 16 22 26" stroke-width="3"/>', '⦘': '<path d="M10 6 Q20 16 10 26" stroke-width="3"/>',
    '︹': '<path d="M6 22 Q16 12 26 22" stroke-width="3"/>', '︺': '<path d="M6 10 Q16 20 26 10" stroke-width="3"/>',
}[g]);
const TRI = {
    E: '23,16 9,7 9,25', W: '9,16 23,7 23,25', N: '16,6 7,22 25,22', S: '16,26 7,10 25,10',
};
const CHEV = { E: 'M11 8 L21 16 L11 24', W: 'M21 8 L11 16 L21 24', N: 'M8 21 L16 11 L24 21', S: 'M8 11 L16 21 L24 11' };
const signalShape = (look, dir) => shape('s' + look + dir,
    look === 'main' ? `<polygon points="${TRI[dir]}" fill="#000" stroke="none"/>`
        : look === 'distant' ? `<polygon points="${TRI[dir]}" stroke-width="2.6"/>`
            : `<path d="${CHEV[dir]}" stroke-width="3" stroke-linecap="round"/>`);
const crossMark = axis => shape('x' + axis, axis === 'EW'
    ? '<path d="M11 5 V27 M21 5 V27" stroke-width="2.4"/>' : '<path d="M5 11 H27 M5 21 H27" stroke-width="2.4"/>');

const esc = s => String(s).replace(/[&<>"]/g, z => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[z]));

function cellHTML(c) {
    switch (c.kind) {
        case 'empty': return '';
        case 'track': {
            const g = c.glyph;
            if (BUFFERS.includes(g)) return `<i class="ly rail ${rail(c.dirs)}"></i><i class="ly rail ${bar(c.dirs)}"></i>`;
            if (TUNNELS.includes(g)) return `<i class="ly rail ${rail(c.dirs)}"></i><i class="ly tunnel ${tunnel(g)}"></i>`;
            return `<i class="ly rail ${rail(c.dirs)}"></i>`;
        }
        case 'switch': {
            if (!c.point) return `<span class="raw bad">${esc(c.text)}</span>`;
            const normal = TRACK_DIRS[c.a], reverse = TRACK_DIRS[c.b].replace(c.point, '');
            return `<i class="ly rail ${rail(normal)}"></i><i class="ly rail-alt ${rail(reverse)}"></i>` +
                `<b class="nm">${esc(c.name)}</b>${c.inverted ? '<em class="inv" title="Invertovaná výhybka">I</em>' : ''}`;
        }
        case 'signal': {
            if (!c.dir) return `<span class="raw bad">${esc(c.text)}</span>`;
            return `<i class="ly rail-faint ${rail(c.dirs)}"></i><i class="ly sig-${c.cls} ${signalShape(c.look, c.dir)}"></i>` +
                `<b class="nm ${c.dir === 'N' || c.dir === 'S' ? 'side' : c.dir === 'W' ? 'top' : ''}">${esc(c.name)}</b>`;
        }
        case 'crossing':
            if (!c.dirs) return `<span class="raw bad">${esc(c.text)}</span>`;
            return `<i class="ly rail ${rail(c.dirs)}"></i><i class="ly crossmark ${crossMark(c.dirs)}"></i><b class="nm">${esc(c.name)}</b>`;
        case 'label': return `<span class="lb">${esc(c.label)}</span>`;
        default: return `<span class="raw bad">${esc(c.text)}</span>`;
    }
}

// ------------------------------------------------------------------ editor
export class Editor {
    /**
     * @param {HTMLElement} scroller  scrolling container
     * @param {import('./grid.js').Grid} grid
     * @param {object} hooks  {onSelect, onEditHint, onContextMenu, nextName, onToolDone, toast}
     */
    constructor(scroller, grid, hooks) {
        this.scroller = scroller;
        this.grid = grid;
        this.hooks = hooks;
        this.cs = 30;
        this.tool = 'select';
        this.brush = null;
        this.sel = { ax: 1, ay: 1, cx: 1, cy: 1 };
        this.marks = new Map(); // key -> class list
        this.build();
        this.renderAll();
        this.updateSelection();
        this.ready = true;
        grid.onChange(changes => {
            if (changes.length > 600) this.renderAll();
            else for (const c of changes) this.renderCell(c.x, c.y);
        });
    }

    // ---------------------------------------------------------- DOM
    build() {
        const { cols, rows } = this.grid;
        const board = this.board = document.createElement('div');
        board.className = 'board';
        board.tabIndex = 0;
        board.setAttribute('role', 'grid');
        board.setAttribute('aria-label', 'Kolejiště');
        let html = '<div class="hd corner"></div>';
        for (let x = 0; x < cols; x++) html += `<div class="hd col${x % 5 === 0 ? ' five' : ''}">${x}</div>`;
        for (let y = 0; y < rows; y++) {
            html += `<div class="hd row${y % 5 === 0 ? ' five' : ''}">${y}</div>`;
            for (let x = 0; x < cols; x++) html += '<div class="c"></div>';
        }
        board.innerHTML = html + '<div class="ov sel"></div><div class="ov cur"></div><div class="ov handle" title="Táhněte pro vyplnění"></div><div class="ov ghosts"></div><input class="ov cell-input" spellcheck="false" autocomplete="off">';
        this.cellsEl = [];
        const kids = board.children;
        for (let y = 0; y < rows; y++) {
            const r = [];
            for (let x = 0; x < cols; x++) r.push(kids[1 + cols + y * (cols + 1) + 1 + x]);
            this.cellsEl.push(r);
        }
        this.colHd = [...board.querySelectorAll('.hd.col')];
        this.rowHd = [...board.querySelectorAll('.hd.row')];
        this.selEl = board.querySelector('.sel');
        this.curEl = board.querySelector('.cur');
        this.handleEl = board.querySelector('.handle');
        this.ghostsEl = board.querySelector('.ghosts');
        this.input = board.querySelector('.cell-input');
        this.scroller.appendChild(board);
        enablePan(this.scroller);
        this.setCellSize(this.cs);
        this.bindMouse();
        this.bindKeys();
        this.bindInput();
        this.bindClipboard();
    }

    setCellSize(cs) {
        cs = Math.max(16, Math.min(56, Math.round(cs)));
        this.cs = cs;
        this.board.style.setProperty('--cs', cs + 'px');
        this.board.style.gridTemplateColumns = `${HW}px repeat(${this.grid.cols}, ${cs}px)`;
        this.board.style.gridTemplateRows = `${HH}px repeat(${this.grid.rows}, ${cs}px)`;
        this.board.classList.toggle('tiny', cs < 24);
        this.updateSelection();
        if (this.editing) this.placeInput();
    }

    zoomBy(factor, clientX, clientY) {
        const r = this.scroller.getBoundingClientRect();
        const px = (clientX ?? r.left + r.width / 2) - r.left, py = (clientY ?? r.top + r.height / 2) - r.top;
        const gx = (this.scroller.scrollLeft + px - HW) / this.cs, gy = (this.scroller.scrollTop + py - HH) / this.cs;
        this.setCellSize(this.cs * factor);
        this.scroller.scrollLeft = gx * this.cs + HW - px;
        this.scroller.scrollTop = gy * this.cs + HH - py;
        return this.cs;
    }

    renderAll() {
        for (let y = 0; y < this.grid.rows; y++) for (let x = 0; x < this.grid.cols; x++) this.renderCell(x, y);
    }
    renderCell(x, y) {
        const el = this.cellsEl[y][x];
        const c = parseCell(this.grid.get(x, y));
        el.className = 'c' + (c.kind === 'empty' ? '' : ' k-' + c.kind) + (this.marks.get(y * this.grid.cols + x) || '');
        el.innerHTML = cellHTML(c);
        el.title = c.kind === 'empty' ? '' : c.text;
    }

    /** marks: Map key(y*cols+x) -> ' e-error' etc. Re-renders only cells whose mark changed. */
    setMarks(marks) {
        const old = this.marks;
        this.marks = marks;
        const keys = new Set([...old.keys(), ...marks.keys()]);
        for (const k of keys) {
            if (old.get(k) === marks.get(k)) continue;
            const x = k % this.grid.cols, y = Math.floor(k / this.grid.cols);
            const el = this.cellsEl[y][x];
            el.classList.remove('e-error', 'e-warn', 'e-info', 'sc-error', 'sc-warn');
            for (const cls of (marks.get(k) || '').trim().split(' ').filter(Boolean)) el.classList.add(cls);
        }
    }

    // ---------------------------------------------------------- selection
    get rect() {
        const s = this.sel;
        return { x1: Math.min(s.ax, s.cx), y1: Math.min(s.ay, s.cy), x2: Math.max(s.ax, s.cx), y2: Math.max(s.ay, s.cy) };
    }
    clamp(x, y) { return [Math.max(0, Math.min(this.grid.cols - 1, x)), Math.max(0, Math.min(this.grid.rows - 1, y))]; }

    select(x, y, extend = false, reveal = true) {
        [x, y] = this.clamp(x, y);
        if (extend) { this.sel.cx = x; this.sel.cy = y; } else this.sel = { ax: x, ay: y, cx: x, cy: y };
        this.updateSelection();
        if (reveal) this.reveal(x, y);
    }
    selectRect(x1, y1, x2, y2) {
        [x1, y1] = this.clamp(x1, y1); [x2, y2] = this.clamp(x2, y2);
        this.sel = { ax: x1, ay: y1, cx: x2, cy: y2 };
        this.updateSelection();
    }
    updateSelection() {
        if (!this.selEl) return;
        const r = this.rect, cs = this.cs;
        const box = (el, x1, y1, x2, y2) => {
            el.style.left = HW + x1 * cs + 'px'; el.style.top = HH + y1 * cs + 'px';
            el.style.width = (x2 - x1 + 1) * cs + 'px'; el.style.height = (y2 - y1 + 1) * cs + 'px';
        };
        box(this.selEl, r.x1, r.y1, r.x2, r.y2);
        box(this.curEl, this.sel.cx, this.sel.cy, this.sel.cx, this.sel.cy);
        this.selEl.classList.toggle('multi', r.x1 !== r.x2 || r.y1 !== r.y2);
        this.handleEl.style.left = HW + (r.x2 + 1) * cs - 4 + 'px';
        this.handleEl.style.top = HH + (r.y2 + 1) * cs - 4 + 'px';
        this.handleEl.hidden = this.tool !== 'select';
        for (const h of this.colHd) h.classList.remove('on');
        for (const h of this.rowHd) h.classList.remove('on');
        for (let x = r.x1; x <= r.x2; x++) this.colHd[x].classList.add('on');
        for (let y = r.y1; y <= r.y2; y++) this.rowHd[y].classList.add('on');
        if (this.ready && this.hooks.onSelect) this.hooks.onSelect(this.sel.cx, this.sel.cy, r);
    }
    reveal(x, y, center = false) {
        const s = this.scroller, cs = this.cs;
        const left = HW + x * cs, top = HH + y * cs;
        if (center) {
            s.scrollTo({ left: left - s.clientWidth / 2 + cs / 2, top: top - s.clientHeight / 2 + cs / 2, behavior: 'smooth' });
            return;
        }
        if (left - HW < s.scrollLeft) s.scrollLeft = left - HW;
        else if (left + cs > s.scrollLeft + s.clientWidth) s.scrollLeft = left + cs - s.clientWidth;
        if (top - HH < s.scrollTop) s.scrollTop = top - HH;
        else if (top + cs > s.scrollTop + s.clientHeight) s.scrollTop = top + cs - s.clientHeight;
    }
    flash(x, y) {
        this.select(x, y, false, false);
        this.reveal(x, y, true);
        const el = this.cellsEl[y][x];
        el.classList.remove('flash');
        void el.offsetWidth;
        el.classList.add('flash');
        this.board.focus({ preventScroll: true });
    }

    setTool(tool, brush = null) {
        this.tool = tool;
        this.brush = brush;
        this.board.dataset.tool = tool;
        this.handleEl.hidden = tool !== 'select';
    }

    cellAt(clientX, clientY, clampToGrid = true) {
        const r = this.board.getBoundingClientRect();
        let x = Math.floor((clientX - r.left - HW) / this.cs), y = Math.floor((clientY - r.top - HH) / this.cs);
        if (clampToGrid) [x, y] = this.clamp(x, y);
        return [x, y];
    }

    // ---------------------------------------------------------- mouse
    bindMouse() {
        const b = this.board;
        let drag = null;
        let autoScroll = null;

        b.addEventListener('mousedown', e => {
            if (e.target === this.input) return;
            if (this.editing) this.commitEdit();
            const hd = e.target.closest('.hd');
            if (hd) {
                e.preventDefault();
                b.focus({ preventScroll: true });
                if (hd.classList.contains('col')) { const x = this.colHd.indexOf(hd); this.selectRect(x, 0, x, this.grid.rows - 1); }
                else if (hd.classList.contains('row')) { const y = this.rowHd.indexOf(hd); this.selectRect(0, y, this.grid.cols - 1, y); }
                else this.selectRect(0, 0, this.grid.cols - 1, this.grid.rows - 1);
                return;
            }
            if (e.button === 2) {
                const [x, y] = this.cellAt(e.clientX, e.clientY);
                const r = this.rect;
                if (x < r.x1 || x > r.x2 || y < r.y1 || y > r.y2) this.select(x, y, false, false);
                return;
            }
            if (e.button !== 0) return;
            e.preventDefault();
            b.focus({ preventScroll: true });
            const [x, y] = this.cellAt(e.clientX, e.clientY);
            if (e.target === this.handleEl) {
                drag = { mode: 'fill', from: this.rect };
            } else if (this.tool === 'select') {
                this.select(x, y, e.shiftKey, false);
                drag = { mode: 'select' };
            } else {
                this.select(x, y, false, false);
                drag = { mode: this.tool, path: [{ x, y }], seen: new Set([y * this.grid.cols + x]) };
                this.drawGhosts(drag);
            }
            const move = ev => {
                const [mx, my] = this.cellAt(ev.clientX, ev.clientY);
                this.autoScroll(ev, () => move(ev), autoScroll, v => (autoScroll = v));
                if (drag.mode === 'select') {
                    if (mx !== this.sel.cx || my !== this.sel.cy) this.select(mx, my, true, false);
                } else if (drag.mode === 'fill') {
                    drag.to = this.fillTarget(drag.from, mx, my);
                    this.drawFillGhost(drag);
                } else {
                    this.extendPath(drag, mx, my);
                    this.drawGhosts(drag);
                }
            };
            const up = () => {
                document.removeEventListener('mousemove', move);
                document.removeEventListener('mouseup', up);
                clearInterval(autoScroll); autoScroll = null;
                const d = drag; drag = null;
                this.ghostsEl.innerHTML = '';
                if (d.mode === 'fill' && d.to) this.applyFill(d.from, d.to);
                else if (d.mode === 'pen') this.applyPen(d.path);
                else if (d.mode === 'brush') this.applyBrush(d.path);
                else if (d.mode === 'erase') this.applyErase(d.path);
            };
            document.addEventListener('mousemove', move);
            document.addEventListener('mouseup', up);
        });

        b.addEventListener('dblclick', e => {
            if (this.tool !== 'select' || e.target.closest('.hd') || e.target === this.input) return;
            const [x, y] = this.cellAt(e.clientX, e.clientY);
            this.select(x, y);
            this.startEdit();
        });

        b.addEventListener('contextmenu', e => {
            if (e.target === this.input) return;
            e.preventDefault();
            if (e.target.closest('.hd')) return;
            this.hooks.onContextMenu && this.hooks.onContextMenu(e.clientX, e.clientY);
        });

        b.addEventListener('mousemove', e => {
            if (this.tool !== 'select' || e.buttons) return;
            const [x, y] = this.cellAt(e.clientX, e.clientY, false);
            this.hooks.onHover && this.hooks.onHover(x, y);
        });
        b.addEventListener('mouseleave', () => this.hooks.onHover && this.hooks.onHover(-1, -1));

        this.scroller.addEventListener('wheel', e => {
            if (!e.ctrlKey && !e.metaKey) return;
            e.preventDefault();
            const cs = this.zoomBy(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
            this.hooks.onZoom && this.hooks.onZoom(cs);
        }, { passive: false });
    }

    autoScroll(ev, again, timer, setTimer) {
        const r = this.scroller.getBoundingClientRect();
        const edge = 28;
        const vx = ev.clientX < r.left + HW + edge ? -1 : ev.clientX > r.right - edge ? 1 : 0;
        const vy = ev.clientY < r.top + HH + edge ? -1 : ev.clientY > r.bottom - edge ? 1 : 0;
        if (!vx && !vy) { clearInterval(timer); setTimer(null); return; }
        if (timer) return;
        setTimer(setInterval(() => {
            this.scroller.scrollLeft += vx * this.cs;
            this.scroller.scrollTop += vy * this.cs;
            again();
        }, 60));
    }

    // path of cells for pen / brush / eraser; steps one cell at a time so a fast mouse skips nothing
    extendPath(drag, x, y) {
        const p = drag.path;
        let last = p[p.length - 1];
        while (last.x !== x || last.y !== y) {
            const dx = x - last.x, dy = y - last.y;
            const next = Math.abs(dx) >= Math.abs(dy) ? { x: last.x + Math.sign(dx), y: last.y } : { x: last.x, y: last.y + Math.sign(dy) };
            if (drag.mode === 'pen') {
                // going back over the previous cell shortens the line
                const prev = p[p.length - 2];
                if (prev && prev.x === next.x && prev.y === next.y) { p.pop(); last = prev; continue; }
                p.push(next);
            } else {
                const k = next.y * this.grid.cols + next.x;
                if (!drag.seen.has(k)) { drag.seen.add(k); p.push(next); }
            }
            last = next;
        }
    }

    drawGhosts(drag) {
        const cs = this.cs;
        let html = '';
        if (drag.mode === 'pen') {
            const plan = this.planPen(drag.path);
            for (const [k, text] of plan) {
                const x = k % this.grid.cols, y = Math.floor(k / this.grid.cols);
                html += `<div class="ghost pen" style="left:${HW + x * cs}px;top:${HH + y * cs}px">${cellHTML(parseCell(text))}</div>`;
            }
            if (!plan.size) for (const { x, y } of drag.path) html += `<div class="ghost" style="left:${HW + x * cs}px;top:${HH + y * cs}px"></div>`;
        } else {
            for (const { x, y } of drag.path) {
                const inner = drag.mode === 'brush' && this.brush ? cellHTML(parseCell(this.brush.preview || this.brush.text)) : '';
                html += `<div class="ghost ${drag.mode}" style="left:${HW + x * cs}px;top:${HH + y * cs}px">${inner}</div>`;
            }
        }
        this.ghostsEl.innerHTML = html;
    }

    // ---------------------------------------------------------- pen: draws track, picks glyphs itself
    planPen(path) {
        const plan = new Map();
        if (path.length < 2) return plan;
        const cols = this.grid.cols;
        const dirTo = (a, b) => (b.x > a.x ? 'E' : b.x < a.x ? 'W' : b.y > a.y ? 'S' : 'N');
        const n = path.length;
        const straight = d => (d === 'E' || d === 'W' ? '═' : '║');
        let nextSwitch = null;
        const switchName = () => {
            nextSwitch = this.hooks.nextName('switch', nextSwitch);
            return nextSwitch;
        };
        // direction of travel along an axis, first after index i (forward) or last before it
        const travelAlong = (axis, i, forward) => {
            const range = forward ? [...Array(n - 1 - i).keys()].map(k => i + k) : [...Array(i).keys()].map(k => i - 1 - k);
            for (const j of range) {
                const d = dirTo(path[j], path[j + 1]);
                if (axis.includes(d)) return d;
            }
            return null;
        };
        for (let i = 0; i < n; i++) {
            const p = path[i];
            const dirs = [];
            if (i > 0) dirs.push(dirTo(p, path[i - 1]));
            if (i < n - 1) dirs.push(dirTo(p, path[i + 1]));
            if (dirs.length === 2 && dirs[0] === dirs[1]) continue;
            const k = p.y * cols + p.x;
            const ex = parseCell(this.grid.get(p.x, p.y));
            const end = dirs.length === 1;
            if (ex.kind === 'empty') {
                plan.set(k, end ? straight(dirs[0]) : glyphFor(dirs));
                continue;
            }
            if (!end) {
                // crossing an existing plain track the same way: keep it
                continue;
            }
            const d = dirs[0];
            if (ex.dirs.includes(d)) continue;
            if (ex.kind === 'track' && PLAIN_TRACK.includes(ex.glyph)) {
                const exDirs = TRACK_DIRS[ex.glyph];
                let point;
                if (exDirs.includes(OPP[d])) {
                    // a curve: the point is the arm on the other side of the new branch
                    point = OPP[d];
                } else {
                    // a straight track with a branch leaving sideways
                    const axis = exDirs; // 'WE' or 'NS'
                    const h = i === 0 ? travelAlong(axis, 0, true) : travelAlong(axis, n - 1, false);
                    const def = axis.includes('E') ? 'E' : 'S';
                    point = i === 0 ? OPP[h || def] : (h || def);
                }
                if (!exDirs.includes(point)) continue;
                const reverse = glyphFor(point + d);
                if (!reverse || reverse === ex.glyph) continue;
                plan.set(k, fmt.switch(ex.glyph, reverse, switchName(), false));
            }
        }
        return plan;
    }
    applyPen(path) {
        const plan = this.planPen(path);
        if (!plan.size) return;
        this.grid.edit('Kreslení koleje', () => {
            for (const [k, text] of plan) this.grid.set(k % this.grid.cols, Math.floor(k / this.grid.cols), text);
        });
        const last = path[path.length - 1];
        this.select(last.x, last.y, false, false);
    }

    applyBrush(path) {
        if (!this.brush) return;
        let prev = null;
        this.grid.edit('Štětec: ' + this.brush.title, () => {
            for (const { x, y } of path) {
                const text = this.brush.make ? this.brush.make(prev) : this.brush.text;
                prev = text;
                this.grid.set(x, y, text);
            }
        });
    }
    applyErase(path) {
        this.grid.edit('Guma', () => { for (const { x, y } of path) this.grid.set(x, y, ''); });
    }

    // ---------------------------------------------------------- fill handle
    fillTarget(from, x, y) {
        const outX = x < from.x1 ? x - from.x1 : x > from.x2 ? x - from.x2 : 0;
        const outY = y < from.y1 ? y - from.y1 : y > from.y2 ? y - from.y2 : 0;
        if (!outX && !outY) return null;
        if (Math.abs(outX) >= Math.abs(outY)) return { ...from, x1: Math.min(from.x1, x), x2: Math.max(from.x2, x) };
        return { ...from, y1: Math.min(from.y1, y), y2: Math.max(from.y2, y) };
    }
    drawFillGhost(drag) {
        const t = drag.to, cs = this.cs;
        this.ghostsEl.innerHTML = t ? `<div class="ghost fillbox" style="left:${HW + t.x1 * cs}px;top:${HH + t.y1 * cs}px;width:${(t.x2 - t.x1 + 1) * cs}px;height:${(t.y2 - t.y1 + 1) * cs}px"></div>` : '';
    }
    applyFill(from, to) {
        const w = from.x2 - from.x1 + 1, h = from.y2 - from.y1 + 1;
        const src = [];
        for (let y = 0; y < h; y++) { src.push([]); for (let x = 0; x < w; x++) src[y].push(this.grid.get(from.x1 + x, from.y1 + y)); }
        const mod = (a, m) => ((a % m) + m) % m;
        this.grid.edit('Vyplnění', () => {
            for (let y = to.y1; y <= to.y2; y++) {
                for (let x = to.x1; x <= to.x2; x++) {
                    if (x >= from.x1 && x <= from.x2 && y >= from.y1 && y <= from.y2) continue;
                    this.grid.set(x, y, src[mod(y - from.y1, h)][mod(x - from.x1, w)]);
                }
            }
        });
        this.selectRect(to.x1, to.y1, to.x2, to.y2);
    }

    // ---------------------------------------------------------- keyboard
    bindKeys() {
        this.board.addEventListener('keydown', e => {
            if (e.target === this.input) return;
            const ctrl = e.ctrlKey || e.metaKey;
            const s = this.sel;
            const moves = { ArrowUp: [0, -1], ArrowDown: [0, 1], ArrowLeft: [-1, 0], ArrowRight: [1, 0] };
            if (moves[e.key]) {
                e.preventDefault();
                let [dx, dy] = moves[e.key];
                if (ctrl) { dx *= 10; dy *= 10; }
                this.select(s.cx + dx, s.cy + dy, e.shiftKey);
                return;
            }
            if (e.key === 'Tab') { e.preventDefault(); this.select(s.cx + (e.shiftKey ? -1 : 1), s.cy); return; }
            if (e.key === 'Home') { e.preventDefault(); this.select(0, ctrl ? 0 : s.cy, e.shiftKey); return; }
            if (e.key === 'End') { e.preventDefault(); this.select(this.grid.cols - 1, ctrl ? this.grid.rows - 1 : s.cy, e.shiftKey); return; }
            if (e.key === 'PageDown' || e.key === 'PageUp') {
                e.preventDefault();
                const step = Math.max(1, Math.floor(this.scroller.clientHeight / this.cs) - 2);
                this.select(s.cx, s.cy + (e.key === 'PageDown' ? step : -step), e.shiftKey);
                return;
            }
            if (e.key === 'Enter' || e.key === 'F2') { e.preventDefault(); this.startEdit(); return; }
            if (e.key === 'Delete' || e.key === 'Backspace') { e.preventDefault(); this.clearSelection(); return; }
            if (e.key === 'Escape') {
                if (this.tool !== 'select') { this.hooks.onToolDone && this.hooks.onToolDone(); return; }
                this.select(s.cx, s.cy);
                return;
            }
            if (ctrl && e.key.toLowerCase() === 'a') { e.preventDefault(); this.selectRect(0, 0, this.grid.cols - 1, this.grid.rows - 1); return; }
            if (!ctrl && !e.altKey && e.key.length === 1) {
                e.preventDefault();
                this.startEdit(e.key);
            }
        });
    }

    clearSelection() {
        const r = this.rect;
        this.grid.edit('Smazání', () => {
            for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) this.grid.set(x, y, '');
        });
    }

    /** Writes text (or text factory) into every selected cell. */
    fillSelection(make, label) {
        const r = this.rect;
        let prev = null;
        this.grid.edit(label, () => {
            for (let y = r.y1; y <= r.y2; y++) {
                for (let x = r.x1; x <= r.x2; x++) {
                    const t = typeof make === 'function' ? make(prev) : make;
                    prev = t;
                    this.grid.set(x, y, t);
                }
            }
        });
    }

    // ---------------------------------------------------------- inline editing
    startEdit(initial) {
        const { cx, cy } = this.sel;
        this.reveal(cx, cy);
        this.editing = { x: cx, y: cy, before: this.grid.get(cx, cy) };
        const inp = this.input;
        inp.value = initial !== undefined ? initial : this.editing.before;
        inp.classList.add('on');
        this.placeInput();
        inp.focus();
        if (initial === undefined) inp.select();
        else inp.setSelectionRange(inp.value.length, inp.value.length);
        this.hooks.onEditHint && this.hooks.onEditHint(inp.value, inp);
    }
    placeInput() {
        const { x, y } = this.editing, cs = this.cs;
        const inp = this.input;
        inp.style.left = HW + x * cs + 'px';
        inp.style.top = HH + y * cs + 'px';
        inp.style.height = cs + 'px';
        inp.style.minWidth = Math.max(cs * 5, 150) + 'px';
        inp.style.width = Math.max(cs * 5, 150, (inp.value.length + 3) * 9) + 'px';
    }
    commitEdit(move = null) {
        if (!this.editing) return;
        const { x, y } = this.editing;
        let v = this.input.value.trim();
        // keyboard shortcuts for glyphs that cannot be typed
        if (v === '-' || v === '=') v = '═';
        else if (v === '|') v = '║';
        this.editing = null;
        this.input.classList.remove('on');
        this.hooks.onEditHint && this.hooks.onEditHint(null);
        this.grid.set(x, y, v);
        this.board.focus({ preventScroll: true });
        if (move) this.select(x + move[0], y + move[1]);
        else this.updateSelection();
    }
    cancelEdit() {
        if (!this.editing) return;
        this.editing = null;
        this.input.classList.remove('on');
        this.hooks.onEditHint && this.hooks.onEditHint(null);
        this.board.focus({ preventScroll: true });
    }
    bindInput() {
        const inp = this.input;
        inp.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Enter') { e.preventDefault(); this.commitEdit(e.shiftKey ? [0, -1] : [0, 1]); }
            else if (e.key === 'Tab') { e.preventDefault(); this.commitEdit(e.shiftKey ? [-1, 0] : [1, 0]); }
            else if (e.key === 'Escape') { e.preventDefault(); this.cancelEdit(); }
        });
        inp.addEventListener('input', () => {
            this.placeInput();
            this.hooks.onEditHint && this.hooks.onEditHint(inp.value, inp);
        });
        inp.addEventListener('blur', () => { if (this.editing) this.commitEdit(); });
    }

    // ---------------------------------------------------------- clipboard (TSV, like a spreadsheet)
    copyText() {
        const r = this.rect;
        const lines = [];
        for (let y = r.y1; y <= r.y2; y++) {
            const row = [];
            for (let x = r.x1; x <= r.x2; x++) row.push(this.grid.get(x, y));
            lines.push(row.join('\t'));
        }
        return lines.join('\n');
    }
    pasteText(text) {
        const rows = text.replace(/\r\n?/g, '\n').replace(/\n$/, '').split('\n').map(l => l.split('\t'));
        const { x1, y1 } = this.rect;
        const single = rows.length === 1 && rows[0].length === 1;
        const r = this.rect;
        this.grid.edit('Vložení', () => {
            if (single) {
                for (let y = r.y1; y <= r.y2; y++) for (let x = r.x1; x <= r.x2; x++) this.grid.set(x, y, rows[0][0]);
            } else {
                rows.forEach((row, dy) => row.forEach((t, dx) => this.grid.set(x1 + dx, y1 + dy, t)));
            }
        });
        if (!single) this.selectRect(x1, y1, x1 + Math.max(...rows.map(r => r.length)) - 1, y1 + rows.length - 1);
    }
    bindClipboard() {
        const active = () => document.activeElement === this.board;
        document.addEventListener('copy', e => {
            if (!active()) return;
            e.preventDefault();
            e.clipboardData.setData('text/plain', this.copyText());
            this.hooks.toast && this.hooks.toast('Zkopírováno');
        });
        document.addEventListener('cut', e => {
            if (!active()) return;
            e.preventDefault();
            e.clipboardData.setData('text/plain', this.copyText());
            this.clearSelection();
        });
        document.addEventListener('paste', e => {
            if (!active()) return;
            e.preventDefault();
            this.pasteText(e.clipboardData.getData('text/plain'));
        });
    }
}

/** Moving around by dragging with the middle mouse button (wheel held down). */
export function enablePan(scroller) {
    scroller.addEventListener('mousedown', e => {
        if (e.button !== 1) return;
        e.preventDefault();          // no browser autoscroll
        e.stopPropagation();         // the editor must not treat it as a click
        const sx = e.clientX, sy = e.clientY, left = scroller.scrollLeft, top = scroller.scrollTop;
        document.body.classList.add('panning');
        const move = ev => {
            scroller.scrollLeft = left - (ev.clientX - sx);
            scroller.scrollTop = top - (ev.clientY - sy);
        };
        const up = ev => {
            if (ev.button !== 1) return;
            document.body.classList.remove('panning');
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
    }, true);
    // middle click would otherwise paste (Linux) or open links
    scroller.addEventListener('auxclick', e => { if (e.button === 1) e.preventDefault(); });
}

export { describe, cellHTML };
