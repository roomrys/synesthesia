document.addEventListener('keydown', event => {
    switch (event.code) {
        case "Backspace":
            // Delete key
            const selectedNotes = document.querySelectorAll('.selected');
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
            const bNotes = document.querySelectorAll('.noteB');
            toggleSelectedNotes(bNotes);
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
            const eNotes = document.querySelectorAll('.noteE');
            toggleSelectedNotes(eNotes);
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

function removeAllNotesFromLegend() {
    const legendNoteElements = document.querySelectorAll('.legendNote');
    legendNoteElements.forEach(legendNoteElement => {
        legendNoteElement.remove();
    });
}