import { BrowserWindow, dialog, ipcMain, shell } from 'electron';
import { stat, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  initializeDatabase,
  getConfig,
  saveConfig,
  getGameProfiles,
  upsertGameProfile,
  deleteGameProfile,
  getModRecords,
  saveModRecords,
  getCollections,
  saveCollections,
} from './db.js';
import {
  fetchModDetails,
  fetchMultipleModDetails,
  fetchCollectionDetails,
  queryWorkshopFiles,
  fetchRawModDetails,
  fetchWorkshopPageJson,
  fetchChangeNotes,
  fetchPlayerSummaries,
  fetchWorkshopTagTotals,
  fetchAppDetails,
  fetchAppReviewSummaries,
  fetchWorkshopComments,
} from './steamApi.js';
import { enqueueDownloadJob, getJobs, subscribeToJobUpdates, modifyModRecord } from './jobManager.js';
import { installMod, removeMod, enableMod, disableMod } from './installer.js';

const REGISTERED_CHANNELS = new Set();

function slugifyFileName(value) {
  return (value || '')
    .toString()
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-zA-Z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toLowerCase() || 'collection';
}

function normalizeCollectionModForTransfer(mod) {
  if (!mod || typeof mod !== 'object') {
    return null;
  }

  const modIdCandidate = mod.modId ?? mod.id ?? mod.workshopId ?? mod.publishedFileId ?? mod.publishedfileid ?? null;
  if (!modIdCandidate) {
    return null;
  }

  const modId = String(modIdCandidate).trim();
  if (!modId) {
    return null;
  }

  const title = typeof mod.title === 'string' ? mod.title : '';
  const author = typeof mod.author === 'string' ? mod.author : '';
  const previewUrl = typeof mod.previewUrl === 'string' ? mod.previewUrl : '';
  const workshopUrlCandidate = typeof mod.workshopUrl === 'string' ? mod.workshopUrl.trim() : '';
  const workshopUrl = workshopUrlCandidate || `https://steamcommunity.com/sharedfiles/filedetails/?id=${modId}`;
  const tags = Array.isArray(mod.tags) ? mod.tags.map((tag) => String(tag).trim()).filter(Boolean) : [];
  const result = {
    modId,
    title,
    author,
    previewUrl,
    workshopUrl,
    tags,
  };

  if (mod.addedAt && typeof mod.addedAt === 'string') {
    result.addedAt = mod.addedAt;
  }

  if (mod.stats && typeof mod.stats === 'object') {
    const scoreValue = mod.stats.score ?? mod.stats.vote_score ?? mod.stats.rating;
    if (scoreValue !== undefined && scoreValue !== null && !Number.isNaN(Number(scoreValue))) {
      result.stats = { score: Number(scoreValue) };
    }
  }

  return result;
}

function normalizeCollectionForTransfer(collection) {
  if (!collection || typeof collection !== 'object') {
    return null;
  }

  const metaCandidate = collection.metadata && typeof collection.metadata === 'object' ? collection.metadata : {};
  const name = typeof collection.name === 'string' ? collection.name.trim() : '';
  const description = typeof collection.description === 'string' ? collection.description : '';
  const tags = Array.isArray(collection.tags)
    ? collection.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
  const mods = Array.isArray(collection.mods)
    ? collection.mods.map((mod) => normalizeCollectionModForTransfer(mod)).filter(Boolean)
    : [];

  const normalized = {
    name: name || 'Untitled Collection',
    description,
    tags,
    mods,
  };

  const createdAt = collection.createdAt ?? metaCandidate.createdAt ?? null;
  const updatedAt = collection.updatedAt ?? metaCandidate.updatedAt ?? null;

  if (createdAt) {
    normalized.createdAt = createdAt;
  }
  if (updatedAt) {
    normalized.updatedAt = updatedAt;
  }

  const metadata = {};
  if (metaCandidate.profileId) {
    metadata.originalProfileId = metaCandidate.profileId;
  }
  if (metaCandidate.profileName) {
    metadata.profileName = metaCandidate.profileName;
  }
  if (metaCandidate.source) {
    metadata.source = metaCandidate.source;
  }
  if (metaCandidate.exportedAt || collection.exportedAt) {
    metadata.exportedAt = metaCandidate.exportedAt ?? collection.exportedAt;
  }
  if (collection.importSource || metaCandidate.importSource) {
    metadata.importSource = collection.importSource ?? metaCandidate.importSource;
  }

  if (Object.keys(metadata).length > 0) {
    normalized.metadata = metadata;
  }

  return normalized;
}

