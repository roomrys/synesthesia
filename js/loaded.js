// Get the element where you want to add the text
const element = document.querySelector('.textDisplay');

// Define the text you want to add
const text = `Press the note name on your keyboard to select all notes of that name.
Shift indicates a sharp.
Backspace clears the selection.
Enjoy the synesthetic experience!`;

// Define the typing speed (in milliseconds per character)
const typingSpeed = 80;

// Define a function to simulate typing one character at a time
function typeText(text, index) {
    if (index < text.length) {
        // Add the next character to the element
        element.innerHTML += text.charAt(index);

        // Schedule the next character to be added after a delay
        setTimeout(() => {
            typeText(text, index + 1);
        }, typingSpeed);
    }
}

// Call the function to start typing the text when the DOM loads
document.addEventListener('DOMContentLoaded', () => {
    typeText(text, 0);
});