import { numRows, numCols } from "./config.js";

const table = document.getElementById('excel-table');  
// Reference to the editable grid table

document.getElementById('convertLuaButton').addEventListener('click', convertToLua);  
// Converts all cell content into formatted LUA configuration

document.getElementById('saveCSVButton').addEventListener('click', saveToCSV);  
// Save table into a CSV file

document.getElementById('loadCSVButton').addEventListener('click', loadFromCSV);  
// Load CSV file into the grid

document.getElementById('deleteAllButton').addEventListener('click', deleteAllCells);  
// Clear all cells

document.getElementById('helpButton').addEventListener('click', displayHelp);  
// Open help page in a new tab


// Converts the entire table content into LUA configuration format
function convertToLua() {

    // Templates for various LUA entries
    const TemplateTrack = "{y, x, \"z\"},";
    const TemplateSwitch = "{y, x, \"z\", \"r\", \"q\"},";
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

                // Switch (e.g., "═ V ═ Vy1")
                else if (cellText.charAt(2) === 'V') {
                    let Temp = TemplateSwitch.replace("x", row);
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
