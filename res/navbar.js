// Global variables
const table = document.getElementById('excel-table');
const numRows = 50;
const numCols = 160;

// Event listeners for navbar buttons
document.getElementById('convertLuaButton').addEventListener('click', convertToLua);
document.getElementById('saveCSVButton').addEventListener('click', saveToCSV);
document.getElementById('loadCSVButton').addEventListener('click', loadFromCSV);
document.getElementById('deleteAllButton').addEventListener('click', deleteAllCells);
document.getElementById('helpButton').addEventListener('click', displayHelp);

// Function to convert layout to LUA format
function convertToLua() {
    const TemplateTrack = "{y, x, \"z\"},";
    const TemplateSwitch = "{y, x, \"z\", \"r\", \"q\"},";
    const TemplateSignal = "{y, x, \"z\", \"q\"},";

    let StorageSignals = "\n";
    let StorageTracks = "\n";
    let StorageSwitches = "\n";

    let Config = "Config = {}\n";
    let Tracks = "Config.Tracks = {";
    let Switches = "Config.Switches = {";
    let Signals = "Config.Signals = {";
    let Return = "return Config";
    let End = "}" + "\n";
    let Output;

    const table = document.getElementById('excel-table');

    // Loop through each cell in the table
    for (let row = 0; row < table.rows.length; row++) {
        for (let col = 0; col < table.rows[row].cells.length; col++) {
            const cell = table.rows[row].cells[col];
            const cellText = cell.textContent.trim();

            if (cellText.length > 2) {
                if (cellText.charAt(2) === 'V') {
                    // Switches
                    let Temp = TemplateSwitch.replace("x", row);
                    Temp = Temp.replace("y", col);
                    Temp = Temp.replace('z', cellText.charAt(0));
                    Temp = Temp.replace('r', cellText.charAt(4));
                    Temp = Temp.replace("q", cellText.substring(6));
                    Temp = Temp + '\n';
                    StorageSwitches += Temp;
                } else if (cellText.charAt(2) === 'N') {
                    // Signals
                    let Temp2 = TemplateSignal.replace("x", row);
                    Temp2 = Temp2.replace("y", col);
                    Temp2 = Temp2.replace('z', cellText.charAt(0));
                    Temp2 = Temp2.replace("q", cellText.substring(4));
                    Temp2 = Temp2 + '\n';
                    StorageSignals += Temp2;
                }
            } else if (cellText === "═") {
                // Tracks
                let trackSegment = cellText;
                let loop = 1;

                while ((col + loop) < table.rows[row].cells.length && table.rows[row].cells[col + loop].textContent.trim() === "═") {
                    trackSegment += table.rows[row].cells[col + loop].textContent.trim();
                    loop++;
                }

                if ((col + loop) < table.rows[row].cells.length) {
                    const nextCell = table.rows[row].cells[col + loop].textContent.trim();
                    if (nextCell === "╗" || nextCell === "╝" || nextCell === "╚" || nextCell === "╗") {
                        trackSegment += nextCell;
                        loop++;
                    }
                }

                let Temp3 = TemplateTrack.replace("x", row);
                Temp3 = Temp3.replace("y", col);
                Temp3 = Temp3.replace("z", trackSegment);
                Temp3 = Temp3 + '\n';

                StorageTracks += Temp3;
                col += loop - 1; // Update col to skip over the processed track cells
            }
        }
    }

    Output = Config + Signals + StorageSignals + End + Tracks + StorageTracks + End + Switches + StorageSwitches + End + Return;
    
    // Copy to clipboard and alert
    navigator.clipboard.writeText(Output).then(() => {
        alert('Code copied to clipboard');
    }).catch(err => {
        console.error('Failed to copy text to clipboard', err);
    });
}

// Function to save table content to a CSV file
function saveToCSV() {
    let csvContent = '';
    for (let row = 0; row < numRows; row++) {
        for (let col = 0; col < numCols; col++) {
            const cell = table.rows[row].cells[col];
            const cellText = cell.textContent.trim() || 'null';
            csvContent += cellText + ',';
        }
        csvContent += '\n';
    }
    downloadCsv(csvContent);
}

// Function to download CSV file
function downloadCsv(content) {
    const blob = new Blob([content], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'table_data.csv';
    a.click();
    URL.revokeObjectURL(url);
}

// Function to load CSV file content into the table
function loadFromCSV() {
    const fileInput = document.createElement('input');
    fileInput.type = 'file';
    fileInput.accept = '.csv';

    fileInput.addEventListener('change', (event) => {
        const file = event.target.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (e) => {
            const csvContent = e.target.result;
            const rows = csvContent.split('\n');
            for (let row = 0; row < numRows; row++) {
                const rowData = rows[row] ? rows[row].split(',') : [];
                for (let col = 0; col < numCols; col++) {
                    const cell = table.rows[row].cells[col];
                    const div = cell.querySelector('div');
                    if (rowData[col] !== "null") {
                        div.textContent = rowData[col] || '';
                    }
                }
            }
        };
        reader.readAsText(file);
    });

    fileInput.click();
}


// Function to delete all text in the div within each cell
function deleteAllCells() {
    for (let row = 0; row < numRows; row++) {
        for (let col = 0; col < numCols; col++) {
            const cell = table.rows[row].cells[col];
            const div = cell.querySelector('div');
            div.textContent = ''; // Clear the text content of the div
        }
    }
}

// Add event listener to the delete all cells button
document.getElementById('deleteAllButton').addEventListener('click', deleteAllCells);


// Function to display help
function displayHelp() {
    const helpURL = 'help.html';
    const link = document.createElement('a');
    link.href = helpURL;
    link.target = '_blank';
    link.click();
}
