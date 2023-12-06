document.addEventListener('keydown', event => {
    switch (event.code) {
        case "Backspace":
            // Delete key
            var selectedNotes = document.querySelectorAll('.selected');
            selectedNotes.forEach(noteElement => {
                noteElement.classList.remove('selected');
            });
            removeAllNotesFromLegend();
            break;

        // TODO: Toggling selected notes doesn't take into account already selected notes
        // Toggle selected notes for each key
        case "KeyA":
            // A key
            if (event.shiftKey) {
                // ASharp notes
                const aSharpNotes = document.querySelectorAll('.noteASharp');
                toggleSelectedNotes(aSharpNotes);
            } else {
                // A notes
                const aNotes = document.querySelectorAll('.noteA');
                toggleSelectedNotes(aNotes);
            }
            break;
        case "KeyB":
            // B key (only has B notes)
            if (event.shiftKey) {
                // C notes
                const cNotes = document.querySelectorAll('.noteC');
                toggleSelectedNotes(cNotes);
            } else {
                const bNotes = document.querySelectorAll('.noteB');
                toggleSelectedNotes(bNotes);
            }
            break;
        case "KeyC":
            // C key
            if (event.shiftKey) {
                // CSharp notes
                const cSharpNotes = document.querySelectorAll('.noteCSharp');
                toggleSelectedNotes(cSharpNotes);
            } else {
                // C notes
                const cNotes = document.querySelectorAll('.noteC');
                toggleSelectedNotes(cNotes);
            }
            break;
        case "KeyD":
            // D key
            if (event.shiftKey) {
                // DSharp notes
                const dSharpNotes = document.querySelectorAll('.noteDSharp');
                toggleSelectedNotes(dSharpNotes);
            } else {
                // D notes
                const dNotes = document.querySelectorAll('.noteD');
                toggleSelectedNotes(dNotes);
            }
            break;
        case "KeyE":
            // E key (only has E notes)
            if (event.shiftKey) {
                // F notes
                const fNotes = document.querySelectorAll('.noteF');
                toggleSelectedNotes(fNotes);
            } else {
                const eNotes = document.querySelectorAll('.noteE');
                toggleSelectedNotes(eNotes);
            }
            break;
        case "KeyF":
            // F key
            if (event.shiftKey) {
                // FSharp notes
                const fSharpNotes = document.querySelectorAll('.noteFSharp');
                toggleSelectedNotes(fSharpNotes);
            } else {
                // F notes
                const fNotes = document.querySelectorAll('.noteF');
                toggleSelectedNotes(fNotes);
            }
            break;
        case "KeyG":
            // G key
            if (event.shiftKey) {
                // GSharp notes
                const gSharpNotes = document.querySelectorAll('.noteGSharp');
                toggleSelectedNotes(gSharpNotes);
            } else {
                // G notes
                const gNotes = document.querySelectorAll('.noteG');
                toggleSelectedNotes(gNotes);
            }
            break;
        case "KeyR":
            // R key
            // Reverse the direction of the fretboard
            guitarNeckElement.classList.toggle('reverse');
        case "ArrowLeft":
            // Left arrow key
            // Check if guitarNeckElement has class 'reverse'
            getCurrentFretAndFretToSelect = guitarNeckElement.classList.contains('reverse') ?
                getCurrentFretAndHigherFret : getCurrentFretAndLowerFret
            selectShiftedFretNotes(getCurrentFretAndFretToSelect);
            updateLegend();
            break;
        case "ArrowRight":
            // Left arrow key
            // Check if guitarNeckElement has class 'reverse'
            getCurrentFretAndFretToSelect = guitarNeckElement.classList.contains('reverse') ?
                getCurrentFretAndLowerFret : getCurrentFretAndHigherFret
            selectShiftedFretNotes(getCurrentFretAndFretToSelect);
            updateLegend();
            break;
    }
});

