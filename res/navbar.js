import { numRows, numCols } from "./config.js";

const table = document.getElementById('excel-table');  
// Reference to the editable grid table

document.getElementById('convertLuaButton').addEventListener('click', convertToLua);  
// Converts all cell content into formatted LUA configuration

document.getElementById('saveCSVButton').addEventListener('click', saveToCSV);  
// Save table into a CSV file

document.getElementById('loadCSVButton').addEventListener('click', loadFromCSV);
// Load CSV file into the grid

document.getElementById('loadLuaButton').addEventListener('click', loadFromLua);
// Load a LUA config file (as produced by convertToLua) back into the grid

document.getElementById('deleteAllButton').addEventListener('click', deleteAllCells);  
// Clear all cells

document.getElementById('helpButton').addEventListener('click', displayHelp);  
// Open help page in a new tab


// Converts the entire table content into LUA configuration format
function convertToLua() {

    // Templates for various LUA entries
    const TemplateTrack = "{y, x, \"z\"},";
    const TemplateSwitch = "{y, x, \"z\", \"r\", \"q\"},";
    // A physical switch block that's placed/wired backwards from every other one -- ORMS
    // reads a 6th "true" element to flip which activate() boolean it sends for that one
    // switch, while the two icons keep their normal meaning (first = deactivated look,
    // second = activated look) for every other switch and for the GUI/pathfinding.
    const TemplateSwitchInverted = "{y, x, \"z\", \"r\", \"q\", true},";
    const TemplateCrossing = "{y, x, \"z\", \"r\", \"q\"},";
    const TemplateSignal = "{y, x, \"z\", \"q\"},";
    const TemplateLabel = "{y, x, \"q\"},";

    // Storage for the categorized LUA strings
    let StorageSignals = "\n";
    let StorageTracks = "\n";
    let StorageSwitches = "\n";
    let StorageCrossings = "\n";
    let StorageLable = "\n";

    // The structure of the exported LUA table
    let Config = "Config = {}\n";
    let Tracks = "Config.Tracks = {";
    let Switches = "Config.Switches = {";
    let Signals = "Config.Signals = {";
    let Crossings = "Config.Crossings = {";
    let Labels = "Config.Labels = {";
    let Return = "return Config";
    let End = "}\n";
    let Output;

    const table = document.getElementById('excel-table');  
    // Fresh reference (not strictly necessary, but harmless)


    // Loop over every cell in the grid
    for (let row = 0; row < table.rows.length; row++) {
        for (let col = 0; col < table.rows[row].cells.length; col++) {

            const cell = table.rows[row].cells[col];
            const cellText = cell.textContent.trim();  
            // Get cleaned text for processing

            //Track labels, switches, signals, etc.
            if (cellText.length > 2) {

                // Label: begins with 'L'
                if (cellText.charAt(0) === 'L') {
                    let Temp2 = TemplateLabel.replace("x", row);
                    Temp2 = Temp2.replace("y", col);
                    Temp2 = Temp2.replace('q', cellText.substring(2));  
                    // Label text after "L "

                    StorageLable += Temp2 + '\n';
                }

                // Switch (e.g., "═ V ═ Vy1"). "I" instead of "V" marks a switch whose
                // physical block is inverted (see TemplateSwitchInverted above) -- same
                // format otherwise, just a different marker character so the fixed
                // character positions below don't need to change.
                else if (cellText.charAt(2) === 'V' || cellText.charAt(2) === 'I') {
                    const template = cellText.charAt(2) === 'I' ? TemplateSwitchInverted : TemplateSwitch;
                    let Temp = template.replace("x", row);
                    Temp = Temp.replace("y", col);
                    Temp = Temp.replace('z', cellText.charAt(0));
                    // First letter is type

                    Temp = Temp.replace('r', cellText.charAt(4));
                    // Direction char

                    Temp = Temp.replace("q", cellText.substring(6));
                    // ID portion

                    StorageSwitches += Temp + '\n';
                }

                // Signal (e.g., "◀ N S1")
                else if (cellText.charAt(2) === 'N') {
                    let Temp2 = TemplateSignal.replace("x", row);
                    Temp2 = Temp2.replace("y", col);
                    Temp2 = Temp2.replace('q', cellText.charAt(0));  
                    // Symbol

                    Temp2 = Temp2.replace("z", cellText.substring(4));  
                    // Signal ID

                    StorageSignals += Temp2 + '\n';
                }

                // Crossing (e.g., "╪ P P4953")
                else if (cellText.charAt(2) === 'P') {
                    let Temp = TemplateCrossing.replace("x", row);
                    Temp = Temp.replace("y", col);
                    Temp = Temp.replace('z', cellText.charAt(0));  
                    // Symbol type

                    Temp = Temp.replace('r', cellText.charAt(4));  
                    // Orientation

                    Temp = Temp.replace("q", cellText.substring(6));  
                    // Crossing ID

                    StorageCrossings += Temp + '\n';
                }
            }

            //Track segments
            else if (["═", "╗", "╝", "╚", "╔", "╥", "╨", "╡", "╞", "║", "︹", "︺", "⦘", "⦗", "╠", "╣", "╦", "╩"].includes(cellText)) {

                let trackSegment = cellText;  
                // Starting symbol of the track

                let loop = 1;

                // Collect continuous track symbols to the right
                while (["═", "︹", "︺", "⦘", "⦗"].includes((col + loop) < table.rows[row].cells.length && table.rows[row].cells[col + loop].textContent.trim())) {

                    trackSegment += table.rows[row].cells[col + loop].textContent.trim();
                    loop++;
                }

                // Check next special symbols after main segment
                if ((col + loop) < table.rows[row].cells.length) {
                    const nextCell = table.rows[row].cells[col + loop].textContent.trim();

                    if (["╗", "╝", "╚", "╔", "╥", "╨", "╡", "╞", "║", "︹", "︺", "⦘", "⦗", "╠", "╣", "╦", "╩"].includes(nextCell)) {
                        trackSegment += nextCell;
                        loop++;
                    }
                }

                // Convert to template
                let Temp3 = TemplateTrack.replace("x", row);
                Temp3 = Temp3.replace("y", col);
                Temp3 = Temp3.replace("z", trackSegment);

                StorageTracks += Temp3 + '\n';

                col += loop - 1;  
                // Skip processed track cells
            }
        }
    }


    // Combine all parts into final output
    Output =
        Config +
        Signals + StorageSignals + End +
        Tracks + StorageTracks + End +
        Switches + StorageSwitches + End +
        Crossings + StorageCrossings + End +
        Labels + StorageLable + End +
        Return;


    // Open the generated code in a new window
    const newWindow = window.open();
    newWindow.document.write(`
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Generated Code</title>
            <link rel="stylesheet" href="style.css">
        </head>
        <body>
            <div class="container">
                <pre>${Output}</pre>
            </div>
        </body>
        </html>
    `);
}

