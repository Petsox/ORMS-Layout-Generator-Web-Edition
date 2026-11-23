// "SignalCraft" dialog: checks the layout and downloads the station file for the station office device.
import { convertToStation } from './signalcraft.js';

const POSITION = /^\[sloupec (\d+), řádek (\d+)\]\s*/; // 1-based in the messages of signalcraft.js
const esc = s => String(s).replace(/[&<>"]/g, z => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[z]));
const plural = (n, one, few, many) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many);
const count = (n, one, few, many) => n + ' ' + plural(n, one, few, many);

/**
 * @param {{grid: import('./grid.js').Grid, locate: (x:number, y:number) => void, setMarks: (m: Map) => void}} env
 */
export function initSignalCraft({ grid, locate, setMarks }) {
    const $ = s => document.querySelector(s);
    const dialog = $('#scDialog');
    const nameInput = $('#scNazev');
    const resultBox = $('#scVysledek');
    const statusLine = $('#scStav');
    const downloadButton = $('#scStahnout');
    const hideButton = $('#scSkryt');
    let lastStation = null;

    try { nameInput.value = localStorage.getItem('scNazev') || nameInput.value; } catch (e) { /* no storage */ }

    $('#scZkontrolovat').addEventListener('click', check);
    nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
    hideButton.addEventListener('click', () => { setMarks(new Map()); hideButton.hidden = true; });
    downloadButton.addEventListener('click', () => {
        if (!lastStation) return;
        const blob = new Blob([JSON.stringify(lastStation, null, 1)], { type: 'application/json' });
        const a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = lastStation.id + '.json';
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    });
    resultBox.addEventListener('click', e => {
        const b = e.target.closest('.sc-poloha');
        if (!b) return;
        dialog.close();
        locate(+b.dataset.x, +b.dataset.y);
    });

    function check() {
        const name = nameInput.value.trim() || 'Stanice';
        try { localStorage.setItem('scNazev', name); } catch (e) { /* no storage */ }
        const res = convertToStation(grid.cells, { name });
        lastStation = res.station;
        downloadButton.disabled = !res.station;

        const marks = new Map();
        const mark = (texts, cls) => {
            for (const t of texts) {
                const m = t.match(POSITION);
                if (m) marks.set((+m[2] - 1) * grid.cols + (+m[1] - 1), cls);
            }
        };
        mark(res.warnings, ' sc-warn');
        mark(res.errors, ' sc-error');
        setMarks(marks);
        hideButton.hidden = !marks.size;

        let html = '';
        if (res.errors.length) {
            html += '<div class="banner error">Kolejiště má chyby, stanici zatím nelze stáhnout.</div>';
        } else {
            const s = res.station;
            html += '<div class="banner ok">✓ Kolejiště je v pořádku, stanici můžete stáhnout.</div><div class="sc-cisla">' + [
                [s.stavedla.length, 'stavědlo', 'stavědla', 'stavědel'],
                [s.vyhybky.length, 'výhybka', 'výhybky', 'výhybek'],
                [s.navestidla.length, 'hlavní návěstidlo', 'hlavní návěstidla', 'hlavních návěstidel'],
                [s.koleje.filter(k => k.cislo).length, 'dopravní kolej', 'dopravní koleje', 'dopravních kolejí'],
                [s.trate.length, 'trať', 'tratě', 'tratí'],
                [s.prejezdy.length, 'přejezd', 'přejezdy', 'přejezdů'],
                [s.cesty.length, 'vlaková cesta', 'vlakové cesty', 'vlakových cest'],
            ].filter(p => p[0]).map(p => `<span class="chip"><b>${p[0]}</b> ${plural(...p)}</span>`).join('') + '</div>';
        }
        html += section('chyba', 'Chyby', res.errors);
        html += section('varovani', 'Upozornění', res.warnings);
        html += boxesSection(res.assignment);
        resultBox.innerHTML = html;

        statusLine.textContent = res.errors.length
            ? count(res.errors.length, 'chyba', 'chyby', 'chyb') + ' k opravě'
            : res.warnings.length ? count(res.warnings.length, 'upozornění', 'upozornění', 'upozornění') : 'Bez výhrad';
    }

    function section(cls, title, texts) {
        if (!texts.length) return '';
        const items = texts.map(t => {
            const m = t.match(POSITION);
            const where = m
                ? `<button type="button" class="sc-poloha" data-x="${m[1] - 1}" data-y="${m[2] - 1}" title="Ukázat v mřížce">${m[1] - 1}·${m[2] - 1}</button>`
                : '';
            return `<li>${where}<span>${esc(t.replace(POSITION, ''))}</span></li>`;
        });
        const badge = cls === 'chyba' ? 'error' : 'warn';
        return `<div class="sc-sekce ${cls}"><h3>${title} <span class="badge ${badge}">${texts.length}</span></h3><ul class="sc-hlasky">${items.join('')}</ul></div>`;
    }

    /** elements grouped by signal box and kind: "návěstidlo S1" -> ST1 / Návěstidla / S1 */
    function boxesSection(assignment) {
        const entries = Object.entries(assignment);
        if (!entries.length) return '';
        const KINDS = [['výhybka', 'Výhybky'], ['návěstidlo', 'Návěstidla'], ['předvěst', 'Předvěsti'], ['přejezd', 'Přejezdy']];
        const boxes = [...new Set(entries.map(p => p[1] || '?'))].sort();
        const natural = (a, b) => a.localeCompare(b, 'cs', { numeric: true });
        const cards = boxes.map(b => {
            const mine = entries.filter(p => (p[1] || '?') === b).map(p => p[0]);
            const rows = KINDS.map(([k, title]) => {
                const names = mine.filter(n => n.startsWith(k + ' ')).map(n => n.slice(k.length + 1)).sort(natural);
                return names.length ? `<p><span class="sc-druh">${title}:</span> ${esc(names.join(', '))}</p>` : '';
            }).join('');
            return `<div class="sc-st"><h4>${esc(b === '?' ? 'Nepřiřazeno' : b)}</h4>${rows}</div>`;
        });
        return `<div class="sc-sekce"><h3>Přiřazení ke stavědlům</h3><div class="sc-stavedla">${cards.join('')}</div></div>`;
    }

    return {
        open() {
            if (!dialog.open) dialog.showModal();
            check();
        },
    };
}
