import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  findSchemas, readSchema, parseData, serializeData, validateData, coerce, setCell, addRow, duplicateRow, removeRow, moveRow, rowsOf,
} from '../app/paint/tables-model.js';

const SCHEMA = JSON.stringify({
  file: 'data/parts.js', title: 'Parts',
  tables: [{
    key: 'weapons', title: 'Weapons', columns: [
      { key: 'id', label: 'Name', type: 'text' }, { key: 'damage', label: 'Damage', type: 'number', min: 0, max: 500, step: 1 },
      { key: 'slot', label: 'Slot', type: 'enum', options: ['main', 'melee'] }, { key: 'color', label: 'Colour', type: 'color' },
      { key: 'auto', label: 'Automatic', type: 'bool' }, { key: 'limit', label: 'Limit', type: 'number', nullable: true },
    ],
  }],
});
const DATA = { weapons: [
  { id: 'rifle', damage: 7, slot: 'main', color: '#ff8800', auto: true, limit: null },
  { id: 'blade', damage: 40, slot: 'melee', color: '#00ccff', auto: false, limit: 3 },
] };
const schema = () => readSchema(SCHEMA).schema;
const table = () => schema().tables[0];

test('schema files are found by name, and a schema is read with defaults filled in', () => {
  assert.deepEqual(findSchemas(['src/a.js', 'data/parts.schema.json', 'b.schema.json']), ['b.schema.json', 'data/parts.schema.json']);
  const { schema, problems } = readSchema(SCHEMA);
  assert.deepEqual(problems, []);
  assert.equal(schema.file, 'data/parts.js');
  assert.equal(schema.tables[0].idKey, 'id', 'a column called id is the name of a row');
  assert.equal(schema.tables[0].columns[0].label, 'Name');
});

test('a damaged schema says what is wrong', () => {
  assert.match(readSchema('{nope').problems[0], /not valid JSON/);
  assert.ok(readSchema('{"file":"x"}').problems.some((p) => /tables/.test(p)));
  assert.ok(readSchema('{"tables":[{"key":"a","columns":[{"key":"x","type":"nope"}]}]}').problems.length > 0);
  assert.ok(readSchema('{"file":"x","tables":[{"key":"a","columns":[{"key":"x","type":"enum"}]}]}').problems.some((p) => /options/.test(p)));
});

test('a data file is read past its comments, and written back as one record to a line, reading back exactly', () => {
  const text = serializeData(DATA, 'Hello');
  assert.match(text, /^\/\/ Hello\nexport default \{/);
  assert.equal(text.split('\n').filter((l) => l.startsWith('    {')).length, 2);
  assert.deepEqual(parseData(text), DATA);
  assert.deepEqual(parseData('/* a\nb */\n// c\nexport default {"a": [1]};\n'), { a: [1] });
  assert.deepEqual(parseData(`export default ${JSON.stringify(DATA)}`), DATA);
  assert.throws(() => parseData('const x = 1;'), /export default/);
  assert.throws(() => parseData('export default { a: 1 };'), /plain JSON/);
});

test('the checks name the table, the row and the column, for ranges, kinds, names and colours', () => {
  assert.deepEqual(validateData(DATA, schema()), []);
  const bad = structuredClone(DATA);
  bad.weapons[0].damage = 900;
  bad.weapons[1].slot = 'back';
  bad.weapons[1].color = 'red';
  bad.weapons.push({ id: 'rifle', damage: 'x', slot: 'main', color: '#000000', auto: 1, limit: null });
  bad.weapons.push({ id: '', damage: 1, slot: 'main', color: '#000000', auto: false, limit: null });
  const problems = validateData(bad, schema());
  const all = problems.join('\n');
  assert.match(all, /Weapons, "rifle": "Damage" is 900, outside 0 to 500/);
  assert.match(all, /"blade": "Slot" is "back"/);
  assert.match(all, /"blade": "Colour" is not a colour/);
  assert.match(all, /another row has the same id/);
  assert.match(all, /"Damage" is not a number/);
  assert.match(all, /should be yes or no/);
  assert.match(all, /row 4: needs a Name/);
});

test('what a box holds becomes the right kind of value', () => {
  const [id, damage, , color, auto, limit] = table().columns;
  assert.equal(coerce(damage, '12.5'), 12.5);
  assert.equal(coerce(damage, 'abc'), 0);
  assert.equal(coerce(limit, ''), null);
  assert.equal(coerce(limit, '7'), 7);
  assert.equal(coerce(auto, true), true);
  assert.equal(coerce(color, '#ABCDEF'), '#abcdef');
  assert.equal(coerce(color, 'nope'), '#000000');
  assert.equal(coerce(id, 5), '5');
});

test('changing, adding, copying, removing and moving rows leave the old data alone and keep names unique', () => {
  const t = table();
  const a = setCell(DATA, t, 0, 'damage', '9');
  assert.equal(a.weapons[0].damage, 9);
  assert.equal(DATA.weapons[0].damage, 7);
  assert.throws(() => setCell(DATA, t, 0, 'nope', '1'), /no column/);
  assert.throws(() => setCell(DATA, t, 5, 'damage', '1'), /no such row/);
  const added = addRow(DATA, t);
  assert.equal(added.index, 2);
  assert.equal(added.data.weapons[2].id, 'new-1');
  assert.equal(added.data.weapons[2].damage, 40, 'it starts as a copy of the last row, which is sensible');
  assert.equal(addRow(added.data, t).data.weapons[3].id, 'new-2');
  const copy = duplicateRow(DATA, t, 0);
  assert.equal(copy.data.weapons[1].id, 'rifle-1');
  assert.equal(copy.data.weapons[1].damage, 7);
  assert.equal(copy.index, 1);
  assert.deepEqual(removeRow(DATA, t, 0).weapons.map((w) => w.id), ['blade']);
  assert.deepEqual(moveRow(DATA, t, 1, -1).weapons.map((w) => w.id), ['blade', 'rifle']);
  assert.deepEqual(moveRow(DATA, t, 0, -1).weapons.map((w) => w.id), ['rifle', 'blade'], 'cannot go off the top');
  assert.deepEqual(rowsOf({}, t), []);
  assert.equal(addRow({}, t).data.weapons[0].id, 'new-1', 'a table with no rows yet gets its first');
  assert.deepEqual(validateData(addRow(DATA, t).data, schema()), [], 'a new row is valid as it comes');
});