function saveToCSV() {

    let csvContent = '';

    // Loop over every row/column
    for (let row = 0; row < numRows; row++) {
        for (let col = 0; col < numCols; col++) {

            const cell = table.rows[row].cells[col];
            const cellText = cell.textContent.trim() || 'null';  
            // Use 'null' to preserve empty cells

            csvContent += cellText + ',';  
            // CSV value + comma
        }
        csvContent += '\n';  
        // New line per row
    }

    downloadCsv(csvContent);  
    // Trigger download
}

function downloadCsv(content) {

    const blob = new Blob([content], { type: 'text/csv' });  
    // Create file blob

    const url = URL.createObjectURL(blob);  
    // Temporary file URL

    const a = document.createElement('a');  
    // Dummy anchor to trigger download

    a.href = url;
    a.download = 'table_data.csv';
    a.click();  
    // Programmatically start download

    URL.revokeObjectURL(url);  
    // Cleanup temporary URL
}

function loadFromCSV() {

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv';  
    // Restrict file chooser to CSV

    fileInput.addEventListener('change', (event) => {

        const file = event.target.files[0];
        if (!file) return;  

        const reader = new FileReader();

        reader.onload = (e) => {

            const csvContent = e.target.result;  
            const rows = csvContent.split('\n');  
            // Split CSV into rows

            deleteAllCells();  
            // Clear existing table first

            for (let row = 0; row < numRows; row++) {
                const rowData = rows[row] ? rows[row].split(',') : [];

                for (let col = 0; col < numCols; col++) {

                    const cell = table.rows[row].cells[col];
                    const div = cell.querySelector('div');

                    if (rowData[col] !== "null") {
                        div.textContent = rowData[col] || '';  
                        // Apply cell text
                    }
                }
            }
        };

        reader.readAsText(file);  
        // Read CSV file
    });

    fileInput.click();  
    // Open file chooser
}

