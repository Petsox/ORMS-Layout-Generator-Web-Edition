document.addEventListener('DOMContentLoaded', (event) => {
    const table = document.getElementById('excel-table');
    const rows = 50;
    const cols = 160;

    // Generate table rows and cells
    for (let i = 0; i < rows; i++) {
        const row = document.createElement('tr');
        for (let j = 0; j < cols; j++) {
            const cell = document.createElement('td');
            const content = document.createElement('div'); // Create a div for content
            content.contentEditable = "true";
            cell.appendChild(content);
            row.appendChild(cell);
        }
        table.appendChild(row);
    }

    let isDragging = false;
    let selectedCells = [];
    let startCell = null;
    let undoStack = [];
    let inputTimeout = null;

    const pushStateToUndoStack = (cells) => {
        const state = cells.map(cell => ({ cell, text: cell.querySelector('div').innerText })); // Ensure entire cell content is captured
        undoStack.push(state);
    };

    table.addEventListener('mousedown', (event) => {
        const cell = event.target.closest('td');
        if (cell) {
            const rect = cell.getBoundingClientRect();
            if (event.clientX > rect.right - 10 && event.clientY > rect.bottom - 10) {
                isDragging = true;
                startCell = cell;
                selectedCells = [cell];
                cell.classList.add('selected');
            } else {
                // Push current state to undo stack when starting to edit
                pushStateToUndoStack([cell]);
            }
        }
    });

    table.addEventListener('mousemove', (event) => {
        const cell = event.target.closest('td');
        if (cell) {
            const rect = cell.getBoundingClientRect();
            if (event.clientX > rect.right - 10 && event.clientY > rect.bottom - 10) {
                cell.style.cursor = 'copy'; // Change cursor for dragging
            } else {
                cell.style.cursor = 'default'; // Default cursor
            }
        }

        if (isDragging && cell) {
            if (!selectedCells.includes(cell)) {
                selectedCells.push(cell);
                cell.classList.add('selected');
            }
        }
    });

    table.addEventListener('mouseup', (event) => {
        if (isDragging) {
            isDragging = false;
            const startText = startCell.querySelector('div').innerText;
            pushStateToUndoStack(selectedCells);
            selectedCells.forEach(cell => cell.querySelector('div').innerText = startText); // Ensure entire cell content is set
            selectedCells.forEach(cell => cell.classList.remove('selected'));
            selectedCells = [];
        }
    });

    table.addEventListener('mouseleave', (event) => {
        if (isDragging) {
            isDragging = false;
            selectedCells.forEach(cell => cell.classList.remove('selected'));
            selectedCells = [];
        }
    });

    table.addEventListener('input', (event) => {
        const cell = event.target.closest('td');
        if (cell) {
            clearTimeout(inputTimeout);
            inputTimeout = setTimeout(() => {
                pushStateToUndoStack([cell]);
            }, 300); // Save state if no further input for 300ms
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key === 'z') {
            event.preventDefault();
            if (undoStack.length > 0) {
                const lastState = undoStack.pop();
                lastState.forEach(({ cell, text }) => {
                    cell.querySelector('div').innerText = text; // Ensure entire cell content is set
                });
            }
        }
    });
});
