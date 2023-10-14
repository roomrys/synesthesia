const noteElements = document.querySelectorAll('.guitarNote');

noteElements.forEach(noteElement => {
    noteElement.addEventListener('click', () => {
        if (noteElement.classList.contains('selected')) {
            noteElement.classList.remove('selected');
        } else {
            noteElement.classList.add('selected');
        }
    });
});