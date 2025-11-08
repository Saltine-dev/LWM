import { mkdir, cp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const srcMainDir = path.join(projectRoot, 'src', 'main');
const srcPreloadFile = path.join(projectRoot, 'src', 'preload.cjs');
const distMainDir = path.join(projectRoot, 'dist', 'main');

async function copyDir(source, destination) {
  await mkdir(destination, { recursive: true });
  await cp(source, destination, { recursive: true });
}

async function copyPreload(source, destinationDir) {
  await mkdir(destinationDir, { recursive: true });
  const target = path.join(destinationDir, 'preload.cjs');
  const contents = await readFile(source, 'utf-8');
  await writeFile(target, contents);
}

async function buildMain() {
  await copyDir(srcMainDir, distMainDir);
  await copyPreload(srcPreloadFile, distMainDir);
  console.log('Main process files copied to dist/main');
}

buildMain().catch((error) => {
  console.error('Failed to build main process files:', error);
  process.exit(1);
});

