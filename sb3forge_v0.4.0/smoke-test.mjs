import { readFileSync } from 'node:fs';
import { parseProject } from './dsl.mjs';
import { CATALOG, toSb3, unzip } from './sb3core.mjs';

const source = `stage:

sprite "Cat":
  when_flag():
    move(10)
`;
const spec = parseProject(source);
const result = toSb3(spec);

if (result.problems.length) {
  throw new Error(result.problems.join('\n'));
}
if (!result.bytes.length) {
  throw new Error('SB3 output is empty.');
}

const files = await unzip(result.bytes);
if (!files.has('project.json')) {
  throw new Error('Archive does not contain project.json.');
}
JSON.parse(new TextDecoder().decode(files.get('project.json')));

console.log(`catalog entries: ${Object.keys(CATALOG).length}`);
console.log(`SB3 bytes: ${result.bytes.length}`);
console.log('DSL → SB3 smoke test passed.');
