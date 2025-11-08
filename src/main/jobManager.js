import { EventEmitter } from 'node:events';
import crypto from 'node:crypto';
import path from 'node:path';
import { runWorkshopDownload } from './steamCmdRunner.js';
import { getConfig, getModRecords, saveModRecords } from './db.js';
import { installMod } from './installer.js';

const jobs = new Map();
const queue = [];
const emitter = new EventEmitter();

function toSerializableJob(job) {
  if (!job) {
    return null;
  }

  const { cancel, logs = [], metadata = {}, ...rest } = job;

  return {
    ...rest,
    logs: logs.map((entry) => ({ ...entry })),
    metadata: { ...metadata },
  };
}

function emitUpdate(job) {
  emitter.emit('job-update', toSerializableJob(job));
}

function createJobId() {
  return crypto.randomUUID?.() ?? crypto.randomBytes(16).toString('hex');
}

async function getConcurrencyLimit() {
  try {
    const config = await getConfig();
    return Math.max(Number(config.concurrency) || 1, 1);
  } catch (error) {
    return 1;
  }
}

async function processQueue() {
  const concurrency = await getConcurrencyLimit();
  const runningJobs = Array.from(jobs.values()).filter((job) => job.status === 'running').length;

  if (queue.length === 0 || runningJobs >= concurrency) {
    return;
  }

  const nextJob = queue.shift();
  if (!nextJob) return;

  nextJob.status = 'running';
  nextJob.startedAt = new Date().toISOString();
  await setModRecord(nextJob, {
    status: 'downloading',
    downloadJobId: nextJob.id,
  });
  emitUpdate(nextJob);

  const runner = runWorkshopDownload({
    steamcmdPath: nextJob.steamcmdPath,
    installDir: nextJob.steamInstallDir,
    appId: nextJob.appId,
    modId: nextJob.modId,
    login: nextJob.login,
  });

  nextJob.cancel = () => {
    runner.cancel?.();
    nextJob.status = 'cancelled';
    nextJob.finishedAt = new Date().toISOString();
    emitUpdate(nextJob);
    processQueue();
  };

  runner.on('log', (message) => {
    nextJob.logs.push({
      timestamp: new Date().toISOString(),
      message,
    });

    const percentMatch = message.match(/(\d{1,3}(?:\.\d+)?)%/);
    if (percentMatch) {
      const pct = Math.max(0, Math.min(100, Number.parseFloat(percentMatch[1]) || 0));
      if (!Number.isNaN(pct)) {
        nextJob.progress = pct;
      }
    }

    emitUpdate(nextJob);
  });

  runner.on('error', (error) => {
    handleJobFailure(nextJob, error?.message ?? 'SteamCMD error occurred');
  });

  runner.on('exit', ({ code, logs }) => {
    handleJobExit(nextJob, code);
    if (Array.isArray(logs)) {
      nextJob.logs.push(...logs.map((entry) => ({ ...entry })));
    }
  });
}

export async function enqueueDownloadJob({
  appId,
  modId,
  profileId,
  steamcmdPath,
  steamInstallDir,
  login,
  installMode,
  modInstallPath,
  metadata = {},
}) {
  const job = {
    id: createJobId(),
    appId,
    modId,
    profileId,
    steamcmdPath,
    steamInstallDir: steamInstallDir || deriveSteamInstallDir(steamcmdPath),
    login,
    status: 'queued',
    logs: [],
    createdAt: new Date().toISOString(),
    startedAt: null,
    finishedAt: null,
    error: null,
    exitCode: null,
    progress: 0,
    installMode: installMode || 'copy',
    modInstallPath: modInstallPath || '',
    metadata,
    workshopContentRoot: steamInstallDir || deriveSteamInstallDir(steamcmdPath),
  };

  jobs.set(job.id, job);
  queue.push(job);
  emitUpdate(job);
  await setModRecord(job, {
    status: 'queued',
    downloadJobId: job.id,
  });
  processQueue();
  return job;
}

export function getJobs() {
  return Array.from(jobs.values()).map((job) => toSerializableJob(job));
}

export function getJob(jobId) {
  return jobs.get(jobId) ?? null;
}

export function subscribeToJobUpdates(listener) {
  emitter.on('job-update', listener);
  return () => emitter.off('job-update', listener);
}

function deriveSteamInstallDir(steamcmdPath) {
  if (steamcmdPath && steamcmdPath.trim().length > 0) {
    return path.dirname(path.resolve(steamcmdPath));
  }
  return process.cwd();
}

async function handleJobFailure(job, message) {
  job.status = 'failed';
  job.error = message;
  job.finishedAt = new Date().toISOString();
  emitUpdate(job);
  try {
    await setModRecord(job, {
      status: 'failed',
      error: message,
      downloadJobId: null,
    });
  } catch (error) {
    console.error('Failed to persist mod record on failure', error);
  }
  processQueue();
}

