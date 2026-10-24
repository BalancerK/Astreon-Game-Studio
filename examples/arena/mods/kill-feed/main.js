// Kill feed: turn each elimination in the frame into a message for all players.
engine.register({
  onFrame(frame) {
    return frame.kills.map((k) => ({ op: 'message', text: 'Player ' + k.killer + ' eliminated ' + k.victim }));
  },
});
