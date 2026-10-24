// The Rules panel: "when this happens, do that" built from pieces. Every change rewrites src/rules.js, and each rule shows the exact code it makes, so the pieces
// lead into code instead of hiding it.
import { h, button, fill } from '../ui/dom.js';
import {
  WHENS, THENS, KEY_NAMES, newRule, nextId, problemWith, describeRule, codeFor, generateModule, parseRules, addToGame,
} from '../rules/rules-model.js';

const PATH = 'src/rules.js';
const MAIN = 'src/main.js';

export function rulesPanel(studio) {
  return {
    id: 'rules',
    title: 'Rules',
    icon: 'plus',
    create() {
      let rules = [];
      let broken = '';
      const list = h('div', { class: 'rule-list' });
      const note = h('p', { class: 'ship-note', role: 'status' });
      const el = h('div', { class: 'panel-body rules', 'aria-label': 'Rules' });

      function load() {
        broken = '';
        rules = [];
        if (!studio.project || !studio.project.has(PATH)) return;
        try { rules = parseRules(studio.project.readText(PATH)); } catch (error) { broken = error.message; }
      }

      function save() {
        studio.project.write(PATH, generateModule(rules));
        studio.emit('files');
        studio.emit('plugin-event', 'rules-changed');
        draw();
      }

      function connect() {
        if (!studio.project.has(MAIN)) return;
        const r = addToGame(studio.project.readText(MAIN));
        if (r.problem) { studio.toasts.show(r.problem, { kind: 'info' }); return; }
        if (r.changed) {
          studio.project.write(MAIN, r.text);
          studio.emit('files');
          studio.toasts.show('Added the rules to src/main.js: one import and two calls.', { kind: 'success' });
        }
      }

      function add(type) {
        if (!studio.project) { studio.toasts.show('Open a project first.', { kind: 'info' }); return; }
        if (broken) return;
        rules.push(newRule(type, nextId(rules)));
        save();
        connect();
      }

      const field = (value, on, { type = 'text', width = 8, label } = {}) => h('input', {
        type, value: String(value ?? ''), class: 'rule-input', size: width, aria: { label },
        on: { change: (e) => on(type === 'number' ? Number(e.target.value) : e.target.value) },
      });
      const choose = (options, value, on, label) => h('select', {
        class: 'art-select', aria: { label }, on: { change: (e) => on(e.target.value) },
      }, ...options.map(([v, t]) => h('option', { value: v, text: t, selected: v === value })));

      function whenRow(rule) {
        const w = rule.when;
        const bits = [choose(Object.entries(WHENS).map(([k, v]) => [k, v.label]), w.type, (v) => {
          rule.when = WHENS[v].make();
          if (v !== 'touch') rule.then = rule.then.filter((t) => !['remove', 'burst', 'move'].includes(t.type));
          if (!rule.then.length) rule.then = [THENS.say.make()];
          save();
        }, 'When')];
        const set = (k, conv = (x) => x) => (v) => { w[k] = conv(v); save(); };
        if (w.type === 'touch') bits.push(field(w.a, set('a'), { label: 'First thing' }), h('span', { text: 'touches' }),
          field(w.b, set('b'), { label: 'Second thing' }));
        if (w.type === 'key') {
          bits.push(choose(KEY_NAMES.map((k) => [k, k]), w.key, set('key'), 'Key'),
            choose([['press', 'pressed'], ['hold', 'held down']], w.mode, set('mode'), 'How'));
        }
        if (w.type === 'every') bits.push(field(w.seconds, set('seconds', Number), { type: 'number', width: 4, label: 'Seconds' }),
          h('span', { text: 'seconds' }));
        if (w.type === 'none') bits.push(field(w.kind, set('kind'), { label: 'Thing' }));
        if (w.type === 'score') bits.push(field(w.n, set('n', Number), { type: 'number', width: 4, label: 'Score' }));
        return h('div', { class: 'rule-row' }, h('strong', { text: 'When' }), ...bits);
      }

      function thenRow(rule, t, i) {
        const set = (k, conv = (x) => x) => (v) => { t[k] = conv(v); save(); };
        const who = rule.when.type === 'touch'
          ? choose([['a', rule.when.a], ['b', rule.when.b]], t.who, set('who'), 'Which thing')
          : null;
        const bits = [choose(Object.entries(THENS).filter(([k]) => rule.when.type === 'touch' || !['remove', 'burst', 'move'].includes(k))
          .map(([k, v]) => [k, v.label]), t.type, (v) => { rule.then[i] = THENS[v].make(); save(); }, 'Do')];
        if (t.type === 'score') bits.push(field(t.add, set('add', Number), { type: 'number', width: 4, label: 'Change by' }));
        if (['remove', 'burst', 'move'].includes(t.type) && who) bits.push(who);
        if (t.type === 'move') bits.push(field(t.x, set('x', Number), { type: 'number', width: 4, label: 'x' }),
          field(t.y, set('y', Number), { type: 'number', width: 4, label: 'y' }));
        if (t.type === 'play') bits.push(field(t.sound, set('sound'), { label: 'Sound name' }));
        if (t.type === 'shake') bits.push(field(t.amount, set('amount', Number), { type: 'number', width: 4, label: 'Amount' }));
        if (t.type === 'add') bits.push(field(t.field, set('field'), { label: 'Value name' }),
          field(t.n, set('n', Number), { type: 'number', width: 4, label: 'Add' }));
        if (t.type === 'set') {
          bits.push(field(t.field, set('field'), { label: 'Value name' }), field(t.value, set('value', (x) => {
            if (x === 'true') return true;
            if (x === 'false') return false;
            return x.trim() !== '' && Number.isFinite(Number(x)) ? Number(x) : x;
          }), { width: 6, label: 'Value' }));
        }
        if (t.type === 'spawn') {
          bits.push(field(t.kind, set('kind'), { label: 'Thing to make' }),
            field(t.x, set('x', (x) => (x === 'random' ? x : Number(x))), { width: 6, label: 'x' }), 
            field(t.y, set('y', Number), { type: 'number', width: 4, label: 'y' }));
        }
        if (t.type === 'say') bits.push(field(t.text, set('text'), { width: 16, label: 'Message' }),
          field(t.seconds, set('seconds', Number), { type: 'number', width: 3, label: 'Seconds' }));
        bits.push(button({ text: '×', class: 'small ghost', title: 'Remove this step', aria: { label: 'Remove this step' },
          onClick: () => { rule.then.splice(i, 1); save(); } }));
        return h('div', { class: 'rule-row' }, h('strong', { text: i === 0 ? 'Then' : 'and' }), ...bits);
      }

      function card(rule) {
        const problem = problemWith(rule);
        return h('div', { class: `rule-card${problem ? ' bad' : ''}` },
          h('p', { class: 'rule-sentence', text: problem ? problem : describeRule(rule) }),
          whenRow(rule),
          ...rule.then.map((t, i) => thenRow(rule, t, i)),
          h('div', { class: 'rule-actions' },
            button({ text: 'Add a step', class: 'small', onClick: () => { rule.then.push(THENS.say.make()); save(); } }),
            h('label', { class: 'rule-once' },
              h('input', { type: 'checkbox', checked: rule.once, on: { change: (e) => { rule.once = e.target.checked; save(); } } }), 
              ' only the first time'),
            button({ text: 'Delete rule', class: 'small ghost', onClick: () => { rules = rules.filter((r) => r !== rule); save(); } })),
          problem ? null : h('details', { class: 'rule-code' }, h('summary', { text: 'Show the code' }), h('pre', { text: codeFor(rule) })));
      }

      function draw() {
        note.textContent = broken;
        fill(list, ...(broken ? [] : rules.length ? rules.map(card) : [h('div', { class: 'empty' }, h('h3', { text: 'No rules yet' }),
          h('p', { text: 'A rule says "when this happens, do that". Pick one below. '
            + 'Each rule writes real code into src/rules.js, and you can read it.' }))]));
      }

      fill(el,
        h('div', { class: 'toolbar art-bar' }, h('span', { text: 'Add a rule:' }),
          ...Object.entries(WHENS).map(([k, v]) => button({ text: v.label, class: 'small', onClick: () => add(k) }))),
        note, list,
        h('p', {
          class: 'ship-note',
          text: 'The rules live in src/rules.js. You can open it and change the code, '
            + 'but keep the RULES list as plain JSON so this panel can read it.',
        }));
      load();
      draw();
      const reload = () => { load(); draw(); };
      studio.on('project', reload);
      studio.on('file-changed', (e) => { if (e?.path === PATH) reload(); });
      return { el, focus: () => el.querySelector('button')?.focus(), onShow: reload };
    },
  };
}
