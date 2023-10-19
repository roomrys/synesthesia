// TODO: Allow these to be configurable (and mapped to a frequency)
const stringNames = ['stringHighE', 'stringB', 'stringG', 'stringD', 'stringA', 'stringLowE'];
const stringStartingNotes = { stringHighE: 'E', stringB: 'B', stringG: 'G', stringD: 'D', stringA: 'A', stringLowE: 'E' };

// TODO: Add note aliases (e.g. CSharp = Db)
const noteNames = ['A', 'ASharp', 'B', 'C', 'CSharp', 'D', 'DSharp', 'E', 'F', 'FSharp', 'G', 'GSharp'];
const noteNamesWithSharpAsHash = {
    'A': 'A',
    'ASharp': 'A#',
    'B': 'B',
    'C': 'C',
    'CSharp': 'C#',
    'D': 'D',
    'DSharp': 'D#',
    'E': 'E',
    'F': 'F',
    'FSharp': 'F#',
    'G': 'G',
    'GSharp': 'G#'
};
const noteNamesWithHashAsSharp = {};
for (const key in noteNamesWithSharpAsHash) {
    const value = noteNamesWithSharpAsHash[key];
    noteNamesWithHashAsSharp[value] = key;
};

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
        fretNoteText = noteNamesWithSharpAsHash[fretNote];
        noteElement.classList.add(`note${fretNote}`);
        noteElement.setAttribute('data-note', fretNoteText);

        guitarFretElement.appendChild(noteElement);
    }

}