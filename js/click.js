const noteElements = document.querySelectorAll('.guitarNote');

noteElements.forEach(noteElement => {
    noteElement.addEventListener('click', () => {
        if (noteElement.classList.contains('selected')) {
            noteElement.classList.remove('selected');

            // Remove from the legend
            const noteText = noteElement.getAttribute('data-note');
            removeNoteFromLegend(noteText);
        } else {
            noteElement.classList.add('selected');

            // Add to the legend
            const noteText = noteElement.getAttribute('data-note');
            addNoteToLegend(noteText);
        }
    });
});

function removeNoteFromLegend(noteText) {
    // Check that there are not multiple notes of the same name in the legend
    const selectedNoteElements = document.querySelectorAll('.selected');
    let numSelectedNotes = 0;
    selectedNoteElements.forEach(selectedNoteElement => {
        if (selectedNoteElement.getAttribute('data-note') === noteText) {
            numSelectedNotes++;
        }
    }
    );

    console.log(numSelectedNotes);
    // If there are multiple notes of the same name in the legend, do nothing
    if (numSelectedNotes >= 1) {
        return;
    }

    const legendElement = document.querySelector('.legend');
    const legendNoteElements = document.querySelectorAll('.legendNote');
    legendNoteElements.forEach(legendNoteElement => {
        if (legendNoteElement.textContent === noteText) {
            legendNoteElement.remove();
        }
    });
}

function addNoteToLegend(noteText) {
    const legendElement = document.querySelector('.legend');

    // Check if note is already in legend
    const legendNoteElements = document.querySelectorAll('.legendNote');
    let isInLegend = false;
    legendNoteElements.forEach(legendNoteElement => {
        if (legendNoteElement.textContent === noteText) {
            isInLegend = true;
        }
    });

    // If note is already in legend, do nothing
    if (isInLegend) {
        return;
    }

    // Otherwise, add note to legend
    const legendNoteElement = document.createElement('div');
    legendNoteElement.textContent = noteText;
    fretNote = noteNamesWithHashAsSharp[noteText];
    legendNoteElement.classList.add(`note${fretNote}`);
    legendNoteElement.classList.add('legendNote');
    legendElement.appendChild(legendNoteElement);
}