function toggleSelectedNotes(notes) {
    // Toggle selected notes for each key
    // BUGORFEATURE: If any of the notes are already selected, deselect all notes 
    // on/after that fret.

    let isSelected = false;
    notes.forEach(noteElement => {
        // check if any of the notes are already selected
        if (noteElement.classList.contains('selected')) {
            isSelected = true;
        };
        if (isSelected) {
            // if any of the notes are already selected, deselect all
            noteElement.classList.remove('selected');
            const noteText = noteElement.getAttribute('data-note');
            removeNoteFromLegend(noteText);
        } else {
            // if none of the notes are already selected, select all
            noteElement.classList.add('selected');
            const noteText = noteElement.getAttribute('data-note');
            addNoteToLegend(noteText);
        }
    });
}

function updateLegend() {
    removeAllNotesFromLegend();
    const selectedNoteElements = document.querySelectorAll('.selected');
    selectedNoteElements.forEach(selectedNoteElement => {
        const noteText = selectedNoteElement.getAttribute('data-note');
        addNoteToLegend(noteText);
    });
}

function removeAllNotesFromLegend() {
    const legendNoteElements = document.querySelectorAll('.legendNote');
    legendNoteElements.forEach(legendNoteElement => {
        legendNoteElement.remove();
    });
}


function selectShiftedFretNotes(getCurrentFretAndFretToSelect) {
    // Shift all the selected notes to the left
    // Deselect all the selected notes and select the notes in the same index one container to the left
    selectedNotes = document.querySelectorAll('.selected');

    // Deselect the current note
    selectedNotes.forEach(noteElement => { noteElement.classList.remove('selected') });

    // Select the note in the same index one container to the left
    selectedNotes.forEach(noteElement => {
        var { noteFret: fretCurrent, noteFretSiblings: fretsToSelect } = getCurrentFretAndFretToSelect(noteElement);

        // Get the note at the same index in the previous container
        const index = Array.from(fretCurrent.children).indexOf(noteElement);
        fretsToSelect.forEach(fretToSelect => {
            const newNote = fretToSelect.children[index];

            // If there is a note at the same index in the previous container
            if (newNote !== undefined) {
                // Select the note
                newNote.classList.add('selected');
            }
        });
    });
}


function getCurrentFretAndLowerFret(noteElement) {
    // Get the previous container
    let noteFret = noteElement.parentElement;
    let noteFretSiblings = [];  // Multiple siblings if the current fret is the 12th fret

    // Get one fret to the left
    let noteFretSibling = noteFret.previousElementSibling;
    if (noteFretSibling !== null) {
        // If there is a previous fret, then append it to the list of siblings
        noteFretSiblings.push(noteFretSibling);
    }

    const guitarNeck = noteFret.parentElement;

    // If the current fret is the 1st fret, then shift note to the 11th fret
    if (Array.from(guitarNeck.children).indexOf(noteFret) === 0) {
        // Get 12th fret and append it to the list of siblings
        noteFretSibling = guitarNeck.children[11];
        noteFretSiblings.push(noteFretSibling);
    }

    return {
        noteFret: noteFret,
        noteFretSiblings: noteFretSiblings
    };
}


function getCurrentFretAndHigherFret(noteElement) {
    // Get the next container
    let noteFret = noteElement.parentElement;
    let noteFretSiblings = [];  // Multiple siblings if the current fret is the 12th fret

    // Get one fret to the right
    let noteFretSibling = noteFret.nextElementSibling;
    if (noteFretSibling !== null) {
        //  If there is a next fret, then append it to the list of siblings
        noteFretSiblings.push(noteFretSibling);
    }

    const guitarNeck = noteFret.parentElement;

    // If the current fret is the 12th fret, then shift note to both the 13th and 1st frets
    if (Array.from(guitarNeck.children).indexOf(noteFret) === 11) {
        // Get 1st fret and append it to the list of siblings
        noteFretSibling = guitarNeck.firstElementChild;
        noteFretSiblings.push(noteFretSibling);

    }

    return {
        noteFret: noteFret,
        noteFretSiblings: noteFretSiblings
    };
}