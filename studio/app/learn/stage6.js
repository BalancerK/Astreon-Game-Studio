// Stage 6 of the pathway: "Go online". There is no code to write here: this stage uses the Network lab to feel what makes online games hard (lag, jitter, lost
// packets) and what engines do about it (a server that decides, prediction, correction, interpolation). Each step is something done in the lab.
import { happened } from './checks.js';

/** @type {import('./session.js').Stage} */
export const STAGE_6 = {
  id: 'online',
  title: 'Go online',
  intro: 'When people play together, computers far apart must agree about one game over a network that is slow and loses things. You will not write code in this stage: '
    + 'you will use the Network lab to feel the problem, and then to see how online games get around it.',
  done: 'You have seen the three tricks every online game uses: a server that decides, a guess ahead on your own screen that is corrected when the truth arrives, '
    + 'and drawing other players a little in the past so they move smoothly. To build a real one, the multiplayer tutorial in the documentation walks through a card game, '
    + 'and the engine has the pieces (server, transport, prediction clock) that the lab was made from.',
  missions: [
    {
      id: 'lab',
      title: 'Start the lab',
      open: 'netlab',
      watch: [],
      task: [
        'The **Network lab** is a tiny online game with a pretend network between you and a server. A real server decides where everything is; you only send it what keys you hold.',
        'Press **Start the lab**, click on the picture, and steer the blue dot with the arrow keys. The dashed ring is where the server says you are.',
      ],
      check: happened('lab-start'),
      hints: ['The Network lab panel is in the Debug workspace, or open it from the View menu.', 'Click on the picture first so it can hear your keys.'],
      answer: 'Press "Start the lab" and move with the arrow keys.',
      why: 'Your keys go to the server as small packets, 30 times a second. The server moves you and sends back where you are. Everything you see about the game is a message from far away.',
    },
    {
      id: 'lag',
      title: 'Feel the lag',
      open: 'netlab',
      watch: [],
      task: [
        'Make the network slow. Move the **Lag each way** slider to **150 ms or more** and steer again. The round trip, shown beside the picture, is twice that.',
        'Notice that your dot still moves at once. That is the next step: it is guessing.',
      ],
      check: happened('lab-lag'),
      hints: ['The slider is beside the picture, under the buttons.', 'Try 200: it is a mobile connection on a bad day.'],
      answer: 'Drag "Lag each way" to 150 or more.',
      why: 'Even light takes time to cross an ocean: a packet from far away is already 100 ms old when it arrives. A game that waited for the server before showing your move would feel like moving through mud.',
    },
    {
      id: 'predict',
      title: 'Turn prediction off, then on',
      open: 'netlab',
      watch: [],
      task: [
        'With lag still on, untick **Prediction** and steer: now your dot only moves when the server tells you it did, a fifth of a second late. Feel that.',
        'Then tick **Prediction** again. The game moves you at once on your own screen, guessing that the server will agree.',
      ],
      check: happened('lab-predict-on'),
      hints: ['The checkboxes are under the sliders.', 'Watch the purple graph: it shows how far the picture is behind what you asked for.'],
      answer: 'Untick Prediction, move around, then tick it again.',
      why: 'Prediction means the client runs the same movement rules as the server and applies your keys immediately. Because both sides use the same rules, the guess is almost always right, and the game feels instant.',
    },
    {
      id: 'gust',
      title: 'Catch a wrong guess',
      open: 'netlab',
      watch: [],
      task: [
        'A guess can be wrong when the server knows something you do not. Press **Push me (the server does)** (or the **G** key) while you are moving.',
        'The server moved you; your guess did not know. Watch the orange graph jump, and see how the dot slides to the truth. Untick **Smooth corrections** and push again to see the jump unsoftened.',
      ],
      check: happened('lab-gust'),
      hints: ['The button is above the picture.', 'The bigger the lag, the later the correction arrives, and the further your guess has strayed.'],
      answer: 'Press "Push me (the server does)" while moving.',
      why: 'When the server\'s answer arrives, the client takes the server\'s position, replays the keys the server has not seen yet, and carries on. If the guess was right nothing changes; if it was wrong you are moved. That is reconciliation, and the server always wins.',
    },
    {
      id: 'loss',
      title: 'Lose some packets',
      open: 'netlab',
      watch: [],
      task: [
        'Networks lose packets. Move **Lost packets** to **10% or more** and steer. Watch the "Lost" counts and the orange graph.',
        'The game keeps working, because each packet says "this is where things are now", so a lost one is replaced by the next one 33 ms later.',
      ],
      check: happened('lab-loss'),
      hints: ['The slider is under Jitter.', 'Also try turning Interpolation off: the green bot starts to jump when snapshots are missing.'],
      answer: 'Drag "Lost packets" to 10% or more.',
      why: 'Games send positions many times a second and never wait for a lost one: waiting would stall everyone. Only things that must arrive (a chat message, a purchase) are sent in a way that retries, and they are sent rarely.',
    },
    {
      id: 'packets',
      title: 'Read a packet',
      open: 'netlab',
      watch: [],
      task: [
        'Look at the list of **Packets** beside the picture: the latest ones crossing the wire. Click one to read what it is.',
        'Notice how small they are: 7 bytes up and 25 bytes down. Small packets are cheap, which is why a game can send thirty a second to thousands of players.',
      ],
      check: happened('lab-packets'),
      hints: ['Click a line in the Packets list.', 'The arrows show the direction: out to the server, in from the server.'],
      answer: 'Click any packet in the list.',
      why: 'A game\'s network messages are a few numbers in a fixed layout, not text. Keeping them tiny and regular is most of what "netcode" is. The engine\'s protocol package does this for real games.',
    },
  ],
};
