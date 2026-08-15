document.addEventListener('DOMContentLoaded', () => {  
    // Run this code only after the whole HTML document has fully loaded

    const table = document.getElementById('excel-table');  
    // Reference to the table acting like an Excel grid

    const coordinatesDisplay = document.querySelector('.brand');  
    // Element that displays the currently selected cell coordinates

    const contextMenu = document.querySelector(".wrapper");  
    // Custom right-click context menu

    const cellChanges = {};  
    // Stores cell modifications for undo functionality (key: "row-column")


    // Handle table mousedown
    table.addEventListener('mousedown', (event) => {
        const cell = event.target.closest('td');  
        // Find the nearest table cell clicked (ignore clicks on padding/inner elements)

        if (cell) {
            const column = cell.cellIndex;  
            // Column index of the clicked cell

            const row = cell.parentElement.rowIndex;  
            // Row index of the clicked cell

            coordinatesDisplay.textContent = `Vybraná buňka: X: ${column}, Y: ${row}`;  
            // Update coordinate display
        }
    });


    // Custom right-click menu
    table.addEventListener("contextmenu", e => {
        e.preventDefault();  
        // Prevent the default browser context menu

        const x = e.clientX, y = e.clientY;  
        // Cursor position on screen

        const rect = table.getBoundingClientRect();  
        // Bounding rectangle for table (position and size)

        const offsetX = e.clientX - rect.left;  
        const offsetY = e.clientY - rect.top;  
        // Cursor position relative to the table

        // Show context menu only when right-clicking **inside** the table bounds
        if (offsetX >= 0 && offsetX <= rect.width && offsetY >= 0 && offsetY <= rect.height) {
            contextMenu.style.left = `${x}px`;  
            contextMenu.style.top = `${y}px`;  
            contextMenu.style.visibility = "visible";  
        }
    });


    // Hide context menu on click outside
    document.addEventListener("click", () => contextMenu.style.visibility = "hidden");

    //Handle clicks on context menu items
    function handleMenuItemClick(event) {
        const menuItem = event.target.closest('.item');  
        // Detect actual menu item click (even when clicking its child elements)

        if (menuItem) {
            const text = menuItem.querySelector('span').textContent;  
            // Read displayed item text to determine action

            switch (text) {

                // Insert preset symbols / text based on menu selection
                case 'Vyhybka':
                    pasteTextIntoSelectedCell("═ V ═ Vy1Kr");
                    break;

                case 'Název Stanice':
                    pasteTextIntoSelectedCell("L Nymburk Hl.n.");
                    break;

                case 'Hlavní':
                    pasteTextIntoSelectedCell("◀ N S1Kr");
                    break;

                case 'Předvěst':
                    pasteTextIntoSelectedCell("◁ N PrS1Kr");
                    break;
                case 'Seřaďovací':
                    // Handle click for "Návěstidlo - Seřaďovací"
                    pasteTextIntoSelectedCell("< N Se1Kr")
                    break;

                case '╪':
                    pasteTextIntoSelectedCell("╪ P ═ P4953");
                    break;

                case '╫':
                    pasteTextIntoSelectedCell("╫ P ║ P4953");
                    break;

                // Items that do nothing
                case 'Přejezd':
                case 'Návěstidlo':
                case 'Kolej':
                case 'Zarážedla':
                case 'Tunel':
                    break;

                // Default: paste the item's text itself
                default:
                    pasteTextIntoSelectedCell(text);
                    break;
            }
        }
    }

    contextMenu.addEventListener('click', handleMenuItemClick);  
    // Listen for clicks inside the custom context menu


    function pasteTextIntoSelectedCell(text) {
        // Extract stored coordinates of the selected cell
        const [_, column, row] = coordinatesDisplay.textContent.match(/X: (\d+), Y: (\d+)/);

        const selectedCell = table.rows[row].cells[column];  
        // Access the referenced cell using row/column numbers

        if (selectedCell) {
            const cellDiv = selectedCell.querySelector('div');  
            // Text inside each cell is inside a <div>

            if (cellDiv) {
                addCellChange(cellDiv, cellDiv.textContent, text);  
                // Save old/new values for undo

                cellDiv.textContent = text;  
                // Apply new cell content

                selectedCell.focus();  
                // Focus the cell after editing
            }
        }
    }


    //Save cell changes for undo functionality
    function addCellChange(cell, oldValue, newValue) {

        const column = cell.cellIndex;  
        // Column number of the div inside the cell

        const row = cell.parentElement.rowIndex;  
        // Row number

        const cellKey = `${row}-${column}`;  
        // Unique cell identifier

        // Store only the first change (no stacking per cell)
        if (!cellChanges[cellKey]) {
            cellChanges[cellKey] = { oldValue, newValue };
        }
    }


    // Catch Ctrl+Z for undoing last change
    document.addEventListener('keydown', (event) => {
        if (event.ctrlKey && event.key === 'z') {
            undoLastChange();
        }
    });

    function undoLastChange() {
        const lastChangeKey = Object.keys(cellChanges).pop();  
        // Get the latest added cell change

        if (lastChangeKey) {
            const [row, column] = lastChangeKey.split('-');  
            // Extract position

            const cell = table.rows[row].cells[column];  
            // Find the actual cell

            const lastChange = cellChanges[lastChangeKey];  
            // Get old/new values

            if (cell && lastChange) {
                cell.textContent = lastChange.oldValue;  
                // Restore original cell text

                delete cellChanges[lastChangeKey];  
                // Remove the change from history
            }
        }
    }
});
