// TODO: Allow these to be configurable (and mapped to a frequency)
const stringNames = ['stringHighE', 'stringB', 'stringG', 'stringD', 'stringA', 'stringLowE'];
const stringStartingNotes = { stringHighE: 'E', stringB: 'B', stringG: 'G', stringD: 'D', stringA: 'A', stringLowE: 'E' };

// TODO: Add note aliases (e.g. CSharp = Db)
const noteNames = ['A', 'ASharp', 'B', 'C', 'CSharp', 'D', 'DSharp', 'E', 'F', 'FSharp', 'G', 'GSharp'];
const noteColors = { 'A': `rgb(255, 0, 0)`, 'ASharp': `rgb(255, 127, 0)`, 'B': `rgb(255, 255, 0)`, 'C': `rgb(127, 255, 0)`, 'CSharp': `rgb(0, 255, 0)`, 'D': `rgb(0, 255, 127)`, 'DSharp': `rgb(0, 255, 255)`, 'E': `rgb(0, 127, 255)`, 'F': `rgb(0, 0, 255)`, 'FSharp': `rgb(127, 0, 255)`, 'G': `rgb(255, 0, 255)`, 'GSharp': `rgb(255, 0, 127)` };

const guitarNeckElement = document.querySelector('.guitarNeck');
const numFretsToShow = 21;  // TODO: Make this based on innerWidth of window
const markedFretIndices = [3, 5, 7, 9, 12, 15, 17, 19];

// Calculate width of fret in percentage
const widthOfFret = Math.floor(100 / numFretsToShow);

for (let i = 0; i < numFretsToShow; i++) {

    // Add a guitarFretElement within the guitarNeckElement
    const guitarFretElement = document.createElement('div');
    guitarFretElement.classList.add('guitarFret');
    guitarFretElement.classList.add(`fret${i + 1}`);
    if (markedFretIndices.includes(i + 1)) {
        guitarFretElement.classList.add('markedFret');
    }
    guitarFretElement.style.width = `${widthOfFret}%`;
    guitarNeckElement.appendChild(guitarFretElement);

    // Add 6 noteElements within each guitarFretElement
    for (let j = 0; j < 6; j++) {
        const noteElement = document.createElement('div');
        noteElement.classList.add('guitarNote');

        // Add class for string name
        stringName = stringNames[j];
        noteElement.classList.add(stringName);

        // Add class for note name
        openNote = stringStartingNotes[stringName];
        fretNoteIndex = noteNames.indexOf(openNote) + i + 1;
        fretNote = noteNames[fretNoteIndex % noteNames.length];
        noteElement.classList.add(`note${fretNote}`);

        // Set background color
        noteElement.style.backgroundColor = noteColors[fretNote];

        guitarFretElement.appendChild(noteElement);
    }

}