function extractCollectionsFromPayload(payload) {
  if (!payload) {
    return [];
  }

  if (Array.isArray(payload)) {
    return payload;
  }

  if (typeof payload !== 'object') {
    return [];
  }

  if (Array.isArray(payload.collections)) {
    return payload.collections;
  }

  if (payload.collection) {
    return [payload.collection];
  }

  if (Array.isArray(payload.data)) {
    return payload.data;
  }

  return [payload];
}

function extractSteamCollectionId(value) {
  if (value === undefined || value === null) {
    return null;
  }

  const str = String(value).trim();
  if (!str) {
    return null;
  }

  const queryMatch = str.match(/(?:\?|&)(?:id|collectionid|publishedfileid)=(\d{5,})/i);
  if (queryMatch) {
    return queryMatch[1];
  }

  const fileDetailsMatch = str.match(/filedetails\/?(?:\?id=)?(\d{5,})/i);
  if (fileDetailsMatch) {
    return fileDetailsMatch[1];
  }

  const plainDigits = str.match(/(\d{5,})/);
  if (plainDigits) {
    return plainDigits[1];
  }

  return null;
}

function mapModDetailToCollectionEntry(detail) {
  if (!detail || typeof detail !== 'object') {
    return null;
  }

  const modId = detail.modId ?? detail.id ?? detail.workshopId ?? null;
  if (!modId) {
    return null;
  }

  const entry = {
    modId: String(modId),
    title: detail.title ?? `Workshop Item ${modId}`,
    author: detail.author ?? '',
    authorId: detail.authorId ?? null,
    previewUrl: detail.previewUrl ?? '',
    workshopUrl:
      (typeof detail.url === 'string' && detail.url.trim())
        ? detail.url.trim()
        : `https://steamcommunity.com/sharedfiles/filedetails/?id=${modId}`,
    tags: Array.isArray(detail.tags) ? detail.tags.map((tag) => String(tag).trim()).filter(Boolean) : [],
    addedAt: new Date().toISOString(),
  };

  if (Array.isArray(detail.previewUrls) && detail.previewUrls.length) {
    entry.previewUrls = detail.previewUrls;
  }

  if (detail.stats && typeof detail.stats === 'object') {
    entry.stats = { ...detail.stats };
  }

  return entry;
}

function handle(channel, handler) {
  if (REGISTERED_CHANNELS.has(channel)) {
    return;
  }

  ipcMain.handle(channel, handler);
  REGISTERED_CHANNELS.add(channel);
}

function emitWindowState(window) {
  if (!window || window.isDestroyed()) {
    return;
  }

  window.webContents.send('window:state', {
    isMaximized: window.isMaximized(),
    isFullScreen: window.isFullScreen(),
    isMinimized: window.isMinimized?.() ?? false,
  });
}

