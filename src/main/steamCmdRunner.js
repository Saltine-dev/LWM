import { spawn } from 'node:child_process';
import { EventEmitter } from 'node:events';
import path from 'node:path';

function buildSteamCmdArgs({ login, appId, modId }) {
  const args = [];

  if (login?.username && login?.password) {
    args.push('+login', login.username, login.password);
  } else {
    args.push('+login', 'anonymous');
  }

  args.push('+workshop_download_item', String(appId), String(modId));
  args.push('+quit');

  return args;
}

export function runWorkshopDownload({
  steamcmdPath,
  installDir,
  appId,
  modId,
  login,
}) {
  const emitter = new EventEmitter();
  emitter.logs = [];

  const binary = steamcmdPath && steamcmdPath.trim().length > 0 ? steamcmdPath : 'steamcmd';
  const args = buildSteamCmdArgs({ login, appId, modId });

  const child = spawn(binary, args, {
    cwd: installDir ? path.resolve(installDir) : undefined,
    env: {
      ...process.env,
    },
  });

  const handleData = (buffer) => {
    const message = buffer.toString();
    emitter.logs.push({ timestamp: new Date().toISOString(), message });
    emitter.emit('log', message);
  };

  child.stdout?.on('data', handleData);
  child.stderr?.on('data', handleData);

  child.on('error', (error) => {
    emitter.emit('error', error);
  });

  child.on('close', (code) => {
    emitter.emit('exit', { code, logs: [...(emitter.logs ?? [])] });
  });

  emitter.cancel = () => {
    if (!child.killed) {
      child.kill('SIGINT');
    }
  };

  return emitter;
}

