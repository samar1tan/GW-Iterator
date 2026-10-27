import { cp, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const output = path.join(root, 'dist', 'site');
await rm(output, { recursive: true, force: true });
await mkdir(path.join(output, 'brand'), { recursive: true });
for (const name of ['index.html', 'style.css', 'site.js']) await cp(path.join(root, 'site', name), path.join(output, name));
await cp(path.join(root, 'public', 'brand', 'gwi-mark.svg'), path.join(output, 'brand', 'gwi-mark.svg'));
await mkdir(path.join(output, 'assets'), { recursive: true });
await cp(path.join(root, 'site', 'assets', 'workbench-example.svg'), path.join(output, 'assets', 'workbench-example.svg'));
console.log('Static project website built in dist/site');
