// A studio plugin: dice and coins for testing a game idea on paper first, or settling an argument about who plays first. Pick a die, press Roll. It adds commands
// to the palette too ("Roll a six-sided die", "Flip a coin"). It asks for no permissions.
export const manifest = {
  "id": "dice-roller",
  "name": "Dice and coins",
  "version": "1.0.0",
  "description": "Roll dice (4, 6, 8, 10, 12, 20, 100 sides) and flip a coin, with a history of the rolls.",
  "permissions": [],
  "panels": [{ "id": "dice", "title": "Dice" }],
  "commands": [{ "id": "d6", "title": "Roll a six-sided die" }, { "id": "coin", "title": "Flip a coin" }]
};

export default function activate(studio) {
  const roll = (sides) => 1 + Math.floor(Math.random() * sides);

  studio.panel(async (root) => {
    root.innerHTML = '<h3>Dice</h3><div id="buttons"></div><p style="font-size:2em;margin:.3em 0" id="now" aria-live="polite">–</p><p class="dim" id="history"></p>';
    const history = [];
    const show = (label, value) => {
      root.querySelector('#now').textContent = value;
      history.unshift(label + ': ' + value);
      root.querySelector('#history').textContent = history.slice(0, 12).join('   ');
    };
    const buttons = root.querySelector('#buttons');
    for (const sides of [4, 6, 8, 10, 12, 20, 100]) {
      const b = document.createElement('button');
      b.textContent = 'd' + sides;
      b.className = sides === 6 ? 'primary' : '';
      b.addEventListener('click', () => show('d' + sides, roll(sides)));
      buttons.append(b, ' ');
    }
    const coin = document.createElement('button');
    coin.textContent = 'Flip a coin';
    coin.addEventListener('click', () => show('coin', roll(2) === 1 ? 'heads' : 'tails'));
    buttons.append(coin);
  });

  studio.command('d6', () => { studio.ui.toast('You rolled a ' + roll(6) + '.', 'info'); });
  studio.command('coin', () => { studio.ui.toast(roll(2) === 1 ? 'Heads.' : 'Tails.', 'info'); });
}
