import { cp, mkdir, rm, rename, stat } from 'node:fs/promises';
import path from 'node:path';

async function pathExists(targetPath) {
  try {
    await stat(targetPath);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

export function resolveWorkshopModPath(workshopContentRoot, appId, modId) {
  return path.join(
    workshopContentRoot,
    'steamapps',
    'workshop',
    'content',
    String(appId),
    String(modId),
  );
}

export async function installMod({
  workshopContentRoot,
  appId,
  modId,
  destination,
  mode = 'copy',
}) {
  if (!workshopContentRoot || !appId || !modId || !destination) {
    throw new Error('installMod requires workshopContentRoot, appId, modId, and destination');
  }

  const sourcePath = resolveWorkshopModPath(workshopContentRoot, appId, modId);
  const targetPath = path.join(destination, String(modId));

  if (!(await pathExists(sourcePath))) {
    throw new Error(`Workshop download not found at ${sourcePath}`);
  }

  await mkdir(destination, { recursive: true });

  if (await pathExists(targetPath)) {
    await rm(targetPath, { recursive: true, force: true });
  }

  if (mode === 'symlink') {
    const { symlink } = await import('node:fs/promises');
    await symlink(sourcePath, targetPath, 'junction');
  } else {
    await cp(sourcePath, targetPath, { recursive: true });
  }

  return {
    installedPath: targetPath,
    sourcePath,
    mode,
  };
}

export async function removeMod(installedPath) {
  if (!installedPath) {
    throw new Error('removeMod requires installedPath');
  }

  if (await pathExists(installedPath)) {
    await rm(installedPath, { recursive: true, force: true });
  }
}

export async function disableMod(installedPath) {
  if (!installedPath) {
    throw new Error('disableMod requires installedPath');
  }

  if (installedPath.endsWith('.disabled')) {
    return installedPath;
  }

  const disabledPath = `${installedPath}.disabled`;
  await rename(installedPath, disabledPath);
  return disabledPath;
}

export async function enableMod(installedPath) {
  if (!installedPath) {
    throw new Error('enableMod requires installedPath');
  }

  if (!installedPath.endsWith('.disabled')) {
    return installedPath;
  }

  const enabledPath = installedPath.replace(/\.disabled$/, '');
  await rename(installedPath, enabledPath);
  return enabledPath;
}

