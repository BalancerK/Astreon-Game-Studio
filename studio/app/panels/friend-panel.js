// Play with a friend: two people, two browsers, one game. You swap two short codes (by chat, text message, anything), and then both browsers run the game and trade only the
// keys being held. Nothing goes through a server and nothing is stored. The game has to be repeatable (the kit's games are) and read `inputs` for the second player.
import { h, button, fill } from '../ui/dom.js';
import { FriendLink, fingerprint } from '../net/friend.js';

const INTRO = 'Play your game with a friend over the internet: one of you makes an invitation code and sends it, '
  + 'the other pastes it and sends an answer code back.';
const DIFFERENT = 'Your friend has a different version of the game. Send them your project so you both play the same one, then try again.';

export function friendPanel(studio) {
  return {
    id: 'friend',
    title: 'Play with a friend',
    icon: 'play',
    create() {
      let link = null;
      let code = '';
      const status = h('p', { class: 'lab-explain', role: 'status', text: INTRO });
      const body = h('div', { class: 'lab-controls' });
      const el = h('div', { class: 'panel-body art lab', 'aria-label': 'Play with a friend' }, status, body);
      const say = (text) => { status.textContent = text; };

      function fresh() {
        link?.close('stopped');
        studio.runner.netStop();
        code = '';
        link = new FriendLink({ fingerprint: fingerprint(studio.gameFiles()) });
        const l = link;
        l.on('connected', () => say('Connected. Checking you both have the same game…'));
        l.on('mismatch', () => say(DIFFERENT));
        l.on('ready', ({ me, players }) => {
          studio.runner.netStart({ me, players });
          l.release();
          say(`Playing! You are player ${me + 1}. Click the game and use the arrow keys.`);
          draw();
        });
        l.on('message', ({ from, message }) => studio.runner.netMessage(from, message));
        l.on('closed', (why) => { studio.runner.netStop(); say(`Stopped (${why}).`); draw(); });
        return l;
      }
      studio.runner.on('netOut', (m) => link?.send(m));
      studio.runner.on('net', (n) => {
        if (n.desync !== null) say(`The two games stopped matching at tick ${n.desync}. Something in the game is not repeatable.`);
      });

      async function host() {
        const l = fresh();
        try {
          code = await l.invite();
          say('Send this invitation code to your friend. Then paste the answer they send back.');
        } catch (e) { say(`Could not make an invitation: ${e.message}`); }
        draw();
      }
      async function join(text) {
        const l = fresh();
        try {
          code = await l.join(text.trim());
          say('Send this answer code back to the host. Then wait: the game starts by itself.');
        } catch (e) { say(`That does not look like an invitation code: ${e.message}`); }
        draw();
      }
      async function accept(text) {
        try {
          await link.accept(text.trim());
          say('Connecting…');
        } catch (e) { say(`That answer did not work: ${e.message}`); }
      }

      function draw() {
        const codeBox = code
          ? h('textarea', { class: 'lab-code', readOnly: true, rows: 4, value: code, aria: { label: 'Your code' },
            on: { focus: (e) => e.target.select() } })
          : null;
        const box = (placeholder, label) => h('textarea', { rows: 3, placeholder, aria: { label } });
        const invitation = box('Paste the invitation code here', 'Invitation code from the host');
        const answer = box('Paste the answer code here', 'Answer code from your friend');
        const hosting = link?.me === 0 && link.state === 'inviting';
        fill(body,
          h('div', { class: 'art-label', text: 'I want to host' }),
          button({ text: 'Make an invitation', class: 'small primary', onClick: host, label: 'Make an invitation' }),
          hosting ? h('div', {}, codeBox, answer,
            button({ text: 'Connect', class: 'small', onClick: () => accept(answer.value), label: 'Connect' })) : null,
          h('div', { class: 'art-label', text: 'I was invited' }),
          invitation,
          button({ text: 'Join', class: 'small primary', onClick: () => join(invitation.value), label: 'Join' }),
          link?.me === 1 ? codeBox : null,
          link ? button({ text: 'Stop', class: 'small', icon: 'stop', onClick: () => link?.close('you stopped'), label: 'Stop' }) : null);
      }
      draw();
      return { el, focus: () => body.querySelector('button')?.focus(), expose: { get link() { return link; } } };
    },
  };
}
