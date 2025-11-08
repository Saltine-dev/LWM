import { spawn } from 'node:child_process';
import process from 'node:process';
import path from 'node:path';
import { access } from 'node:fs/promises';
import waitOn from 'wait-on';

async function resolveElectronBinary(projectRoot) {
  const binDir = path.join(projectRoot, 'node_modules', '.bin');
  const extrasDirElectronmon = path.join(projectRoot, 'node_modules', 'electronmon', 'dist', 'extras', 'bin');

  const candidates = process.platform === 'win32'
    ? [
        path.join(extrasDirElectronmon, 'electronmon.exe'),
        path.join(binDir, 'electronmon.cmd'),
        path.join(binDir, 'electronmon.exe'),
        path.join(extrasDirElectronmon, 'electron.exe'),
        path.join(binDir, 'electron.cmd'),
        'electronmon.cmd',
        'electron.exe',
        'electron.cmd',
        'electron.exe',
      ]
    : [
        path.join(binDir, 'electronmon'),
        path.join(binDir, 'electron'),
        'electronmon',
        'electron',
      ];

  for (const candidate of candidates) {
    try {
      await access(candidate);
      return candidate;
    } catch (error) {
      // continue checking
    }
  }

  throw new Error('Unable to locate electronmon or electron executable. Try reinstalling dependencies.');
}

const DEFAULT_PORT = 5583;
const port = Number(process.env.DEV_SERVER_PORT || DEFAULT_PORT);
const devServerUrl = `http://localhost:${port}`;

async function startElectron() {
  const projectRoot = process.cwd();
  process.env.NODE_ENV = process.env.NODE_ENV || 'development';
  process.env.VITE_DEV_SERVER_URL = devServerUrl;

  try {
    await waitOn({ resources: [devServerUrl], timeout: 120_000 });
  } catch (error) {
    console.error(`Timed out waiting for renderer dev server at ${devServerUrl}`);
    process.exit(1);
  }

  let command;
  try {
    command = await resolveElectronBinary(projectRoot);
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }

  const scriptPath = path.join(projectRoot, 'src', 'main', 'main.js');
  const commonOptions = {
    stdio: 'inherit',
    env: process.env,
    windowsHide: false,
  };

  let child;
  if (process.platform === 'win32') {
    const commandWithQuotes = command.includes(' ') ? `"${command}"` : command;
    child = spawn('cmd.exe', ['/c', commandWithQuotes, '--trace-warnings', scriptPath], commonOptions);
  } else {
    child = spawn(command, ['--trace-warnings', scriptPath], commonOptions);
  }

  child.on('exit', (code) => {
    process.exit(code ?? 0);
  });

  child.on('error', (error) => {
    console.error('Failed to launch Electron:', error);
    process.exit(1);
  });

  const handleShutdown = () => {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  };

  process.on('SIGINT', handleShutdown);
  process.on('SIGTERM', handleShutdown);
}

startElectron();

