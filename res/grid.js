// The layout grid: cell texts plus undo/redo. Every change goes through edit(), which records it
// as one undoable step and notifies the listeners with the list of changed cells.
import { COLS, ROWS } from './cells.js';

const HISTORY_LIMIT = 400;

export class Grid {
    constructor() {
        this.cols = COLS;
        this.rows = ROWS;
        this.cells = Array.from({ length: ROWS }, () => Array(COLS).fill(''));
        this.undoStack = [];
        this.redoStack = [];
        this.listeners = new Set();
        this.tx = null;
    }

    inBounds(x, y) { return x >= 0 && y >= 0 && x < this.cols && y < this.rows; }
    get(x, y) { return this.inBounds(x, y) ? this.cells[y][x] : ''; }

    /** Runs fn, records every set() inside it as one undo step called label. */
    edit(label, fn) {
        if (this.tx) { fn(); return; }
        const tx = this.tx = new Map();
        try { fn(); } finally { this.tx = null; }
        const changes = [...tx.values()].filter(c => c.before !== c.after);
        if (!changes.length) return false;
        this.undoStack.push({ label, changes });
        if (this.undoStack.length > HISTORY_LIMIT) this.undoStack.shift();
        this.redoStack = [];
        this.emit(changes, label);
        return true;
    }

    set(x, y, text) {
        if (!this.inBounds(x, y)) return;
        if (!this.tx) { this.edit('Úprava buňky', () => this.set(x, y, text)); return; }
        text = (text ?? '').replace(/[\r\n\t]+/g, ' ').trim();
        const before = this.cells[y][x];
        if (before === text) return;
        const k = y * this.cols + x;
        const rec = this.tx.get(k);
        if (rec) rec.after = text; else this.tx.set(k, { x, y, before, after: text });
        this.cells[y][x] = text;
    }

    /** Replaces the whole grid (texts[y][x]); one undo step. */
    replaceAll(texts, label) {
        return this.edit(label, () => {
            for (let y = 0; y < this.rows; y++) {
                for (let x = 0; x < this.cols; x++) this.set(x, y, (texts[y] && texts[y][x]) || '');
            }
        });
    }

    clear(label = 'Smazat vše') { return this.replaceAll([], label); }

    undo() { return this.step(this.undoStack, this.redoStack, 'before'); }
    redo() { return this.step(this.redoStack, this.undoStack, 'after'); }
    step(from, to, field) {
        const entry = from.pop();
        if (!entry) return null;
        for (const c of entry.changes) this.cells[c.y][c.x] = c[field];
        to.push(entry);
        this.emit(entry.changes, entry.label);
        return entry.label;
    }

    *nonEmpty() {
        for (let y = 0; y < this.rows; y++) {
            for (let x = 0; x < this.cols; x++) if (this.cells[y][x]) yield [x, y, this.cells[y][x]];
        }
    }
    isEmpty() { return this.nonEmpty().next().done; }
    texts() { return this.cells.map(r => r.slice()); }

    onChange(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
    emit(changes, label) { for (const fn of this.listeners) fn(changes, label); }
}
