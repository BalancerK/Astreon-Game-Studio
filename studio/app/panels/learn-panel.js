// The Learn panel: the guided pathway, as a card beside the code. It shows one mission at a time (what to do, a hint when asked for, the answer last), what
// is done, and why a finished mission works. It never locks anything: every button that moves on is always there, and the guide can be turned off.
import { h, button, fill } from '../ui/dom.js';
import { richPieces } from '../learn/rich.js';

/** Text with `code` and **bold** as page elements. */
const piece = (p) => (p.kind === 'code' ? h('code', { text: p.text }) : p.kind === 'bold' ? h('strong', { text: p.text }) : p.text);
const rich = (text) => richPieces(text).map(piece);
const paragraphs = (list) => list.map((t) => h('p', {}, rich(t)));
const codeBox = (text) => h('pre', { class: 'learn-code', tabIndex: 0, aria: { label: 'Code to write' }, text });

export function learnPanel(studio) {
  return {
    id: 'learn',
    title: 'Learn',
    icon: 'edit',
    create() {
      const head = h('div', { class: 'learn-head' });
      const body = h('div', { class: 'learn-body', tabIndex: -1 });
      const live = h('div', { class: 'sr-only', role: 'status', aria: { live: 'polite' } });
      const el = h('div', { class: 'panel-body learn', aria: { label: 'Guided pathway' } }, head, body, live);
      let lastDone = 0;

      const dots = (s) => h('div', { class: 'learn-dots', role: 'list', aria: { label: 'Missions' } },
        s.outline().flatMap((stage) => [
          h('span', { class: 'stage-name', text: stage.title }),
          ...stage.missions.map((m) => h('span', {
            class: `dot ${m.state}`, role: 'listitem', title: m.title, aria: { label: `${m.title}: ${m.state}` },
          })),
        ]));

      function none() {
        const project = studio.project;
        fill(head, h('h3', { text: 'Learn by making' }));
        fill(body,
          h('p', { text: 'Guided routes that teach you by changing a real game: a hero that runs and jumps and grows into a whole game, '
            + 'or a 3D hall you walk round and turn into a gem hunt.' }),
          h('p', { text: 'The guide only suggests. Nothing is locked, and you can turn it off at any time.' }),
          ...studio.learn.pathways.map((p) => h('div', { class: 'learn-card' },
            h('h4', { text: p.title }), h('p', { text: p.blurb }),
            button({ text: 'Start with a new game', class: 'primary', onClick: () => studio.learn.start(p.id) }),
            project ? button({ text: 'Use this project', class: 'small ghost', onClick: () => studio.learn.turnOn(p.id) }) : null)));
      }

      function off() {
        fill(head, h('h3', { text: 'The guide is off' }));
        fill(body, h('p', { text: 'You are on your own. Your place is kept, so you can pick up where you left off.' }),
          button({ text: 'Turn the guide on', class: 'primary', onClick: () => studio.learn.setEnabled(true) }),
          button({ text: 'Start again from the beginning', class: 'small ghost', onClick: () => studio.learn.restart() }));
      }

      function finished(s) {
        fill(head, h('h3', { text: 'Pathway finished' }), dots(s));
        fill(body,
          h('div', { class: 'learn-card done' }, h('h4', { text: 'You finished every step' }),
            h('p', { text: 'You made a complete little game: a hero, a scrolling level, danger and a way to win. It is yours. '
              + 'Keep changing it, or start a new game from the start page.' }),
            h('p', { text: 'More stages (multiplayer, publishing, 3D) are still to come. '
              + 'The studio and the documentation are there whenever you want to go further.' })),
          button({ text: 'Save a restore point', class: 'primary', onClick: () => studio.commands.execute('history.save') }),
          button({ text: 'Export as a zip', class: 'small ghost', onClick: () => studio.commands.execute('project.export') }),
          button({ text: 'Go back one step', class: 'small ghost', onClick: () => studio.learn.back() }),
          button({ text: 'Turn the guide off', class: 'small ghost', onClick: () => studio.learn.setEnabled(false) }));
      }

      function stageIntro(s) {
        fill(head, h('h3', { text: s.stage.title }), dots(s));
        fill(body,
          h('div', { class: 'learn-card' },
            h('h4', { text: `Stage ${s.pathway.stages.indexOf(s.stage) + 1}: ${s.stage.title}` }), h('p', { text: s.stage.intro })),
          button({ text: 'Start', class: 'primary', onClick: () => studio.learn.begin() }),
          s.progress.index > 0 ? button({ text: 'Back', class: 'small ghost', onClick: () => studio.learn.back() }) : null,
          button({ text: 'Skip this stage', class: 'small ghost', onClick: () => skipStage(s) }));
      }

      function skipStage(s) {
        const ids = s.stage.missions.length;
        for (let i = 0; i < ids; i++) studio.learn.session?.next({ skip: true });
        if (!studio.learn.session?.finished && !studio.learn.session?.atStageStart) studio.learn.begin();
      }

      function mission(s) {
        const m = s.mission;
        const done = s.completedNow;
        const n = s.progress.index + 1;
        fill(head, h('h3', { text: m.title }), h('span', { class: 'learn-count', text: `Step ${n} of ${s.total}` }), dots(s));
        const parts = [];
        if (done) {
          parts.push(h('div', { class: 'learn-card done' }, h('h4', { text: 'Done!' }), h('p', {}, rich(m.why)),
            m.deeper && studio.config?.docsUrl
              ? h('p', {}, h('a', { href: `${studio.config.docsUrl}/${m.deeper.href}`, target: '_blank', rel: 'noopener', text: m.deeper.label }))
              : null));
          const last = s.progress.index >= s.total - 1;
          parts.push(button({ text: last ? 'Finish' : 'Next step', class: 'primary', onClick: () => studio.learn.next() }));
          parts.push(button({ text: 'Back', class: 'small ghost', onClick: () => studio.learn.back() }));
        } else {
          parts.push(...paragraphs(m.task));
          if (s.note) parts.push(h('p', { class: 'learn-note', role: 'status' }, rich(s.note)));
          if (studio.learn.nudging) {
            parts.push(h('p', { class: 'learn-nudge', text: 'Taking your time is fine. A hint is one click away if you want it.' }));
          }
          const stopped = studio.runner.status === 'error' ? studio.entries.slice(-6).find((e) => /is not defined/.test(e.text)) : null;
          if (stopped) {
            parts.push(h('p',
              { class: 'learn-note', role: 'status', text: 'A red "is not defined" message is normal while you are in the middle of a step: '
              + 'a name has to be added to the import list at the top before it can be used. Finish the step and it goes away.' }));
          }
          s.shownHints().forEach((t, i) => parts.push(h('div', { class: 'learn-hint' }, h('strong', { text: `Hint ${i + 1}: ` }), ...rich(t))));
          if (s.progress.answerShown) {
            parts.push(h('div', { class: 'learn-answer' }, h('strong', { text: 'The answer' }), codeBox(m.answer)));
            if (m.apply) parts.push(button({ text: 'Make this change for me', class: 'small', onClick: () => studio.learn.applyAnswer() }));
          }
          const row = [];
          if (m.manual) row.push(button({ text: 'I have done this', class: 'primary', onClick: () => studio.learn.markDone() }));
          if (s.hasMoreHints) {
            const more = s.progress.hints > 0;
            row.push(button({ text: more ? 'Another hint' : 'Give me a hint', class: more ? 'small' : '', onClick: () => studio.learn.hint() }));
          }
          else if (!s.progress.answerShown) row.push(button({ text: 'Show the answer', class: 'small', onClick: () => studio.learn.showAnswer() }));
          row.push(button({ text: 'Skip', class: 'small ghost', onClick: () => studio.learn.next({ skip: true }) }));
          if (s.progress.index > 0) row.push(button({ text: 'Back', class: 'small ghost', onClick: () => studio.learn.back() }));
          parts.push(h('div', { class: 'learn-actions' }, ...row));
        }
        const turnOff = button({ text: 'Turn the guide off', class: 'small ghost', onClick: () => studio.learn.setEnabled(false) });
        parts.push(h('div', { class: 'learn-foot' }, turnOff));
        fill(body, ...parts);
        if (done && s.progress.done.length !== lastDone) live.textContent = `Step done: ${m.title}`;
        lastDone = s.progress.done.length;
      }

      function render() {
        const s = studio.learn.session;
        if (!studio.project || !s) none();
        else if (!s.enabled) off();
        else if (s.finished) finished(s);
        else if (!s.started && !s.completedNow && s.atStageStart) stageIntro(s);
        else mission(s);
      }

      studio.on('learn', render);
      let wasError = false;
      // only when the game stops, or starts again after an error: a button should not be replaced under the mouse for nothing
      studio.on('runner-status', (status) => {
        const isError = status === 'error';
        if (isError || wasError) render();
        wasError = isError;
      });
      studio.on('project', render);
      render();
      return { el, focus: () => body.focus() };
    },
  };
}