function loadFromLua() {

    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.lua';
    // Restrict file chooser to LUA

    fileInput.addEventListener('change', (event) => {

        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();

        reader.onload = (e) => {
            parseLuaContent(e.target.result);
        };

        reader.readAsText(file);
        // Read LUA file
    });

    fileInput.click();
    // Open file chooser
}

// Parses a Config.* LUA table (the format written by convertToLua) and
// rebuilds the grid from it. Each entry is "{col, row, ...fields},"; the
// field layout per category mirrors the templates in convertToLua exactly.
function parseLuaContent(content) {

    deleteAllCells();
    // Clear existing table first

    content = content.replace(/\r\n/g, '\n');

    // Matches "Config.<Name> = { ...entries... }" blocks
    const sectionPattern = /Config\.(\w+)\s*=\s*\{([\s\S]*?)\n\s*\}/g;

    // Matches a single "{col, row, "f1"[, "f2"][, "f3"][, true]}," entry
    const entryPattern = /\{\s*(-?\d+)\s*,\s*(-?\d+)\s*,\s*"((?:[^"\\]|\\.)*)"(?:\s*,\s*"((?:[^"\\]|\\.)*)")?(?:\s*,\s*"((?:[^"\\]|\\.)*)")?(?:\s*,\s*(true))?\s*\}/g;

    let sectionMatch;
    while ((sectionMatch = sectionPattern.exec(content)) !== null) {

        const sectionName = sectionMatch[1];
        const sectionBody = sectionMatch[2];

        entryPattern.lastIndex = 0;
        let entryMatch;

        while ((entryMatch = entryPattern.exec(sectionBody)) !== null) {

            const col = parseInt(entryMatch[1], 10);
            const row = parseInt(entryMatch[2], 10);
            const f1 = entryMatch[3];
            const f2 = entryMatch[4];
            const f3 = entryMatch[5];
            const inverted = entryMatch[6] === 'true';

            if (row < 0 || row >= numRows || col < 0 || col >= numCols) continue;
            // Skip out-of-range coordinates rather than crashing on a hand-edited file

            switch (sectionName) {

                case 'Tracks':
                    // f1 is the track symbol run, one character per cell
                    placeTrackSegment(row, col, f1);
                    break;

                case 'Switches':
                    // f1: type, f2: direction char, f3: id, inverted -> "I" marker
                    setCellText(row, col, `${f1} ${inverted ? 'I' : 'V'} ${f2} ${f3}`);
                    break;

                case 'Signals':
                    // f1: signal id, f2: symbol
                    setCellText(row, col, `${f2} N ${f1}`);
                    break;

                case 'Crossings':
                    // f1: symbol, f2: orientation, f3: id
                    setCellText(row, col, `${f1} P ${f2} ${f3}`);
                    break;

                case 'Labels':
                    // f1: label text
                    setCellText(row, col, `L ${f1}`);
                    break;
            }
        }
    }
}

function setCellText(row, col, text) {
    const cell = table.rows[row] && table.rows[row].cells[col];
    if (!cell) return;

    const div = cell.querySelector('div');
    if (div) div.textContent = text;
}

function placeTrackSegment(row, col, segment) {
    for (let i = 0; i < segment.length && col + i < numCols; i++) {
        setCellText(row, col + i, segment[i]);
    }
}

function deleteAllCells() {
    for (let row = 0; row < numRows; row++) {
        for (let col = 0; col < numCols; col++) {

            const cell = table.rows[row].cells[col];
            const div = cell.querySelector('div');

            div.textContent = '';  
            // Remove text from cell
        }
    }
}


// Allow button to trigger the delete function
document.getElementById('deleteAllButton').addEventListener('click', deleteAllCells);

function displayHelp() {

    const helpURL = 'help.html';  
    // Help file URL

    const link = document.createElement('a');
    link.href = helpURL;
    link.target = '_blank';  
    // Open in new tab

    link.click();  
    // Trigger opening
}
