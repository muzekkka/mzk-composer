import { readFileSync } from 'node:fs';

export const exampleProject = () =>
  JSON.parse(readFileSync(new URL('../../examples/MZK-0001_exemplo.json', import.meta.url), 'utf8'));
