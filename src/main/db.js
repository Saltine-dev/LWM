import {
  mkdir,
  readFile,
  writeFile,
  access,
  readdir,
  unlink,
} from 'node:fs/promises';
import path from 'node:path';
import { constants } from 'node:fs';
import crypto from 'node:crypto';

const DATA_DIRECTORY = path.join(process.cwd(), 'data');

const COLLECTIONS_DIRECTORY = path.join(DATA_DIRECTORY, 'collections');

const FILE_PATHS = {
  config: path.join(DATA_DIRECTORY, 'config.json'),
  mods: path.join(DATA_DIRECTORY, 'mods.json'),
  collections: path.join(DATA_DIRECTORY, 'collections.json'),
};

const DEFAULTS = {
  config: {
    steamcmdPath: '',
    defaultInstallMode: 'copy',
    concurrency: 1,
    enableUpdateChecks: true,
    appDataDir: DATA_DIRECTORY,
    gameProfiles: [],
    steamApiKey: '',
  },
  mods: [],
  collections: [],
};

function generateId() {
  return crypto.randomUUID?.() ?? crypto.randomBytes(16).toString('hex');
}

function sanitizeAppId(value) {
  if (value === undefined || value === null) {
    return '';
  }
  return String(value).trim();
}

function sanitizeName(value, fallbackAppId) {
  const trimmed = value ? String(value).trim() : '';
  if (trimmed.length > 0) {
    return trimmed;
  }

  if (fallbackAppId) {
    return `App ${fallbackAppId}`;
  }

  return 'New Profile';
}

function sanitizePathValue(value) {
  if (!value) {
    return '';
  }

  const trimmed = String(value).trim();
  if (!trimmed) {
    return '';
  }

  return path.normalize(trimmed);
}

function sanitizeInstallMode(value) {
  return value === 'symlink' ? 'symlink' : 'copy';
}

function normalizeProfileInput(input, existingProfile = null) {
  if (!input) {
    throw new Error('Profile payload is required');
  }

  const merged = { ...existingProfile, ...input };
  const now = new Date().toISOString();
  const appId = sanitizeAppId(merged.appId);

  const normalized = {
    ...merged,
    id: merged.id ?? generateId(),
    appId,
    name: sanitizeName(merged.name, appId),
    modPath: sanitizePathValue(merged.modPath ?? ''),
    steamcmdPath: sanitizePathValue(merged.steamcmdPath ?? ''),
    installMode: sanitizeInstallMode(merged.installMode),
    lastSync: merged.lastSync ?? null,
    createdAt: merged.createdAt ?? now,
    updatedAt: now,
  };

  if (!normalized.appId) {
    throw new Error('appId is required for a game profile');
  }

  return normalized;
}

async function ensureDataDirectory() {
  await mkdir(DATA_DIRECTORY, { recursive: true });
}

async function ensureCollectionsDirectory() {
  await mkdir(COLLECTIONS_DIRECTORY, { recursive: true });
}

async function fileExists(filePath) {
  try {
    await access(filePath, constants.F_OK);
    return true;
  } catch (error) {
    return false;
  }
}

async function readJson(filePath, fallback) {
  try {
    const contents = await readFile(filePath, 'utf-8');
    return JSON.parse(contents);
  } catch (error) {
    return fallback;
  }
}

async function writeJson(filePath, data) {
  await writeFile(filePath, JSON.stringify(data, null, 2), 'utf-8');
}

async function initializeFile(key) {
  const filePath = FILE_PATHS[key];
  const defaultValue = DEFAULTS[key];

  if (!(await fileExists(filePath))) {
    await writeJson(filePath, defaultValue);
  }
}

export async function initializeDatabase() {
  await ensureDataDirectory();
  await Promise.all(Object.keys(FILE_PATHS).map((key) => initializeFile(key)));
}

async function readCollectionsFromDirectory() {
  await ensureCollectionsDirectory();

  let entries;
  try {
    entries = await readdir(COLLECTIONS_DIRECTORY, { withFileTypes: true });
  } catch (error) {
    return [];
  }

  const collections = await Promise.all(
    entries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map(async (entry) => {
        const filePath = path.join(COLLECTIONS_DIRECTORY, entry.name);
        try {
          const data = await readJson(filePath, null);
          return data && typeof data === 'object' ? data : null;
        } catch (error) {
          return null;
        }
      }),
  );

  return collections.filter(Boolean);
}

