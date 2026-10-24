// The sample plugins that come with the studio: small, readable, and each one asks for as little as it can. The Plugins panel lists them with what each is allowed to do,
// and installs one with a click. Each file is a plugin like any other, so it is also the best way to learn how to write one: install it, then read it.

/** @type {{file: string, id: string, title: string, blurb: string}[]} `id` is the plugin's own id (the same as in its manifest). */
export const GALLERY = [
  { file: 'notes.plugin.js', id: 'notepad', title: 'Notepad', blurb: 'A place to write ideas down. It remembers what you wrote.' },
  { file: 'todo.plugin.js', id: 'todo-list', title: 'To-do list', blurb: 'Jobs for your game: add them, tick them off, and they are still there tomorrow.' },
  { file: 'dice.plugin.js', id: 'dice-roller', title: 'Dice and coins', blurb: 'Roll dice of every size and flip a coin, with a history of the rolls.' },
  { file: 'todo-finder.plugin.js', id: 'todo-finder', title: 'TODO finder', blurb: 'Lists every TODO, FIXME and HACK note in your code, with the file and line.' },
  { file: 'score-watch.plugin.js', id: 'score-watch', title: 'Number watcher', blurb: 'Shows the lowest, highest and latest of the numbers your game reports.' },
  { file: 'statistics.plugin.js', id: 'statistics', title: 'Project statistics', blurb: 'Counts the lines and bytes of every file, and can gather all your code into one file.' },
];

/** Where a sample's file is, relative to this module. */
export const sampleUrl = (file) => new URL(`./examples/${file}`, import.meta.url);
