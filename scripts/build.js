// Vercel build: puts everything the app needs into dist/ (the local server.js does the same mapping live).
import fs from 'node:fs';
import path from 'node:path';
const R = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const out = path.join(R, 'dist');
fs.rmSync(out, { recursive: true, force: true });
const copy = (from, to) => fs.cpSync(path.join(R, from), path.join(out, to), { recursive: true });
copy('public', '.');
copy('models', 'models');
copy('node_modules/@mediapipe/tasks-vision', 'vendor/tasks-vision');
copy('node_modules/imagetracerjs', 'vendor/imagetracer');
copy('node_modules/ag-psd/dist', 'vendor/ag-psd');
console.log('dist ready');
