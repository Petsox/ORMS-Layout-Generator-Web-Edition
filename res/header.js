document.addEventListener('DOMContentLoaded', () => {
    const table = document.getElementById('excel-table');
    const coordinatesDisplay = document.querySelector('.brand');
    const contextMenu = document.querySelector(".wrapper");
    const cellChanges = {}; // Object to store cell changes for undo functionality

    // Function to handle mousedown event on the table
    table.addEventListener('mousedown', (event) => {
        const cell = event.target.closest('td');
        if (cell) {
            const column = cell.cellIndex;
            const row = cell.parentElement.rowIndex;
            coordinatesDisplay.textContent = `Vybraná buňka: X: ${column}, Y: ${row}`;
        }
    });

    // Function to handle contextmenu event on the table
    table.addEventListener("contextmenu", e => {
        e.preventDefault();
        const x = e.clientX, y = e.clientY

        const rect = table.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;

        if (offsetX >= 0 && offsetX <= rect.width && offsetY >= 0 && offsetY <= rect.height) {
            contextMenu.style.left = `${x}px`;
            contextMenu.style.top = `${y}px`;
            contextMenu.style.visibility = "visible";
        }
    });

    // Function to hide context menu when clicked outside
    document.addEventListener("click", () => contextMenu.style.visibility = "hidden");

    // Function to handle click events for context menu items
    function handleMenuItemClick(event) {
        const menuItem = event.target.closest('.item');
        if (menuItem) {
            const text = menuItem.querySelector('span').textContent;
            switch (text) {
                case 'Vyhybka':
                    // Handle click for "Vyhybky"
                    pasteTextIntoSelectedCell("═ V ═ Vy1")
                    break;
                case 'Návěstidlo':
                    // Handle click for "Návěstidlo"
                    pasteTextIntoSelectedCell("< N SeKr1")
                    break;
                // Add cases for other menu items as needed
                default:
                    pasteTextIntoSelectedCell(text)
                    break;
            }
        }
    }

    // Add click event listeners for context menu items and sub-items
    contextMenu.addEventListener('click', handleMenuItemClick);

// Function to paste specified text into the selected cell's div
function pasteTextIntoSelectedCell(text) {
    const [_, column, row] = coordinatesDisplay.textContent.match(/X: (\d+), Y: (\d+)/);
    const selectedCell = table.rows[row].cells[column];
    if (selectedCell) {
        const cellDiv = selectedCell.querySelector('div');
        if (cellDiv) {
            addCellChange(cellDiv, cellDiv.textContent, text);
            cellDiv.textContent = text;
            selectedCell.focus(); // Focus the cell after pasting the text
        }
    }
}


    // Function to add a cell change to the cellChanges object
    function addCellChange(cell, oldValue, newValue) {
        const column = cell.cellIndex;
        const row = cell.parentElement.rowIndex;
        const cellKey = `${row}-${column}`;
        if (!cellChanges[cellKey]) {
            cellChanges[cellKey] = { oldValue: oldValue, newValue: newValue };
        }
    }

    // Function to handle undo action (CTRL + Z)
    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key === 'z') {
            undoLastChange();
        }
    });

    // Function to undo the last change made to a cell
    function undoLastChange() {
        const lastChangeKey = Object.keys(cellChanges).pop();
        if (lastChangeKey) {
            const [row, column] = lastChangeKey.split('-');
            const cell = table.rows[row].cells[column];
            const lastChange = cellChanges[lastChangeKey];
            if (cell && lastChange) {
                cell.textContent = lastChange.oldValue;
                delete cellChanges[lastChangeKey];
            }
        }
    }
});
