// Healing aura: every 30 ticks (twice a second) heal each wounded player by 2.
// A mod never touches the game. It receives a plain-data frame and returns a list of commands; the game decides.
engine.register({
  onFrame(frame) {
    const commands = [];
    for (const p of frame.players) {
      if (p.hp > 0 && p.hp < 100) commands.push({ op: 'heal', id: p.id, amount: 2 });
    }
    return commands;
  },
});
