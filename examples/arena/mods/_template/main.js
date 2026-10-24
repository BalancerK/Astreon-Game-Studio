// Your mod's code. It runs in a locked-down sandbox: no require/import, no process, no timers, no network.
// You get `engine.register({...})` and `engine.log(text)`. Hooks must be synchronous and return plain JSON.
//
//   onInit({ id, savedState })  called once at start (and after hot reload)
//   onFrame(frame)              frame = { tick, players: [{ id, x, y, hp }], kills: [{ killer, victim }] }
//                               return an array of commands: heal, damage, teleport, message (see docs/MODDING.md)
//   serialize()                 return state to carry across a hot reload
engine.register({
  onFrame(frame) {
    return [];
  },
});
