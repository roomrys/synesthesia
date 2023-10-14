const guitarNeckElement = document.querySelector('.guitarNeck');
const numFretsToShow = 21;  // TODO: Make this based on innerWidth of window

// Calculate width of fret in percentage
const widthOfFret = Math.floor(100 / numFretsToShow);

for (let i = 0; i < numFretsToShow; i++) {

    // Add a guitarFretElement within the guitarNeckElement
    const guitarFretElement = document.createElement('div');
    guitarFretElement.classList.add('guitarFret');
    guitarFretElement.style.width = `${widthOfFret}%`;
    guitarNeckElement.appendChild(guitarFretElement);

    // Add 6 noteElements within each guitarFretElement
    for (let j = 0; j < 6; j++) {
        const noteElement = document.createElement('div');
        noteElement.classList.add('guitarNote');
        guitarFretElement.appendChild(noteElement);
    }

}