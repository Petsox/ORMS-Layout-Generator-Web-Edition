import { numRows, numCols } from "./config.js";

document.addEventListener('DOMContentLoaded', (event) => {  
    // Run script only after the entire document is fully loaded

    const table = document.getElementById('excel-table');  
    // Reference to the table that will contain the grid

    for (let i = 0; i < numRows; i++) {
        const row = document.createElement('tr');  
        // Create a new table row

        for (let j = 0; j < numCols; j++) {
            const cell = document.createElement('td');  
            // Create a table cell

            const content = document.createElement('div');  
            // Create inner <div> to hold editable text

            content.contentEditable = "true";  
            // Make the text inside the cell editable

            cell.appendChild(content);  
            // Insert the editable div into the cell

            row.appendChild(cell);  
            // Add the cell to the current row
        }

        table.appendChild(row);  
        // Add the completed row to the table
    }

    let isDragging = false;  
    // True while selecting multiple cells by dragging

    let selectedCells = [];  
    // List of cells selected during drag operation

    let startCell = null;  
    // Cell where dragging began

    let undoStack = [];  
    // Stack storing previous states for undo functionality

    let inputTimeout = null;  
    // Delay timer for saving undo state when typing

    const pushStateToUndoStack = (cells) => {
        // Save the text content of each cell's inner div
        const state = cells.map(cell => ({
            cell,
            text: cell.querySelector('div').innerText  
            // Store complete textual content for undo
        }));

        undoStack.push(state);  
        // Save snapshot to undo history
    };

    table.addEventListener('mousedown', (event) => {
        const cell = event.target.closest('td');  
        // Detect the clicked cell

        if (cell) {
            const rect = cell.getBoundingClientRect();  
            // Get coordinates of the cell on the screen

            // Check if click is in bottom-right 10×10px area (drag fill handle)
            if (event.clientX > rect.right - 10 && event.clientY > rect.bottom - 10) {
                isDragging = true;  
                startCell = cell;  
                selectedCells = [cell];  
                cell.classList.add('selected');  
                // Mark starting cell as selected
            } else {
                // Normal click → store current state before editing
                pushStateToUndoStack([cell]);
            }
        }
    });

    table.addEventListener('mousemove', (event) => {
        const cell = event.target.closest('td');  
        // Cell currently under cursor

        if (cell) {
            const rect = cell.getBoundingClientRect();

            // Change cursor when hovering over drag fill area
            if (event.clientX > rect.right - 10 && event.clientY > rect.bottom - 10) {
                cell.style.cursor = 'copy';  
            } else {
                cell.style.cursor = 'default';
            }
        }

        // Dragging behavior: highlight new cells added to selection
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
            // Text to copy into dragged cells

            pushStateToUndoStack(selectedCells);  
            // Save state of all cells before changing them

            // Apply the same text to all selected cells
            selectedCells.forEach(cell =>
                cell.querySelector('div').innerText = startText
            );

            // Remove selection visual
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
            // Reset delay timer

            // Save state only if user pauses typing for 300ms
            inputTimeout = setTimeout(() => {
                pushStateToUndoStack([cell]);
            }, 300);
        }
    });

    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key === 'z') {
            event.preventDefault();  
            // Prevent browser's built-in undo

            if (undoStack.length > 0) {
                const lastState = undoStack.pop();  
                // Retrieve last saved state

                // Restore text for each saved cell
                lastState.forEach(({ cell, text }) => {
                    cell.querySelector('div').innerText = text;
                });
            }
        }
    });
});