async function handleJobExit(job, code) {
  if (job.status === 'cancelled') {
    await setModRecord(job, {
      status: 'cancelled',
      downloadJobId: null,
    });
    emitUpdate(job);
    processQueue();
    return;
  }

  job.finishedAt = new Date().toISOString();
  job.exitCode = code;

  if (code !== 0) {
    const lastLog = job.logs?.[job.logs.length - 1]?.message;
    const message = lastLog?.trim() ? lastLog.trim() : `SteamCMD exited with code ${code}`;
    await handleJobFailure(job, message);
    return;
  }

  try {
    const installResult = await installMod({
      workshopContentRoot: job.workshopContentRoot,
      appId: job.appId,
      modId: job.modId,
      destination: job.modInstallPath,
      mode: job.installMode,
    });

    job.status = 'completed';
    job.installedPath = installResult.installedPath;
    job.progress = 100;
    emitUpdate(job);

    await setModRecord(job, {
      status: 'installed',
      installedPath: installResult.installedPath,
      sourcePath: installResult.sourcePath,
      installMode: job.installMode,
      lastDownloadedAt: new Date().toISOString(),
      downloadJobId: null,
      lastKnownUpdateAt: job.metadata?.timeUpdated ?? null,
      fileSizeBytes: job.metadata?.fileSizeBytes ?? null,
    });
  } catch (error) {
    await handleJobFailure(job, `Install failed: ${error.message}`);
    return;
  }

  processQueue();
}

async function setModRecord(job, updates) {
  try {
    const records = await getModRecords();
    const now = new Date().toISOString();
    const index = records.findIndex((item) => item.modId === job.modId && item.profileId === job.profileId);

    const existing = index >= 0 ? records[index] : null;
    const base = existing ?? {};

    const next = {
      ...base,
      modId: job.modId,
      profileId: job.profileId,
      appId: job.appId,
      title: job.metadata?.title ?? base.title ?? '',
      author: job.metadata?.author ?? base.author ?? '',
      previewUrl: job.metadata?.previewUrl ?? base.previewUrl ?? '',
      workshopUrl: job.metadata?.url ?? base.workshopUrl ?? '',
      installMode: job.installMode ?? base.installMode ?? 'copy',
      lastKnownUpdateAt: updates.lastKnownUpdateAt ?? base.lastKnownUpdateAt ?? job.metadata?.timeUpdated ?? null,
      fileSizeBytes: updates.fileSizeBytes ?? base.fileSizeBytes ?? job.metadata?.fileSizeBytes ?? null,
      updatedAt: now,
      createdAt: base.createdAt ?? now,
      status: updates.status ?? base.status ?? 'queued',
      downloadJobId: updates.downloadJobId !== undefined ? updates.downloadJobId : base.downloadJobId ?? null,
      installedPath: updates.installedPath ?? base.installedPath ?? null,
      sourcePath: updates.sourcePath ?? base.sourcePath ?? null,
      error: updates.error ?? (updates.status === 'failed' ? updates.error : base.error ?? null),
      lastDownloadedAt: updates.lastDownloadedAt ?? base.lastDownloadedAt ?? null,
    };

    const sanitized = {
      ...next,
      status: next.status,
    };

    const alignedRecords = [...records];
    if (index >= 0) {
      alignedRecords[index] = sanitized;
    } else {
      alignedRecords.push(sanitized);
    }

    await saveModRecords(alignedRecords);
    return sanitized;
  } catch (error) {
    console.error('Failed to persist mod record', error);
    return null;
  }
}

export async function modifyModRecord(modId, profileId, updates) {
  try {
    const records = await getModRecords();
    const now = new Date().toISOString();
    const index = records.findIndex((item) => item.modId === modId && item.profileId === profileId);

    if (index === -1) {
      if (!updates) {
        return null;
      }

      const base = {
        modId,
        profileId,
        createdAt: now,
        updatedAt: now,
      };

      const entry = typeof updates === 'function' ? { ...base, ...(updates(base) ?? {}) } : { ...base, ...updates };
      entry.updatedAt = now;
      const nextRecords = [...records, entry];
      await saveModRecords(nextRecords);
      return entry;
    }

    const existing = records[index];
    let nextValue;

    if (typeof updates === 'function') {
      nextValue = updates(existing);
    } else if (updates) {
      nextValue = {
        ...existing,
        ...updates,
      };
    } else {
      nextValue = existing;
    }

    if (nextValue === null) {
      const nextRecords = [...records.slice(0, index), ...records.slice(index + 1)];
      await saveModRecords(nextRecords);
      return null;
    }

    nextValue.updatedAt = now;
    const nextRecords = [...records];
    nextRecords[index] = nextValue;
    await saveModRecords(nextRecords);
    return nextValue;
  } catch (error) {
    console.error('Failed to modify mod record', error);
    throw error;
  }
}

