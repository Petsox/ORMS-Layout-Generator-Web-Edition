// "Export do SignalCraftu" button: checks the layout and downloads the station file for the station office device.
import { convertToStation } from "./signalcraft.js";

const table = document.getElementById('excel-table');
const dialog = document.getElementById('scDialog');
const nameInput = document.getElementById('scNazev');
const resultBox = document.getElementById('scVysledek');
const statusLine = document.getElementById('scStav');
const downloadButton = document.getElementById('scStahnout');
let lastStation = null;

document.getElementById('signalcraftButton').addEventListener('click', () => {
    try { nameInput.value = localStorage.getItem('scNazev') || nameInput.value; } catch (e) { /* no storage */ }
    dialog.showModal();
    check();
});
document.getElementById('scZkontrolovat').addEventListener('click', check);
document.getElementById('scZavrit').addEventListener('click', () => dialog.close());
nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') check(); });
// a click on the dimmed area around the window closes it
dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
downloadButton.addEventListener('click', () => {
    if (!lastStation) return;
    const blob = new Blob([JSON.stringify(lastStation, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = lastStation.id + '.json';
    a.click();
    URL.revokeObjectURL(a.href);
});
// a click on a position: close the window and show the cell in the layout
resultBox.addEventListener('click', e => {
    const b = e.target.closest('.sc-poloha');
    if (!b) return;
    const cell = cellAt(+b.dataset.x, +b.dataset.y);
    if (!cell) return;
    dialog.close();
    cell.scrollIntoView({ block: 'center', inline: 'center', behavior: 'smooth' });
    cell.classList.remove('sc-blik');
    void cell.offsetWidth; // restart the animation
    cell.classList.add('sc-blik');
});

const POSITION = /^\[sloupec (\d+), řádek (\d+)\]\s*/;
const cellAt = (x, y) => table.rows[y - 1] && table.rows[y - 1].cells[x - 1];
const esc = s => String(s).replace(/[&<>"]/g, z => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[z]));

function gridTexts() {
    return [...table.rows].map(r => [...r.cells].map(c => c.textContent.trim()));
}

function check() {
    const name = nameInput.value.trim() || 'Stanice';
    try { localStorage.setItem('scNazev', name); } catch (e) { /* no storage */ }
    const res = convertToStation(gridTexts(), { name });
    lastStation = res.station;
    downloadButton.disabled = !res.station;

    for (const c of table.querySelectorAll('.sc-chyba, .sc-varovani')) c.classList.remove('sc-chyba', 'sc-varovani');
    const mark = (texts, cls) => {
        for (const t of texts) {
            const m = t.match(POSITION);
            const cell = m && cellAt(+m[1], +m[2]);
            if (cell) cell.classList.add(cls);
        }
    };
    mark(res.warnings, 'sc-varovani');
    mark(res.errors, 'sc-chyba');

    let html = '';
    if (res.errors.length) {
        html += `<div class="sc-souhrn chyba">Kolejiště má chyby, stanici zatím nelze stáhnout.</div>`;
    } else {
        const s = res.station;
        html += `<div class="sc-souhrn ok">Kolejiště je v pořádku, stanici můžeš stáhnout.</div><div class="sc-cisla">` + [
            [s.stavedla.length, 'stavědlo', 'stavědla', 'stavědel'],
            [s.vyhybky.length, 'výhybka', 'výhybky', 'výhybek'],
            [s.navestidla.length, 'hlavní návěstidlo', 'hlavní návěstidla', 'hlavních návěstidel'],
            [s.koleje.filter(k => k.cislo).length, 'dopravní kolej', 'dopravní koleje', 'dopravních kolejí'],
            [s.trate.length, 'trať', 'tratě', 'tratí'],
            [s.prejezdy.length, 'přejezd', 'přejezdy', 'přejezdů'],
        ].filter(p => p[0]).map(p => `<span class="sc-cislo"><b>${p[0]}</b>${plural(...p)}</span>`).join('') + '</div>';
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
            ? `<button type="button" class="sc-poloha" data-x="${m[1]}" data-y="${m[2]}" title="Ukázat v kolejišti">sl. ${m[1]} · ř. ${m[2]}</button>`
            : '<span class="sc-bez"></span>';
        return `<li>${where}<span>${esc(t.replace(POSITION, ''))}</span></li>`;
    });
    return `<div class="sc-sekce ${cls}"><h3>${title} <span class="sc-pocet">${texts.length}</span></h3><ul class="sc-hlasky">${items.join('')}</ul></div>`;
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

/** Czech plural without the number: 1 výhybka, 2–4 výhybky, 5+ výhybek */
function plural(n, one, few, many) {
    return n === 1 ? one : n >= 2 && n <= 4 ? few : many;
}
function count(n, one, few, many) {
    return n + ' ' + plural(n, one, few, many);
}