export function registerIpcHandlers() {
  if (registerIpcHandlers.initialized) {
    return;
  }

  registerIpcHandlers.initialized = true;

  initializeDatabase().catch((error) => {
    console.error('Failed to initialize database', error);
  });

  handle('steam:fetch-mod-details', async (_event, payload) => {
    const config = await getConfig();
    const apiKey = config.steamApiKey || process.env.STEAM_API_KEY || '';

    const modId = typeof payload === 'object' && payload !== null ? payload.modId ?? payload.id : payload;
    const appId =
      (typeof payload === 'object' && payload !== null ? payload.appId : undefined) ?? config.defaultAppId ?? null;

    return fetchModDetails(modId, { apiKey, appId });
  });

  handle('steam:fetch-mod-details-raw', async (_event, modId) => fetchRawModDetails(modId));

  handle('steam:fetch-multiple-mod-details', async (_event, payload) => {
    const config = await getConfig();
    const apiKey = config.steamApiKey || process.env.STEAM_API_KEY || '';

    const modIds = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.modIds)
        ? payload.modIds
        : [];

    const appId =
      (typeof payload === 'object' && payload !== null ? payload.appId : undefined) ?? config.defaultAppId ?? null;

    return fetchMultipleModDetails(modIds, { apiKey, appId });
  });

  handle('steam:fetch-mod-workshop-json', async (_event, modId) => fetchWorkshopPageJson(modId));

  handle('steam:get-change-notes', async (_event, payload = {}) => {
    const value = typeof payload === 'object' && payload !== null ? payload : { modId: payload };
    const modId = value.modId ?? value.id ?? value.publishedfileid ?? value.publishedFileId ?? value.workshopId;

    if (!modId) {
      throw new Error('modId is required to fetch change notes');
    }

    const language = value.language ?? value.lang ?? value.l ?? 'english';
    return fetchChangeNotes(String(modId), { language });
  });

  handle('steam:get-comments', async (_event, payload = {}) => {
    const value = typeof payload === 'object' && payload !== null ? payload : { modId: payload };
    const modId = value.modId ?? value.id ?? value.publishedfileid ?? value.publishedFileId ?? value.workshopId;

    if (!modId) {
      throw new Error('modId is required to fetch comments');
    }

    const start = value.start ?? value.offset ?? 0;
    const count = value.count ?? value.limit ?? 50;
    return fetchWorkshopComments(String(modId), start, count);
  });

  handle('steam:fetch-collection-details', async (_event, collectionId) => fetchCollectionDetails(collectionId));

  handle('steam:query-files', async (_event, options) => {
    const config = await getConfig();
    const apiKey = config.steamApiKey || process.env.STEAM_API_KEY || '';
    return queryWorkshopFiles({ ...options, apiKey });
  });

  handle('steam:get-player-summaries', async (_event, payload = {}) => {
    const steamIds = Array.isArray(payload)
      ? payload
      : Array.isArray(payload?.steamIds)
        ? payload.steamIds
        : [];

    if (!steamIds?.length) {
      return [];
    }

    const config = await getConfig();
    const apiKey = config.steamApiKey || process.env.STEAM_API_KEY || '';
    return fetchPlayerSummaries(steamIds, apiKey);
  });

  handle('steam:get-tag-counts', async (_event, payload = {}) => {
    const appId = payload?.appId ?? payload?.appid;
    const tags = Array.isArray(payload?.tags) ? payload.tags : [];

    const config = await getConfig();
    const apiKey = config.steamApiKey || process.env.STEAM_API_KEY || '';
    return fetchWorkshopTagTotals(appId, tags, apiKey);
  });

  handle('dialog:select-file', async (event, options = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const { title, defaultPath, filters } = options;
    const result = await dialog.showOpenDialog(window, {
      title: title ?? 'Select File',
      defaultPath,
      properties: ['openFile'],
      filters,
    });

    if (result.canceled || !result.filePaths?.length) {
      return { canceled: true };
    }

    return { canceled: false, path: result.filePaths[0] };
  });

  handle('dialog:select-directory', async (event, options = {}) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const { title, defaultPath } = options;
    const result = await dialog.showOpenDialog(window, {
      title: title ?? 'Select Folder',
      defaultPath,
      properties: ['openDirectory', 'createDirectory'],
    });

    if (result.canceled || !result.filePaths?.length) {
      return { canceled: true };
    }

    return { canceled: false, path: result.filePaths[0] };
  });

  handle('jobs:start-download', async (_event, payload) => enqueueDownloadJob(payload));

  handle('jobs:get-all', async () => getJobs());

  if (!REGISTERED_CHANNELS.has('jobs:subscribe')) {
    ipcMain.on('jobs:subscribe', (event) => {
      const updateChannel = 'jobs:update';

      const unsubscribe = subscribeToJobUpdates((job) => {
        event.sender.send(updateChannel, job);
      });

      event.sender.once('destroyed', () => {
        unsubscribe();
      });
    });

    REGISTERED_CHANNELS.add('jobs:subscribe');
  }

  handle('config:get', async () => getConfig());

  handle('config:save', async (_event, config) => saveConfig(config));

  handle('profiles:get', async () => getGameProfiles());

  handle('profiles:upsert', async (_event, profile) => upsertGameProfile(profile));

  handle('profiles:delete', async (_event, profileId) => {
    await deleteGameProfile(profileId);
    return profileId;
  });

  handle('mods:get', async () => getModRecords());

  handle('mods:save', async (_event, records) => saveModRecords(records));

  handle('collections:get', async () => getCollections());

  handle('collections:save', async (_event, collections) => saveCollections(collections));

  handle('collections:export', async (event, payload = {}) => {
    const value = payload && typeof payload === 'object' ? payload : {};
    const collection = value.collection;

    if (!collection || typeof collection !== 'object') {
      throw new Error('Collection payload is required for export.');
    }

    const normalized = normalizeCollectionForTransfer(collection);
    if (!normalized) {
      throw new Error('Collection payload is invalid.');
    }

    const metadataPayload =
      normalized.metadata && typeof normalized.metadata === 'object' ? { ...normalized.metadata } : {};

    if (metadataPayload.importSource) {
      delete metadataPayload.importSource;
    }

    if (collection.profileId) {
      metadataPayload.originalProfileId = collection.profileId;
    }
    if (collection.profileName && !metadataPayload.profileName) {
      metadataPayload.profileName = collection.profileName;
    }

    metadataPayload.source = 'Local Workshop Manager';
    metadataPayload.exportedAt = new Date().toISOString();

    normalized.metadata = metadataPayload;

    const exportPayload = {
      format: 'local-workshop-manager.collection',
      formatVersion: 1,
      exportedAt: metadataPayload.exportedAt,
      collection: normalized,
    };

    const defaultFileName = `${slugifyFileName(normalized.name)}.json`;
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const saveResult = await dialog.showSaveDialog(window, {
      title: 'Export Collection',
      defaultPath: defaultFileName,
      filters: [
        {
          name: 'Collection Files',
          extensions: ['json'],
        },
      ],
    });

    if (saveResult.canceled || !saveResult.filePath) {
      return { canceled: true };
    }

    await writeFile(saveResult.filePath, JSON.stringify(exportPayload, null, 2), 'utf-8');
    return { canceled: false, filePath: saveResult.filePath };
  });

  handle('collections:import', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender) ?? undefined;
    const openResult = await dialog.showOpenDialog(window, {
      title: 'Import Collections',
      properties: ['openFile', 'multiSelections'],
      filters: [
        {
          name: 'Collection Files',
          extensions: ['json'],
        },
      ],
    });

    if (openResult.canceled || !openResult.filePaths?.length) {
      return { canceled: true, collections: [], errors: [] };
    }

    const imported = [];
    const errors = [];

    await Promise.all(
      openResult.filePaths.map(async (filePath) => {
        try {
          const contents = await readFile(filePath, 'utf-8');
          const parsed = JSON.parse(contents);
          const candidates = extractCollectionsFromPayload(parsed);
          const normalizedCollections = candidates
            .map((item) => normalizeCollectionForTransfer(item))
            .filter(Boolean);

          if (!normalizedCollections.length) {
            errors.push({ filePath, message: 'No collection data found.' });
            return;
          }

          const sourceLabel = path.basename(filePath);
          normalizedCollections.forEach((collectionEntry) => {
            const meta = collectionEntry.metadata && typeof collectionEntry.metadata === 'object'
              ? { ...collectionEntry.metadata }
              : {};
            meta.importSource = meta.importSource ?? sourceLabel;
            collectionEntry.metadata = meta;
            collectionEntry.importSource = sourceLabel;
            imported.push(collectionEntry);
          });
        } catch (error) {
          errors.push({ filePath, message: error?.message ?? 'Failed to import file.' });
        }
      }),
    );

    return { canceled: false, collections: imported, errors };
  });

  handle('collections:import-steam', async (_event, payload = {}) => {
    const input = typeof payload === 'object' && payload !== null
      ? payload.url ?? payload.collectionId ?? payload.id
      : payload;

    const collectionId = extractSteamCollectionId(input);
    if (!collectionId) {
      throw new Error('Provide a valid Steam collection URL or ID.');
    }

    try {
      const config = await getConfig();
      const apiKey = config.steamApiKey || process.env.STEAM_API_KEY || '';
      const defaultAppId = config.defaultAppId ?? null;

      const [collectionDetails, collectionMetaDetails] = await Promise.all([
        fetchCollectionDetails(collectionId),
        fetchMultipleModDetails([collectionId], { apiKey, appId: defaultAppId }).catch(() => []),
      ]);

      const metaEntry = Array.isArray(collectionMetaDetails) && collectionMetaDetails.length > 0
        ? collectionMetaDetails[0]
        : null;

      const childIds = Array.isArray(collectionDetails.items)
        ? Array.from(
            new Set(
              collectionDetails.items
                .map((item) => item?.fileId)
                .filter((id) => id && /^\d{5,}$/.test(String(id))),
            ),
          )
        : [];

      if (!childIds.length) {
        return {
          canceled: false,
          collections: [],
          errors: [
            {
              collectionId,
              message: 'No mods were found in the specified Steam collection.',
            },
          ],
        };
      }

      const chunkSize = 20;
      const modDetails = [];
      const missingIds = new Set(childIds.map((id) => String(id)));
      const importErrors = [];

      for (let index = 0; index < childIds.length; index += chunkSize) {
        const chunk = childIds.slice(index, index + chunkSize);
        try {
          const details = await fetchMultipleModDetails(chunk, { apiKey, appId: defaultAppId });
          details.forEach((detail) => {
            if (!detail) {
              return;
            }
            modDetails.push(detail);
            missingIds.delete(String(detail.modId));
          });
        } catch (chunkError) {
          console.warn('Failed to fetch mod details for chunk', chunk, chunkError);
          importErrors.push({
            collectionId,
            message: `Failed to fetch details for items ${chunk.join(', ')}.`,
          });
        }
      }

      const mappedMods = modDetails
        .map((detail) => mapModDetailToCollectionEntry(detail))
        .filter(Boolean);

      if (!mappedMods.length) {
        return {
          canceled: false,
          collections: [],
          errors: [
            ...importErrors,
            {
              collectionId,
              message: 'Mods in the collection could not be fetched or are private.',
            },
          ],
        };
      }

      if (missingIds.size) {
        importErrors.push({
          collectionId,
          missingIds: Array.from(missingIds),
          message: `Skipped ${missingIds.size} item${missingIds.size === 1 ? '' : 's'} that could not be fetched.`,
        });
      }

      const metadata = {
        source: 'Steam',
        steamCollectionId: String(collectionId),
        importedAt: new Date().toISOString(),
        importSource: typeof input === 'string' ? input : `Steam Collection ${collectionId}`,
      };

      if (metaEntry?.authorId) {
        metadata.collectionAuthorId = metaEntry.authorId;
      }
      if (metaEntry?.author) {
        metadata.collectionAuthor = metaEntry.author;
      }

      const collectionPayload = {
        name: metaEntry?.title ?? `Steam Collection ${collectionId}`,
        description: metaEntry?.description ?? metaEntry?.shortDescription ?? '',
        tags: Array.isArray(metaEntry?.tags) ? metaEntry.tags : [],
        mods: mappedMods,
        metadata,
      };

      return {
        canceled: false,
        collections: [collectionPayload],
        errors: importErrors,
      };
    } catch (error) {
      console.error('Failed to import Steam collection', error);
      throw new Error(error?.message ?? 'Failed to import Steam collection.');
    }
  });

  handle('mods:install', async (_event, payload) => installMod(payload));

  handle('mods:remove', async (_event, installedPath) => {
    await removeMod(installedPath);
    return installedPath;
  });

  handle('mods:disable', async (_event, installedPath) => disableMod(installedPath));

  handle('mods:enable', async (_event, installedPath) => enableMod(installedPath));

  handle('mods:uninstall', async (_event, payload = {}) => {
    const { modId, profileId } = payload;

    if (!modId || !profileId) {
      throw new Error('modId and profileId are required to uninstall a mod');
    }

    const records = await getModRecords();
    const record = records.find((item) => item.modId === modId && item.profileId === profileId);

    if (!record) {
      throw new Error('Mod record not found');
    }

    if (record.installedPath) {
      await removeMod(record.installedPath);
    }

    const updated = await modifyModRecord(modId, profileId, {
      status: 'uninstalled',
      installedPath: null,
      sourcePath: null,
      downloadJobId: null,
      lastUninstalledAt: new Date().toISOString(),
    });

    return updated;
  });

  handle('mods:check-update', async (_event, payload = {}) => {
    const { modId, appId, profileId } = payload;

    if (!modId || !profileId) {
      throw new Error('modId and profileId are required to check for updates');
    }

    const config = await getConfig();
    const apiKey = config.steamApiKey || process.env.STEAM_API_KEY || '';

    const records = await getModRecords();
    const record = records.find((item) => item.modId === modId && item.profileId === profileId);
    const resolvedAppId = appId ?? record?.appId;

    const details = await fetchModDetails(modId, { apiKey, appId: resolvedAppId });
    const remoteUpdated = details?.timeUpdated ?? null;
    const lastKnownUpdateAt = record?.lastKnownUpdateAt ?? null;

    const updateAvailable = remoteUpdated && lastKnownUpdateAt && remoteUpdated > lastKnownUpdateAt;

    const updatedRecord = await modifyModRecord(modId, profileId, (existing = {}) => ({
      ...existing,
      appId: resolvedAppId ?? existing.appId ?? '',
      title: details?.title ?? existing.title ?? '',
      author: details?.author ?? existing.author ?? '',
      previewUrl: details?.previewUrl ?? existing.previewUrl ?? '',
      workshopUrl: details?.url ?? existing.workshopUrl ?? '',
      lastKnownUpdateAt: remoteUpdated ?? existing.lastKnownUpdateAt ?? null,
      lastCheckedAt: new Date().toISOString(),
      status: updateAvailable ? 'update_available' : existing.installedPath ? 'installed' : existing.status ?? 'installed',
      fileSizeBytes: details?.fileSizeBytes ?? existing.fileSizeBytes ?? null,
      latestWorkshopDetails: {
        timeUpdated: remoteUpdated,
        fileSizeBytes: details?.fileSizeBytes ?? null,
      },
    }));

    return {
      record: updatedRecord,
      details,
    };
  });

  handle('steam:get-app-details', async (_event, payload = {}) => {
    const appId = typeof payload === 'object' && payload !== null ? payload.appId ?? payload.appid : payload;

    if (!appId) {
      throw new Error('appId is required');
    }

    return fetchAppDetails(String(appId));
  });

  handle('steam:get-app-reviews', async (_event, payload = {}) => {
    const appId = typeof payload === 'object' && payload !== null ? payload.appId ?? payload.appid : payload;

    if (!appId) {
      throw new Error('appId is required');
    }

    return fetchAppReviewSummaries(String(appId));
  });

  handle('system:show-item', async (_event, payload) => {
    const targetPath =
      typeof payload === 'string'
        ? payload
        : payload && typeof payload === 'object'
          ? payload.path
          : null;

    if (!targetPath || typeof targetPath !== 'string') {
      throw new Error('Path is required to reveal item');
    }

    try {
      const fileInfo = await stat(targetPath).catch(() => null);

      if (fileInfo?.isDirectory()) {
        const result = await shell.openPath(targetPath);
        if (result) {
          throw new Error(result);
        }
        return true;
      }

      shell.showItemInFolder(targetPath);
      return true;
    } catch (error) {
      console.error('Failed to open path', targetPath, error);
      throw error;
    }
  });

  handle('window:minimize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.minimize();
    setImmediate(() => emitWindowState(window));
    return true;
  });

  handle('window:toggle-maximize', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
      return { isMaximized: false, isFullScreen: false };
    }

    if (window.isMaximized()) {
      window.unmaximize();
    } else {
      window.maximize();
    }

    setImmediate(() => emitWindowState(window));

    return {
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen(),
    };
  });

  handle('window:close', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    window?.close();
    return true;
  });

  handle('window:get-state', async (event) => {
    const window = BrowserWindow.fromWebContents(event.sender);

    if (!window) {
      return {
        isMaximized: false,
        isFullScreen: false,
        isMinimized: false,
      };
    }

    const state = {
      isMaximized: window.isMaximized(),
      isFullScreen: window.isFullScreen(),
      isMinimized: window.isMinimized?.() ?? false,
    };

    setImmediate(() => emitWindowState(window));

    return state;
  });
}

registerIpcHandlers.initialized = false;

export default registerIpcHandlers;