async function migrateLegacyCollections(legacyCollections) {
  if (!Array.isArray(legacyCollections) || legacyCollections.length === 0) {
    return [];
  }

  await ensureCollectionsDirectory();

  const normalized = legacyCollections
    .map((collection) => {
      if (!collection || typeof collection !== 'object') {
        return null;
      }

      const next = { ...collection };
      next.id = next.id ?? generateId();
      return next;
    })
    .filter(Boolean);

  await Promise.all(
    normalized.map((collection) => {
      const filePath = path.join(COLLECTIONS_DIRECTORY, `${collection.id}.json`);
      return writeJson(filePath, collection);
    }),
  );

  await writeJson(FILE_PATHS.collections, []);
  return normalized;
}

export async function getConfig() {
  await initializeDatabase();
  return readJson(FILE_PATHS.config, DEFAULTS.config);
}

export async function saveConfig(config) {
  await ensureDataDirectory();
  await writeJson(FILE_PATHS.config, config);
  return config;
}

export async function getGameProfiles() {
  const config = await getConfig();
  const profiles = config.gameProfiles ?? [];
  return Array.isArray(profiles) ? profiles : [];
}

export async function upsertGameProfile(profile) {
  const config = await getConfig();
  const profiles = config.gameProfiles ?? [];
  const index = profiles.findIndex((item) => item.id === profile?.id);
  const existing = index >= 0 ? profiles[index] : null;
  const normalized = normalizeProfileInput(profile, existing ?? undefined);

  const nextProfiles = [...profiles];
  if (index >= 0) {
    nextProfiles[index] = normalized;
  } else {
    nextProfiles.push(normalized);
  }

  config.gameProfiles = nextProfiles;
  await saveConfig(config);
  return normalized;
}

export async function deleteGameProfile(profileId) {
  const config = await getConfig();
  config.gameProfiles = (config.gameProfiles ?? []).filter((profile) => profile.id !== profileId);
  await saveConfig(config);
}

export async function getModRecords() {
  await initializeDatabase();
  return readJson(FILE_PATHS.mods, DEFAULTS.mods);
}

export async function saveModRecords(records) {
  await ensureDataDirectory();
  await writeJson(FILE_PATHS.mods, records);
  return records;
}

export async function getCollections() {
  await initializeDatabase();
  const directoryCollections = await readCollectionsFromDirectory();

  if (directoryCollections.length > 0) {
    return directoryCollections;
  }

  const legacyCollections = await readJson(FILE_PATHS.collections, DEFAULTS.collections);

  if (Array.isArray(legacyCollections) && legacyCollections.length > 0) {
    return migrateLegacyCollections(legacyCollections);
  }

  return [];
}

export async function saveCollections(collections) {
  await ensureDataDirectory();
  await ensureCollectionsDirectory();

  const array = Array.isArray(collections) ? collections.filter(Boolean) : [];
  const normalized = array.map((collection) => {
    if (!collection || typeof collection !== 'object') {
      return null;
    }

    const next = { ...collection };
    next.id = next.id ?? generateId();
    return next;
  }).filter(Boolean);

  let existingEntries = [];
  try {
    existingEntries = await readdir(COLLECTIONS_DIRECTORY, { withFileTypes: true });
  } catch (error) {
    existingEntries = [];
  }

  const existingPaths = new Set(
    existingEntries
      .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith('.json'))
      .map((entry) => path.join(COLLECTIONS_DIRECTORY, entry.name)),
  );

  const keptPaths = new Set();

  await Promise.all(
    normalized.map(async (collection) => {
      const filePath = path.join(COLLECTIONS_DIRECTORY, `${collection.id}.json`);
      keptPaths.add(filePath);
      await writeJson(filePath, collection);
    }),
  );

  const removals = Array.from(existingPaths)
    .filter((filePath) => !keptPaths.has(filePath))
    .map(async (filePath) => {
      try {
        await unlink(filePath);
      } catch (error) {
        // Ignore removal errors; file may already be gone
      }
    });

  await Promise.all(removals);

  // Maintain an empty legacy file to signal migration has occurred
  await writeJson(FILE_PATHS.collections, []);

  return normalized;
}

