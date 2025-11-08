import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  FaFolderOpen,
  FaCog,
  FaHome,
  FaThLarge,
  FaBell,
  FaLayerGroup,
  FaBookmark,
  FaUser,
  FaTag,
  FaTimes,
  FaSearch,
  FaDownload,
  FaExternalLinkAlt,
  FaSteam,
  FaUsers,
  FaGlobe,
  FaRedditAlien,
  FaTwitter,
  FaYoutube,
  FaCheckCircle,
  FaExclamationTriangle,
  FaPuzzlePiece,
  FaStar,
  FaMinus,
  FaWindowMaximize,
  FaWindowRestore,
  FaSlidersH,
} from 'react-icons/fa';
import bbcode from 'bbcodejs';

const HERO_LINK_ICON_MAP = {
  website: FaGlobe,
  support: FaUsers,
  reddit: FaRedditAlien,
  twitter: FaTwitter,
  youtube: FaYoutube,
  bluesky: FaGlobe,
  bilibili: FaGlobe,
  steam: FaSteam,
  community: FaUsers,
  workshop: FaSteam,
};

function getBridge() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.api ?? null;
}

function getWindowControls() {
  if (typeof window === 'undefined') {
    return null;
  }
  return window.windowControls ?? null;
}

function getPlatform() {
  if (typeof window === 'undefined') {
    return '';
  }
  return window.environment?.platform ?? '';
}

async function safeInvoke(channel, payload) {
  const bridge = getBridge();
  if (!bridge?.invoke) {
    console.warn('IPC bridge not ready; returning empty result for', channel);
    return null;
  }

  return bridge.invoke(channel, payload);
}

const BROWSE_SORT_OPTIONS = [
  {
    id: 'popular',
    label: 'Most Popular',
    sort: 'trend',
    actualSort: 'trend',
    queryType: 0,
    supportsTimeframe: true,
    requiresSearch: false,
  },
  {
    id: 'relevance',
    label: 'Relevance',
    sort: 'textsearch',
    actualSort: 'textsearch',
    queryType: 0,
    supportsTimeframe: false,
    requiresSearch: true,
  },
  {
    id: 'subscribed',
    label: 'Most Subscribed',
    sort: 'totaluniquesubscribers',
    actualSort: 'totaluniquesubscribers',
    queryType: 9,
    supportsTimeframe: false,
    requiresSearch: false,
  },
  {
    id: 'recent',
    label: 'Most Recent',
    sort: 'mostrecent',
    actualSort: 'mostrecent',
    queryType: 1,
    supportsTimeframe: false,
    requiresSearch: false,
  },
  {
    id: 'updated',
    label: 'Last Updated',
    sort: 'lastupdated',
    actualSort: 'lastupdated',
    queryType: 1,
    supportsTimeframe: false,
    requiresSearch: false,
  },
];

const DEFAULT_TIMEFRAME_ID = '180';
const TIMEFRAME_OPTIONS = [
  { id: '1', label: 'Today', days: 1 },
  { id: '7', label: 'This Week', days: 7 },
  { id: '30', label: 'This Month', days: 30 },
  { id: '90', label: 'Last 3 Months', days: 90 },
  { id: '180', label: 'Last 6 Months', days: 180 },
  { id: '365', label: 'This Year', days: 365 },
  { id: 'all', label: 'All Time', days: null },
];

const DEFAULT_PAGE_SIZE = 30;

function getPopularTimeframeParams(days) {
  switch (days) {
    case 1:
      return { days: 1, queryType: 3 };
    case 7:
      return { days: 7, queryType: 3 };
    case 30:
      return { days: 30, queryType: 3 };
    case 90:
      return { days: 90, queryType: 3 };
    case 180:
      return { days: 180, queryType: 3 };
    case 365:
      return { days: 365, queryType: 3 };
    default:
      return { days: -1, queryType: 0 };
  }
}

const INSTALL_MODES = [
  { value: 'copy', label: 'Copy files (recommended)' },
  { value: 'symlink', label: 'Create symlinks (advanced)' },
];

const EMPTY_HOME_DATA = {
  trendingWeek: [],
  popularAllTime: [],
  subscribedAllTime: [],
  recentUpdated: [],
  tags: [],
};

const STEAM_ID_REGEX = /^\d{5,}$/;
const WORKSHOP_URL_REGEX = /(?:https?:\/\/)?(?:www\.)?steamcommunity\.com\/sharedfiles\/filedetails\/?\?id=(\d+)/i;

const bbcodeParserInstance = new bbcode.Parser();
bbcodeParserInstance.renderer.options.linkify = true;
bbcodeParserInstance.registerTag('s', bbcode.createSimpleTag('del'));
bbcodeParserInstance.registerTag('strike', bbcode.createSimpleTag('del'));

async function resolveAuthorNamesForLists(modLists) {
  const flatMods = modLists.flat().filter(Boolean);
  if (flatMods.length === 0) {
    return modLists;
  }

  const candidateIds = flatMods
    .map((mod) => mod?.authorId ?? (typeof mod?.author === 'string' && STEAM_ID_REGEX.test(mod.author) ? mod.author : null))
    .filter(Boolean);

  const uniqueIds = Array.from(new Set(candidateIds));
  if (uniqueIds.length === 0) {
    return modLists;
  }

  try {
    const response = await safeInvoke('steam:get-player-summaries', { steamIds: uniqueIds });
    const playersArray = Array.isArray(response)
      ? response
      : Array.isArray(response?.players)
        ? response.players
        : [];

    if (!playersArray.length) {
      return modLists;
    }

    const nameMap = new Map(playersArray.map((player) => [player.steamid, player.personaname]));

    const mapMod = (mod) => {
      if (!mod) return mod;
      const candidateId = mod.authorId ?? (typeof mod.author === 'string' && STEAM_ID_REGEX.test(mod.author) ? mod.author : null);
      if (candidateId && nameMap.has(candidateId)) {
        return {
          ...mod,
          authorId: candidateId,
          author: nameMap.get(candidateId),
        };
      }
      return mod;
    };

    return modLists.map((list) => list.map(mapMod));
  } catch (error) {
    console.error('Failed to resolve author names', error);
    return modLists;
  }
}

function formatDescription(markup) {
  if (!markup) {
    return '';
  }
  try {
    const rawHtml = bbcodeParserInstance.toHTML(markup);
    if (typeof DOMParser === 'undefined') {
      return rawHtml;
    }

    const parser = new DOMParser();
    const doc = parser.parseFromString(`<div>${rawHtml}</div>`, 'text/html');
    const container = doc.body.firstElementChild ?? doc.body;

    container.querySelectorAll('a').forEach((anchor) => {
      const href = (anchor.getAttribute('href') || '').trim();
      const text = (anchor.textContent || '').trim();
      if (!href || !text) {
        return;
      }

      const normalizedHref = href.replace(/^https?:\/\//i, '').replace(/\/$/, '');
      const normalizedText = text.replace(/^https?:\/\//i, '').replace(/\/$/, '');

      if (normalizedHref !== normalizedText) {
        let prev = anchor.previousSibling;

        while (prev && prev.nodeType === Node.TEXT_NODE && prev.textContent.trim() === '') {
          const nodeToRemove = prev;
          prev = prev.previousSibling;
          nodeToRemove.parentNode?.removeChild(nodeToRemove);
        }

        if (prev && prev.nodeName === 'BR') {
          prev.parentNode?.removeChild(prev);
        }
      }
    });

    return container.innerHTML;
  } catch (error) {
    console.error('Failed to parse BBCode', error);
    return markup;
  }
}

function formatFileSize(bytes) {
  if (!bytes || Number.isNaN(bytes)) {
    return 'Unknown';
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatRequirementTitle(req) {
  if (!req) {
    return 'Unknown item';
  }
  if (req.title && req.title.trim()) {
    return req.title.trim();
  }
  if (req.bulkTitle && req.bulkTitle.trim()) {
    return req.bulkTitle.trim();
  }
  if (req.modId) {
    return req.modId;
  }
  if (req.appId) {
    return `App ${req.appId}`;
  }
  return 'Unknown item';
}

function extractWorkshopId(value) {
  if (typeof value !== 'string') {
    return null;
  }

  const trimmed = value.trim();
  if (!trimmed) {
    return null;
  }

  const urlMatch = trimmed.match(WORKSHOP_URL_REGEX);
  if (urlMatch?.[1]) {
    return urlMatch[1];
  }

  if (STEAM_ID_REGEX.test(trimmed)) {
    return trimmed;
  }

  return null;
}

function getJobPriority(status) {
  switch (status) {
    case 'running':
      return 0;
    case 'queued':
      return 1;
    case 'completed':
      return 2;
    case 'failed':
      return 3;
    case 'cancelled':
      return 4;
    default:
      return 5;
  }
}

function getJobStatusLabel(job) {
  if (!job) {
    return '';
  }

  switch (job.status) {
    case 'running':
      return 'Downloading';
    case 'queued':
      return 'Queued';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'cancelled':
      return 'Cancelled';
    default:
      return job.status;
  }
}

function formatTimestamp(isoString) {
  if (!isoString) {
    return '—';
  }

  try {
    const date = new Date(isoString);
    if (Number.isNaN(date.getTime())) {
      return '—';
    }
    return date.toLocaleString();
  } catch (error) {
    return '—';
  }
}

function formatDurationRange(startIso, endIso) {
  if (!startIso || !endIso) {
    return '—';
  }

  try {
    const start = new Date(startIso).getTime();
    const end = new Date(endIso).getTime();
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) {
      return '—';
    }

    const diffSeconds = Math.floor((end - start) / 1000);
    const minutes = Math.floor(diffSeconds / 60);
    const seconds = diffSeconds % 60;

    if (minutes > 0) {
      return `${minutes}m ${seconds.toString().padStart(2, '0')}s`;
    }

    return `${seconds}s`;
  } catch (error) {
    return '—';
  }
}

function renderStarRating(score, maxStars = 5) {
  if (score === null || score === undefined) {
    return null;
  }

  // Steam score is typically 0-100, convert to 0-5 scale
  const normalizedScore = Math.min(100, Math.max(0, score));
  const starRating = (normalizedScore / 100) * maxStars;
  const fullStars = Math.floor(starRating);
  const hasHalfStar = starRating - fullStars >= 0.5;

  return (
    <span className="star-rating" aria-label={`${starRating.toFixed(1)} out of ${maxStars} stars`}>
      {Array.from({ length: maxStars }, (_, i) => {
        if (i < fullStars) {
          return <FaStar key={i} className="star-rating__star star-rating__star--full" />;
        } else if (i === fullStars && hasHalfStar) {
          return <FaStar key={i} className="star-rating__star star-rating__star--half" />;
        } else {
          return <FaStar key={i} className="star-rating__star star-rating__star--empty" />;
        }
      })}
    </span>
  );
}

function getJobStatusSummary(job) {
  if (!job) {
    return '';
  }

  if (job.status === 'completed') {
    return 'Completed';
  }

  if (job.status === 'failed') {
    const lastLog = job.logs?.[job.logs.length - 1]?.message?.trim();
    return job.error || lastLog || 'Failed';
  }

  if (job.status === 'running') {
    const progressValue = Math.max(0, Math.min(100, Number.isFinite(job.progress) ? Math.round(job.progress) : 0));
    return `Downloading… ${progressValue}%`;
  }

  if (job.status === 'queued') {
    return 'Queued';
  }

  if (job.status === 'cancelled') {
    return 'Cancelled';
  }

  return job.status;
}

function formatOptionalFileSize(bytes) {
  if (typeof bytes === 'string') {
    const parsed = Number(bytes.trim());
    if (Number.isFinite(parsed)) {
      bytes = parsed;
    }
  }

  if (typeof bytes !== 'number' || Number.isNaN(bytes) || bytes <= 0) {
    return 'Unknown size';
  }
  return formatFileSize(bytes);
}

function formatList(values, limit = null) {
  if (!values) {
    return '—';
  }

  let list = [];
  if (Array.isArray(values)) {
    list = values
      .map((value) => {
        if (typeof value === 'string') {
          return value.trim();
        }
        if (value && typeof value === 'object') {
          return (value.description || value.name || value.title || '').trim();
        }
        return '';
      })
      .filter(Boolean);
  } else if (typeof values === 'string') {
    const trimmed = values.trim();
    if (trimmed) {
      list = [trimmed];
    }
  }

  if (!list.length) {
    return '—';
  }

  if (limit && list.length > limit) {
    list = list.slice(0, limit);
  }

  return list.join(', ');
}

function formatReviewSummary(summary) {
  if (!summary) {
    return '—';
  }

  const parts = [];
  if (summary.reviewScoreDesc) {
    parts.push(summary.reviewScoreDesc);
  }
  if (Number.isFinite(summary.totalReviews) && summary.totalReviews > 0) {
    parts.push(`(${summary.totalReviews.toLocaleString()} reviews)`);
  }

  return parts.length > 0 ? parts.join(' ') : '—';
}

function stripHtml(value) {
  if (!value || typeof value !== 'string') {
    return '';
  }

  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function detectLinkKind(label = '', url = '', fallback = 'website') {
  const text = `${label} ${url}`.toLowerCase();

  if (text.includes('reddit') || url.toLowerCase().includes('reddit.com')) {
    return 'reddit';
  }

  if (text.includes('youtube') || url.toLowerCase().includes('youtu')) {
    return 'youtube';
  }

  if (text.includes('twitter') || text.includes('x.com') || url.toLowerCase().includes('twitter.com') || url.toLowerCase().includes('x.com')) {
    return 'twitter';
  }

  if (text.includes('bluesky') || text.includes('bsky') || url.toLowerCase().includes('bsky.app')) {
    return 'bluesky';
  }

  if (text.includes('bilibili') || url.toLowerCase().includes('bilibili')) {
    return 'bilibili';
  }

  if (text.includes('community') && url.toLowerCase().includes('steamcommunity.com/app')) {
    return 'community';
  }

  if (text.includes('workshop')) {
    return 'workshop';
  }

  if (text.includes('support')) {
    return 'support';
  }

  if (text.includes('steam') && url.toLowerCase().includes('store.steampowered.com/app')) {
    return 'steam';
  }

  if (text.includes('website') || url.toLowerCase().includes('http')) {
    return 'website';
  }

  return fallback ?? 'website';
}

function buildHeroLinks(details, appId) {
  const linkMap = new Map();

  const pushLink = (label, url, kind = undefined) => {
    if (!url || typeof url !== 'string') {
      return;
    }
    const trimmedUrl = url.trim();
    if (!trimmedUrl) {
      return;
    }

    const key = trimmedUrl;
    if (linkMap.has(key)) {
      return;
    }

    const detectedKind = detectLinkKind(label, trimmedUrl, kind);
    linkMap.set(key, {
      label: label || 'Link',
      url: trimmedUrl,
      kind: detectedKind,
    });
  };

  if (appId) {
    pushLink('Steam Store', `https://store.steampowered.com/app/${appId}/`, 'steam');
    pushLink('Community Hub', `https://steamcommunity.com/app/${appId}`, 'community');
    pushLink('Workshop Page', `https://steamcommunity.com/workshop/browse/?appid=${appId}`, 'workshop');
  }

  if (details?.website) {
    pushLink('Website', details.website, 'website');
  }

  if (details?.support_info?.url) {
    pushLink('Support', details.support_info.url, 'support');
  }

  if (Array.isArray(details?.links)) {
    details.links.forEach((entry) => {
      if (!entry) return;
      const label = entry.name || entry.title || entry.label || 'Link';
      const url = entry.url || entry.link;
      pushLink(label, url);
    });
  }

  if (Array.isArray(details?.social_media)) {
    details.social_media.forEach((entry) => {
      if (!entry) return;
      const label = entry.name || entry.platform || entry.title || 'Link';
      const url = entry.url || entry.link;
      pushLink(label, url);
    });
  }

  return Array.from(linkMap.values());
}

function createEmptyProfileForm(appId = '') {
  return {
    id: null,
    name: '',
    appId: appId ? String(appId) : '',
    modPath: '',
    steamcmdPath: '',
    installMode: 'copy',
  };
}

function createSettingsForm(config = {}) {
  return {
    steamApiKey: config.steamApiKey ?? '',
    steamcmdPath: config.steamcmdPath ?? '',
    defaultInstallMode: config.defaultInstallMode ?? 'copy',
    concurrency: String(config.concurrency ?? 1),
    enableUpdateChecks: config.enableUpdateChecks ?? true,
    appDataDir: config.appDataDir ?? '',
  };
}

function generateUniqueId(prefix = 'id') {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
}

function createUniqueCollectionName(name, existingNames) {
  const base = (name || '').trim() || 'Imported Collection';
  let candidate = base;
  let counter = 2;
  const namesSet = existingNames ?? new Set();
  while (namesSet.has(candidate.toLowerCase())) {
    candidate = `${base} (${counter})`;
    counter += 1;
  }
  namesSet.add(candidate.toLowerCase());
  return candidate;
}

const DEFAULT_COLLECTION_IMPORT_MODAL = {
  isOpen: false,
  mode: 'options',
  steamUrl: '',
  loading: false,
  error: '',
};

function createCollectionTemplate(name = '') {
  const timestamp = new Date().toISOString();
  return {
    id: generateUniqueId('collection'),
    name: name.trim() || 'Untitled Collection',
    description: '',
    mods: [],
    tags: [],
    createdAt: timestamp,
    updatedAt: timestamp,
  };
}

function normalizeCollectionModEntry(mod) {
  if (!mod) {
    return null;
  }

  const modId = String(
    mod.modId
      ?? mod.id
      ?? mod.publishedFileId
      ?? mod.publishedfileid
      ?? mod.workshopId
      ?? '',
  ).trim();

  if (!modId) {
    return null;
  }

  const title = mod.title ?? mod.name ?? mod.workshopTitle ?? '';
  const author = mod.author ?? mod.creator ?? mod.owner ?? '';
  const previewUrls = Array.isArray(mod.previewUrls) ? mod.previewUrls : [];
  const previewUrl = mod.previewUrl ?? previewUrls[0] ?? '';
  const url = mod.url ?? mod.workshopUrl ?? (modId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${modId}` : '');
  const tags = Array.isArray(mod.tags)
    ? mod.tags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];

  return {
    modId,
    title,
    author,
    previewUrl,
    workshopUrl: url,
    addedAt: new Date().toISOString(),
    stats: mod.stats ? { score: mod.stats.score ?? null } : undefined,
    tags,
  };
}

function normalizeCollection(collection) {
  if (!collection) {
    return null;
  }

  const timestamp = new Date().toISOString();
  const mods = Array.isArray(collection.mods) ? collection.mods.filter(Boolean) : [];
  const profileId = collection.profileId ? String(collection.profileId) : null;
  return {
    id: collection.id ?? generateUniqueId('collection'),
    name: (collection.name ?? 'Untitled Collection').trim() || 'Untitled Collection',
    description: typeof collection.description === 'string' ? collection.description : '',
    mods,
    tags: Array.isArray(collection.tags)
      ? collection.tags.map((tag) => String(tag).trim()).filter(Boolean)
      : [],
    createdAt: collection.createdAt ?? timestamp,
    updatedAt: collection.updatedAt ?? timestamp,
    profileId,
  };
}

function normalizeCollectionList(collections = []) {
  return collections
    .map((collection) => normalizeCollection(collection))
    .filter(Boolean);
}

function getCollectionPreviewImages(collection, limit = 4) {
  if (!collection || !Array.isArray(collection.mods)) {
    return [];
  }

  const images = [];
  const seen = new Set();
  for (const entry of collection.mods) {
    if (!entry?.modId || seen.has(entry.modId)) {
      continue;
    }
    seen.add(entry.modId);
    const preview = entry.previewUrl;
    if (preview) {
      images.push(preview);
    }
    if (images.length >= limit) {
      break;
    }
  }
  return images;
}

function buildModShapeFromCollectionEntry(entry) {
  if (!entry || !entry.modId) {
    return null;
  }

  return {
    modId: entry.modId,
    title: entry.title || entry.modId,
    author: entry.author || '',
    previewUrl: entry.previewUrl || '',
    previewUrls: entry.previewUrl ? [entry.previewUrl] : [],
    url: entry.workshopUrl || (entry.modId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${entry.modId}` : ''),
    stats: entry.stats || null,
    tags: Array.isArray(entry.tags) ? entry.tags : [],
  };
}

function parseTagList(value) {
  if (!value) {
    return [];
  }

  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item, index, array) => item.length > 0 && array.indexOf(item) === index);
}

function mergeTagLists(existingTags, additions) {
  const base = Array.isArray(existingTags)
    ? existingTags.map((tag) => String(tag).trim()).filter(Boolean)
    : [];
  const result = [...base];
  if (Array.isArray(additions)) {
    additions.forEach((tag) => {
      const trimmed = String(tag).trim();
      if (trimmed && !result.includes(trimmed)) {
        result.push(trimmed);
      }
    });
  }
  return result;
}

function useDownloadJobs() {
  const [jobs, setJobs] = useState([]);

  useEffect(() => {
    let unsubscribe = () => {};

    async function bootstrap() {
      const initialJobs = (await safeInvoke('jobs:get-all')) ?? [];
      setJobs(initialJobs);

      const bridge = getBridge();
      if (bridge?.subscribeDownloads) {
        unsubscribe = bridge.subscribeDownloads((job) => {
          setJobs((prev) => {
            const existingIndex = prev.findIndex((item) => item.id === job.id);
            if (existingIndex >= 0) {
              const next = [...prev];
              next[existingIndex] = job;
              return next;
            }
            return [...prev, job];
          });
        });
      }
    }

    bootstrap();

    return () => {
      unsubscribe?.();
    };
  }, []);

  return jobs;
}

function createDependencyPromptState() {
  return {
    isOpen: false,
    mod: null,
    missing: [],
    installed: [],
    options: { silent: true, notify: true },
  };
}

function createUninstallConfirmState() {
  return {
    isOpen: false,
    record: null,
  };
}

export default function App() {
  const platform = useMemo(() => getPlatform(), []);
  const [windowControlsAvailable, setWindowControlsAvailable] = useState(() => Boolean(getWindowControls()));
  const [windowIsMaximized, setWindowIsMaximized] = useState(false);
  const [config, setConfig] = useState(null);
  const [profiles, setProfiles] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState(null);
  const [modRecords, setModRecords] = useState([]);
  const [allCollections, setAllCollections] = useState([]);
  const [collectionsSaving, setCollectionsSaving] = useState(false);
  const [collectionsError, setCollectionsError] = useState('');
  const [activeCollectionId, setActiveCollectionId] = useState(null);
  const [collectionRenameDrafts, setCollectionRenameDrafts] = useState({});
  const [collectionTagDrafts, setCollectionTagDrafts] = useState({});
  const [collectionAssignState, setCollectionAssignState] = useState({
    isOpen: false,
    mod: null,
    selectedIds: [],
    newName: '',
    error: '',
  });
  const [collectionImportModal, setCollectionImportModal] = useState({ ...DEFAULT_COLLECTION_IMPORT_MODAL });
  const [collectionDependencyPrompt, setCollectionDependencyPrompt] = useState({
    isOpen: false,
    collection: null,
    baseMods: [],
    dependencyMods: [],
  });
  const [collectionDeletionConfirm, setCollectionDeletionConfirm] = useState({
    isOpen: false,
    collection: null,
  });
  const [modIdInput, setModIdInput] = useState('');
  const [isLoadingMod, setIsLoadingMod] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');
  const [browseSortId, setBrowseSortId] = useState('popular');
  const [browseTimeframeId, setBrowseTimeframeId] = useState(DEFAULT_TIMEFRAME_ID);
  const [browsePage, setBrowsePage] = useState(1);
  const [browseTotal, setBrowseTotal] = useState(0);
  const [browseCursorHistory, setBrowseCursorHistory] = useState({});
  const [browseHasMore, setBrowseHasMore] = useState(false);
  const [browseRequiredTag, setBrowseRequiredTag] = useState(null);
  const [browseSearchInput, setBrowseSearchInput] = useState('');
  const [browseSearchText, setBrowseSearchText] = useState('');
  const [browseSearchVersion, setBrowseSearchVersion] = useState(0);
  const [isTagPickerOpen, setIsTagPickerOpen] = useState(false);
  const [gridMods, setGridMods] = useState([]);
  const [isLoadingGrid, setIsLoadingGrid] = useState(false);
  const [gridError, setGridError] = useState('');

  const latestRequestRef = useRef(0);

  const [isProfileManagerOpen, setIsProfileManagerOpen] = useState(false);
  const [profileForm, setProfileForm] = useState(() => createEmptyProfileForm());
  const [profileFormMode, setProfileFormMode] = useState('create');
  const [profileFormErrors, setProfileFormErrors] = useState({});
  const [profileAlert, setProfileAlert] = useState('');
  const [profileSubmitting, setProfileSubmitting] = useState(false);
  const [profileDeleting, setProfileDeleting] = useState(false);
  const [activeView, setActiveView] = useState('home');
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [settingsForm, setSettingsForm] = useState(() => createSettingsForm());
  const [settingsErrors, setSettingsErrors] = useState({});
  const [settingsAlert, setSettingsAlert] = useState('');
  const [settingsSubmitting, setSettingsSubmitting] = useState(false);
  const [homeData, setHomeData] = useState(EMPTY_HOME_DATA);
  const [homeLoading, setHomeLoading] = useState(false);
  const [homeError, setHomeError] = useState('');
  const [carouselIndex, setCarouselIndex] = useState(0);
  const [homeSelectedList, setHomeSelectedList] = useState('popular');
  const [modDetailState, setModDetailState] = useState({
    isOpen: false,
    loading: false,
    mod: null,
    error: '',
    selectedImageIndex: 0,
    requirements: [],
  });
  const [homeDataVersion, setHomeDataVersion] = useState(0);
  const [homeTransitionKey, setHomeTransitionKey] = useState(0);
  const [browseTransitionKey, setBrowseTransitionKey] = useState(0);
  const [viewTransitionKey, setViewTransitionKey] = useState(0);
  const [subscriptionsAlert, setSubscriptionsAlert] = useState({ type: 'info', message: '' });
  const [contextMenuState, setContextMenuState] = useState({ isOpen: false, x: 0, y: 0, mod: null });
  const [toasts, setToasts] = useState([]);
  const [isDownloadsPanelOpen, setIsDownloadsPanelOpen] = useState(false);
  const [isCheckingAllUpdates, setIsCheckingAllUpdates] = useState(false);
  const [subscriptionAuthorNames, setSubscriptionAuthorNames] = useState({});
  const [heroImageFailed, setHeroImageFailed] = useState(false);
  const [appDetails, setAppDetails] = useState(null);
  const [appReviewSummaries, setAppReviewSummaries] = useState(null);
  const [appDetailsError, setAppDetailsError] = useState('');
  const [isImageLightboxOpen, setIsImageLightboxOpen] = useState(false);
  const [lightboxImageIndex, setLightboxImageIndex] = useState(0);
  const [dependencyPromptState, setDependencyPromptState] = useState(createDependencyPromptState);
  const [uninstallConfirmState, setUninstallConfirmState] = useState(createUninstallConfirmState);
  const [changeLogState, setChangeLogState] = useState({
    loading: false,
    error: '',
    entries: [],
    count: 0,
    modId: null,
  });
  const [isChangeLogModalOpen, setIsChangeLogModalOpen] = useState(false);
  const changeNotesAbortRef = useRef(null);
  const welcomeNotificationShownRef = useRef(false);
  const [commentsState, setCommentsState] = useState({
    loading: false,
    error: '',
    comments: [],
    totalCount: 0,
    currentPage: 0,
    pageSize: 50,
    hasMore: false,
    modId: null,
  });
  const [breadcrumbs, setBreadcrumbs] = useState([]);
  const [originalPageState, setOriginalPageState] = useState(null);

  useEffect(() => {
    const controls = getWindowControls();

    if (!controls) {
      return undefined;
    }

    setWindowControlsAvailable(true);

    let isMounted = true;

    controls.getState?.().then((state) => {
      if (!isMounted) {
        return;
      }

      if (state && typeof state.isMaximized === 'boolean') {
        setWindowIsMaximized(state.isMaximized);
      }
    });

    const unsubscribe = controls.onStateChange?.((state) => {
      if (state && typeof state.isMaximized === 'boolean') {
        setWindowIsMaximized(state.isMaximized);
      }
    });

    return () => {
      isMounted = false;
      unsubscribe?.();
    };
  }, []);

  const showWindowControls = windowControlsAvailable && platform !== 'darwin';

  const handleMinimizeWindow = useCallback(() => {
    const controls = getWindowControls();
    controls?.minimize?.();
  }, []);

  const handleToggleMaximizeWindow = useCallback(() => {
    const controls = getWindowControls();
    controls?.toggleMaximize?.();
  }, []);

  const handleCloseWindow = useCallback(() => {
    const controls = getWindowControls();
    controls?.close?.();
  }, []);

  const downloadJobs = useDownloadJobs();
  const collectionsLoadedRef = useRef(false);
  const jobStatusRef = useRef(new Map());
  const previousJobStatusRef = useRef(new Map());
  const [jobCompletionAnimations, setJobCompletionAnimations] = useState({});
  const completionTimersRef = useRef(new Map());
  const progressStateRef = useRef(new Map());
  const [jobProgressDisplay, setJobProgressDisplay] = useState({});
  const fetchedSubscriptionAuthorIdsRef = useRef(new Set());
  const downloadJobByModId = useMemo(() => {
    const map = new Map();
    downloadJobs.forEach((job) => {
      if (selectedProfileId && job.profileId !== selectedProfileId) {
        return;
      }

      if (!map.has(job.modId)) {
        map.set(job.modId, job);
        return;
      }

      const current = map.get(job.modId);
      const priority = getJobPriority(job.status);
      const currentPriority = getJobPriority(current.status);
      if (priority < currentPriority) {
        map.set(job.modId, job);
      }
    });
    return map;
  }, [downloadJobs, selectedProfileId]);

  const downloadJobsForProfile = useMemo(() => {
    return downloadJobs.filter((job) => !selectedProfileId || job.profileId === selectedProfileId);
  }, [downloadJobs, selectedProfileId]);

  const activeModId = modDetailState.mod?.modId ?? null;
  const isActiveChangeLogState = activeModId && changeLogState.modId === activeModId;
  const changeLogCountForActiveMod = isActiveChangeLogState ? changeLogState.count : 0;
  const isChangeLogLoading = Boolean(isActiveChangeLogState && changeLogState.loading && changeLogState.entries.length === 0);
  const changeLogButtonLabel = isChangeLogLoading && !isChangeLogModalOpen
    ? 'Loading update logs…'
    : `${changeLogCountForActiveMod.toLocaleString()} Update Log${changeLogCountForActiveMod === 1 ? '' : 's'}`;

  const collectionsById = useMemo(() => {
    return allCollections.reduce((map, collection) => {
      if (collection?.id) {
        map.set(collection.id, collection);
      }
      return map;
    }, new Map());
  }, [allCollections]);

  const closeContextMenu = useCallback(() => {
    setContextMenuState((prev) => (prev.isOpen ? { ...prev, isOpen: false, mod: null } : prev));
  }, []);

  useEffect(() => {
    function handleGlobalClick() {
      closeContextMenu();
    }

    function handleEscape(event) {
      if (event.key === 'Escape') {
        closeContextMenu();
      }
    }

    window.addEventListener('click', handleGlobalClick);
    window.addEventListener('contextmenu', handleGlobalClick);
    window.addEventListener('keydown', handleEscape);

    return () => {
      window.removeEventListener('click', handleGlobalClick);
      window.removeEventListener('contextmenu', handleGlobalClick);
      window.removeEventListener('keydown', handleEscape);
    };
  }, [closeContextMenu]);

  const showToast = useCallback((message, type = 'info', options = {}) => {
    const { title, modName, duration = 5000 } = options;
    // Allow toasts with title even if message is empty
    if (!message && !title) return;
    const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
    setToasts((prev) => [...prev, { id, message, type, title, modName }]);
    window.setTimeout(() => {
      setToasts((prev) => {
        const toast = prev.find((t) => t.id === id);
        if (toast) {
          toast.exiting = true;
          return [...prev];
        }
        return prev.filter((toast) => toast.id !== id);
      });
      window.setTimeout(() => {
        setToasts((prev) => prev.filter((toast) => toast.id !== id));
      }, 300);
    }, duration);
  }, []);

  const showModNotification = useCallback((title, modName, type = 'info') => {
    showToast('', type, { title, modName });
  }, [showToast]);

  const markCollectionsReady = useCallback(() => {
    if (!collectionsLoadedRef.current) {
      collectionsLoadedRef.current = true;
    }
  }, []);

  const updateCollections = useCallback((updater) => {
    markCollectionsReady();
    setAllCollections((prev) => {
      if (typeof updater === 'function') {
        return updater(prev);
      }
      return updater;
    });
  }, [markCollectionsReady]);

  const collections = useMemo(() => {
    if (!selectedProfileId) {
      return [];
    }
    return allCollections.filter((collection) => {
      if (!collection?.profileId) {
        return true;
      }
      return collection.profileId === selectedProfileId;
    });
  }, [allCollections, selectedProfileId]);

  const openCollectionDetail = useCallback((collectionId, options = {}) => {
    const collection = collectionsById.get(collectionId);

    if (!collection) {
      showToast('Collection not found.', 'error');
      return;
    }

    if (collection.profileId && collection.profileId !== selectedProfileId) {
      setSelectedProfileId(collection.profileId);
    }

    setActiveCollectionId(collectionId);
    setActiveView('collection-detail');

    if (!options.preserveBreadcrumbs) {
      setBreadcrumbs([
        { type: 'view', label: 'Collections', data: 'collections', id: 'collections-root' },
        { type: 'collection', label: collection.name, data: { collectionId }, id: collection.id },
      ]);
    }
  }, [collectionsById, selectedProfileId, showToast]);

  function handleModContextMenu(event, mod) {
    event.preventDefault();
    event.stopPropagation();
    const MENU_WIDTH = 200;
    const MENU_HEIGHT = 160;
    const viewportWidth = window.innerWidth || 0;
    const viewportHeight = window.innerHeight || 0;
    const clampedX = Math.max(0, Math.min(event.clientX, viewportWidth - MENU_WIDTH));
    const clampedY = Math.max(0, Math.min(event.clientY, viewportHeight - MENU_HEIGHT));
    setContextMenuState({
      isOpen: true,
      x: clampedX,
      y: clampedY,
      mod,
    });
  }

  async function copyTextToClipboard(text, successMessage = 'Copied to clipboard.') {
    if (!navigator.clipboard || !text) {
      showToast('Clipboard not available.', 'error');
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showToast(successMessage, 'success');
    } catch (error) {
      console.error('Failed to copy text', error);
      showToast('Failed to copy.', 'error');
    }
  }

  async function copyImageToClipboard(url) {
    if (!url) {
      showToast('No image available for this mod.', 'error');
      return;
    }

    try {
      if (navigator.clipboard && navigator.clipboard.write && window.ClipboardItem) {
        const response = await fetch(url, { mode: 'cors' });
        const blob = await response.blob();
        const item = new window.ClipboardItem({ [blob.type]: blob });
        await navigator.clipboard.write([item]);
        showToast('Image copied to clipboard.', 'success');
      } else {
        await navigator.clipboard.writeText(url);
        showToast('Image copy unsupported; URL copied instead.', 'info');
      }
    } catch (error) {
      console.error('Failed to copy image', error);
      if (navigator.clipboard && navigator.clipboard.writeText) {
        try {
          await navigator.clipboard.writeText(url);
          showToast('Image URL copied to clipboard.', 'info');
        } catch (fallbackError) {
          console.error('Failed to copy image URL', fallbackError);
          showToast('Failed to copy image.', 'error');
        }
      } else {
        showToast('Failed to copy image.', 'error');
      }
    }
  }

  function getWorkshopUrl(mod) {
    if (!mod) {
      return '';
    }
    return mod.url || (mod.modId ? `https://steamcommunity.com/sharedfiles/filedetails/?id=${mod.modId}` : '');
  }

  useEffect(() => {
    async function loadInitialData() {
      try {
        const [cfg, profileList, mods] = await Promise.all([
          safeInvoke('config:get'),
          safeInvoke('profiles:get'),
          safeInvoke('mods:get'),
        ]);

        let collectionsPayload = null;
        for (let attempt = 0; attempt < 5; attempt += 1) {
          const response = await safeInvoke('collections:get');
          if (Array.isArray(response)) {
            collectionsPayload = response;
            break;
          }

          await new Promise((resolve) => {
            window.setTimeout(resolve, 150 * (attempt + 1));
          });
        }

        setConfig(cfg ?? {});
        setProfiles(profileList ?? []);
        const resolvedExistingMods = await resolveAuthorNamesForLists([mods ?? []]);
        setModRecords(resolvedExistingMods?.[0] ?? mods ?? []);
        if (collectionsPayload) {
          updateCollections(normalizeCollectionList(collectionsPayload));
        } else {
          console.warn('Failed to hydrate collections from disk; existing data will load after next change.');
        }
        setSettingsForm(createSettingsForm(cfg ?? {}));

        if (profileList?.length) {
          setSelectedProfileId(profileList[0].id);
        }

      } catch (error) {
        console.error('Failed to load initial data', error);
        setErrorMessage('Unable to load local data. Check logs for details.');
      }
    }

    loadInitialData();
     // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showToast]);

  useEffect(() => {
    if (!collectionsLoadedRef.current) {
      return undefined;
    }

    let cancelled = false;
    setCollectionsSaving(true);
    setCollectionsError('');

    safeInvoke('collections:save', allCollections)
      .catch((error) => {
        if (cancelled) {
          return;
        }

        console.error('Failed to save collections', error);
        const message = error?.message ?? 'Failed to save collections.';
        setCollectionsError(message);
        showToast(message, 'error', { duration: 5000 });
      })
      .finally(() => {
        if (!cancelled) {
          setCollectionsSaving(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [allCollections, showToast]);

  useEffect(() => {
    if (!collections.length) {
      if (activeCollectionId !== null) {
        setActiveCollectionId(null);
      }
      return;
    }

    const hasActiveInProfile = collections.some((collection) => collection.id === activeCollectionId);

    if (!hasActiveInProfile) {
      setActiveCollectionId(collections[0].id);
    }
  }, [collections, activeCollectionId]);

  const selectedProfile = useMemo(
    () => profiles.find((profile) => profile.id === selectedProfileId) ?? null,
    [profiles, selectedProfileId],
  );

  const workshopTitle = useMemo(() => {
    if (selectedProfile?.name) {
      return selectedProfile.name;
    }
    if (selectedProfile?.appId) {
      return selectedProfile.appId;
    }
    return 'Workshop';
  }, [selectedProfile]);

  const heroImageCandidate = useMemo(() => {
    if (!selectedProfile?.appId) {
      return null;
    }

    const candidates = [];
    if (appDetails?.background_raw) {
      candidates.push(appDetails.background_raw);
    }
    if (appDetails?.background) {
      candidates.push(appDetails.background);
    }
    if (Array.isArray(appDetails?.screenshots) && appDetails.screenshots.length > 0) {
      const screenshot = appDetails.screenshots[0];
      if (screenshot?.path_full) {
        candidates.push(screenshot.path_full);
      }
    }
    if (appDetails?.header_image) {
      candidates.push(appDetails.header_image);
    }
    if (appDetails?.capsule_imagev5) {
      candidates.push(appDetails.capsule_imagev5);
    }
    candidates.push(`https://cdn.cloudflare.steamstatic.com/steam/apps/${selectedProfile.appId}/library_hero.jpg`);

    return candidates.find((url) => typeof url === 'string' && url.length > 0) ?? null;
  }, [appDetails, selectedProfile?.appId]);

  const heroImageUrl = useMemo(() => {
    if (heroImageFailed) {
      return null;
    }
    return heroImageCandidate ?? null;
  }, [heroImageCandidate, heroImageFailed]);

  useEffect(() => {
    if (!heroImageCandidate) {
      setHeroImageFailed(false);
      return;
    }

    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (!cancelled) {
        setHeroImageFailed(false);
      }
    };
    image.onerror = () => {
      if (!cancelled) {
        setHeroImageFailed(true);
      }
    };
    image.src = heroImageCandidate;

    return () => {
      cancelled = true;
    };
  }, [heroImageCandidate]);

  const heroLinks = useMemo(
    () => buildHeroLinks(appDetails, selectedProfile?.appId),
    [appDetails, selectedProfile?.appId],
  );

  const getHeroLinkIcon = useCallback((kind) => HERO_LINK_ICON_MAP[kind] ?? HERO_LINK_ICON_MAP.website, []);

  useEffect(() => {
    if (profiles.length === 0) {
      if (selectedProfileId !== null) {
        setSelectedProfileId(null);
      }
      return;
    }

    const exists = profiles.some((profile) => profile.id === selectedProfileId);
    if (!exists) {
      setSelectedProfileId(profiles[0].id);
    }
  }, [profiles, selectedProfileId]);

  useEffect(() => {
    if (!selectedProfile?.appId) {
      setHomeData(EMPTY_HOME_DATA);
      return;
    }

    fetchHomeOverview(selectedProfile.appId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedProfile?.appId, config?.steamApiKey]);

  useEffect(() => {
    setCarouselIndex(0);
    if (!homeData.trendingWeek.length) {
      return undefined;
    }

    const timer = setInterval(() => {
      setCarouselIndex((prev) => (prev + 1) % homeData.trendingWeek.length);
    }, 6000);

    return () => {
      clearInterval(timer);
    };
  }, [homeData.trendingWeek]);

  const modRecordsById = useMemo(() => {
    return modRecords.reduce((map, record) => {
      if (!selectedProfileId || record.profileId === selectedProfileId) {
        map.set(record.modId, record);
      }
      return map;
    }, new Map());
  }, [modRecords, selectedProfileId]);

  const subscriptionsForProfile = useMemo(() => {
    if (!selectedProfileId) {
      return [];
    }

    return modRecords
      .filter((record) => record.profileId === selectedProfileId && record.installedPath)
      .sort((a, b) => {
        const aTime = a.lastDownloadedAt ? new Date(a.lastDownloadedAt).getTime() : 0;
        const bTime = b.lastDownloadedAt ? new Date(b.lastDownloadedAt).getTime() : 0;
        return bTime - aTime;
      });
  }, [modRecords, selectedProfileId]);

  useEffect(() => {
    const pendingIds = subscriptionsForProfile
      .map((record) => (record?.author ? String(record.author).trim() : ''))
      .filter((authorId) =>
        authorId
        && STEAM_ID_REGEX.test(authorId)
        && !subscriptionAuthorNames[authorId]
        && !fetchedSubscriptionAuthorIdsRef.current.has(authorId),
      );

    if (!pendingIds.length) {
      return;
    }

    pendingIds.forEach((id) => fetchedSubscriptionAuthorIdsRef.current.add(id));

    safeInvoke('steam:get-player-summaries', { steamIds: pendingIds })
      .then((players) => {
        if (!Array.isArray(players)) {
          return;
        }

        const mapping = {};
        players.forEach((player) => {
          if (player?.steamid && player?.personaname) {
            mapping[player.steamid] = player.personaname;
          }
        });

        if (Object.keys(mapping).length > 0) {
          setSubscriptionAuthorNames((prev) => ({ ...prev, ...mapping }));
        }
      })
      .catch((error) => {
        console.error('Failed to resolve subscription author names', error);
      });
  }, [subscriptionsForProfile, subscriptionAuthorNames]);

  useEffect(() => {
    setHeroImageFailed(false);
  }, [selectedProfile?.appId]);

useEffect(() => {
  if (!selectedProfile?.appId) {
    setAppDetails(null);
    setAppReviewSummaries(null);
    setAppDetailsError('');
    return;
  }

  let cancelled = false;
  setAppDetailsError('');

  const appId = selectedProfile.appId;

  (async () => {
    try {
      const details = await safeInvoke('steam:get-app-details', { appId });
      const reviews = await safeInvoke('steam:get-app-reviews', { appId }).catch((error) => {
        console.warn('Failed to fetch app reviews', error);
        return null;
      });

      if (cancelled) {
        return;
      }

      setAppDetails(details ?? null);
      setAppReviewSummaries(reviews ?? null);
    } catch (error) {
      if (cancelled) {
        return;
      }
      console.error('Failed to fetch app metadata', error);
      setAppDetails(null);
      setAppReviewSummaries(null);
      setAppDetailsError(error?.message ?? 'Unable to load app details');
      return;
    }

    setAppDetailsError('');
  })();

  return () => {
    cancelled = true;
  };
}, [selectedProfile?.appId]);

  const browseSortConfig = useMemo(() => {
    const matched = BROWSE_SORT_OPTIONS.find((option) => option.id === browseSortId);
    if (matched?.requiresSearch && !browseSearchText) {
      return BROWSE_SORT_OPTIONS.find((option) => option.id === 'popular') ?? BROWSE_SORT_OPTIONS[0];
    }
    return matched ?? BROWSE_SORT_OPTIONS[0];
  }, [browseSortId, browseSearchText]);

  const availableBrowseSortOptions = useMemo(() => {
    const filtered = BROWSE_SORT_OPTIONS.filter((option) => !option.requiresSearch || browseSearchText);
    if (browseSearchText) {
      const relevanceOption = filtered.find((option) => option.id === 'relevance');
      if (relevanceOption) {
        return [relevanceOption, ...filtered.filter((option) => option.id !== 'relevance')];
      }
    }
    return filtered;
  }, [browseSearchText]);

  useEffect(() => {
    if (browseSortId === 'relevance' && !browseSearchText) {
      setBrowseSortId('popular');
    }
  }, [browseSortId, browseSearchText]);

  const browseTimeframeOption = useMemo(() => {
    return TIMEFRAME_OPTIONS.find((option) => option.id === browseTimeframeId) ?? TIMEFRAME_OPTIONS[TIMEFRAME_OPTIONS.length - 1];
  }, [browseTimeframeId]);

  const browseCursorKey = useMemo(() => {
    const tagKey = browseRequiredTag ?? 'all';
    const searchKey = browseSearchText ? browseSearchText.toLowerCase() : 'all';
    return `${browseSortId}::${tagKey}::${searchKey}`;
  }, [browseSortId, browseRequiredTag, browseSearchText]);

  const availableTags = useMemo(() => {
    const tagMap = new Map();

    (homeData.tags ?? []).forEach((tag) => {
      if (!tag?.name) {
        return;
      }
      const count = typeof tag.count === 'number' ? tag.count : 0;
      tagMap.set(tag.name, count);
    });

    if (browseRequiredTag && !tagMap.has(browseRequiredTag)) {
      tagMap.set(browseRequiredTag, 0);
    }

    return Array.from(tagMap.entries())
      .sort((a, b) => {
        if (b[1] !== a[1]) {
          return b[1] - a[1];
        }
        return a[0].localeCompare(b[0]);
      })
      .map(([name, count]) => ({ name, count }));
  }, [homeData.tags, browseRequiredTag]);

  useEffect(() => {
    if (!browseSortConfig.supportsTimeframe) {
      if (browseTimeframeId !== 'all') {
        setBrowseTimeframeId('all');
      }
    } else if (!browseTimeframeOption) {
      setBrowseTimeframeId(DEFAULT_TIMEFRAME_ID);
    }
  }, [browseSortConfig, browseTimeframeOption, browseTimeframeId]);

  useEffect(() => {
    const timers = completionTimersRef.current;

    // Clean up timers for jobs no longer completing
    timers.forEach((timeoutId, jobId) => {
      const job = downloadJobs.find((item) => item.id === jobId);
      if (!job || job.status !== 'completed') {
        window.clearTimeout(timeoutId);
        timers.delete(job.id);
        setJobCompletionAnimations((prev) => {
          if (!prev[jobId]) {
            return prev;
          }
          const { [jobId]: _removed, ...rest } = prev;
          return rest;
        });
      }
    });

    downloadJobs.forEach((job) => {
      if (job.status === 'completed' && !timers.has(job.id)) {
        // Always wait for progress to reach 100% before starting completion animation
        // Check progress every frame until it reaches 100%
        const checkProgress = () => {
          const entry = progressStateRef.current.get(job.id);
          const display = entry?.display ?? 0;
          
          if (display >= 99.5) {
            // Progress has reached 100%, start completion animation
            setJobCompletionAnimations((prev) => {
              if (prev[job.id]) {
                return prev;
              }
              return { ...prev, [job.id]: true };
            });

            const timeoutId = window.setTimeout(() => {
              timers.delete(job.id);
              setJobCompletionAnimations((prev) => {
                if (!prev[job.id]) {
                  return prev;
                }
                const { [job.id]: _removed, ...rest } = prev;
                return rest;
              });
            }, 600);

            timers.set(job.id, timeoutId);
          } else {
            // Progress not at 100% yet, check again
            window.requestAnimationFrame(checkProgress);
          }
        };
        
        window.requestAnimationFrame(checkProgress);
      }
    });

    return () => {
      // Do nothing; timers persist between renders until cleared above or in unmount effect
    };
  }, [downloadJobs, jobProgressDisplay]);

  useEffect(() => {
    return () => {
      completionTimersRef.current.forEach((timeoutId) => {
        window.clearTimeout(timeoutId);
      });
      completionTimersRef.current.clear();
    };
  }, []);

  function getJobTargetProgress(job, isCompletionAnimating) {
    if (!job) {
      return 0;
    }

    if (isCompletionAnimating || job.status === 'completed') {
      return 100;
    }

    if (job.status === 'failed' || job.status === 'cancelled') {
      return 0;
    }

    const numericProgress = Number.parseFloat(job.progress);
    if (Number.isFinite(numericProgress)) {
      return Math.max(0, Math.min(100, Math.round(numericProgress)));
    }

    if (job.status === 'running') {
      return 5;
    }

    return 0;
  }

  useEffect(() => {
    const activeJobIds = new Set(downloadJobs.map((job) => job.id));
    const progressState = progressStateRef.current;

    // Remove progress entries for finished jobs that no longer appear
    progressState.forEach((_entry, jobId) => {
      if (!activeJobIds.has(jobId)) {
        progressState.delete(jobId);
        setJobProgressDisplay((prev) => {
          if (!(jobId in prev)) {
            return prev;
          }
          const { [jobId]: _removed, ...rest } = prev;
          return rest;
        });
      }
    });

    const initialDisplays = {};
    let hasInitial = false;

    downloadJobs.forEach((job) => {
      const isCompletionAnimating = job.status === 'completed' && Boolean(jobCompletionAnimations[job.id]);
      const targetProgress = getJobTargetProgress(job, isCompletionAnimating);
      const existingEntry = progressState.get(job.id);

      if (!existingEntry) {
        // For completed jobs, start at current progress if available, otherwise start at 0 to allow full animation
        const currentDisplayFromState = jobProgressDisplay[job.id];
        const initialDisplay = job.status === 'completed' 
          ? (currentDisplayFromState !== undefined ? Math.min(currentDisplayFromState, 99) : 0) // Start from current or 0, but not 100
          : Math.min(targetProgress, 5);
        progressState.set(job.id, {
          display: initialDisplay,
          target: targetProgress, // This will be 100 for completed jobs
        });
        initialDisplays[job.id] = initialDisplay;
        hasInitial = true;
      } else {
        // For completed jobs, ensure target is 100% even if display is less
        if (job.status === 'completed') {
          existingEntry.target = 100;
        } else {
          if (targetProgress < existingEntry.display) {
            existingEntry.display = targetProgress;
          }
          existingEntry.target = targetProgress;
        }
      }
    });

    if (hasInitial) {
      setJobProgressDisplay((prev) => ({
        ...prev,
        ...initialDisplays,
      }));
    }
  }, [downloadJobs, jobCompletionAnimations]);

  useEffect(() => {
    let frameId;

    const step = () => {
      const progressState = progressStateRef.current;
      let hasChanges = false;
      const nextDisplayEntries = {};

      progressState.forEach((entry, jobId) => {
        const { display = 0, target = 0 } = entry;
        let nextDisplay = display;

        if (Math.abs(target - display) < 0.5) {
          nextDisplay = target;
        } else {
          const direction = target > display ? 1 : -1;
          const dynamicStep = Math.max(Math.abs(target - display) * 0.15, 0.8);
          nextDisplay = display + direction * dynamicStep;
          nextDisplay = Math.max(0, Math.min(100, nextDisplay));
        }

        if (nextDisplay !== display) {
          entry.display = nextDisplay;
          hasChanges = true;
        }
        nextDisplayEntries[jobId] = entry.display;
      });

      if (hasChanges) {
        setJobProgressDisplay((prev) => {
          const merged = { ...prev, ...nextDisplayEntries };
          Object.keys(merged).forEach((jobId) => {
            if (!progressState.has(jobId)) {
              delete merged[jobId];
            }
          });
          return merged;
        });
      }

      frameId = window.requestAnimationFrame(step);
    };

    frameId = window.requestAnimationFrame(step);

    return () => {
      if (frameId) {
        window.cancelAnimationFrame(frameId);
      }
    };
  }, []);

  useEffect(() => {
    const currentJobs = new Map(downloadJobs.map((job) => [job.id, job]));
    const previousJobs = previousJobStatusRef.current;

    currentJobs.forEach((job) => {
      const previousJob = previousJobs.get(job.id);
      if (!previousJob) {
        return;
      }

      const wasCompleted = previousJob.status === 'completed';
      const isCompleted = job.status === 'completed';
      const wasFailed = previousJob.status === 'failed';
      const isFailed = job.status === 'failed';

      if (!wasCompleted && isCompleted) {
        const modTitle = job.metadata?.title || job.modId || 'Unknown Mod';
        const record = modRecordsById.get(job.modId);
        const wasInstalled = record?.status === 'installed' || Boolean(record?.installedPath);
        if (wasInstalled) {
          showModNotification('Finished Updating', modTitle, 'success');
        } else {
          showModNotification('Download Finished', modTitle, 'success');
        }
      } else if (!wasFailed && isFailed) {
        const modTitle = job.metadata?.title || job.modId || 'Unknown Mod';
        showModNotification('Download Failed', modTitle, 'error');
      }
    });

    previousJobStatusRef.current = new Map(downloadJobs.map((job) => [job.id, { ...job }]));
  }, [downloadJobs, showModNotification]);

  useEffect(() => {
    if (!selectedProfile?.appId) {
      setGridMods([]);
      setBrowseTotal(0);
      setBrowseCursorHistory((prev) => ({
        ...prev,
        [browseCursorKey]: ['*'],
      }));
      setBrowseHasMore(false);
      setBrowseRequiredTag(null);
      if (profiles.length === 0) {
        setGridError('Add a game profile to browse the Workshop.');
      } else {
        setGridError('Selected profile is missing an App ID.');
      }
      return;
    }

    if (activeView !== 'browse') {
      return;
    }

    fetchBrowseMods();
     // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    selectedProfile?.appId,
    browseSortId,
    browseTimeframeOption,
    browseRequiredTag,
    browsePage,
    activeView,
    browseSearchText,
    browseSearchVersion,
    config?.steamApiKey,
  ]);

  useEffect(() => {
    setBrowsePage(1);
    setBrowseTotal(0);
    setBrowseCursorHistory((prev) => ({
      ...prev,
      [browseCursorKey]: ['*'],
    }));
    setBrowseHasMore(false);
    setGridMods([]);
  }, [browseCursorKey, browseTimeframeId, browseRequiredTag, selectedProfile?.appId]);

  useEffect(() => {
    setViewTransitionKey((prev) => prev + 1);
  }, [activeView]);

  useEffect(() => {
    setHomeTransitionKey((prev) => prev + 1);
  }, [homeSelectedList, homeDataVersion]);

  useEffect(() => {
    let shouldRefreshModRecords = false;
    const nextStatuses = new Map(jobStatusRef.current);
    const failedJobs = [];
    const completedJobs = [];

    downloadJobs.forEach((job) => {
      const previousStatus = nextStatuses.get(job.id);
      if (previousStatus !== job.status) {
        nextStatuses.set(job.id, job.status);
        if (['completed', 'failed', 'cancelled'].includes(job.status)) {
          shouldRefreshModRecords = true;
        }
        if (job.status === 'failed') {
          failedJobs.push(job);
        }
        if (job.status === 'completed') {
          completedJobs.push(job);
        }
      }
    });

    jobStatusRef.current = nextStatuses;

    if (shouldRefreshModRecords) {
      (async () => {
        try {
          const refreshedRecords = (await safeInvoke('mods:get')) ?? [];
          setModRecords(refreshedRecords);
        } catch (error) {
          console.error('Failed to refresh mod records', error);
        }
      })();
    }

    failedJobs.forEach((job) => {
      const lastLog = job.logs?.[job.logs.length - 1]?.message?.trim();
      const message = job.error || lastLog || 'Download failed.';
      console.error('Mod download failed', { job, lastLog });

      if (modDetailState.isOpen && modDetailState.mod?.modId === job.modId) {
        setModDetailState((prev) => ({ ...prev, error: message }));
      }

      if (job.profileId === selectedProfileId) {
        updateSubscriptionsAlert(message, 'error');
      }
    });

    completedJobs.forEach((job) => {
      if (job.profileId === selectedProfileId && modDetailState.isOpen && modDetailState.mod?.modId === job.modId) {
        setModDetailState((prev) => ({ ...prev, error: '' }));
      }
      if (job.profileId === selectedProfileId) {
        updateSubscriptionsAlert('Download completed.', 'success');
      }
    });
  }, [downloadJobs, modDetailState, selectedProfileId]);

  async function fetchHomeOverview(appId) {
    setHomeLoading(true);
    setHomeError('');

    try {
      const [trendingRes, popularRes, subscribedRes, recentRes] = await Promise.all([
        safeInvoke('steam:query-files', {
          appId,
          sort: 'trend',
          actualSort: 'trend',
          queryType: 3,
          days: 7,
          section: 'readytouseitems',
          pageSize: 9,
        }),
        safeInvoke('steam:query-files', {
          appId,
          sort: 'trend',
          actualSort: 'trend',
          queryType: 0,
          section: 'readytouseitems',
          pageSize: 9,
        }),
        safeInvoke('steam:query-files', {
          appId,
          sort: 'totaluniquesubscribers',
          actualSort: 'totaluniquesubscribers',
          queryType: 9,
          section: 'readytouseitems',
          pageSize: 9,
        }),
        safeInvoke('steam:query-files', {
          appId,
          sort: 'mostrecent',
          actualSort: 'mostrecent',
          queryType: 1,
          section: 'readytouseitems',
          pageSize: 9,
        }),
      ]);

      let tagEntries = [];
      try {
        const tagSeed = await safeInvoke('steam:query-files', {
          appId,
          sort: 'trend',
          actualSort: 'trend',
          queryType: 0,
          section: 'readytouseitems',
          pageSize: 100,
          days: -1,
        });

        const tagMap = new Map();
        (tagSeed?.items ?? []).forEach((mod) => {
          (mod.tags ?? []).forEach((tag) => {
            const name = typeof tag === 'string' ? tag : tag?.tag;
            if (!name) {
              return;
            }
            tagMap.set(name, (tagMap.get(name) ?? 0) + 1);
          });
        });

        tagEntries = Array.from(tagMap.entries())
          .sort((a, b) => {
            if (b[1] !== a[1]) {
              return b[1] - a[1];
            }
            return a[0].localeCompare(b[0]);
          })
          .slice(0, 200)
          .map(([name, count]) => ({ name, count }));

        try {
          const globalTagCounts = await safeInvoke('steam:get-tag-counts', {
            appId,
            tags: tagEntries.map((tag) => tag.name),
          });

          if (Array.isArray(globalTagCounts) && globalTagCounts.length > 0) {
            const countMap = new Map(
              globalTagCounts
                .filter((entry) => entry && typeof entry.name === 'string')
                .map((entry) => [entry.name, Number(entry.count) || 0]),
            );

            tagEntries = tagEntries
              .map((tag) => {
                const total = countMap.get(tag.name);
                if (typeof total === 'number' && total >= 0) {
                  return { ...tag, count: total };
                }
                return tag;
              })
              .sort((a, b) => {
                if (b.count !== a.count) {
                  return b.count - a.count;
                }
                return a.name.localeCompare(b.name);
              });
          }
        } catch (tagTotalError) {
          console.warn('Failed to load global tag counts', tagTotalError);
        }
      } catch (tagError) {
        console.warn('Failed to seed tag counts', tagError);
      }

      const initialLists = [
        trendingRes?.items ?? [],
        popularRes?.items ?? [],
        subscribedRes?.items ?? [],
        recentRes?.items ?? [],
      ];

      const [trendingWeek, popularAllTime, subscribedAllTime, recentUpdated] = await resolveAuthorNamesForLists(initialLists);

      setHomeData({
        trendingWeek,
        popularAllTime,
        subscribedAllTime,
        recentUpdated,
        tags: tagEntries,
      });
      setHomeDataVersion((prev) => prev + 1);

      if (
        trendingWeek.length === 0 &&
        popularAllTime.length === 0 &&
        subscribedAllTime.length === 0 &&
        recentUpdated.length === 0
      ) {
        setHomeError('No workshop items found yet.');
      }
    } catch (error) {
      console.error('Failed to load workshop overview', error);
      setHomeData(EMPTY_HOME_DATA);
      setHomeError(error?.message ?? 'Unable to load workshop overview.');
    } finally {
      setHomeLoading(false);
    }
  }

  async function fetchBrowseMods() {
    if (!selectedProfile?.appId) {
      return;
    }

    const requestId = latestRequestRef.current + 1;
    latestRequestRef.current = requestId;
    setIsLoadingGrid(true);
    setGridError('');

    const cursorHistory = browseCursorHistory[browseCursorKey] ?? ['*'];
    const cursor = cursorHistory[browsePage - 1] ?? '*';

    const payload = {
      appId: selectedProfile.appId,
      cursor,
      pageSize: DEFAULT_PAGE_SIZE,
      sort: browseSortConfig.sort,
      actualSort: browseSortConfig.actualSort,
      queryType: browseSortConfig.queryType,
      section: 'readytouseitems',
      searchText: browseSearchText,
    };

    if (browseSortId === 'popular') {
      payload.actualSort = 'trend';
      payload.queryType = 3;
      payload.section = 'readytouseitems';

      const timeframeParams = getPopularTimeframeParams(browseTimeframeOption?.days ?? null);
      payload.days = timeframeParams.days;
      if (timeframeParams.queryType !== undefined) {
        payload.queryType = timeframeParams.queryType;
      }
    } else if (browseSortId === 'relevance') {
      payload.sort = 'textsearch';
      payload.actualSort = 'textsearch';
      payload.queryType = 0;
      payload.days = -1;
    } else if (browseSortId === 'subscribed') {
      payload.actualSort = 'totaluniquesubscribers';
      payload.queryType = 9;
      payload.days = -1;
    } else if (browseSortId === 'recent') {
      payload.actualSort = 'mostrecent';
      payload.queryType = 1;
      payload.days = -1;
    } else if (browseSortId === 'updated') {
      payload.actualSort = 'lastupdated';
      payload.queryType = 1;
      payload.days = -1;
    }

    if (browseRequiredTag) {
      payload.requiredTags = [browseRequiredTag];
    }

    try {
      const result = (await safeInvoke('steam:query-files', payload)) ?? {};

      if (requestId !== latestRequestRef.current) {
        return;
      }

      let items = result.items ?? [];
      const [resolvedItems] = await resolveAuthorNamesForLists([items]);
      if (Array.isArray(resolvedItems)) {
        items = resolvedItems;
      }

      if (requestId !== latestRequestRef.current) {
        return;
      }

      setGridMods(items);
      const responseTotal = typeof result.total === 'number' ? result.total : null;
      const inferredTotal = browseSortConfig.supportsTimeframe
        ? items?.length ?? 0
        : (browsePage - 1) * DEFAULT_PAGE_SIZE + (items?.length ?? 0);
      setBrowseTotal(responseTotal && responseTotal > 0 ? responseTotal : inferredTotal);
      setBrowseTransitionKey((prev) => prev + 1);

      const nextCursor = result.nextCursor ?? null;
      const hasMore = Boolean(nextCursor && nextCursor !== '0');
      setBrowseHasMore(hasMore);
      setBrowseCursorHistory((prev) => {
        const existing = prev[browseCursorKey] ?? ['*'];
        const nextHistory = [...existing];
        nextHistory[browsePage] = nextCursor ?? null;
        return {
          ...prev,
          [browseCursorKey]: nextHistory,
        };
      });

      if (!items.length) {
        setGridError('');
      }
    } catch (error) {
      if (requestId !== latestRequestRef.current) {
        return;
      }

      console.error('Failed to query workshop files', error);
      setGridMods([]);
      setBrowseHasMore(false);
      const message = error?.message ?? 'Unable to load workshop items right now.';
      setGridError(message);
    } finally {
      if (requestId === latestRequestRef.current) {
        setIsLoadingGrid(false);
      }
    }
  }

  function handleSearchInputChange(event) {
    setBrowseSearchInput(event.target.value);
  }

  function handleSearchSubmit(event) {
    event?.preventDefault?.();

    const rawValue = browseSearchInput;
    const trimmed = rawValue.trim();
    const workshopId = extractWorkshopId(rawValue);

    if (!trimmed) {
      if (browseSearchText !== '') {
        setBrowseSearchText('');
      }
      setBrowseSearchInput('');
      setBrowsePage(1);
      if (browseSortId === 'relevance') {
        setBrowseSortId('popular');
      }
      handleViewChange('browse');
      setBrowseSearchVersion((prev) => prev + 1);
      return;
    }

    setBrowseSearchInput(trimmed);

    if (workshopId) {
      handleViewChange('browse');
      openModDetail({ modId: workshopId, appId: selectedProfile?.appId ?? config?.defaultAppId ?? null });
      return;
    }

    if (browseSortId !== 'relevance') {
      setBrowseSortId('relevance');
    }

    if (trimmed !== browseSearchText) {
      setBrowseSearchText(trimmed);
      setBrowsePage(1);
    } else if (browsePage !== 1) {
      setBrowsePage(1);
    }

    handleViewChange('browse');
    setBrowseSearchVersion((prev) => prev + 1);
  }

  async function handleFetchMod() {
    const trimmed = modIdInput.trim();

    if (!trimmed) {
      setErrorMessage('Enter a mod ID to fetch details.');
      return;
    }

    setErrorMessage('');
    setIsLoadingMod(true);

    try {
      const details = await safeInvoke('steam:fetch-mod-details', {
        modId: trimmed,
        appId: selectedProfile?.appId ?? config?.defaultAppId ?? null,
      });
      if (!details) {
        throw new Error('No details returned');
      }

      const resolved = await resolveAuthorNamesForLists([[details]]);
      const enrichedDetails = resolved?.[0]?.[0] ?? details;

      setModRecords((prev) => {
        const exists = prev.some((item) => item.modId === details.modId);
        if (exists) {
          return prev.map((item) => (item.modId === details.modId ? { ...item, ...enrichedDetails } : item));
        }
        return [enrichedDetails, ...prev];
      });

      setGridMods((prev) => {
        const exists = prev.some((item) => item.modId === details.modId);
        if (exists) {
          return prev.map((item) => (item.modId === details.modId ? { ...item, ...enrichedDetails } : item));
        }
        return [enrichedDetails, ...prev];
      });
    } catch (error) {
      console.error('Failed to fetch mod details', error);
      setErrorMessage('Failed to fetch mod details. Verify the Mod ID.');
    } finally {
      setIsLoadingMod(false);
    }
  }

  function openTagPicker() {
    setIsTagPickerOpen(true);
  }

  function closeTagPicker() {
    setIsTagPickerOpen(false);
  }

  function handleBrowseTagSelect(tagName) {
    setBrowseRequiredTag(tagName);
    setIsTagPickerOpen(false);
  }

  function handleClearBrowseTag() {
    setBrowseRequiredTag(null);
    setIsTagPickerOpen(false);
  }

  function handleBrowseSortChange(event) {
    const nextValue = event.target.value;
    if (nextValue === 'relevance' && !browseSearchText) {
      return;
    }
    setBrowseSortId(nextValue);
  }

  function handleBrowseTimeframeChange(event) {
    setBrowseTimeframeId(event.target.value);
  }

  async function handleDownloadMod(mod, { silent = false, notify = true } = {}) {
    if (!mod) {
      return;
    }

    if (!selectedProfile) {
      if (modDetailState.isOpen) {
        setModDetailState((prev) => ({ ...prev, error: 'Select a profile to download this mod.' }));
      }
      return;
    }

    if (!selectedProfile.modPath) {
      if (modDetailState.isOpen) {
        setModDetailState((prev) => ({ ...prev, error: 'Set an install path in the selected profile before downloading.' }));
      }
      return;
    }

    const steamcmdPath = selectedProfile.steamcmdPath?.trim() || config?.steamcmdPath?.trim() || '';
    if (!steamcmdPath) {
      const message = 'Configure SteamCMD in settings or the profile before downloading.';
      if (modDetailState.isOpen) {
        setModDetailState((prev) => ({ ...prev, error: message }));
      }
      if (!silent) {
        updateSubscriptionsAlert(message, 'error');
      }
      if (notify) {
        showToast(message, 'error');
      }
      return;
    }

    const installMode = selectedProfile.installMode || config?.defaultInstallMode || 'copy';

    try {
      await safeInvoke('jobs:start-download', {
        appId: selectedProfile.appId,
        modId: mod.modId,
        profileId: selectedProfile.id,
        steamcmdPath,
        installMode,
        modInstallPath: selectedProfile.modPath,
        metadata: {
          title: mod.title,
          author: mod.author,
          previewUrl: mod.previewUrl,
          url: mod.url,
          timeUpdated: mod.timeUpdated ?? null,
          fileSizeBytes: mod.fileSizeBytes ?? null,
        },
      });

      if (modDetailState.isOpen) {
        setModDetailState((prev) => ({ ...prev, error: '' }));
      }
      const record = modRecordsById.get(mod.modId);
      const isUpdate = record?.status === 'installed' || Boolean(record?.installedPath);
      if (!silent) {
        updateSubscriptionsAlert(isUpdate ? 'Update queued.' : 'Download queued.', 'info');
      }
      if (notify) {
        const modTitle = mod.title || mod.modId;
        if (isUpdate) {
          showModNotification('Updating Mods', modTitle, 'info');
        } else {
          showModNotification('Download Started', modTitle, 'info');
        }
      }
    } catch (error) {
      console.error('Failed to start download job', error);
      if (modDetailState.isOpen) {
        setModDetailState((prev) => ({ ...prev, error: error?.message ?? 'Failed to start download.' }));
      }
      if (!silent) {
        updateSubscriptionsAlert(error?.message ?? 'Failed to start download.', 'error');
      }
      if (notify) {
        showToast(error?.message ?? 'Failed to start download.', 'error');
      }
    }
  }

  function updateSubscriptionsAlert(message, type = 'info') {
    setSubscriptionsAlert({ message, type });
  }

  async function handleSubscriptionCheck(record, options = {}) {
    if (!record) {
      return null;
    }

    const { silent = false } = options;
    const modTitle = record.title || record.modId || 'Unknown Mod';

    applyModRecordUpdate({ ...record, status: 'checking' });
    if (!silent) {
      updateSubscriptionsAlert('Checking for updates…', 'info');
      showModNotification('Checking for Update', modTitle, 'info');
    }

    try {
      const response = await safeInvoke('mods:check-update', {
        modId: record.modId,
        appId: record.appId,
        profileId: record.profileId,
      });

      if (response?.record) {
        const previousStatus = record.status;
        applyModRecordUpdate(response.record);
        if (!silent) {
          if (response.record.status === 'update_available') {
            updateSubscriptionsAlert('An update is available for this mod.', 'warning');
            if (previousStatus !== 'update_available') {
              showModNotification('Mod Update Available', modTitle, 'warning');
            }
          } else {
            updateSubscriptionsAlert('This mod is up to date.', 'success');
            showModNotification('No Updates Found', modTitle, 'success');
          }
        }
        return response.record;
      }

      if (!silent) {
        updateSubscriptionsAlert('Update check completed.', 'info');
      }
      return null;
    } catch (error) {
      console.error('Failed to check for updates', error);
      applyModRecordUpdate({ ...record });
      if (!silent) {
        updateSubscriptionsAlert(error?.message ?? 'Failed to check for updates.', 'error');
        return null;
      }
      throw error;
    }
  }

  async function handleSubscriptionUninstall(record) {
    if (!record) {
      return;
    }

    const modTitle = record.title || record.modId || 'Unknown Mod';
    showModNotification('Uninstall Started', modTitle, 'info');
    applyModRecordUpdate({ ...record, status: 'uninstalling' });
    updateSubscriptionsAlert('Uninstalling mod…', 'info');

    try {
      const updated = await safeInvoke('mods:uninstall', {
        modId: record.modId,
        profileId: record.profileId,
      });

      applyModRecordUpdate(updated);
      updateSubscriptionsAlert('Mod uninstalled successfully.', 'success');
      showModNotification('Uninstall Finished', modTitle, 'success');
    } catch (error) {
      console.error('Failed to uninstall mod', error);
      updateSubscriptionsAlert(error?.message ?? 'Failed to uninstall mod.', 'error');
      showModNotification('Uninstall Failed', modTitle, 'error');
    }
  }

  async function handleCheckAllUpdates() {
    if (isCheckingAllUpdates) {
      return;
    }

    if (!subscriptionsForProfile.length) {
      showToast('No installed mods to check for updates.', 'info');
      return;
    }

    setIsCheckingAllUpdates(true);
    showToast('Checking Mods for Updates', 'info', { duration: 4000 });

    let updatesAvailable = 0;
    let failures = 0;

    try {
      for (const record of subscriptionsForProfile) {
        try {
          const updatedRecord = await handleSubscriptionCheck(record, { silent: true });
          if (updatedRecord?.status === 'update_available') {
            updatesAvailable += 1;
          }
        } catch (error) {
          failures += 1;
        }
      }

      if (failures > 0) {
        showToast('Some mods failed to check for updates.', 'error');
      } else if (updatesAvailable > 0) {
        showToast(`Updating Finished: ${updatesAvailable} mod${updatesAvailable === 1 ? '' : 's'} have updates available.`, 'warning', { duration: 6000 });
      } else {
        showToast('Updating Finished: All mods are up to date.', 'success', { duration: 5000 });
      }
    } finally {
      setIsCheckingAllUpdates(false);
    }
  }

  function handleHomeTagClick(tagName) {
    if (!tagName) {
      return;
    }
    setBrowseRequiredTag(tagName);
    handleViewChange('browse');
    setIsTagPickerOpen(false);
  }

  function handleBrowsePrevPage() {
    setBrowsePage((prev) => Math.max(1, prev - 1));
  }

  function handleBrowseNextPage() {
      setBrowsePage((prev) => prev + 1);
  }

  function cancelChangeNotesRequest() {
    if (changeNotesAbortRef.current) {
      changeNotesAbortRef.current.cancelled = true;
      changeNotesAbortRef.current = null;
    }
  }

  function resetChangeLogState() {
    cancelChangeNotesRequest();
    setChangeLogState({ loading: false, error: '', entries: [], count: 0, modId: null });
    setIsChangeLogModalOpen(false);
  }

  async function fetchChangeNotesCount(modId) {
    cancelChangeNotesRequest();

    if (!modId) {
      setChangeLogState({ loading: false, error: '', entries: [], count: 0, modId: null });
      return;
    }

    const abortHandle = { cancelled: false };
    changeNotesAbortRef.current = abortHandle;

    setChangeLogState({
      loading: true,
      error: '',
      entries: [],
      count: 0,
      modId,
    });

    try {
      const response = await safeInvoke('steam:get-change-notes', { modId });
      if (abortHandle.cancelled) {
        return;
      }

      const entries = Array.isArray(response) ? response : [];
      setChangeLogState({
        loading: false,
        error: '',
        entries,
        count: entries.length,
        modId,
      });
    } catch (error) {
      if (abortHandle.cancelled) {
        return;
      }
      console.error('Failed to fetch change notes count', error);
      setChangeLogState({
        loading: false,
        error: error?.message ?? 'Failed to load update logs.',
        entries: [],
        count: 0,
        modId,
      });
    } finally {
      if (!abortHandle.cancelled && changeNotesAbortRef.current === abortHandle) {
        changeNotesAbortRef.current = null;
      }
    }
  }

  function handleChangeLogClick(modId) {
    if (!modId) {
      return;
    }

    const isSameMod = changeLogState.modId === modId;
    if (isSameMod && changeLogState.entries.length > 0) {
      setIsChangeLogModalOpen(true);
      return;
    }

    cancelChangeNotesRequest();

    const abortHandle = { cancelled: false };
    changeNotesAbortRef.current = abortHandle;

    setChangeLogState((prev) => ({
      ...prev,
      loading: true,
      error: '',
      entries: [],
      modId,
    }));
    setIsChangeLogModalOpen(true);

    safeInvoke('steam:get-change-notes', { modId })
      .then((response) => {
        if (abortHandle.cancelled) {
          return;
        }

        const entries = Array.isArray(response) ? response : [];
        setChangeLogState({
          loading: false,
          error: '',
          entries,
          count: entries.length,
          modId,
        });
      })
      .catch((error) => {
        if (abortHandle.cancelled) {
          return;
        }
        console.error('Failed to load change notes', error);
        setChangeLogState((prev) => ({
          ...prev,
          loading: false,
          error: error?.message ?? 'Failed to load update logs.',
          entries: [],
          modId,
        }));
      })
      .finally(() => {
        if (changeNotesAbortRef.current === abortHandle) {
          changeNotesAbortRef.current = null;
        }
      });
  }

  function closeChangeLogModal() {
    setIsChangeLogModalOpen(false);
    cancelChangeNotesRequest();
    setChangeLogState((prev) => ({ ...prev, loading: false }));
  }

  async function fetchComments(modId, page = 0) {
    if (!modId) {
      setCommentsState({ loading: false, error: '', comments: [], totalCount: 0, currentPage: 0, pageSize: 50, hasMore: false, modId: null });
      return;
    }

    const pageSize = commentsState.pageSize || 50;
    const start = page * pageSize;

    setCommentsState((prev) => ({
      ...prev,
      loading: true,
      error: '',
      modId,
      currentPage: page,
    }));

    try {
      const response = await safeInvoke('steam:get-comments', { modId, start, count: pageSize });
      
      // Check if response has an error field
      if (response.error) {
        setCommentsState({
          loading: false,
          error: response.error,
          comments: [],
          totalCount: 0,
          currentPage: page,
          pageSize,
          hasMore: false,
          modId,
        });
        return;
      }
      
      setCommentsState({
        loading: false,
        error: '',
        comments: response.comments || [],
        totalCount: response.totalCount || 0,
        currentPage: page,
        pageSize,
        hasMore: response.hasMore || false,
        modId,
      });
    } catch (error) {
      console.error('Failed to fetch comments', error);
      setCommentsState((prev) => ({
        ...prev,
        loading: false,
        error: error?.message ?? 'Failed to load comments.',
        comments: [],
      }));
    }
  }

  function handleCommentsPageChange(page) {
    if (commentsState.modId) {
      fetchComments(commentsState.modId, page);
    }
  }

  function resetCommentsState() {
    setCommentsState({ loading: false, error: '', comments: [], totalCount: 0, currentPage: 0, pageSize: 50, hasMore: false, modId: null });
  }

  function openModDetail(mod, addToBreadcrumbs = true) {
    if (!mod) {
      return;
    }

    // Capture original page state before navigating to mod detail
    if (addToBreadcrumbs && originalPageState === null) {
      const currentState = {
        view: activeView,
      };
      
      if (activeView === 'browse') {
        currentState.browse = {
          sortId: browseSortId,
          page: browsePage,
          requiredTag: browseRequiredTag,
          searchText: browseSearchText,
          timeframeId: browseTimeframeId,
        };
      }
      
      setOriginalPageState(currentState);
    }

    resetChangeLogState();
    setIsImageLightboxOpen(false);
    setLightboxImageIndex(0);
    setActiveView('mod-detail');
    setModDetailState({ isOpen: true, loading: true, mod: null, error: '', selectedImageIndex: 0, requirements: [] });

    if (addToBreadcrumbs) {
      const modTitle = mod.title || mod.modId || 'Unknown Mod';
      addBreadcrumb('mod', modTitle, mod);
    }

    (async () => {
      try {
        const modId = mod.modId ?? mod.id ?? mod.publishedfileid;
        const [detailsResult, queryResult] = await Promise.all([
          safeInvoke('steam:fetch-mod-details', {
            modId,
            appId: selectedProfile?.appId ?? config?.defaultAppId ?? null,
          }).catch((error) => {
            console.error('fetch-mod-details failed', error);
            return null;
          }),
          safeInvoke('steam:query-files', {
            appId: mod.appId ?? selectedProfile?.appId ?? config?.defaultAppId ?? null,
            publishedFileIds: [modId],
            pageSize: 1,
            sort: 'trend',
            queryType: 3,
          }).catch((error) => {
            console.error('Failed to query workshop requirements', error);
            return null;
          }),
        ]);

        console.log('[Modal] raw fetch results', { modId, detailsResult, queryResult });

        const queryItem = queryResult?.items?.find((item) => item.modId === modId);

        if (!detailsResult && !queryItem) {
          throw new Error('No workshop details returned');
        }

        const details = detailsResult ?? queryItem ?? {};
        if (!details) {
          throw new Error('No details returned');
        }

        console.log('[Modal] merged detail source', details);

        const [[enriched]] = await resolveAuthorNamesForLists([[details]]);

        let combinedRequirements = (enriched?.requirements ?? []).filter(Boolean);
        if (queryItem?.requirements?.length) {
          combinedRequirements = queryItem.requirements;
        }

        console.log('[Modal] combined requirements before hydration', combinedRequirements);

        const workshopRequirementIds = combinedRequirements
          .filter((req) => req.kind !== 'app' && req.id)
          .map((req) => req.id);
        const uniqueWorkshopIds = Array.from(new Set(workshopRequirementIds));

        let requirementDetails = [];
        const baseRequirementMap = new Map(combinedRequirements.map((req) => [req.id, req]));

        if (uniqueWorkshopIds.length) {
          try {
            const fetched = await safeInvoke('steam:fetch-multiple-mod-details', {
              modIds: uniqueWorkshopIds,
              appId: selectedProfile?.appId ?? config?.defaultAppId ?? null,
            });
            const fetchedMap = new Map((fetched ?? []).map((item) => [item.modId, item]));

            requirementDetails = uniqueWorkshopIds.map((id) => {
              const baseReq = baseRequirementMap.get(id) ?? {};
              const detail = fetchedMap.get(id);
              const previewFromDetail = detail?.previewUrl
                ?? (Array.isArray(detail?.previewUrls) && detail.previewUrls.length > 0 ? detail.previewUrls[0] : null);
              const previewFromBase = baseReq?.previewUrl
                ?? (Array.isArray(baseReq?.previewUrls) && baseReq.previewUrls.length > 0 ? baseReq.previewUrls[0] : null);
              const previewUrl = previewFromDetail ?? previewFromBase ?? null;

              return {
                ...detail,
                modId: id,
                title: detail?.title ?? baseReq?.title ?? id,
                typeLabel: baseReq?.typeLabel ?? 'Workshop Item',
                kind: baseReq?.kind ?? 'workshop',
                previewUrl,
                previewUrls: detail?.previewUrls ?? baseReq?.previewUrls ?? (previewUrl ? [previewUrl] : []),
                url: detail?.url ?? baseReq?.url ?? getWorkshopUrl({ modId: id }),
                author: detail?.author ?? baseReq?.author ?? detail?.owner ?? baseReq?.owner ?? '',
                description: detail?.shortDescription ?? detail?.description ?? baseReq?.description ?? '',
              };
            });
          } catch (reqError) {
            console.error('Failed to load requirement details', reqError);
            requirementDetails = uniqueWorkshopIds.map((id) => {
              const baseReq = baseRequirementMap.get(id) ?? {};
              const previewFromBase = baseReq?.previewUrl
                ?? (Array.isArray(baseReq?.previewUrls) && baseReq.previewUrls.length > 0 ? baseReq.previewUrls[0] : null);
              const previewUrl = previewFromBase ?? null;
              return {
                modId: id,
                title: baseReq?.title ?? id,
                typeLabel: baseReq?.typeLabel ?? 'Workshop Item',
                kind: baseReq?.kind ?? 'workshop',
                previewUrl,
                previewUrls: baseReq?.previewUrls ?? (previewUrl ? [previewUrl] : []),
                url: baseReq?.url ?? getWorkshopUrl({ modId: id }),
                author: baseReq?.author ?? '',
              };
            });
          }
        }

        let appRequirements = combinedRequirements
          .filter((req) => req.kind === 'app')
          .map((req) => {
            const inferredAppId = req.appId ?? (req.id && String(req.id).startsWith('app-') ? String(req.id).slice(4) : null);
            const previewFromBase = req.previewUrl
              ?? (Array.isArray(req.previewUrls) && req.previewUrls.length > 0 ? req.previewUrls[0] : null);
            return {
              modId: req.id ?? (inferredAppId ? `app-${inferredAppId}` : undefined),
              appId: inferredAppId,
              title: req.title ?? (inferredAppId ? `App ${inferredAppId}` : req.id),
              typeLabel: req.typeLabel ?? 'DLC',
              kind: 'app',
              previewUrl: previewFromBase ?? null,
              previewUrls: req.previewUrls ?? (previewFromBase ? [previewFromBase] : []),
              url: req.url ?? (inferredAppId ? `https://store.steampowered.com/app/${inferredAppId}/` : ''),
            };
          });

        if (appRequirements.length) {
          const uniqueAppIds = Array.from(
            new Set(appRequirements.map((req) => (req.appId ? String(req.appId) : null)).filter(Boolean)),
          );

          if (uniqueAppIds.length) {
            const appDetailPairs = await Promise.all(
              uniqueAppIds.map(async (appId) => {
                try {
                  const data = await safeInvoke('steam:get-app-details', { appId });
                  return [appId, data];
                } catch (appError) {
                  console.error('Failed to fetch app requirement details', appId, appError);
                  return null;
                }
              }),
            );

            const appDetailsMap = new Map(appDetailPairs.filter(Boolean));

            appRequirements = appRequirements.map((req) => {
              if (!req.appId) {
                return req;
              }

              const info = appDetailsMap.get(String(req.appId)) ?? appDetailsMap.get(Number(req.appId));
              const previewUrl = info?.header_image
                ?? info?.capsule_imagev5
                ?? info?.capsule_image
                ?? info?.capsule_image_small
                ?? req.previewUrl
                ?? null;

              return {
                ...req,
                previewUrl,
                previewUrls: req.previewUrls?.length ? req.previewUrls : previewUrl ? [previewUrl] : [],
                url: req.url ?? `https://store.steampowered.com/app/${req.appId}/`,
                description: req.description ?? info?.short_description ?? '',
                developer:
                  req.developer
                  ?? (Array.isArray(info?.developers) && info.developers.length ? info.developers[0] : info?.developer)
                  ?? '',
              };
            });
          }
        }

        const mergedRequirements = [...requirementDetails, ...appRequirements];

        console.log('[Modal] combined requirements', mergedRequirements);

        const loadedMod = enriched ?? details;
        const modTitle = loadedMod?.title || loadedMod?.modId || 'Unknown Mod';

        setModDetailState({
          isOpen: true,
          loading: false,
          mod: loadedMod,
          error: '',
          selectedImageIndex: 0,
          requirements: mergedRequirements,
        });

        // Update the last breadcrumb with the actual mod title if it exists
        if (addToBreadcrumbs) {
          setBreadcrumbs((prev) => {
            if (prev.length === 0) {
              return prev;
            }
            const lastCrumb = prev[prev.length - 1];
            if (lastCrumb.type === 'mod' && lastCrumb.label !== modTitle) {
              const updated = [...prev];
              updated[updated.length - 1] = { ...lastCrumb, label: modTitle, data: loadedMod };
              return updated;
            }
            return prev;
          });
        }

        fetchChangeNotesCount(modId);
        fetchComments(modId, 0);
      } catch (error) {
        console.error('Failed to load mod details', error);
        setModDetailState((prev) => ({ ...prev, loading: false, error: error?.message ?? 'Unable to load mod details.' }));
      }
    })();
  }

  function closeModDetail() {
    if (breadcrumbs.length > 1) {
      const previousIndex = breadcrumbs.length - 2;
      navigateToBreadcrumb(previousIndex);
    } else {
      setBreadcrumbs([]);
      setActiveView('home');
      setModDetailState({ isOpen: false, loading: false, mod: null, error: '', selectedImageIndex: 0, requirements: [] });
    }
    setIsImageLightboxOpen(false);
    closeDependencyPrompt();
    resetChangeLogState();
    resetCommentsState();
  }

  function openProfileManager(profile = null) {
    if (profile) {
      setProfileForm({
        id: profile.id ?? null,
        name: profile.name ?? '',
        appId: profile.appId ?? '',
        modPath: profile.modPath ?? '',
        steamcmdPath: profile.steamcmdPath ?? '',
        installMode: 'copy',
      });
      setProfileFormMode('edit');
    } else {
      const defaultAppId = selectedProfile?.appId ?? profiles[0]?.appId ?? '';
      setProfileForm(createEmptyProfileForm(defaultAppId));
      setProfileFormMode('create');
    }

    setProfileFormErrors({});
    setProfileAlert('');
    setIsProfileManagerOpen(true);
  }

  function closeProfileManager() {
    setIsProfileManagerOpen(false);
    setProfileSubmitting(false);
    setProfileDeleting(false);
    setProfileAlert('');
  }

  function handleProfileFieldChange(field, value) {
    setProfileForm((prev) => ({
      ...prev,
      [field]: value,
    }));
    setProfileFormErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function handleSelectProfileForEdit(profileId) {
    const profile = profiles.find((item) => item.id === profileId);
    if (profile) {
      openProfileManager(profile);
    }
  }

  function validateProfileForm(form) {
    const errors = {};
    const trimmedName = form.name.trim();
    const trimmedAppId = form.appId.trim();
    const trimmedModPath = form.modPath.trim();

    if (!trimmedName) {
      errors.name = 'Name is required';
    }

    if (!trimmedAppId) {
      errors.appId = 'App ID is required';
    } else if (!/^\d+$/.test(trimmedAppId)) {
      errors.appId = 'App ID must be a numeric Steam App ID';
    }

    if (!trimmedModPath) {
      errors.modPath = 'Mod install folder is required';
    }

    if (!['copy', 'symlink'].includes(form.installMode)) {
      errors.installMode = 'Choose an install mode';
    }

    return errors;
  }

  async function refreshProfilesAndSelect(targetProfileId) {
    const nextProfiles = (await safeInvoke('profiles:get')) ?? [];
    setProfiles(nextProfiles);

    if (nextProfiles.length === 0) {
      setSelectedProfileId(null);
      return;
    }

    if (targetProfileId && nextProfiles.some((profile) => profile.id === targetProfileId)) {
      setSelectedProfileId(targetProfileId);
      return;
    }

    setSelectedProfileId((existing) => {
      if (existing && nextProfiles.some((profile) => profile.id === existing)) {
        return existing;
      }
      return nextProfiles[0].id;
    });
  }

  async function handleProfileSave() {
    const errors = validateProfileForm(profileForm);
    setProfileFormErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    setProfileSubmitting(true);
    setProfileAlert('');

    const payload = {
      id: profileForm.id ?? undefined,
      name: profileForm.name.trim(),
      appId: profileForm.appId.trim(),
      modPath: profileForm.modPath.trim(),
      steamcmdPath: profileForm.steamcmdPath.trim(),
      installMode: profileForm.installMode,
    };

    try {
      const savedProfile = await safeInvoke('profiles:upsert', payload);
      await refreshProfilesAndSelect(savedProfile?.id);
      setProfileFormErrors({});
      closeProfileManager();
    } catch (error) {
      console.error('Failed to save profile', error);
      setProfileAlert('Unable to save profile. Check your inputs and try again.');
    } finally {
      setProfileSubmitting(false);
    }
  }

  async function handleProfileDelete() {
    if (!profileForm.id) {
      return;
    }

    setProfileDeleting(true);
    setProfileAlert('');

    try {
      await safeInvoke('profiles:delete', profileForm.id);
      await refreshProfilesAndSelect(profileForm.id === selectedProfileId ? null : selectedProfileId);
      closeProfileManager();
    } catch (error) {
      console.error('Failed to delete profile', error);
      setProfileAlert('Unable to delete profile.');
    } finally {
      setProfileDeleting(false);
    }
  }

  function handleProfileManagerNew() {
    const defaultAppId = selectedProfile?.appId ?? profiles[0]?.appId ?? '';
    setProfileForm(createEmptyProfileForm(defaultAppId));
    setProfileFormErrors({});
    setProfileAlert('');
    setProfileFormMode('create');
  }

  async function handleChooseDirectory(field, title) {
    setProfileAlert('');
    const current = profileForm[field] ?? '';
    const payload = {
      title,
      defaultPath: current || profileForm.modPath || '',
    };

    try {
      const result = await safeInvoke('dialog:select-directory', payload);
      if (result && result.canceled !== true && result.path) {
        setProfileForm((prev) => ({
          ...prev,
          [field]: result.path,
        }));
        setProfileFormErrors((prev) => ({
          ...prev,
          [field]: undefined,
        }));
      }
    } catch (error) {
      console.error('Directory selection failed', error);
      setProfileAlert('Unable to open directory picker. Try again.');
    }
  }

  function addBreadcrumb(type, label, data = null) {
    setBreadcrumbs((prev) => {
      const newCrumb = { type, label, data, id: `${Date.now()}-${Math.random()}` };
      return [...prev, newCrumb];
    });
  }

  function navigateToBreadcrumb(index) {
    if (index < 0 || index >= breadcrumbs.length) {
      return;
    }

    const targetCrumb = breadcrumbs[index];
    const newBreadcrumbs = breadcrumbs.slice(0, index + 1);
    setBreadcrumbs(newBreadcrumbs);

    if (targetCrumb.type === 'view') {
      // Restore browse state if returning to browse page and original state exists
      if (targetCrumb.data === 'browse' && originalPageState && originalPageState.view === 'browse' && originalPageState.browse) {
        const { browse } = originalPageState;
        setBrowseSortId(browse.sortId);
        setBrowsePage(browse.page);
        setBrowseRequiredTag(browse.requiredTag);
        setBrowseSearchText(browse.searchText);
        setBrowseTimeframeId(browse.timeframeId);
        setBrowseSearchInput(browse.searchText || '');
      }
      
      setActiveView(targetCrumb.data);
      if (targetCrumb.data !== 'mod-detail') {
        setModDetailState({ isOpen: false, loading: false, mod: null, error: '', selectedImageIndex: 0, requirements: [] });
        setOriginalPageState(null);
      }
    } else if (targetCrumb.type === 'mod') {
      if (targetCrumb.data) {
        const modData = targetCrumb.data;
        setBreadcrumbs(newBreadcrumbs);
        setActiveView('mod-detail');
        openModDetail(modData, false);
      }
    } else if (targetCrumb.type === 'collection') {
      const targetId = targetCrumb.data?.collectionId ?? targetCrumb.data ?? targetCrumb.id;
      if (targetId) {
        openCollectionDetail(targetId, { preserveBreadcrumbs: true });
      }
    }
  }

  function handleViewChange(view) {
    if (view !== 'subscriptions' && subscriptionsAlert.message) {
      updateSubscriptionsAlert('', 'info');
    }

    if (view !== 'subscriptions') {
      setIsDownloadsPanelOpen(false);
    }

    if (view === 'home' || view === 'browse' || view === 'subscriptions' || view === 'collections') {
      const viewLabels = {
        home: 'Home',
        browse: 'Browse',
        subscriptions: 'Subscriptions',
        collections: 'Collections',
      };
      const newBreadcrumb = { type: 'view', label: viewLabels[view] || view, data: view, id: 'root' };
      setBreadcrumbs([newBreadcrumb]);
      setOriginalPageState(null);
    }

    setActiveView(view);
    if (view === 'collections') {
      setActiveCollectionId((prev) => {
        if (prev && collectionsById.has(prev)) {
          return prev;
        }
        return collections.length > 0 ? collections[0].id : null;
      });
    }
    if (view === 'browse') {
      setGridError('');
    }
  }

  function goToSubscriptions() {
    if (modDetailState.isOpen) {
      closeModDetail();
    }
    handleViewChange('subscriptions');
  }

  function renderDownloadJobCard(job) {
    const record = modRecordsById.get(job.modId);
    const title = record?.title || job.metadata?.title || job.modId;
    const displayTitle = `${title} (${job.modId})`;
    const sizeBytes = record?.fileSizeBytes ?? job.metadata?.fileSizeBytes ?? null;
    const sizeLabel = formatOptionalFileSize(sizeBytes);
    const durationLabel = job.startedAt && job.finishedAt
      ? formatDurationRange(job.startedAt, job.finishedAt)
      : job.startedAt && job.status === 'running'
        ? 'In progress…'
        : '—';
    const installPath = record?.installedPath || job.modInstallPath || '';
    const statusSummary = getJobStatusSummary(job);
    const isRunning = job.status === 'running';
    const completionAnimating = Boolean(jobCompletionAnimations[job.id]);
    const displayProgress = jobProgressDisplay[job.id] ?? getJobTargetProgress(job, completionAnimating);
    const progressValue = Math.max(0, Math.min(100, Math.round(displayProgress)));

    return (
      <div key={job.id} className="downloads-item">
        <div className="downloads-item__header">
          <div className="downloads-item__title">{displayTitle}</div>
          <span className={`downloads-item__status downloads-item__status--${job.status}`}>{statusSummary}</span>
        </div>
        <div className="downloads-item__meta">
          <span><strong>Size:</strong> {sizeLabel}</span>
          <span><strong>Duration:</strong> {durationLabel}</span>
          <span className="downloads-item__path" title={installPath || 'Unknown path'}>
            <strong>Path:</strong>{' '}
            {installPath ? (
              <button
                type="button"
                className="path-button"
                onClick={() => handleOpenPath(installPath)}
              >
                {installPath}
              </button>
            ) : (
              'Unknown path'
            )}
          </span>
        </div>
        {isRunning && (
          <div className="download-progress downloads-item__progress" role="status" aria-live="polite">
            <div className="download-progress__bar">
              <div className="download-progress__fill" style={{ width: `${progressValue}%` }} />
            </div>
            <div className="download-progress__label">Downloading… {progressValue}%</div>
          </div>
        )}
      </div>
    );
  }

  function handleHomeListChange(listId) {
    setHomeSelectedList(listId);
  }

  function handleHomeSeeAll(listConfig) {
    if (!listConfig) {
      return;
    }

    const { browseSort = 'popular', browseTimeframe = null } = listConfig;

    setBrowseSearchInput('');
    setBrowseSearchText('');
    setBrowsePage(1);
    setBrowseRequiredTag(null);

    setBrowseSortId(browseSort);

    if (browseSort === 'popular') {
      setBrowseTimeframeId(browseTimeframe ?? 'all');
    } else {
      setBrowseTimeframeId('all');
    }

    closeContextMenu();
    closeModDetail();
    handleViewChange('browse');
  }

  const closeDownloadsPanel = useCallback(() => {
    setIsDownloadsPanelOpen(false);
  }, []);

  const toggleDownloadsPanel = useCallback(() => {
    setIsDownloadsPanelOpen((prev) => !prev);
  }, []);

  useEffect(() => {
    if (breadcrumbs.length === 0 && (activeView === 'home' || activeView === 'browse' || activeView === 'subscriptions')) {
      const viewLabels = {
        home: 'Home',
        browse: 'Browse',
        subscriptions: 'Subscriptions',
      };
      const initialBreadcrumb = { type: 'view', label: viewLabels[activeView] || activeView, data: activeView, id: 'root' };
      setBreadcrumbs([initialBreadcrumb]);
    }
  }, [activeView, breadcrumbs.length]);

  // Scroll to top when browse page changes
  const prevBrowsePageRef = useRef(browsePage);
  useEffect(() => {
    if (activeView === 'browse' && browsePage !== prevBrowsePageRef.current) {
      prevBrowsePageRef.current = browsePage;
      const appMain = document.querySelector('.app-main');
      if (appMain) {
        appMain.scrollTo({ top: 0, behavior: 'smooth' });
      }
    }
  }, [browsePage, activeView]);

  useEffect(() => {
    if (!isDownloadsPanelOpen) {
      return undefined;
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeDownloadsPanel();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [isDownloadsPanelOpen, closeDownloadsPanel]);

  async function handleOpenPath(targetPath) {
    if (!targetPath || typeof targetPath !== 'string') {
      return;
    }

    try {
      const success = await safeInvoke('system:show-item', { path: targetPath });
      if (!success) {
        showToast('Unable to open path in File Explorer.', 'error');
      }
    } catch (error) {
      console.error('Failed to open path', targetPath, error);
      showToast('Unable to open path in File Explorer.', 'error');
    }
  }

  function getSubscriptionAuthorName(record) {
    const rawAuthor = record?.author ? String(record.author).trim() : '';
    if (!rawAuthor) {
      return 'Unknown Creator';
    }

    const resolved = subscriptionAuthorNames[rawAuthor];
    if (resolved) {
      return resolved;
    }

    if (STEAM_ID_REGEX.test(rawAuthor)) {
      return 'Unknown Creator';
    }

    return rawAuthor;
  }

  function openSettingsModal() {
    setSettingsErrors({});
    setSettingsAlert('');
    setSettingsForm(createSettingsForm(config ?? {}));
    setIsSettingsOpen(true);
  }

  function closeSettingsModal() {
    setIsSettingsOpen(false);
    setSettingsSubmitting(false);
    setSettingsAlert('');
  }

  function handleSettingsFieldChange(field, value) {
    setSettingsForm((prev) => ({
      ...prev,
      [field]: value,
    }));
    setSettingsErrors((prev) => {
      if (!prev[field]) {
        return prev;
      }
      const next = { ...prev };
      delete next[field];
      return next;
    });
  }

  function handleSettingsCheckboxChange(field, checked) {
    handleSettingsFieldChange(field, checked);
  }

  async function handleSettingsDirectory(field, title) {
    setSettingsAlert('');
    const current = settingsForm[field] ?? '';

    try {
      const result = await safeInvoke('dialog:select-directory', {
        title,
        defaultPath: current,
      });
      if (result && result.canceled !== true && result.path) {
        handleSettingsFieldChange(field, result.path);
      }
    } catch (error) {
      console.error('Directory selection failed', error);
      setSettingsAlert('Unable to open directory picker. Try again.');
    }
  }

  async function handleSettingsFile(field, title, filters) {
    setSettingsAlert('');
    const current = settingsForm[field] ?? '';

    try {
      const result = await safeInvoke('dialog:select-file', {
        title,
        defaultPath: current,
        filters,
      });
      if (result && result.canceled !== true && result.path) {
        handleSettingsFieldChange(field, result.path);
      }
    } catch (error) {
      console.error('File selection failed', error);
      setSettingsAlert('Unable to open file picker. Try again.');
    }
  }

  function validateSettingsForm(form) {
    const errors = {};
    const concurrencyValue = Number.parseInt(form.concurrency, 10);

    if (Number.isNaN(concurrencyValue) || concurrencyValue < 1) {
      errors.concurrency = 'Concurrency must be a positive whole number';
    }

    if (!['copy', 'symlink'].includes(form.defaultInstallMode)) {
      errors.defaultInstallMode = 'Install mode must be copy or symlink';
    }

    return errors;
  }

  async function handleSettingsSave() {
    const errors = validateSettingsForm(settingsForm);
    setSettingsErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    setSettingsSubmitting(true);
    setSettingsAlert('');

    const concurrencyValue = Math.max(1, Number.parseInt(settingsForm.concurrency, 10) || 1);

    const updatedConfig = {
      ...(config ?? {}),
      steamcmdPath: settingsForm.steamcmdPath.trim(),
      defaultInstallMode: settingsForm.defaultInstallMode,
      concurrency: concurrencyValue,
      enableUpdateChecks: Boolean(settingsForm.enableUpdateChecks),
      appDataDir: settingsForm.appDataDir.trim(),
      steamApiKey: settingsForm.steamApiKey.trim(),
    };

    if (!updatedConfig.gameProfiles) {
      updatedConfig.gameProfiles = config?.gameProfiles ?? [];
    }

    try {
      const savedConfig = await safeInvoke('config:save', updatedConfig);
      const resolvedConfig = savedConfig ?? updatedConfig;
      setConfig(resolvedConfig);
      setSettingsForm(createSettingsForm(resolvedConfig));
      closeSettingsModal();
    } catch (error) {
      console.error('Failed to save settings', error);
      setSettingsAlert('Unable to save settings. Check your inputs and try again.');
    } finally {
      setSettingsSubmitting(false);
    }
  }

  function renderModCard(mod, variant = 'section') {
    if (!mod) {
      return null;
    }

    const installedRecord = modRecordsById.get(mod.modId);
    const isInstalled = installedRecord?.status === 'installed' || Boolean(installedRecord?.installedPath || mod.installedPath);
    const updatedAt = mod.timeUpdated ? new Date(mod.timeUpdated * 1000).toLocaleDateString() : '—';
    const className = variant === 'carousel' ? 'home-card home-card--carousel' : 'home-card';

    return (
      <article
        key={`${variant}-${mod.modId}`}
        className={className}
        onContextMenu={(event) => handleModContextMenu(event, mod)}
        onClick={() => openModDetail(mod)}
        role="button"
        tabIndex={0}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault();
            openModDetail(mod);
          }
        }}
      >
        <div className="home-card__image">
          {mod.previewUrl ? (
            <img
              src={mod.previewUrl}
              alt={mod.title || 'Mod preview'}
              referrerPolicy="no-referrer"
              loading="lazy"
            />
          ) : (
            <span>No Preview</span>
          )}
        </div>
        <div className="home-card__body">
          <div className="home-card__footer">
            {mod.stats?.score !== null && mod.stats?.score !== undefined && (
              <div className="home-card__rating">
                {renderStarRating(mod.stats.score)}
              </div>
            )}
            {isInstalled && <span className="home-card__badge">Installed</span>}
          </div>
          <div className="home-card__title-row">
            <div className="home-card__title">{mod.title || 'Untitled Mod'}</div>
          </div>
          <div className="home-card__meta">by {mod.author || 'Unknown Creator'}</div>
          <div className="home-card__meta">Updated {updatedAt}</div>
        </div>
      </article>
    );
  }

  function renderDownloadControls(mod) {
    if (!mod) {
      return null;
    }

    const record = modRecordsById.get(mod.modId);
    const job = downloadJobByModId.get(mod.modId);
    const isCompletionAnimating = job?.status === 'completed' && Boolean(jobCompletionAnimations[job.id]);
    const displayProgress = job ? jobProgressDisplay[job.id] ?? getJobTargetProgress(job, isCompletionAnimating) : 0;
    const progressValue = Math.max(0, Math.min(100, displayProgress));

    // If mod is installed, show manage buttons (highest priority)
    // This prevents showing progress bar when mod is already installed
    if (record?.status === 'installed') {
      return (
        <div className="mod-detail__action-buttons">
          <button
            type="button"
            className="steam-button secondary"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              goToSubscriptions();
            }}
          >
            Manage Subscription
          </button>
          <button
            type="button"
            className="steam-button danger steam-button--square"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              if (record) {
                setUninstallConfirmState({
                  isOpen: true,
                  record,
                });
              }
            }}
            title="Uninstall mod"
            aria-label="Uninstall mod"
          >
            <FaTimes />
          </button>
        </div>
      );
    }

    // Show progress bar or download states only if mod is not installed
    if (job && job.status === 'failed') {
      const lastLog = job.logs?.[job.logs.length - 1]?.message?.trim();
      const message = job.error || lastLog || 'Download failed.';
      return (
        <div className="download-progress" role="status" aria-live="polite">
          <div className="download-progress__label" style={{ color: '#f06262' }}>{message}</div>
          <button
            type="button"
            className="steam-button danger"
            onClick={(event) => {
              event.preventDefault();
              event.stopPropagation();
              handleDownloadRequest(mod, { silent: true, notify: true });
            }}
          >
            Retry Download
          </button>
        </div>
      );
    }

    if (job && job.status === 'cancelled') {
      return (
        <button
          type="button"
          className="steam-button"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleDownloadRequest(mod, { silent: true, notify: true });
          }}
        >
          Restart Download
        </button>
      );
    }

    // Show "Finishing installation" only if job is completed and record will be installed
    // Don't show this if the mod has been uninstalled (status is 'uninstalled' or no installedPath)
    // This must come before the progress bar check to prevent flickering
    if (job && job.status === 'completed' && !record?.installedPath && record?.status !== 'uninstalled') {
      return (
        <div className="download-progress" role="status">
          <div className="download-progress__label">Finishing installation…</div>
        </div>
      );
    }

    // Show progress bar only if mod is not installed yet
    // Don't show completion animation if mod is already installed
    if (job && record?.status !== 'installed' && (isCompletionAnimating || !['failed', 'completed', 'cancelled'].includes(job.status))) {
      const label = isCompletionAnimating
        ? 'Download complete'
        : job.status === 'running'
          ? `Downloading… ${Math.round(progressValue)}%`
          : 'Queued for download';

      return (
        <div className="download-progress" role="status" aria-live="polite">
          <div className="download-progress__bar">
            <div className="download-progress__fill" style={{ width: `${progressValue}%` }} />
          </div>
          <div className="download-progress__label">{label}</div>
        </div>
      );
    }

    if (record?.status === 'failed') {
      return (
        <button
          type="button"
          className="steam-button danger"
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            handleDownloadRequest(mod, { silent: true, notify: true });
          }}
        >
          Retry Download
        </button>
      );
    }

    const disableDownload = !selectedProfile?.modPath;

    return (
      <button
        type="button"
        className="steam-button"
        onClick={(event) => {
          event.preventDefault();
          event.stopPropagation();
          handleDownloadRequest(mod, { silent: true, notify: true });
        }}
        disabled={disableDownload}
      >
        Download
      </button>
    );
  }

  function applyModRecordUpdate(updatedRecord) {
    if (!updatedRecord) {
      return;
    }

    setModRecords((prev) => {
      const index = prev.findIndex(
        (item) => item.modId === updatedRecord.modId && item.profileId === updatedRecord.profileId,
      );

      if (index === -1) {
        return [...prev, updatedRecord];
      }

      const next = [...prev];
      next[index] = { ...next[index], ...updatedRecord };
      return next;
    });
  }

  function createModShapeFromRecord(record) {
    if (!record) {
      return null;
    }

    return {
      modId: record.modId,
      title: record.title,
      author: record.author,
      previewUrl: record.previewUrl,
      url: record.workshopUrl,
      timeUpdated: record.lastKnownUpdateAt ?? null,
      fileSizeBytes: record.fileSizeBytes ?? null,
      appId: record.appId ?? null,
    tags: Array.isArray(record.tags)
      ? record.tags
      : Array.isArray(record.latestWorkshopDetails?.tags)
        ? record.latestWorkshopDetails.tags
        : [],
    };
  }

  function getSubscriptionStatusLabel(record) {
    const status = record?.status || 'unknown';

    switch (status) {
      case 'installed':
        return 'Installed';
      case 'downloading':
        return 'Downloading';
      case 'queued':
        return 'Queued';
      case 'failed':
        return 'Download failed';
      case 'cancelled':
        return 'Cancelled';
      case 'checking':
        return 'Checking…';
      case 'update_available':
        return 'Update available';
      case 'uninstalled':
        return 'Not installed';
      case 'uninstalling':
        return 'Uninstalling…';
      default:
        return status;
    }
  }

  function triggerDownloadFromRecord(record) {
    const modShape = createModShapeFromRecord(record);
    if (modShape) {
      handleDownloadMod(modShape, { silent: true, notify: true });
    }
  }

  function renderSubscriptionCard(record) {
    const job = downloadJobByModId.get(record.modId);
    const jobActive = job && !['failed', 'completed', 'cancelled'].includes(job.status);
    const statusLabel = jobActive ? getJobStatusLabel(job) : getSubscriptionStatusLabel(record);
    const completionAnimating = job ? Boolean(jobCompletionAnimations[job.id]) : false;
    const displayProgress = job
      ? jobProgressDisplay[job.id] ?? getJobTargetProgress(job, completionAnimating)
      : 0;
    const progressValue = Math.max(0, Math.min(100, Math.round(displayProgress)));
    const updateAvailable = record.status === 'update_available';
    const showInstallAction = record.status === 'uninstalled';
    const authorLabel = getSubscriptionAuthorName(record);
    const recordModShape = createModShapeFromRecord(record);
    const installedPath = record.installedPath || '';

    const openRecordDetail = () => {
      if (recordModShape) {
        openModDetail(recordModShape);
      }
    };

    return (
      <article
        key={`${record.profileId}-${record.modId}`}
        className="subscription-card"
        onContextMenu={(event) => handleModContextMenu(event, createModShapeFromRecord(record))}
      >
        <div className="subscription-card__header">
          <button
            type="button"
            className="subscription-card__title-button"
            onClick={openRecordDetail}
          >
            {record.title || record.modId}
          </button>
          <span className={`subscription-card__status subscription-card__status--${(record.status || 'unknown').replace(/_/g, '-')}`}>
            {statusLabel}
          </span>
        </div>
        <div className="subscription-card__body">
          {record.previewUrl && (
            <button
              type="button"
              className="subscription-card__preview"
              onClick={openRecordDetail}
              aria-label={`Open ${record.title || record.modId}`}
            >
              <img src={record.previewUrl} alt="" referrerPolicy="no-referrer" />
            </button>
          )}
          <div className="subscription-card__details">
            <div>
              <strong>Mod ID:</strong> {record.modId}
            </div>
            <div>
              <strong>Author:</strong> {authorLabel}
            </div>
            {installedPath && (
              <div className="subscription-card__path" title={installedPath}>
                <strong>Installed To:</strong>{' '}
                <button type="button" className="path-button" onClick={() => handleOpenPath(installedPath)}>
                  {installedPath}
                </button>
              </div>
            )}
            {record.lastDownloadedAt && (
              <div>
                <strong>Last Downloaded:</strong> {formatTimestamp(record.lastDownloadedAt)}
              </div>
            )}
            {record.lastCheckedAt && (
              <div>
                <strong>Last Checked:</strong> {formatTimestamp(record.lastCheckedAt)}
              </div>
            )}
          </div>
        </div>
        {jobActive && (
          <div className="download-progress subscription-card__progress" role="status" aria-live="polite">
            <div className="download-progress__bar">
              <div className="download-progress__fill" style={{ width: `${progressValue}%` }} />
            </div>
            <div className="download-progress__label">
              {job.status === 'running' ? `Downloading… ${progressValue}%` : 'Queued for download'}
            </div>
          </div>
        )}
        <div className="subscription-card__actions">
          {(updateAvailable || showInstallAction) && (
            <button
              type="button"
              className="steam-button"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                triggerDownloadFromRecord(record);
              }}
              disabled={jobActive}
            >
              {updateAvailable ? 'Update' : 'Install'}
            </button>
          )}
          <div className="subscription-card__action-row">
            <button
              type="button"
              className="steam-button secondary steam-button--small"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                const modShape = recordModShape ?? createModShapeFromRecord(record);
                openCollectionAssignModal(modShape);
              }}
            >
              Add to Collection
            </button>
            <button
              type="button"
              className="steam-button danger steam-button--small"
              onClick={(event) => {
                event.preventDefault();
                event.stopPropagation();
                handleSubscriptionUninstall(record);
              }}
              disabled={jobActive || !record.installedPath}
            >
              Uninstall
            </button>
          </div>
        </div>
      </article>
    );
  }

  function renderBreadcrumbs() {
    // Don't show breadcrumbs on base pages (only one breadcrumb that's a view)
    if (breadcrumbs.length === 0 || (breadcrumbs.length === 1 && breadcrumbs[0].type === 'view')) {
      return null;
    }

    const handleHomeClick = () => {
      if (originalPageState) {
        const { view, browse } = originalPageState;
        
        // Restore browse state if it was a browse page
        if (view === 'browse' && browse) {
          setBrowseSortId(browse.sortId);
          setBrowsePage(browse.page);
          setBrowseRequiredTag(browse.requiredTag);
          setBrowseSearchText(browse.searchText);
          setBrowseTimeframeId(browse.timeframeId);
          setBrowseSearchInput(browse.searchText || '');
        }
        
        // Restore the view
        const viewLabels = {
          home: 'Home',
          browse: 'Browse',
          subscriptions: 'Subscriptions',
        };
        setBreadcrumbs([{ type: 'view', label: viewLabels[view] || view, data: view, id: 'root' }]);
        setActiveView(view);
        setModDetailState({ isOpen: false, loading: false, mod: null, error: '', selectedImageIndex: 0, requirements: [] });
        setOriginalPageState(null);
      } else {
        // Fallback to home if no original state
        setBreadcrumbs([{ type: 'view', label: 'Home', data: 'home', id: 'root' }]);
        setActiveView('home');
        setModDetailState({ isOpen: false, loading: false, mod: null, error: '', selectedImageIndex: 0, requirements: [] });
      }
    };

    return (
      <nav className="breadcrumbs" aria-label="Breadcrumb navigation">
        <div className="breadcrumbs__container">
          <button
            type="button"
            className="breadcrumbs__home-button"
            onClick={handleHomeClick}
            aria-label="Go to home"
          >
            <FaHome aria-hidden="true" />
          </button>
          <ol className="breadcrumbs__list">
            {breadcrumbs.map((crumb, index) => (
              <li key={crumb.id} className="breadcrumbs__item">
                {index < breadcrumbs.length - 1 ? (
                  <button
                    type="button"
                    className="breadcrumbs__link"
                    onClick={() => navigateToBreadcrumb(index)}
                  >
                    {crumb.label}
                  </button>
                ) : (
                  <span className="breadcrumbs__current">{crumb.label}</span>
                )}
                {index < breadcrumbs.length - 1 && (
                  <span className="breadcrumbs__separator" aria-hidden="true">
                    /
                  </span>
                )}
              </li>
            ))}
          </ol>
        </div>
      </nav>
    );
  }

  function renderModDetailView() {
    return (
      <section className="mod-detail-page">
        <div className="mod-detail-page__content">
          {modDetailState.loading && (
            <div className="mod-detail__loading">
              <span className="loading-spinner" aria-hidden="true" aria-label="Loading" />
            </div>
          )}
          {!modDetailState.loading && modDetailState.error && (
            <div className="mod-detail__error">{modDetailState.error}</div>
          )}
          {!modDetailState.loading && !modDetailState.error && modDetailState.mod && (() => {
            const downloadControlsContent = renderDownloadControls(modDetailState.mod);
            const previewUrls = modDetailState.mod.previewUrls ?? [];
            const hasThumbnails = previewUrls.length > 1;
            const handleHeroActivate = () => {
              if (previewUrls.length === 0) {
                return;
              }
              setLightboxImageIndex(modDetailState.selectedImageIndex || 0);
              setIsImageLightboxOpen(true);
            };
            return (
              <>
                <div className="mod-detail__layout">
                  <div className="mod-detail__media">
                    {previewUrls.length > 0 ? (
                      <>
                        <div
                          className="mod-detail__hero"
                          role="button"
                          tabIndex={0}
                          onClick={handleHeroActivate}
                          onKeyDown={(event) => {
                            if (event.key === 'Enter' || event.key === ' ') {
                              event.preventDefault();
                              handleHeroActivate();
                            }
                          }}
                        >
                          {hasThumbnails && modDetailState.selectedImageIndex > 0 && (
                            <div className="mod-detail__hero-controls">
                              <button
                                type="button"
                                className="mod-detail__hero-nav"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setModDetailState((prev) => ({
                                    ...prev,
                                    selectedImageIndex: Math.max(0, (prev.selectedImageIndex || 0) - 1),
                                  }));
                                }}
                                aria-label="Previous image"
                              >
                                ‹
                              </button>
                            </div>
                          )}
                          <img
                            src={previewUrls[modDetailState.selectedImageIndex || 0]}
                            alt={modDetailState.mod.title || 'Mod preview'}
                            referrerPolicy="no-referrer"
                          />
                          {hasThumbnails && modDetailState.selectedImageIndex < previewUrls.length - 1 && (
                            <div className="mod-detail__hero-controls">
                              <button
                                type="button"
                                className="mod-detail__hero-nav"
                                style={{ marginLeft: 'auto' }}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  setModDetailState((prev) => ({
                                    ...prev,
                                    selectedImageIndex: Math.min(
                                      previewUrls.length - 1,
                                      (prev.selectedImageIndex || 0) + 1,
                                    ),
                                  }));
                                }}
                                aria-label="Next image"
                              >
                                ›
                              </button>
                            </div>
                          )}
                        </div>
                        {hasThumbnails && (
                          <div className="mod-detail__thumbnail-strip" role="list">
                            {previewUrls.map((url, index) => (
                              <button
                                type="button"
                                key={`${modDetailState.mod.modId}-thumb-${index}`}
                                className={`mod-detail__thumbnail ${modDetailState.selectedImageIndex === index ? 'active' : ''}`}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (modDetailState.selectedImageIndex === index) {
                                    setLightboxImageIndex(index);
                                    setIsImageLightboxOpen(true);
                                  } else {
                                    setModDetailState((prev) => ({ ...prev, selectedImageIndex: index }));
                                  }
                                }}
                              >
                                <img src={url} alt="Mod thumbnail" referrerPolicy="no-referrer" />
                              </button>
                            ))}
                          </div>
                        )}
                      </>
                    ) : (
                      <div className="mod-detail__placeholder">No Preview Available</div>
                    )}

                    {downloadControlsContent && (
                      <div className="mod-detail__download">{downloadControlsContent}</div>
                    )}
                  </div>
                  <div className="mod-detail__info">
                    <div className="mod-detail__info-card">
                      <h2>{modDetailState.mod.title || 'Untitled Mod'}</h2>
                      <div className="mod-detail__info-rows">
                        <span>By {modDetailState.mod.author || 'Unknown Creator'}</span>
                        {modDetailState.mod.stats?.score !== null && modDetailState.mod.stats?.score !== undefined && (
                          <span className="mod-detail__rating-row">
                            Rating: {renderStarRating(modDetailState.mod.stats.score)}
                          </span>
                        )}
                        {modDetailState.mod.stats?.subscriptions && (
                          <span>{modDetailState.mod.stats.subscriptions.toLocaleString()} subscribers</span>
                        )}
                        <span>File Size: {formatFileSize(modDetailState.mod.fileSizeBytes)}</span>
                        {modDetailState.mod.timeCreated && (
                          <span>Posted {new Date(modDetailState.mod.timeCreated * 1000).toLocaleString()}</span>
                        )}
                        {modDetailState.mod.timeUpdated && (
                          <span>Updated {new Date(modDetailState.mod.timeUpdated * 1000).toLocaleString()}</span>
                        )}
                      </div>
                      {isActiveChangeLogState ? (
                        <button
                          type="button"
                          className="mod-detail__update-logs-button"
                          onClick={() => handleChangeLogClick(modDetailState.mod.modId)}
                          disabled={isChangeLogLoading && !isChangeLogModalOpen}
                        >
                          {changeLogButtonLabel}
                        </button>
                      ) : null}
                      {!!modDetailState.mod.tags?.length && (
                        <div className="mod-detail__tags">
                          {modDetailState.mod.tags.map((tag) => (
                            <span key={`${modDetailState.mod.modId}-tag-${tag}`} className="mod-detail__tag">
                              {tag}
                            </span>
                          ))}
                        </div>
                      )}
                      <div className="mod-detail__actions">
                        <button
                          type="button"
                          className="steam-button secondary"
                          onClick={() => openCollectionAssignModal(modDetailState.mod)}
                        >
                          Add to Collection
                        </button>
                        {modDetailState.mod.url && (
                          <a
                            href={modDetailState.mod.url}
                            target="_blank"
                            rel="noreferrer"
                            className="steam-button"
                          >
                            View on Steam
                          </a>
                        )}
                      </div>
                    </div>
                    {modDetailState.requirements.length > 0 && (
                      <div className="mod-detail__requirements">
                        <span className="mod-detail__requirements-title">Required Items</span>
                        <span className="mod-detail__requirements-subtitle">
                          This item requires all of the following other items
                        </span>
                        <div className="mod-detail__requirements-list">
                          {modDetailState.requirements.map((req, index) => {
                            const isWorkshopRequirement = req.kind === 'workshop';
                            const isAppRequirement = req.kind === 'app';
                            const appRequirementId = req.appId ?? (req.modId && String(req.modId).startsWith('app-') ? String(req.modId).slice(4) : null);
                            const requirementKey = req.modId || req.appId || (appRequirementId ? `app-${appRequirementId}` : `${index}`);
                            const isClickable = (isWorkshopRequirement && req.modId) || (isAppRequirement && appRequirementId);
                            const requirementRecord = req.modId ? modRecordsById.get(req.modId) : null;
                            const requirementJob = req.modId ? downloadJobByModId.get(req.modId) : null;
                            const isInstalled = isWorkshopRequirement
                              ? Boolean(requirementRecord?.installedPath) || requirementRecord?.status === 'installed'
                              : false;
                            const jobStatus = requirementJob?.status ?? '';
                            const isJobActive = Boolean(requirementJob) && ['running', 'queued', 'created', 'starting', 'completed'].includes(jobStatus);

                            let statusLabel;
                            let statusClassSuffix;

                            if (isWorkshopRequirement) {
                              if (isInstalled) {
                                statusLabel = 'Installed';
                                statusClassSuffix = 'mod-detail__requirement-status--installed';
                              } else if (requirementJob) {
                                if (jobStatus === 'running') {
                                  statusLabel = 'Downloading…';
                                  statusClassSuffix = 'mod-detail__requirement-status--downloading';
                                } else if (jobStatus === 'queued') {
                                  statusLabel = 'Queued';
                                  statusClassSuffix = 'mod-detail__requirement-status--downloading';
                                } else if (jobStatus === 'completed') {
                                  statusLabel = 'Finishing…';
                                  statusClassSuffix = 'mod-detail__requirement-status--downloading';
                                } else {
                                  statusLabel = 'Not installed';
                                  statusClassSuffix = 'mod-detail__requirement-status--missing';
                                }
                              } else {
                                statusLabel = 'Not installed';
                                statusClassSuffix = 'mod-detail__requirement-status--missing';
                              }
                            } else {
                              statusLabel = 'DLC';
                              statusClassSuffix = 'mod-detail__requirement-status--dlc';
                            }

                            const statusIcon = isWorkshopRequirement
                              ? isInstalled
                                ? <FaCheckCircle aria-hidden="true" />
                                : isJobActive
                                  ? <FaDownload aria-hidden="true" />
                                  : <FaExclamationTriangle aria-hidden="true" />
                              : null;

                            const thumbnailUrl = req.previewUrl
                              ?? (Array.isArray(req.previewUrls) && req.previewUrls.length > 0 ? req.previewUrls[0] : null);

                            const handleRequirementClick = () => {
                              if (isWorkshopRequirement && req.modId) {
                                openModDetail({ 
                                  modId: req.modId, 
                                  title: req.title,
                                  appId: req.appId || selectedProfile?.appId || config?.defaultAppId || null
                                });
                              } else if (isAppRequirement && appRequirementId) {
                                const storeUrl = `https://store.steampowered.com/app/${appRequirementId}/`;
                                window.open(storeUrl, '_blank', 'noopener,noreferrer');
                              }
                            };

                            return (
                              <button
                                key={`${modDetailState.mod?.modId ?? 'mod'}-req-${requirementKey}`}
                                type="button"
                                className={`mod-detail__requirement ${
                                  !isWorkshopRequirement && !isAppRequirement ? 'mod-detail__requirement--static' : ''
                                } ${isAppRequirement ? 'mod-detail__requirement--app' : ''}`.trim()}
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  if (isClickable) {
                                    handleRequirementClick();
                                  }
                                }}
                                disabled={!isClickable}
                              >
                                <div className="mod-detail__requirement-left">
                                  <div className="mod-detail__requirement-thumb">
                                    {thumbnailUrl ? (
                                      <img src={thumbnailUrl} alt="" referrerPolicy="no-referrer" />
                                    ) : (
                                      <FaPuzzlePiece aria-hidden="true" />
                                    )}
                                  </div>
                                  <div className="mod-detail__requirement-content">
                                    <span className="mod-detail__requirement-name">{formatRequirementTitle(req)}</span>
                                    <span className={`mod-detail__requirement-status ${statusClassSuffix}`}>
                                      {statusIcon && <span className="mod-detail__requirement-status-icon">{statusIcon}</span>}
                                      {statusLabel}
                                    </span>
                                  </div>
                                </div>
                                <div className="mod-detail__requirement-meta">
                                  {req.typeLabel && (
                                    <span className="mod-detail__requirement-pill">{req.typeLabel}</span>
                                  )}
                                  {isAppRequirement && appRequirementId && (
                                    <FaExternalLinkAlt aria-hidden="true" className="mod-detail__requirement-icon" />
                                  )}
                                </div>
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                </div>
                {(modDetailState.mod.description || modDetailState.mod.shortDescription) && (
                  <div className={`mod-detail__description ${hasThumbnails ? '' : 'mod-detail__description--standalone'}`}>
                    <div
                      className="mod-detail__description-content"
                      dangerouslySetInnerHTML={{
                        __html: formatDescription(modDetailState.mod.description || modDetailState.mod.shortDescription || ''),
                      }}
                    />
                  </div>
                )}

                <div className="mod-detail__comments">
                  <h3 className="mod-detail__comments-title">
                    Comments {commentsState.totalCount > 0 && `(${commentsState.totalCount})`}
                  </h3>
                  
                  {commentsState.loading && commentsState.comments.length === 0 ? (
                    <div className="mod-detail__comments-loading">
                      <span className="loading-spinner" aria-hidden="true" aria-label="Loading" />
                    </div>
                  ) : commentsState.error ? (
                    <div className="mod-detail__comments-error">{commentsState.error}</div>
                  ) : commentsState.comments.length === 0 ? (
                    <div className="mod-detail__comments-empty">No comments yet.</div>
                  ) : (
                    <>
                      <div className="mod-detail__comments-list">
                        {commentsState.comments.map((comment, index) => (
                          <div key={`${comment.authorId}-${comment.timestamp}-${index}`} className="mod-detail__comment">
                            <div className="mod-detail__comment-header">
                              <div className="mod-detail__comment-author-info">
                                {comment.avatarUrl && (
                                  <img 
                                    src={comment.avatarUrl} 
                                    alt={comment.authorName || 'Avatar'} 
                                    className="mod-detail__comment-avatar"
                                  />
                                )}
                                <span className="mod-detail__comment-author">{comment.authorName || 'Unknown'}</span>
                              </div>
                              {comment.date && (
                                <span className="mod-detail__comment-date">
                                  {new Date(comment.date).toLocaleString()}
                                </span>
                              )}
                            </div>
                            <div className="mod-detail__comment-content">
                              {comment.content.split('\n').map((line, lineIndex) => (
                                <React.Fragment key={lineIndex}>
                                  {line}
                                  {lineIndex < comment.content.split('\n').length - 1 && <br />}
                                </React.Fragment>
                              ))}
                            </div>
                          </div>
                        ))}
                      </div>

                      {commentsState.totalCount > commentsState.pageSize && (
                        <div className="mod-detail__comments-pagination">
                          <button
                            type="button"
                            className="steam-button secondary"
                            onClick={() => handleCommentsPageChange(commentsState.currentPage - 1)}
                            disabled={commentsState.loading || commentsState.currentPage === 0}
                          >
                            Previous
                          </button>
                          <span className="mod-detail__comments-page-info">
                            Page {commentsState.currentPage + 1} of {Math.ceil(commentsState.totalCount / commentsState.pageSize)}
                          </span>
                          <button
                            type="button"
                            className="steam-button secondary"
                            onClick={() => handleCommentsPageChange(commentsState.currentPage + 1)}
                            disabled={commentsState.loading || !commentsState.hasMore}
                          >
                            Next
                          </button>
                        </div>
                      )}
                    </>
                  )}
                </div>
              </>
            );
          })()}
        </div>
      </section>
    );
  }

  function renderSubscriptionsView() {
    const headerActions = (
      <div className="subscriptions-header">
        <h2 className="section-title">Subscriptions</h2>
        <div className="subscriptions-header__actions">
          <button
            type="button"
            className="steam-button subscriptions-header__action"
            onClick={handleCheckAllUpdates}
            disabled={isCheckingAllUpdates || !subscriptionsForProfile.length}
          >
            {isCheckingAllUpdates ? 'Checking…' : 'Check for Updates'}
          </button>
          <button
            type="button"
            className="steam-button secondary subscriptions-header__action subscriptions-header__downloads"
            onClick={toggleDownloadsPanel}
            aria-expanded={isDownloadsPanelOpen}
          >
            <FaDownload aria-hidden="true" />
            <span>Downloads</span>
          </button>
        </div>
      </div>
    );

    if (!selectedProfileId) {
      return (
        <section className="subscriptions-view">
          {headerActions}
          <div className="home-empty">Select or create a profile to manage subscriptions.</div>
        </section>
      );
    }

    return (
      <section className="subscriptions-view">
        {headerActions}
        {subscriptionsForProfile.length === 0 ? (
          <div className="home-empty">No mods downloaded yet. Find something in Browse to get started.</div>
        ) : (
          <div className="subscriptions-grid">
            {subscriptionsForProfile.map((record) => renderSubscriptionCard(record))}
          </div>
        )}
      </section>
    );
  }

  function renderCollectionDetailModCard(collection, entry) {
    if (!entry) {
      return null;
    }

    const modId = entry.modId;
    const record = modRecordsById.get(modId);
    const job = downloadJobByModId.get(modId);
    const isInstalled = Boolean(record?.installedPath);
    const isQueued = job && !['failed', 'completed', 'cancelled'].includes(job.status);
    const modTitle = entry.title || record?.title || modId;
    const authorLabel = entry.author || record?.author || 'Unknown Creator';
    const modShape = buildModShapeFromCollectionEntry(entry);
    const previewImage = entry.previewUrl
      || record?.previewUrl
      || (Array.isArray(modShape?.previewUrls) ? modShape.previewUrls[0] : modShape?.previewUrl)
      || '';
    const score = record?.stats?.score ?? entry.stats?.score ?? null;
    const lastUpdatedSource = record?.lastKnownUpdateAt ?? record?.latestWorkshopDetails?.timeUpdated ?? null;
    let lastUpdatedLabel = 'Unknown';

    if (lastUpdatedSource) {
      let parsed;
      if (typeof lastUpdatedSource === 'number') {
        parsed = new Date(lastUpdatedSource * 1000);
      } else {
        parsed = new Date(lastUpdatedSource);
      }

      if (!Number.isNaN(parsed?.getTime?.())) {
        lastUpdatedLabel = parsed.toLocaleString();
      }
    }

    return (
      <article key={`${collection.id}-${modId}`} className="collection-detail-mod">
        <button
          type="button"
          className="collection-detail-mod__thumb"
          onClick={() => openModDetail(modShape)}
        >
          {previewImage ? (
            <img src={previewImage} alt="Mod preview" referrerPolicy="no-referrer" />
          ) : (
            <span>No Preview</span>
          )}
        </button>
        <div className="collection-detail-mod__body">
          <div className="collection-detail-mod__header">
            <button
              type="button"
              className="collection-detail-mod__title"
              onClick={() => openModDetail(modShape)}
            >
              {modTitle}
            </button>
            <span
              className={`collection-detail-mod__badge ${isInstalled ? 'collection-detail-mod__badge--installed' : 'collection-detail-mod__badge--missing'}`}
            >
              {isInstalled ? 'Installed' : 'Not Installed'}
            </span>
          </div>
          <div className="collection-detail-mod__meta">
            <span>Mod ID: {modId}</span>
            <span>By {authorLabel}</span>
            <span>Last updated: {lastUpdatedLabel}</span>
            {score !== null && score !== undefined && (
              <div className="collection-detail-mod__rating">{renderStarRating(score)}</div>
            )}
          </div>
          <div className="collection-detail-mod__actions">
            {!isInstalled && (
              <button
                type="button"
                className="steam-button steam-button--small"
                onClick={() => handleDownloadMod(modShape, { silent: true, notify: true })}
                disabled={isQueued}
              >
                {isQueued ? 'Queued…' : 'Install'}
              </button>
            )}
            <button
              type="button"
              className="steam-button danger steam-button--small"
              onClick={() => {
                if (record?.installedPath) {
                  handleSubscriptionUninstall(record);
                } else {
                  showToast('This mod is not currently installed for the selected profile.', 'info');
                }
              }}
              disabled={!isInstalled}
            >
              Uninstall
            </button>
            <button
              type="button"
              className="steam-button secondary steam-button--small"
              onClick={() => handleRemoveModFromCollection(collection.id, modId)}
            >
              Remove
            </button>
          </div>
        </div>
      </article>
    );
  }

  function renderCollectionCard(collection) {
    const mods = Array.isArray(collection?.mods) ? collection.mods : [];
    const renameDraft = collectionRenameDrafts[collection.id];
    const nameValue = renameDraft !== undefined ? renameDraft : collection.name;
    const isActive = activeCollectionId === collection.id;
    const previewImages = getCollectionPreviewImages(collection, 4);

    return (
      <article
        key={collection.id}
        className={`collection-card${isActive ? ' collection-card--active' : ''}`}
        role="button"
        tabIndex={0}
        onClick={(event) => {
          if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement) {
            return;
          }
          openCollectionDetail(collection.id);
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLButtonElement) {
              return;
            }
            event.preventDefault();
            openCollectionDetail(collection.id);
          }
        }}
      >
        <div className="collection-card__preview">
          {previewImages.length > 0 ? (
            <div className={`collection-collage collection-collage--${previewImages.length}`}>
              {previewImages.map((src, index) => (
                <img key={`${collection.id}-preview-${index}`} src={src} alt="Collection preview" referrerPolicy="no-referrer" />
              ))}
            </div>
          ) : (
            <div className="collection-card__preview-placeholder">No Previews</div>
          )}
        </div>
        <div className="collection-card__header" onClick={(event) => event.stopPropagation()}>
          <input
            type="text"
            className="collection-card__name-input"
            value={nameValue}
            onChange={(event) => handleCollectionNameInputChange(collection.id, event.target.value)}
            onBlur={() => handleCollectionNameCommit(collection.id)}
            onKeyDown={(event) => {
              if (event.key === 'Enter' && !event.shiftKey) {
                event.preventDefault();
                handleCollectionNameCommit(collection.id);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                event.stopPropagation();
                clearCollectionRenameDraft(collection.id);
              }
            }}
            aria-label="Collection name"
          />
          <span className="collection-card__count">{mods.length} mod{mods.length === 1 ? '' : 's'}</span>
        </div>
        <div className="collection-card__actions" onClick={(event) => event.stopPropagation()}>
          <button
            type="button"
            className="steam-button steam-button--small"
            onClick={(event) => {
              event.stopPropagation();
              openCollectionDetail(collection.id);
            }}
          >
            Manage
          </button>
          <button
            type="button"
            className="steam-button danger steam-button--small"
            onClick={(event) => {
              event.stopPropagation();
              setCollectionDeletionConfirm({ isOpen: true, collection });
            }}
          >
            Delete
          </button>
        </div>
        {mods.length === 0 ? (
          <div className="collection-card__empty" onClick={(event) => event.stopPropagation()}>
            No mods in this collection yet.
          </div>
        ) : (
          <div className="collection-card__summary" onClick={(event) => event.stopPropagation()}>
            {mods.slice(0, 3).map((entry) => (
              <div key={`${collection.id}-summary-${entry.modId}`}>{entry.title || entry.modId}</div>
            ))}
            {mods.length > 3 && (
              <div className="collection-card__summary-more">+{mods.length - 3} more</div>
            )}
          </div>
        )}
      </article>
    );
  }

  function renderCollectionsView() {
    const collectionsHeading = `${workshopTitle} Collections`;

    if (!selectedProfileId) {
      return (
        <section className="collections-view">
          <div className="collections-header">
            <h2 className="section-title">{collectionsHeading}</h2>
          </div>
          <div className="home-empty">Select or create a profile to manage collections.</div>
        </section>
      );
    }

    return (
      <section className="collections-view">
        <div className="collections-header">
          <h2 className="section-title">{collectionsHeading}</h2>
          <div className="collections-header__actions">
            {collectionsSaving && <span className="collections-header__status">Saving…</span>}
            <button
              type="button"
              className="steam-button secondary"
              onClick={openCollectionImportModal}
              disabled={!selectedProfileId}
              title={selectedProfileId ? undefined : 'Select or create a profile first'}
            >
              Import Collection
            </button>
            <button
              type="button"
              className="steam-button"
              onClick={() => handleCreateCollection('New Collection')}
            >
              New Collection
            </button>
          </div>
        </div>
        {collectionsError && <div className="collections-alert collections-alert--error">{collectionsError}</div>}
        {collections.length === 0 ? (
          <div className="home-empty">No collections yet. Create one to get started.</div>
        ) : (
          <div className="collections-grid">
            {collections.map((collection) => renderCollectionCard(collection))}
          </div>
        )}
      </section>
    );
  }

  function renderCollectionDetailView() {
    const collection = activeCollectionId ? collectionsById.get(activeCollectionId) : null;

    if (!collection) {
      return (
        <section className="collection-detail">
          <div className="home-empty">
            Collection not found.
            <div>
              <button type="button" className="steam-button" onClick={() => handleViewChange('collections')}>
                Back to Collections
              </button>
            </div>
          </div>
        </section>
      );
    }

    const previewImages = getCollectionPreviewImages(collection, 4);
    const mods = Array.isArray(collection.mods) ? [...collection.mods] : [];
    mods.sort((a, b) => {
      const titleA = (a?.title || a?.modId || '').toLowerCase();
      const titleB = (b?.title || b?.modId || '').toLowerCase();
      return titleA.localeCompare(titleB);
    });

    const descriptionValue = collection.description ?? '';
    const tagsInputValue = collectionTagDrafts[collection.id] !== undefined
      ? collectionTagDrafts[collection.id]
      : (collection.tags ?? []).join(', ');

    const aggregatedTagSet = new Set();
    mods.forEach((entry) => {
      const entryTags = Array.isArray(entry.tags) ? entry.tags : [];
      entryTags.forEach((tag) => {
        const trimmed = String(tag).trim();
        if (trimmed) {
          aggregatedTagSet.add(trimmed);
        }
      });
      const record = modRecordsById.get(entry.modId);
      if (record) {
        const recordTags = Array.isArray(record.tags) ? record.tags : [];
        recordTags.forEach((tag) => {
          const trimmed = String(tag).trim();
          if (trimmed) {
            aggregatedTagSet.add(trimmed);
          }
        });
        const latestTags = Array.isArray(record.latestWorkshopDetails?.tags) ? record.latestWorkshopDetails.tags : [];
        latestTags.forEach((tag) => {
          const trimmed = String(tag).trim();
          if (trimmed) {
            aggregatedTagSet.add(trimmed);
          }
        });
      }
    });
    const suggestedTags = Array.from(aggregatedTagSet).sort((a, b) => a.localeCompare(b));

    return (
      <section className="collection-detail">
        <header className="collection-detail__header">
          <div className="collection-detail__preview">
            {previewImages.length > 0 ? (
              <div className={`collection-collage collection-collage--${previewImages.length}`}>
                {previewImages.map((src, index) => (
                  <img key={`${collection.id}-detail-preview-${index}`} src={src} alt="Collection preview" referrerPolicy="no-referrer" />
                ))}
              </div>
            ) : (
              <div className="collection-card__preview-placeholder">No Previews</div>
            )}
          </div>
          <div className="collection-detail__meta">
            <h2>{collection.name}</h2>
            <div className="collection-detail__stats">
              <span>{mods.length} mod{mods.length === 1 ? '' : 's'}</span>
              <span>Created {collection.createdAt ? new Date(collection.createdAt).toLocaleString() : 'Unknown'}</span>
              <span>Updated {collection.updatedAt ? new Date(collection.updatedAt).toLocaleString() : 'Unknown'}</span>
            </div>
            <div className="collection-detail__actions">
              <button
                type="button"
                className="steam-button"
                onClick={() => handleCollectionInstallAll(collection)}
                disabled={!mods.length}
              >
                Install All
              </button>
              <button
                type="button"
                className="steam-button secondary"
                onClick={() => handleCollectionUninstallAll(collection)}
                disabled={!mods.length}
              >
                Uninstall All
              </button>
              <button
                type="button"
                className="steam-button secondary"
                onClick={() => handleExportCollection(collection.id)}
              >
                Export
              </button>
              <button
                type="button"
                className="steam-button danger"
                onClick={() => setCollectionDeletionConfirm({ isOpen: true, collection })}
              >
                Delete Collection
              </button>
            </div>
          </div>
        </header>

        <div className="collection-detail__editor">
          <div className="collection-detail__field">
            <label htmlFor="collection-description" className="collection-detail__label">Description</label>
            <textarea
              id="collection-description"
              className="collection-detail__textarea"
              placeholder="Describe this collection..."
              value={descriptionValue}
              onChange={(event) => handleCollectionDescriptionChange(collection.id, event.target.value)}
            />
          </div>
        </div>

        <div className="collection-detail__list">
          {mods.length === 0 ? (
            <div className="home-empty">No mods in this collection yet.</div>
          ) : (
            mods.map((entry) => renderCollectionDetailModCard(collection, entry))
          )}
        </div>
      </section>
    );
  }

  function renderHomeView() {
    if (!selectedProfile?.appId) {
      return <div className="home-empty">Select or create a profile to view its workshop.</div>;
    }

    if (homeLoading) {
      return (
        <div className="home-loading">
          <span className="loading-spinner" aria-hidden="true" aria-label="Loading" />
        </div>
      );
    }

    if (homeError) {
      return <div className="home-error">{homeError}</div>;
    }

    const carouselItems = homeData.trendingWeek ?? [];
    const activeCarouselIndex = Math.min(carouselIndex, Math.max(carouselItems.length - 1, 0));
    const appId = selectedProfile?.appId ?? '';
    const heroSubtitle = appDetails?.name
      ? `${appDetails.name} · App ID ${appId}`
      : appId
        ? `App ID ${appId}`
        : 'Steam Workshop Integration';
    const heroDescription = stripHtml(appDetails?.short_description) || `Browse, download, and manage Steam Workshop mods for ${workshopTitle}.`;
    const genreText = formatList(appDetails?.genres?.map((genre) => genre?.description), 3);
    const developerText = formatList(appDetails?.developers);
    const publisherText = formatList(appDetails?.publishers);
    const releaseDateText = appDetails?.release_date?.date || '—';
    const recentReviewsText = formatReviewSummary(appReviewSummaries?.recent);
    const englishReviewsText = formatReviewSummary(appReviewSummaries?.english);
    const heroMetaItems = [
      { label: 'Genre', value: genreText },
      { label: 'Developer', value: developerText },
      { label: 'Publisher', value: publisherText },
      { label: 'Release Date', value: releaseDateText },
      { label: 'Recent Reviews', value: recentReviewsText },
      { label: 'English Reviews', value: englishReviewsText },
    ];
    const heroBackgroundStyle = heroImageUrl ? { '--hero-background': `url(${heroImageUrl})` } : {};
    const heroClassName = heroImageUrl ? 'home-hero home-hero--has-image' : 'home-hero home-hero--no-image';
    const listsConfig = {
      popular: {
        key: 'popular',
        title: 'Most Popular',
        items: homeData.popularAllTime ?? [],
        browseSort: 'popular',
        browseTimeframe: 'all',
      },
      subscribed: {
        key: 'subscribed',
        title: 'Most Subscribed',
        items: homeData.subscribedAllTime ?? [],
        browseSort: 'subscribed',
      },
      recent: {
        key: 'recent',
        title: 'Most Recent',
        items: homeData.recentUpdated ?? [],
        browseSort: 'recent',
      },
    };

    const activeList = listsConfig[homeSelectedList] ?? listsConfig.popular;
    const activeItems = activeList.items.slice(0, 9);

    return (
      <div className="home-layout">
        <section className={heroClassName} style={heroBackgroundStyle}>
          <div className="home-hero__content">
            <div className="home-hero__heading">
              <h1 className="home-hero__title">{workshopTitle}</h1>
              <div className="home-hero__subtitle">{heroSubtitle}</div>
              {heroDescription && <p className="home-hero__description">{heroDescription}</p>}
            </div>
            <div className="home-hero__meta">
              {heroMetaItems.map((item) => (
                <div key={item.label} className="home-hero__meta-item">
                  <span className="home-hero__meta-label">{item.label}</span>
                  <span className="home-hero__meta-value">{item.value}</span>
                </div>
              ))}
            </div>
            {heroLinks.length > 0 && (
              <div className="home-hero__links">
                {heroLinks.map((link) => {
                  const IconComponent = getHeroLinkIcon(link.kind);
                  return (
                    <a
                      key={link.url}
                      href={link.url}
                      className="home-hero__link"
                      target="_blank"
                      rel="noopener noreferrer"
                    >
                      <IconComponent aria-hidden="true" />
                      <span>
                        {link.label}
                        <FaExternalLinkAlt aria-hidden="true" className="home-hero__link-icon" />
                      </span>
                    </a>
                  );
                })}
              </div>
            )}
            {appDetailsError && <div className="home-hero__alert">{appDetailsError}</div>}
          </div>
        </section>
        <section className="home-carousel-section">
          {carouselItems.length === 0 ? (
            <div className="home-empty">No trending mods found this week.</div>
          ) : (
            <div className="home-carousel fade-container" key={`carousel-${homeTransitionKey}`}>
              <div
                className="home-carousel__track"
                style={{ transform: `translateX(-${activeCarouselIndex * 100}%)` }}
              >
                {carouselItems.map((mod) => (
                  <div
                    key={`carousel-${mod.modId}`}
                    className="home-carousel__slide"
                    role="button"
                    tabIndex={0}
                    onClick={() => openModDetail(mod)}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter' || event.key === ' ') {
                        event.preventDefault();
                        openModDetail(mod);
                      }
                    }}
                  >
                    <div className="home-carousel__info">
                      <div className="home-carousel__title">{mod.title || 'Untitled Mod'}</div>
                      <div className="home-carousel__meta">by {mod.author || 'Unknown Creator'}</div>
                      <div className="home-carousel__meta">
                        Updated{' '}
                        {mod.timeUpdated
                          ? new Date(mod.timeUpdated * 1000).toLocaleDateString()
                          : '—'}
                      </div>
                      {mod.shortDescription && (
                        <div className="home-carousel__description">{mod.shortDescription}</div>
                      )}
                    </div>
                    <div className="home-carousel__image">
                      {mod.previewUrl ? (
                        <img
                          src={mod.previewUrl}
                          alt={mod.title || 'Mod preview'}
                          loading="lazy"
                          referrerPolicy="no-referrer"
                        />
                      ) : (
                        <span>No Preview</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
              <div className="home-carousel__controls">
                {carouselItems.map((_, index) => (
                  <button
                    key={`dot-${index}`}
                    type="button"
                    className={`home-carousel__dot ${index === activeCarouselIndex ? 'active' : ''}`}
                    onClick={() => setCarouselIndex(index)}
                    aria-label={`Go to slide ${index + 1}`}
                  />
                ))}
              </div>
            </div>
          )}
        </section>

        <div className="home-content-row">
          <div className="home-list-panel">
            <div className="home-tabs">
              {Object.values(listsConfig).map((list) => (
                <button
                  key={list.key}
                  type="button"
                  className={`home-tab ${homeSelectedList === list.key ? 'active' : ''}`}
                  onClick={() => handleHomeListChange(list.key)}
                >
                  {list.title}
                </button>
              ))}
            </div>
            <div key={`home-grid-${homeTransitionKey}`} className="home-tab-panel fade-container">
              {activeItems.length === 0 ? (
                <div className="home-empty">No items available yet.</div>
              ) : (
                <>
                  <div className="home-section__grid">
                    {activeItems.map((mod) => renderModCard(mod, 'section'))}
                  </div>
                  <div className="home-list__footer">
                    <button
                      type="button"
                      className="steam-button secondary"
                      onClick={() => handleHomeSeeAll(activeList)}
                    >
                      See All
                    </button>
                  </div>
                </>
              )}
            </div>
          </div>

          <aside className="home-tags">
            <h3 className="home-tags__title">Popular Tags</h3>
            {homeData.tags.length === 0 ? (
              <div className="home-empty">Tags unavailable.</div>
            ) : (
              <ul className="home-tags__list">
                {homeData.tags.map((tag) => (
                  <li key={tag.name} className="home-tags__item">
                    <button
                      type="button"
                      className="home-tag"
                      onClick={() => handleHomeTagClick(tag.name)}
                    >
                      <span className="home-tag__label">{tag.name}</span>
                      <span className="home-tag__count">{tag.count}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </aside>
        </div>
      </div>
    );
  }

  function renderBrowseView() {
    if (!selectedProfile?.appId) {
      return <div className="home-empty">Select or create a profile to browse its workshop.</div>;
    }

    const sortSelectId = 'browse-sort-select';
    const timeframeSelectId = 'browse-timeframe-select';
    const supportsTimeframe = browseSortConfig.supportsTimeframe;
    const knownTotal = browseTotal > 0;
    const totalPages = knownTotal ? Math.max(1, Math.ceil(browseTotal / DEFAULT_PAGE_SIZE)) : null;
    const canGoPrev = browsePage > 1 && !isLoadingGrid;
    const canGoNext = browseHasMore && !isLoadingGrid && !gridError;

    const shouldShowPagination = browsePage > 1 || browseHasMore;

    return (
      <section className="browse-view">
        <div className="browse-header fade-container" key={`browse-header-${browseTransitionKey}`}>
          <div className="browse-header__top">
            <h2 className="section-title">Browse Workshop</h2>
          </div>
          <div className="browse-controls">
            <button
              type="button"
              className="steam-button secondary browse-tag-button browse-controls__tag-button"
              onClick={openTagPicker}
              aria-label="Select tag filter"
            >
              <FaTag aria-hidden="true" />
            </button>
            {browseRequiredTag && (
              <span className="browse-tag-chip browse-controls__chip">
                <FaTag aria-hidden="true" />
                <span>{browseRequiredTag}</span>
                <button
                  type="button"
                  className="browse-tag-chip__clear"
                  onClick={handleClearBrowseTag}
                  aria-label="Clear tag filter"
                >
                  <FaTimes aria-hidden="true" />
                </button>
              </span>
            )}
            <div className="browse-controls__group">
              <label className="browse-label" htmlFor={sortSelectId}>
                Sort By
              </label>
              <select
                id={sortSelectId}
                className="steam-input steam-input--select"
                value={browseSortId}
                onChange={handleBrowseSortChange}
              >
                {availableBrowseSortOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            {browseSortId === 'popular' && (
              <div className="browse-controls__group">
                <label className="browse-label" htmlFor={timeframeSelectId}>
                  Timeframe
                </label>
                <select
                  id={timeframeSelectId}
                  className="steam-input steam-input--select"
                  value={browseTimeframeId}
                  onChange={handleBrowseTimeframeChange}
                >
                  {TIMEFRAME_OPTIONS.map((option) => (
                    <option key={option.id} value={option.id}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            )}
            <form className="search-form browse-search browse-controls__search" onSubmit={handleSearchSubmit}>
              <input
                type="search"
                className="steam-input search-form__input"
                placeholder="Search workshop by keyword, ID, or link"
                aria-label="Search workshop"
                autoComplete="off"
                value={browseSearchInput}
                onChange={handleSearchInputChange}
              />
              <button type="submit" className="steam-button search-form__button">
                <FaSearch aria-hidden="true" />
                <span>Search</span>
              </button>
            </form>
          </div>
        </div>

        <div key={`browse-results-${browseTransitionKey}`} className="fade-container">
          {gridError && !isLoadingGrid ? <div className="home-error">{gridError}</div> : null}

          {isLoadingGrid && gridMods.length === 0 ? (
            <div className="home-loading">
              <span className="loading-spinner" aria-hidden="true" aria-label="Loading" />
            </div>
          ) : null}

          {!isLoadingGrid && gridMods.length === 0 && !gridError ? (
            <div className="home-empty">No workshop items found for this filter.</div>
          ) : null}

          {gridMods.length > 0 ? (
            <div className="browse-grid">
              {gridMods.map((mod) => renderModCard(mod, 'browse'))}
            </div>
          ) : null}
        </div>

        {shouldShowPagination ? (
          <div className="browse-pagination">
            <button
              type="button"
              className="steam-button secondary"
              onClick={() => {
                if (canGoPrev) {
                  handleBrowsePrevPage();
                }
              }}
              disabled={!canGoPrev}
            >
              Previous
            </button>
            <div className="browse-pagination__pages">
              {(() => {
                const pages = new Set();
                const total = totalPages && totalPages > 0 ? totalPages : null;
                pages.add(1);
                if (total) {
                  pages.add(total);
                  for (let i = Math.max(1, browsePage - 2); i <= Math.min(total, browsePage + 2); i += 1) {
                    pages.add(i);
                  }
                } else {
                  for (let i = Math.max(1, browsePage - 2); i <= browsePage; i += 1) {
                    pages.add(i);
                  }
                  if (browseHasMore) {
                    pages.add(browsePage + 1);
                    pages.add(browsePage + 2);
                  }
                }
                const sortedPages = Array.from(pages).sort((a, b) => a - b);
                const sequence = [];
                for (let i = 0; i < sortedPages.length; i += 1) {
                  const page = sortedPages[i];
                  sequence.push(page);
                  const next = sortedPages[i + 1];
                  if (next && next - page > 1) {
                    sequence.push(`ellipsis-${page}`);
                  }
                }
                return sequence.map((entry) => {
                  if (typeof entry === 'number') {
                    return (
                      <button
                        type="button"
                        key={`page-${entry}`}
                        className={`browse-page-button ${browsePage === entry ? 'active' : ''}`}
                        onClick={() => setBrowsePage(entry)}
                      >
                        {entry}
                      </button>
                    );
                  }
                  return (
                    <span key={entry} className="browse-page-ellipsis">
                      …
                    </span>
                  );
                });
              })()}
            </div>
            <button
              type="button"
              className="steam-button secondary"
              onClick={() => {
                if (canGoNext) {
                  handleBrowseNextPage();
                }
              }}
              disabled={!canGoNext}
            >
              Next
            </button>
          </div>
        ) : null}
      </section>
    );
  }

  function getRequirementStatusForMod(mod) {
    if (!mod || !modDetailState.isOpen || modDetailState.mod?.modId !== mod.modId) {
      return { installed: [], missing: [] };
    }

    const requirements = Array.isArray(modDetailState.requirements) ? modDetailState.requirements : [];
    const installed = [];
    const missing = [];

    requirements.forEach((requirement) => {
      if (!requirement || requirement.kind !== 'workshop' || !requirement.modId) {
        return;
      }

      const record = modRecordsById.get(requirement.modId);
      const job = downloadJobByModId.get(requirement.modId);
      const isInstalled = Boolean(record?.installedPath) || record?.status === 'installed';
      const entry = { requirement, record, job };

      if (isInstalled) {
        installed.push(entry);
      } else {
        missing.push(entry);
      }
    });

    return { installed, missing };
  }

  function buildRequirementModShape(requirement) {
    if (!requirement || requirement.kind !== 'workshop' || !requirement.modId) {
      return null;
    }

    const fallbackPreview = Array.isArray(requirement.previewUrls) && requirement.previewUrls.length > 0
      ? requirement.previewUrls[0]
      : requirement.previewUrl ?? '';

    return {
      modId: requirement.modId,
      title: requirement.title ?? requirement.modId,
      author: requirement.author ?? requirement.creator ?? requirement.owner ?? '',
      previewUrl: fallbackPreview,
      previewUrls: requirement.previewUrls ?? (fallbackPreview ? [fallbackPreview] : []),
      url: requirement.url ?? getWorkshopUrl({ modId: requirement.modId }),
      timeUpdated: requirement.timeUpdated ?? null,
      fileSizeBytes: requirement.fileSizeBytes ?? null,
    };
  }

  function handleDownloadRequest(mod, options = { silent: true, notify: true }) {
    if (!mod) {
      return;
    }

    if (modDetailState.isOpen && modDetailState.mod?.modId === mod.modId) {
      const dependencyStatus = getRequirementStatusForMod(mod);
      if (dependencyStatus.missing.length > 0) {
        setDependencyPromptState({
          isOpen: true,
          mod,
          missing: dependencyStatus.missing,
          installed: dependencyStatus.installed,
          options,
        });
        return;
      }
    }

    handleDownloadMod(mod, options);
  }

  const getCollectionIdsContainingMod = useCallback((modId) => {
    if (!modId) {
      return [];
    }

    const targetId = String(modId);
    return collections
      .filter((collection) => Array.isArray(collection?.mods) && collection.mods.some((entry) => entry.modId === targetId))
      .map((collection) => collection.id);
  }, [collections]);

  function handleCreateCollection(name = '') {
    if (!selectedProfileId) {
      showToast('Select a profile before creating a collection.', 'error');
      return null;
    }

    const template = {
      ...createCollectionTemplate(name),
      profileId: selectedProfileId,
    };

    updateCollections((prev) => [...prev, template]);
    setActiveCollectionId(template.id);
    showToast(`Collection "${template.name}" created.`, 'success');
    return template;
  }

  function handleRenameCollection(collectionId, nextName) {
    if (!collectionId) {
      return;
    }

    const trimmed = (nextName ?? '').trim();
    const targetName = trimmed || 'Untitled Collection';
    let updated = false;
    const previousName = collectionsById.get(collectionId)?.name ?? null;

    updateCollections((prev) => {
      const index = prev.findIndex((item) => item.id === collectionId);
      if (index === -1) {
        return prev;
      }

      const current = prev[index];
      if (current.name === targetName) {
        return prev;
      }

      updated = true;
      const next = [...prev];
      next[index] = {
        ...current,
        name: targetName,
        profileId: current.profileId ?? selectedProfileId ?? null,
        updatedAt: new Date().toISOString(),
      };
      return next;
    });

    if (updated) {
      clearCollectionRenameDraft(collectionId);
      showToast(`Renamed collection to "${targetName}".`, 'success');
      if (activeCollectionId === collectionId && activeView === 'collection-detail') {
        setBreadcrumbs([
          { type: 'view', label: 'Collections', data: 'collections', id: 'collections-root' },
          { type: 'collection', label: targetName, data: { collectionId }, id: collectionId },
        ]);
      }
    } else {
      clearCollectionRenameDraft(collectionId);

      if (collectionsById.size && !collectionsById.has(collectionId)) {
        if (previousName !== null) {
          showToast('Collection not found.', 'error');
        }
      } else if (previousName === targetName) {
        // No change; no toast needed
      }
    }
  }

  function clearCollectionRenameDraft(collectionId) {
    setCollectionRenameDrafts((prev) => {
      if (!(collectionId in prev)) {
        return prev;
      }
      const { [collectionId]: _removed, ...rest } = prev;
      return rest;
    });
  }

  function handleCollectionNameInputChange(collectionId, value) {
    setCollectionRenameDrafts((prev) => ({ ...prev, [collectionId]: value }));
  }

  function handleCollectionNameCommit(collectionId) {
    if (!Object.prototype.hasOwnProperty.call(collectionRenameDrafts, collectionId)) {
      return;
    }

    const draftValue = collectionRenameDrafts[collectionId];
    handleRenameCollection(collectionId, draftValue);
  }

  function handleCollectionNameKeyDown(event, collectionId) {
    if (event.key === 'Enter') {
      event.preventDefault();
      event.stopPropagation();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      clearCollectionRenameDraft(collectionId);
    }
  }

  function handleCollectionDescriptionChange(collectionId, value) {
    updateCollections((prev) => {
      const index = prev.findIndex((item) => item.id === collectionId);
      if (index === -1) {
        return prev;
      }

      const collection = prev[index];
      if (collection.description === value) {
        return prev;
      }

      const next = [...prev];
      next[index] = {
        ...collection,
        description: value,
        updatedAt: new Date().toISOString(),
      };
      return next;
    });
  }

  function handleCollectionTagInputChange(collectionId, value) {
    setCollectionTagDrafts((prev) => ({ ...prev, [collectionId]: value }));
  }

  function handleCollectionTagsCommit(collectionId) {
    setCollectionTagDrafts((prev) => {
      if (!(collectionId in prev)) {
        return prev;
      }

      const draftValue = prev[collectionId];
      const { [collectionId]: _removed, ...rest } = prev;
      const parsed = parseTagList(draftValue ?? '');

      updateCollections((collectionsPrev) => {
        const index = collectionsPrev.findIndex((item) => item.id === collectionId);
        if (index === -1) {
          return collectionsPrev;
        }

        const collection = collectionsPrev[index];
        const currentTags = Array.isArray(collection.tags) ? collection.tags : [];

        const tagsChanged = parsed.length !== currentTags.length || parsed.some((tag, idx) => tag !== currentTags[idx]);

        if (!tagsChanged) {
          return collectionsPrev;
        }

        const next = [...collectionsPrev];
        next[index] = {
          ...collection,
          tags: parsed,
          profileId: collection.profileId ?? selectedProfileId ?? null,
          updatedAt: new Date().toISOString(),
        };
        return next;
      });

      return rest;
    });
  }

  function closeCollectionDeletionConfirm() {
    setCollectionDeletionConfirm({ isOpen: false, collection: null });
  }

  function handleConfirmDeleteCollection() {
    const target = collectionDeletionConfirm.collection;
    if (!target) {
      closeCollectionDeletionConfirm();
      return;
    }

    closeCollectionDeletionConfirm();
    handleDeleteCollection(target.id);
  }

  function handleDeleteCollection(collectionId) {
    if (!collectionId) {
      return;
    }

    let deletedCollectionName = null;
    let removed = false;

    updateCollections((prev) => {
      const index = prev.findIndex((item) => item.id === collectionId);
      if (index === -1) {
        return prev;
      }

      removed = true;
      deletedCollectionName = prev[index]?.name ?? null;
      const next = [...prev.slice(0, index), ...prev.slice(index + 1)];
      return next;
    });

    if (removed) {
      if (activeCollectionId === collectionId) {
        setActiveCollectionId(null);
        if (activeView === 'collection-detail') {
          handleViewChange('collections');
        }
      }
      clearCollectionRenameDraft(collectionId);
      setCollectionTagDrafts((prev) => {
        if (!(collectionId in prev)) {
          return prev;
        }
        const { [collectionId]: _removedDraft, ...restDrafts } = prev;
        return restDrafts;
      });

      const label = deletedCollectionName ? ` "${deletedCollectionName}"` : '';
      showToast(`Deleted collection${label}.`, 'info');
    } else {
      showToast('Collection not found.', 'error');
    }
  }

  function handleRemoveModFromCollection(collectionId, modId) {
    if (!collectionId || !modId) {
      return;
    }

    const targetModId = String(modId);
    let removed = false;

    updateCollections((prev) => {
      const index = prev.findIndex((item) => item.id === collectionId);
      if (index === -1) {
        return prev;
      }

      const collection = prev[index];
      const mods = Array.isArray(collection.mods) ? collection.mods : [];
      if (!mods.some((entry) => entry.modId === targetModId)) {
        return prev;
      }

      const nextMods = mods.filter((entry) => entry.modId !== targetModId);
      removed = mods.length !== nextMods.length;
      if (!removed) {
        return prev;
      }

      const next = [...prev];
      next[index] = {
        ...collection,
        mods: nextMods,
        updatedAt: new Date().toISOString(),
      };
      return next;
    });

    if (removed) {
      showToast('Removed mod from collection.', 'info');
    }
  }

  async function handleExportCollection(collectionId) {
    if (!collectionId) {
      showToast('Collection not found.', 'error');
      return;
    }

    const collection = collectionsById.get(collectionId);
    if (!collection) {
      showToast('Collection not found.', 'error');
      return;
    }

    try {
      const result = await safeInvoke('collections:export', {
        collection,
      });

      if (!result || result.canceled) {
        return;
      }

      showToast(`Exported "${collection.name}".`, 'success');
    } catch (error) {
      console.error('Failed to export collection', error);
      showToast('Failed to export collection.', 'error');
    }
  }

  function processImportedCollections(importedCollections, importErrors = []) {
    if (!selectedProfileId) {
      showToast('Select a profile before importing collections.', 'error');
      return false;
    }

    const collectionsArray = Array.isArray(importedCollections) ? importedCollections : [];
    const errorsArray = Array.isArray(importErrors) ? importErrors : [];

    if (!collectionsArray.length) {
      if (errorsArray.length) {
        console.warn('Collection import errors:', errorsArray);
        showToast('Unable to import collections. See logs for details.', 'error');
      } else {
        showToast('No collections were found to import.', 'info');
      }
      return false;
    }

    if (errorsArray.length) {
      console.warn('Collection import errors:', errorsArray);
    }

    const importedIds = [];
    const now = new Date().toISOString();

    updateCollections((prev) => {
      const next = [...prev];
      const existingNames = new Set(next.map((item) => (item.name || '').toLowerCase()));

      collectionsArray.forEach((raw) => {
        const sanitizedMods = Array.isArray(raw.mods)
          ? raw.mods.map((entry) => normalizeCollectionModEntry(entry)).filter(Boolean)
          : [];

        const normalized = normalizeCollection({
          ...raw,
          id: undefined,
          profileId: selectedProfileId,
          mods: sanitizedMods,
          tags: Array.isArray(raw.tags) ? raw.tags : [],
          createdAt: raw.createdAt ?? now,
          updatedAt: now,
        });

        normalized.mods = sanitizedMods;
        normalized.profileId = selectedProfileId;
        normalized.createdAt = normalized.createdAt ?? now;
        normalized.updatedAt = now;

        const baseName = normalized.name || raw.name || 'Imported Collection';
        normalized.name = createUniqueCollectionName(baseName, existingNames);

        if (raw.metadata && typeof raw.metadata === 'object') {
          const metadata = { ...raw.metadata };
          const importSource = raw.importSource ?? raw.metadata.importSource;
          if (importSource) {
            metadata.importSource = importSource;
          }
          normalized.metadata = metadata;
        } else if (raw.importSource) {
          normalized.metadata = { importSource: raw.importSource };
        }

        next.push(normalized);
        importedIds.push(normalized.id);
      });

      return next;
    });

    if (importedIds.length) {
      setActiveCollectionId(importedIds[0]);
      handleViewChange('collections');
    }

    showToast(`Imported ${collectionsArray.length} collection${collectionsArray.length === 1 ? '' : 's'}.`, 'success');

    if (errorsArray.length) {
      showToast(`Skipped ${errorsArray.length} item${errorsArray.length === 1 ? '' : 's'} during import. Check logs for details.`, 'warning');
    }

    return true;
  }

  async function importCollectionsFromFile() {
    if (!selectedProfileId) {
      showToast('Select a profile before importing collections.', 'error');
      return;
    }

    try {
      const result = await safeInvoke('collections:import');

      if (!result || result.canceled) {
        return;
      }

      const importedCollections = Array.isArray(result.collections) ? result.collections : [];
      const importErrors = Array.isArray(result.errors) ? result.errors : [];

      processImportedCollections(importedCollections, importErrors);
    } catch (error) {
      console.error('Failed to import collections', error);
      showToast('Failed to import collections.', 'error');
    }
  }

  function openCollectionImportModal() {
    setCollectionImportModal({ ...DEFAULT_COLLECTION_IMPORT_MODAL, isOpen: true });
  }

  function closeCollectionImportModal() {
    setCollectionImportModal({ ...DEFAULT_COLLECTION_IMPORT_MODAL });
  }

  function handleImportModalChooseFile() {
    closeCollectionImportModal();
    window.setTimeout(() => {
      importCollectionsFromFile();
    }, 0);
  }

  function handleImportModalChooseSteam() {
    setCollectionImportModal((prev) => ({
      ...prev,
      mode: 'steam',
      steamUrl: '',
      error: '',
      loading: false,
    }));
  }

  function handleImportModalBack() {
    setCollectionImportModal((prev) => ({
      ...prev,
      mode: 'options',
      steamUrl: '',
      error: '',
      loading: false,
    }));
  }

  function handleImportModalUrlChange(value) {
    setCollectionImportModal((prev) => ({
      ...prev,
      steamUrl: value,
      error: '',
    }));
  }

  async function handleSteamImportSubmit() {
    if (collectionImportModal.loading) {
      return;
    }

    const trimmed = (collectionImportModal.steamUrl || '').trim();
    if (!trimmed) {
      setCollectionImportModal((prev) => ({
        ...prev,
        error: 'Enter a Steam collection URL or ID.',
      }));
      return;
    }

    if (!selectedProfileId) {
      showToast('Select a profile before importing collections.', 'error');
      return;
    }

    let shouldClose = false;

    setCollectionImportModal((prev) => ({
      ...prev,
      loading: true,
      error: '',
    }));

    try {
      const result = await safeInvoke('collections:import-steam', { url: trimmed });

      if (!result || result.canceled) {
        setCollectionImportModal((prev) => ({
          ...prev,
          loading: false,
        }));
        return;
      }

      const importedCollections = Array.isArray(result.collections) ? result.collections : [];
      const importErrors = Array.isArray(result.errors) ? result.errors : [];

      const success = processImportedCollections(importedCollections, importErrors);

      if (success) {
        shouldClose = true;
      } else {
        const errorMessage = importErrors.length
          ? 'Unable to import from the provided URL. Ensure the collection is public and try again.'
          : 'No mods were found in the provided collection.';
        setCollectionImportModal((prev) => ({
          ...prev,
          loading: false,
          error: errorMessage,
        }));
      }
    } catch (error) {
      console.error('Failed to import Steam collection', error);
      const message = error?.message ?? 'Failed to import collection from Steam.';
      setCollectionImportModal((prev) => ({
        ...prev,
        loading: false,
        error: message,
      }));
      showToast('Failed to import collection from Steam.', 'error');
    } finally {
      if (shouldClose) {
        closeCollectionImportModal();
      }
    }
  }

  function handleAddModToCollections(mod, targetCollectionIds) {
    if (!mod) {
      showToast('Unable to add to collection: missing mod information.', 'error');
      return;
    }

    const entry = normalizeCollectionModEntry(mod);
    if (!entry) {
      showToast('Unable to add to collection: invalid mod reference.', 'error');
      return;
    }

    const idsArray = Array.isArray(targetCollectionIds) ? targetCollectionIds : [targetCollectionIds];
    const filteredIds = idsArray
      .filter(Boolean)
      .map((id) => String(id))
      .filter((id) => {
        const targetCollection = collectionsById.get(id);
        if (!targetCollection) {
          return false;
        }
        if (targetCollection.profileId && selectedProfileId && targetCollection.profileId !== selectedProfileId) {
          return false;
        }
        return true;
      });

    if (!filteredIds.length) {
      showToast('Select a collection to add this mod.', 'error');
      return;
    }

    const idsSet = new Set(filteredIds);
    const now = new Date().toISOString();
    const entryTags = Array.isArray(entry.tags) ? entry.tags : (Array.isArray(mod.tags) ? mod.tags : []);
    let affected = 0;
    const updatedCollectionTags = new Map();

    updateCollections((prev) => {
      let changed = false;
      const next = prev.map((collection) => {
        if (!idsSet.has(collection.id)) {
          return collection;
        }

        const mods = Array.isArray(collection.mods) ? collection.mods : [];
        const existingIndex = mods.findIndex((item) => item.modId === entry.modId);

        const existingCollectionTags = Array.isArray(collection.tags) ? collection.tags : [];

        if (existingIndex !== -1) {
          const existing = mods[existingIndex];
          const mergedTags = mergeTagLists(existing.tags, entryTags);
          const merged = {
            ...existing,
            title: entry.title || existing.title,
            author: entry.author || existing.author,
            previewUrl: entry.previewUrl || existing.previewUrl,
            workshopUrl: entry.workshopUrl || existing.workshopUrl,
            stats: entry.stats ?? existing.stats,
            tags: mergedTags,
          };

          const statsChanged = JSON.stringify(existing.stats ?? null) !== JSON.stringify(merged.stats ?? null);
          const tagsChanged = JSON.stringify(Array.isArray(existing.tags) ? existing.tags : []) !== JSON.stringify(mergedTags);

          if (
            existing.title === merged.title
            && existing.author === merged.author
            && existing.previewUrl === merged.previewUrl
            && existing.workshopUrl === merged.workshopUrl
            && !statsChanged
            && !tagsChanged
          ) {
            return collection;
          }

          const newMods = [...mods];
          newMods[existingIndex] = merged;
          const updatedTags = mergeTagLists(existingCollectionTags, mergedTags);
          updatedCollectionTags.set(collection.id, updatedTags);
          changed = true;
          affected += 1;
          return {
            ...collection,
            mods: newMods,
            tags: updatedTags,
            profileId: collection.profileId ?? selectedProfileId ?? null,
            updatedAt: now,
          };
        }

        const newEntry = { ...entry, addedAt: now, tags: entryTags };
        const newMods = [...mods, newEntry];
        const updatedTags = mergeTagLists(existingCollectionTags, entryTags);
        updatedCollectionTags.set(collection.id, updatedTags);
        changed = true;
        affected += 1;
        return {
          ...collection,
          mods: newMods,
          tags: updatedTags,
          profileId: collection.profileId ?? selectedProfileId ?? null,
          updatedAt: now,
        };
      });

      return changed ? next : prev;
    });

    if (updatedCollectionTags.size > 0) {
      setCollectionTagDrafts((prev) => {
        const nextDrafts = { ...prev };
        updatedCollectionTags.forEach((tags, id) => {
          nextDrafts[id] = tags.join(', ');
        });
        return nextDrafts;
      });
    }

    if (affected > 0) {
      setActiveCollectionId(filteredIds[0]);
      showToast(`Added to ${affected} collection${affected === 1 ? '' : 's'}.`, 'success', { duration: 3500 });
    } else {
      showToast('This mod is already in the selected collections.', 'info');
    }
  }

  async function handleCollectionInstallAll(collection) {
    if (!collection) {
      return;
    }

    if (!selectedProfileId) {
      showToast('Select a profile before installing collection mods.', 'error');
      return;
    }

    const mods = Array.isArray(collection.mods) ? collection.mods : [];
    if (!mods.length) {
      showToast('This collection has no mods yet.', 'info');
      return;
    }

    const baseEntries = [];
    const seenBaseIds = new Set();

    mods.forEach((entry) => {
      if (!entry?.modId) {
        return;
      }

      const modId = String(entry.modId);
      if (seenBaseIds.has(modId)) {
        return;
      }

      const modShape = buildModShapeFromCollectionEntry(entry);
      if (!modShape?.modId) {
        return;
      }

      seenBaseIds.add(modId);
      baseEntries.push({
        entry,
        modId,
        modShape,
      });
    });

    if (!baseEntries.length) {
      showToast('No valid mods found to install for this collection.', 'info');
      return;
    }

    const baseModIds = new Set(baseEntries.map((item) => item.modId));
    const requirementsByMod = new Map();

    baseEntries.forEach((item) => {
      const record = modRecordsById.get(item.modId);
      if (record?.requirements?.length) {
        requirementsByMod.set(item.modId, record.requirements);
      }
    });

    const modsToFetch = baseEntries
      .filter((item) => !requirementsByMod.has(item.modId))
      .map((item) => item.modId);

    if (modsToFetch.length > 0) {
      const chunkSize = 20;
      for (let index = 0; index < modsToFetch.length; index += chunkSize) {
        const chunk = modsToFetch.slice(index, index + chunkSize);
        try {
          const fetched = await safeInvoke('steam:fetch-multiple-mod-details', {
            modIds: chunk,
            appId: selectedProfile?.appId ?? config?.defaultAppId ?? null,
          });

          if (Array.isArray(fetched)) {
            fetched.forEach((detail) => {
              if (detail?.modId) {
                requirementsByMod.set(String(detail.modId), Array.isArray(detail.requirements) ? detail.requirements : []);
              }
            });
          }
        } catch (error) {
          console.warn('Failed to fetch requirements for collection mods', error);
        }
      }
    }

    baseEntries.forEach((item) => {
      if (!requirementsByMod.has(item.modId)) {
        requirementsByMod.set(item.modId, []);
      }
    });

    const missingDependenciesMap = new Map();

    requirementsByMod.forEach((requirements, modId) => {
      if (!Array.isArray(requirements) || requirements.length === 0) {
        return;
      }

      requirements.forEach((requirement) => {
        if (!requirement || requirement.kind !== 'workshop' || !requirement.modId) {
          return;
        }

        const requirementId = String(requirement.modId);

        if (baseModIds.has(requirementId)) {
          return;
        }

        const requirementRecord = modRecordsById.get(requirementId);
        const isInstalled = Boolean(requirementRecord?.installedPath) || requirementRecord?.status === 'installed';
        if (isInstalled) {
          return;
        }

        if (!missingDependenciesMap.has(requirementId)) {
          missingDependenciesMap.set(requirementId, requirement);
        }
      });
    });

    if (missingDependenciesMap.size > 0) {
      const dependencyModShapes = [];
      missingDependenciesMap.forEach((requirement) => {
        const dependencyMod = buildRequirementModShape(requirement);
        if (dependencyMod) {
          dependencyModShapes.push(dependencyMod);
        }
      });

      if (dependencyModShapes.length > 0) {
        setCollectionDependencyPrompt({
          isOpen: true,
          collection: { id: collection.id, name: collection.name },
          baseMods: baseEntries.map((item) => item.modShape),
          dependencyMods: dependencyModShapes,
        });
        return;
      }
    }

    queueCollectionDownloads(
      baseEntries.map((item) => item.modShape),
      {
        includeDependencies: false,
        collectionName: collection.name,
      },
    );
  }

  async function handleCollectionUninstallAll(collection) {
    if (!collection) {
      return;
    }

    const mods = Array.isArray(collection.mods) ? collection.mods : [];
    if (!mods.length) {
      showToast('This collection has no mods yet.', 'info');
      return;
    }

    if (!selectedProfileId) {
      showToast('Select a profile before uninstalling collection mods.', 'error');
      return;
    }

    const targetIds = new Set(mods.map((entry) => String(entry.modId))); 
    const installedRecords = modRecords.filter(
      (record) => record.profileId === selectedProfileId
        && record.installedPath
        && targetIds.has(record.modId),
    );

    if (!installedRecords.length) {
      showToast('No installed mods from this collection were found.', 'info');
      return;
    }

    for (const record of installedRecords) {
      // eslint-disable-next-line no-await-in-loop
      await handleSubscriptionUninstall(record);
    }

    showToast(`Started uninstalling ${installedRecords.length} mod${installedRecords.length === 1 ? '' : 's'}.`, 'info', {
      duration: 5000,
    });
  }

  function openCollectionAssignModal(mod) {
    if (!selectedProfileId) {
      showToast('Select a profile before managing collections.', 'error');
      return;
    }

    if (!mod) {
      showToast('Unable to add this mod to a collection.', 'error');
      return;
    }

    const entry = normalizeCollectionModEntry(mod);
    if (!entry) {
      showToast('Unable to add this mod to a collection.', 'error');
      return;
    }

    const modShape = {
      ...mod,
      modId: entry.modId,
      title: entry.title || mod.title || entry.modId,
      author: entry.author || mod.author || '',
      previewUrl: entry.previewUrl || mod.previewUrl || '',
      previewUrls: mod.previewUrls ?? (entry.previewUrl ? [entry.previewUrl] : []),
      url: entry.workshopUrl || mod.url || mod.workshopUrl || '',
      stats: mod.stats ?? entry.stats ?? null,
      tags: Array.isArray(mod.tags) ? mod.tags : entry.tags ?? [],
    };

    setCollectionAssignState({
      isOpen: true,
      mod: modShape,
      selectedIds: getCollectionIdsContainingMod(entry.modId),
      newName: '',
      error: '',
    });
  }

  function closeCollectionAssignModal() {
    setCollectionAssignState({
      isOpen: false,
      mod: null,
      selectedIds: [],
      newName: '',
      error: '',
    });
  }

  function handleCollectionAssignToggle(collectionId) {
    setCollectionAssignState((prev) => {
      if (!prev.isOpen) {
        return prev;
      }

      const nextSelected = prev.selectedIds.includes(collectionId)
        ? prev.selectedIds.filter((id) => id !== collectionId)
        : [...prev.selectedIds, collectionId];

      return { ...prev, selectedIds: nextSelected, error: '' };
    });
  }

  function handleCollectionAssignNameChange(value) {
    setCollectionAssignState((prev) => ({ ...prev, newName: value, error: '' }));
  }

  function handleCollectionAssignSubmit() {
    const { mod, selectedIds, newName } = collectionAssignState;

    if (!mod) {
      return;
    }

    const trimmedName = newName.trim();
    const pendingIds = new Set(selectedIds);

    if (!pendingIds.size && !trimmedName) {
      setCollectionAssignState((prev) => ({ ...prev, error: 'Select an existing collection or enter a name to create one.' }));
      return;
    }

    let createdId = null;

    if (trimmedName) {
      const created = handleCreateCollection(trimmedName);
      if (!created?.id) {
        return;
      }
      createdId = created.id;
      pendingIds.add(createdId);
    }

    handleAddModToCollections(mod, Array.from(pendingIds));
    if (createdId) {
      setActiveCollectionId(createdId);
    }

    closeCollectionAssignModal();
  }

  function closeDependencyPrompt() {
    setDependencyPromptState(createDependencyPromptState());
  }

  function closeUninstallConfirm() {
    setUninstallConfirmState(createUninstallConfirmState());
  }

  async function handleUninstallConfirm() {
    if (!uninstallConfirmState.isOpen || !uninstallConfirmState.record) {
      return;
    }

    const record = uninstallConfirmState.record;
    closeUninstallConfirm();
    await handleSubscriptionUninstall(record);
  }

  function handleDependencyDecision(mode) {
    if (!dependencyPromptState.isOpen) {
      return;
    }

    const { mod, missing, options } = dependencyPromptState;
    closeDependencyPrompt();

    if (mode === 'cancel') {
      return;
    }

    if (mode === 'with-dependencies') {
      missing.forEach(({ requirement }) => {
        const dependencyMod = buildRequirementModShape(requirement);
        if (dependencyMod) {
          handleDownloadMod(dependencyMod, options ?? { silent: true, notify: true });
        }
      });
    }

    if (mod) {
      handleDownloadMod(mod, options ?? { silent: true, notify: true });
    }
  }

  function closeCollectionDependencyPrompt() {
    setCollectionDependencyPrompt({
      isOpen: false,
      collection: null,
      baseMods: [],
      dependencyMods: [],
    });
  }

  function queueCollectionDownloads(modShapes, { includeDependencies = false, collectionName = null } = {}) {
    const shapes = Array.isArray(modShapes) ? modShapes : [];
    const queuedIds = new Set();
    let queuedCount = 0;

    shapes.forEach((shape) => {
      if (!shape?.modId) {
        return;
      }

      const modId = String(shape.modId);
      if (queuedIds.has(modId)) {
        return;
      }

      queuedIds.add(modId);
      handleDownloadMod(shape, { silent: true, notify: true });
      queuedCount += 1;
    });

    if (queuedCount > 0) {
      const label = collectionName ? `"${collectionName}"` : 'the collection';
      const suffix = includeDependencies ? ' including required mods.' : '.';
      showToast(`Queued ${queuedCount} mod${queuedCount === 1 ? '' : 's'} from ${label}${suffix}`, 'info', {
        duration: 5000,
      });
    } else {
      showToast('No valid mods found to install for this collection.', 'info');
    }

    return queuedCount;
  }

  function handleCollectionDependencyDecision(mode) {
    if (!collectionDependencyPrompt.isOpen) {
      return;
    }

    const { baseMods, dependencyMods, collection } = collectionDependencyPrompt;
    closeCollectionDependencyPrompt();

    if (mode === 'cancel') {
      return;
    }

    const modsToQueue = [...baseMods];
    let includeDependencies = false;

    if (mode === 'with-dependencies') {
      includeDependencies = true;
      dependencyMods.forEach((modShape) => {
        modsToQueue.push(modShape);
      });
    }

    queueCollectionDownloads(modsToQueue, {
      includeDependencies,
      collectionName: collection?.name ?? null,
    });
  }

  function handleToggleCollectionTag(collectionId, tag) {
    const trimmed = String(tag ?? '').trim();
    if (!collectionId || !trimmed) {
      return;
    }

    let resultingTags = null;

    updateCollections((prev) => {
      const index = prev.findIndex((item) => item.id === collectionId);
      if (index === -1) {
        return prev;
      }

      const collection = prev[index];
      const currentTags = Array.isArray(collection.tags) ? collection.tags : [];
      const hasTag = currentTags.includes(trimmed);
      const nextTags = hasTag
        ? currentTags.filter((existing) => existing !== trimmed)
        : [...currentTags, trimmed];

      resultingTags = nextTags;

      const next = [...prev];
      next[index] = {
        ...collection,
        tags: nextTags,
        updatedAt: new Date().toISOString(),
      };
      return next;
    });

    if (resultingTags !== null) {
      setCollectionTagDrafts((prev) => ({
        ...prev,
        [collectionId]: resultingTags.join(', '),
      }));
    }
  }

  return (
    <div className="app-shell">
      <header className="app-nav">
        {showWindowControls && (
          <div className="app-window-bar">
            <div className="app-window-bar__drag-region" />
            <div className="app-window-controls">
              <button
                type="button"
                className="window-control-button"
                onClick={handleMinimizeWindow}
                title="Minimize"
                aria-label="Minimize window"
              >
                <FaMinus aria-hidden="true" />
              </button>
              <button
                type="button"
                className="window-control-button"
                onClick={handleToggleMaximizeWindow}
                title={windowIsMaximized ? 'Restore' : 'Maximize'}
                aria-label={windowIsMaximized ? 'Restore window' : 'Maximize window'}
              >
                {windowIsMaximized ? (
                  <FaWindowRestore aria-hidden="true" />
                ) : (
                  <FaWindowMaximize aria-hidden="true" />
                )}
              </button>
              <button
                type="button"
                className="window-control-button window-control-button--close"
                onClick={handleCloseWindow}
                title="Close"
                aria-label="Close window"
              >
                <FaTimes aria-hidden="true" />
              </button>
            </div>
          </div>
        )}

        <div className="app-nav__row">
        <div className="app-nav__brand">
          <FaFolderOpen aria-hidden="true" className="app-nav__brand-icon" />
          <span className="app-nav__brand-text">WORKSHOP MANAGER</span>
        </div>
        {activeView === 'browse' ? (
          <div className="app-nav__search">
            <form className="search-form app-nav__search-form" onSubmit={handleSearchSubmit}>
              <input
                type="search"
                className="steam-input search-form__input"
                placeholder="Search workshop by keyword, ID, or link"
                aria-label="Search workshop"
                autoComplete="off"
                value={browseSearchInput}
                onChange={handleSearchInputChange}
              />
              <button type="submit" className="steam-button search-form__button">
                <FaSearch aria-hidden="true" />
                <span>Search</span>
              </button>
            </form>
          </div>
        ) : (
          <div className="app-nav__spacer" />
        )}
        <div className="app-nav__actions">
          <select
            className="steam-input steam-input--select"
            value={selectedProfileId ?? ''}
            onChange={(event) => setSelectedProfileId(event.target.value)}
          >
            {profiles.length === 0 && <option value="">No Profiles</option>}
            {profiles.map((profile) => (
              <option key={profile.id} value={profile.id}>
                {profile.name ?? profile.appId}
              </option>
            ))}
          </select>
          <button
            className="steam-input header-button header-button--icon"
            type="button"
            aria-label="Manage profiles"
            onClick={() => openProfileManager(selectedProfile ?? null)}
          >
            <FaUser aria-hidden="true" />
          </button>
          <button
            className="steam-input header-button header-button--icon"
            type="button"
            aria-label="Open settings"
            onClick={openSettingsModal}
          >
            <FaCog aria-hidden="true" />
          </button>
          </div>
        </div>
      </header>

      <aside className="app-sidebar">
        <div className="sidebar-section">
          <div className="sidebar-section__title">
            <FaFolderOpen aria-hidden="true" className="sidebar-title-icon" />
            <span>{`${workshopTitle} Workshop`}</span>
          </div>
          <span
            className={`sidebar-link ${activeView === 'home' ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => handleViewChange('home')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleViewChange('home');
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <FaHome aria-hidden="true" className="sidebar-link__icon" />
            <span className="sidebar-link__label">Home</span>
          </span>
          <span
            className={`sidebar-link ${activeView === 'browse' ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => handleViewChange('browse')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleViewChange('browse');
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <FaThLarge aria-hidden="true" className="sidebar-link__icon" />
            <span className="sidebar-link__label">Browse</span>
          </span>
          <span
            className={`sidebar-link ${activeView === 'subscriptions' ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => handleViewChange('subscriptions')}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleViewChange('subscriptions');
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <FaBell aria-hidden="true" className="sidebar-link__icon" />
            <span className="sidebar-link__label">Subscriptions</span>
          </span>
        </div>

        <div className="sidebar-section">
          <div className="sidebar-section__title">
            <FaLayerGroup aria-hidden="true" className="sidebar-title-icon" />
            <span>{`${workshopTitle} Collections`}</span>
          </div>
          <span
            className={`sidebar-link ${activeView === 'collections' ? 'active' : ''}`}
            role="button"
            tabIndex={0}
            onClick={() => {
              handleViewChange('collections');
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                handleViewChange('collections');
              }
            }}
            style={{ cursor: 'pointer' }}
          >
            <FaSlidersH aria-hidden="true" className="sidebar-link__icon" />
            <span className="sidebar-link__label">Manage</span>
          </span>
          {collections.length === 0 && (
            <span className="sidebar-link sidebar-link--muted" style={{ cursor: 'default' }}>
              <span className="sidebar-link__label">No collections yet</span>
            </span>
          )}
          {collections.map((collection) => {
            const isActive = activeCollectionId === collection.id && (activeView === 'collections' || activeView === 'collection-detail');
            const modCount = Array.isArray(collection.mods) ? collection.mods.length : 0;
            return (
              <span
                key={collection.id}
                className={`sidebar-link ${isActive ? 'active' : ''}`}
                role="button"
                tabIndex={0}
                onClick={() => {
                  openCollectionDetail(collection.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    openCollectionDetail(collection.id);
                  }
                }}
                style={{ cursor: 'pointer' }}
              >
              <FaBookmark aria-hidden="true" className="sidebar-link__icon" />
              <span className="sidebar-link__label">{collection.name}</span>
                <span className="sidebar-link__count">{modCount}</span>
            </span>
            );
          })}
        </div>
      </aside>

      <main className="app-main">
        {renderBreadcrumbs()}
        <div key={`view-${activeView}-${viewTransitionKey}`} className="view-fade fade-container">
          {(() => {
            switch (activeView) {
              case 'home':
                return renderHomeView();
              case 'browse':
                return renderBrowseView();
              case 'subscriptions':
                return renderSubscriptionsView();
              case 'collections':
                return renderCollectionsView();
              case 'collection-detail':
                return renderCollectionDetailView();
              case 'mod-detail':
                return renderModDetailView();
              default:
                return renderSubscriptionsView();
            }
          })()}
        </div>

      </main>

      {collectionAssignState.isOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-panel collection-assign-modal">
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Add to Collections</div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  Select one or more collections for {collectionAssignState.mod?.title || collectionAssignState.mod?.modId || 'this mod'}.
                </div>
              </div>
              <button type="button" className="modal-close-button" onClick={closeCollectionAssignModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="collection-assign-modal__body">
              <div className="collection-assign-modal__summary">
                <div className="collection-assign-modal__title">{collectionAssignState.mod?.title || collectionAssignState.mod?.modId}</div>
                <div className="collection-assign-modal__meta">
                  <span>Mod ID: {collectionAssignState.mod?.modId}</span>
                  {collectionAssignState.mod?.author && <span>By {collectionAssignState.mod.author}</span>}
                </div>
              </div>
              <div className="collection-assign-modal__list">
                {collections.length === 0 ? (
                  <div className="collection-assign-modal__empty">No collections yet. Enter a name below to create one.</div>
                ) : (
                  collections.map((collection) => {
                    const isChecked = collectionAssignState.selectedIds.includes(collection.id);
                    const count = Array.isArray(collection.mods) ? collection.mods.length : 0;
                    return (
                      <label key={collection.id} className="collection-assign-modal__item">
                        <input
                          type="checkbox"
                          checked={isChecked}
                          onChange={() => handleCollectionAssignToggle(collection.id)}
                        />
                        <span className="collection-assign-modal__item-name">{collection.name}</span>
                        <span className="collection-assign-modal__item-count">{count} mod{count === 1 ? '' : 's'}</span>
                      </label>
                    );
                  })
                )}
              </div>
              <div className="collection-assign-modal__divider" aria-hidden="true" />
              <div className="collection-assign-modal__new">
                <label htmlFor="collection-assign-new" className="collection-assign-modal__label">Create New Collection</label>
                <input
                  id="collection-assign-new"
                  type="text"
                  className="steam-input"
                  placeholder="Collection name"
                  value={collectionAssignState.newName}
                  onChange={(event) => handleCollectionAssignNameChange(event.target.value)}
                />
              </div>
              {collectionAssignState.error && (
                <div className="collection-assign-modal__error">{collectionAssignState.error}</div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="steam-button" onClick={handleCollectionAssignSubmit}>
                Save
              </button>
              <button type="button" className="steam-button secondary" onClick={closeCollectionAssignModal}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {collectionDeletionConfirm.isOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-panel collection-delete-modal">
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Delete Collection</div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  This action will remove the collection but will not uninstall mods.
                </div>
              </div>
              <button type="button" className="modal-close-button" onClick={closeCollectionDeletionConfirm} aria-label="Close">
                ×
              </button>
            </div>
            <div className="collection-delete-modal__body">
              <p>
                Are you sure you want to delete the collection{' '}
                <strong>{collectionDeletionConfirm.collection?.name}</strong>?
              </p>
            </div>
            <div className="modal-footer">
              <button type="button" className="steam-button danger" onClick={handleConfirmDeleteCollection}>
                Delete Collection
              </button>
              <button type="button" className="steam-button secondary" onClick={closeCollectionDeletionConfirm}>
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {collectionDependencyPrompt.isOpen && (
        <div className="dependency-modal-overlay" role="dialog" aria-modal="true">
          <div className="dependency-modal">
            <div className="dependency-modal__header">
              <h3>Install Required Mods?</h3>
              <button
                type="button"
                className="dependency-modal__close"
                onClick={() => handleCollectionDependencyDecision('cancel')}
                aria-label="Close"
              >
                ×
              </button>
            </div>
            <div className="dependency-modal__content">
              <p>
                Some mods in {collectionDependencyPrompt.collection?.name ? `"${collectionDependencyPrompt.collection.name}"` : 'this collection'} require additional workshop items.
                Choose how you want to continue.
              </p>
              <div className="dependency-modal__list">
                <div className="dependency-modal__list-title">Collection Mods</div>
                <ul>
                  {collectionDependencyPrompt.baseMods.slice(0, 6).map((mod) => (
                    <li key={`collection-base-${mod.modId}`}>{mod.title || mod.modId}</li>
                  ))}
                  {collectionDependencyPrompt.baseMods.length > 6 && (
                    <li key="collection-base-more">+{collectionDependencyPrompt.baseMods.length - 6} more</li>
                  )}
                </ul>
              </div>
              <div className="dependency-modal__list dependency-modal__list--missing">
                <div className="dependency-modal__list-title">Missing Requirements</div>
                <ul>
                  {collectionDependencyPrompt.dependencyMods.slice(0, 6).map((mod) => (
                    <li key={`collection-dependency-${mod.modId}`}>{mod.title || mod.modId}</li>
                  ))}
                  {collectionDependencyPrompt.dependencyMods.length > 6 && (
                    <li key="collection-dependency-more">+{collectionDependencyPrompt.dependencyMods.length - 6} more</li>
                  )}
                </ul>
              </div>
            </div>
            <div className="dependency-modal__actions">
              <button
                type="button"
                className="steam-button"
                onClick={() => handleCollectionDependencyDecision('with-dependencies')}
              >
                Install with Required Mods
              </button>
              <button
                type="button"
                className="steam-button secondary"
                onClick={() => handleCollectionDependencyDecision('collection-only')}
              >
                Install Collection Only
              </button>
              <button
                type="button"
                className="steam-button secondary"
                onClick={() => handleCollectionDependencyDecision('cancel')}
              >
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}

      {collectionImportModal.isOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-panel collection-import-modal">
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Import Collection</div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>
                  {collectionImportModal.mode === 'steam'
                    ? 'Paste a Steam collection URL to import its mods.'
                    : 'Choose how you would like to import a collection.'}
                </div>
              </div>
              <button type="button" className="modal-close-button" onClick={closeCollectionImportModal} aria-label="Close">
                ×
              </button>
            </div>

            {collectionImportModal.mode === 'steam' ? (
              <div className="collection-import-modal__body">
                <label htmlFor="collection-import-url" className="collection-import-modal__label">
                  Steam Collection URL or ID
                </label>
                <input
                  id="collection-import-url"
                  type="text"
                  className="steam-input collection-import-modal__input"
                  placeholder="https://steamcommunity.com/sharedfiles/filedetails/?id=1234567890"
                  value={collectionImportModal.steamUrl}
                  onChange={(event) => handleImportModalUrlChange(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      handleSteamImportSubmit();
                    }
                  }}
                  disabled={collectionImportModal.loading}
                />
                <div className="collection-import-modal__hint">
                  The collection must be public so its contents can be fetched.
                </div>
                {collectionImportModal.error && (
                  <div className="collection-import-modal__error">{collectionImportModal.error}</div>
                )}
              </div>
            ) : (
              <div className="collection-import-modal__options">
                <button
                  type="button"
                  className="steam-button secondary collection-import-modal__option-button"
                  onClick={handleImportModalChooseFile}
                >
                  <span className="collection-import-modal__option-title">Import LWM Collection</span>
                  <span className="collection-import-modal__option-description">
                    Import a collection exported from Local Workshop Manager (.json).
                  </span>
                </button>
                <button
                  type="button"
                  className="steam-button collection-import-modal__option-button"
                  onClick={handleImportModalChooseSteam}
                >
                  <span className="collection-import-modal__option-title">Import from Steam</span>
                  <span className="collection-import-modal__option-description">
                    Paste a Steam collection link to clone its mod list.
                  </span>
                </button>
              </div>
            )}

            <div className="modal-footer">
              {collectionImportModal.mode === 'steam' ? (
                <>
                  <button
                    type="button"
                    className="steam-button"
                    onClick={handleSteamImportSubmit}
                    disabled={collectionImportModal.loading || !collectionImportModal.steamUrl.trim()}
                  >
                    {collectionImportModal.loading ? 'Importing…' : 'Import'}
                  </button>
                  <button
                    type="button"
                    className="steam-button secondary"
                    onClick={handleImportModalBack}
                    disabled={collectionImportModal.loading}
                  >
                    Back
                  </button>
                </>
              ) : (
                <button type="button" className="steam-button secondary" onClick={closeCollectionImportModal}>
                  Close
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {isProfileManagerOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Manage Game Profiles</div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>Configure Workshop targets for your non-Steam installs.</div>
              </div>
              <button type="button" className="modal-close-button" onClick={closeProfileManager} aria-label="Close">
                ×
              </button>
            </div>
            <div className="profile-manager">
              <div className="profile-manager__list">
                <button
                  type="button"
                  className="profile-manager__list-new"
                  onClick={handleProfileManagerNew}
                >
                  + New Profile
                </button>
                <div className="profile-manager__list-items">
                  {profiles.length === 0 && (
                    <div className="profile-manager__list-empty">
                      No profiles yet. Create one to get started.
                    </div>
                  )}
                  {profiles.map((profile) => {
                    const isActive = profileForm.id === profile.id && profileFormMode === 'edit';
                    return (
                      <button
                        type="button"
                        key={profile.id}
                        className={`profile-manager__item ${isActive ? 'active' : ''}`}
                        onClick={() => handleSelectProfileForEdit(profile.id)}
                      >
                        <div className="profile-manager__item-name">{profile.name || 'Untitled Profile'}</div>
                        <div className="profile-manager__item-sub">App ID: {profile.appId || '—'}</div>
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="profile-form">
                {profileAlert && <div className="form-alert">{profileAlert}</div>}
                <div className="form-field">
                  <label className="form-label" htmlFor="profile-name">Profile Name</label>
                  <input
                    id="profile-name"
                    className="steam-input"
                    value={profileForm.name}
                    onChange={(event) => handleProfileFieldChange('name', event.target.value)}
                    placeholder="Example: Skyrim - Mo2"
                  />
                  {profileFormErrors.name && <span className="form-error">{profileFormErrors.name}</span>}
                </div>

                <div className="form-row">
                  <div className="form-field">
                    <label className="form-label" htmlFor="profile-appid">Steam App ID</label>
                    <input
                      id="profile-appid"
                      className="steam-input"
                      value={profileForm.appId}
                      onChange={(event) => handleProfileFieldChange('appId', event.target.value)}
                      placeholder="Example: 489830"
                    />
                    {profileFormErrors.appId && <span className="form-error">{profileFormErrors.appId}</span>}
                  </div>
                  <div className="form-field">
                    <label className="form-label" htmlFor="profile-install-mode">Install Mode</label>
                    <select
                      id="profile-install-mode"
                      className="steam-input"
                      value={profileForm.installMode}
                      onChange={(event) => handleProfileFieldChange('installMode', event.target.value)}
                    >
                      {INSTALL_MODES.map((mode) => (
                        <option key={mode.value} value={mode.value}>
                          {mode.label}
                        </option>
                      ))}
                    </select>
                    {profileFormErrors.installMode && <span className="form-error">{profileFormErrors.installMode}</span>}
                  </div>
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="profile-modpath">Mod Install Folder</label>
                  <div className="path-picker">
                    <input
                      id="profile-modpath"
                      className="steam-input"
                      value={profileForm.modPath}
                      placeholder="C:\\Games\\MyModdedGame\\Mods"
                      onChange={(event) => handleProfileFieldChange('modPath', event.target.value)}
                    />
                    <button
                      type="button"
                      className="steam-button secondary path-picker__button"
                      onClick={() => handleChooseDirectory('modPath', 'Select Mod Install Folder')}
                    >
                      Browse…
                    </button>
                  </div>
                  {profileFormErrors.modPath && <span className="form-error">{profileFormErrors.modPath}</span>}
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="profile-steamcmd">SteamCMD Override (optional)</label>
                  <input
                    id="profile-steamcmd"
                    className="steam-input"
                    value={profileForm.steamcmdPath}
                    onChange={(event) => handleProfileFieldChange('steamcmdPath', event.target.value)}
                    placeholder="Full path to steamcmd.exe"
                  />
                </div>

                <div className="button-row">
                  <button
                    type="button"
                    className="steam-button"
                    onClick={handleProfileSave}
                    disabled={profileSubmitting}
                  >
                    {profileSubmitting ? 'Saving…' : profileFormMode === 'edit' ? 'Save Changes' : 'Create Profile'}
                  </button>
                  <button type="button" className="steam-button secondary" onClick={closeProfileManager}>
                    Cancel
                  </button>
                  {profileFormMode === 'edit' && profileForm.id && (
                    <button
                      type="button"
                      className="steam-button danger"
                      onClick={handleProfileDelete}
                      disabled={profileDeleting}
                    >
                      {profileDeleting ? 'Removing…' : 'Delete Profile'}
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

  {isTagPickerOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-panel tag-picker">
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Select a Tag</div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>Filters apply to the current browse results.</div>
              </div>
              <button type="button" className="modal-close-button" onClick={closeTagPicker} aria-label="Close">
                ×
              </button>
            </div>
            <div className="tag-picker__body">
              {availableTags.length > 0 ? (
                <div className="tag-picker__list">
                  {availableTags.map((tag) => (
                    <button
                      key={`tag-option-${tag.name}`}
                      type="button"
                      className="tag-picker__button"
                      onClick={() => handleBrowseTagSelect(tag.name)}
                    >
                      <span>{tag.name}</span>
                      <span className="tag-picker__count">{Number(tag.count ?? 0).toLocaleString()}</span>
                    </button>
                  ))}
                </div>
              ) : (
                <div className="tag-picker__empty">No tags available yet. Try again after loading workshop data.</div>
              )}
            </div>
            <div className="tag-picker__footer">
              {browseRequiredTag && (
                <button type="button" className="steam-button secondary" onClick={handleClearBrowseTag}>
                  Clear Tag
                </button>
              )}
              <button type="button" className="steam-button" onClick={closeTagPicker}>
                Close
              </button>
            </div>
          </div>
        </div>
      )}

      {isSettingsOpen && (
        <div className="modal-overlay" role="dialog" aria-modal="true">
          <div className="modal-panel">
            <div className="modal-header">
              <div>
                <div style={{ fontSize: 18, fontWeight: 600 }}>Application Settings</div>
                <div style={{ fontSize: 13, opacity: 0.7 }}>Configure Steam access, install preferences, and storage paths.</div>
              </div>
              <button type="button" className="modal-close-button" onClick={closeSettingsModal} aria-label="Close">
                ×
              </button>
            </div>
            <div className="profile-form">
              {settingsAlert && <div className="form-alert">{settingsAlert}</div>}

              <div className="form-field">
                <label className="form-label" htmlFor="settings-steam-api-key">Steam Web API Key</label>
                <input
                  id="settings-steam-api-key"
                  className="steam-input"
                  value={settingsForm.steamApiKey}
                  onChange={(event) => handleSettingsFieldChange('steamApiKey', event.target.value)}
                  placeholder="Enter your Steam Web API key"
                />
                <span className="form-helper">Required for workshop browsing. Generate at https://steamcommunity.com/dev/apikey.</span>
              </div>

              <div className="form-field">
                <label className="form-label" htmlFor="settings-steamcmd">SteamCMD Executable</label>
                <div className="path-picker">
                  <input
                    id="settings-steamcmd"
                    className="steam-input"
                    value={settingsForm.steamcmdPath}
                    onChange={(event) => handleSettingsFieldChange('steamcmdPath', event.target.value)}
                    placeholder="Select steamcmd.exe"
                  />
                  <button
                    type="button"
                    className="steam-button secondary path-picker__button"
                    onClick={() => handleSettingsFile('steamcmdPath', 'Select SteamCMD Executable', [{ name: 'Executables', extensions: ['exe', 'cmd', 'bat'] }])}
                  >
                    Browse…
                  </button>
                </div>
              </div>

              <div className="form-field">
                <label className="form-label" htmlFor="settings-appdir">App Data Directory</label>
                <div className="path-picker">
                  <input
                    id="settings-appdir"
                    className="steam-input"
                    value={settingsForm.appDataDir}
                    onChange={(event) => handleSettingsFieldChange('appDataDir', event.target.value)}
                    placeholder="Directory to store app data"
                  />
                  <button
                    type="button"
                    className="steam-button secondary path-picker__button"
                    onClick={() => handleSettingsDirectory('appDataDir', 'Select App Data Directory')}
                  >
                    Browse…
                  </button>
                </div>
              </div>

              <div className="form-row">
                <div className="form-field">
                  <label className="form-label" htmlFor="settings-install-mode">Default Install Mode</label>
                  <select
                    id="settings-install-mode"
                    className="steam-input"
                    value={settingsForm.defaultInstallMode}
                    onChange={(event) => handleSettingsFieldChange('defaultInstallMode', event.target.value)}
                  >
                    {INSTALL_MODES.map((mode) => (
                      <option key={mode.value} value={mode.value}>
                        {mode.label}
                      </option>
                    ))}
                  </select>
                  {settingsErrors.defaultInstallMode && <span className="form-error">{settingsErrors.defaultInstallMode}</span>}
                </div>

                <div className="form-field">
                  <label className="form-label" htmlFor="settings-concurrency">Max Concurrent Downloads</label>
                  <input
                    id="settings-concurrency"
                    className="steam-input"
                    type="number"
                    min={1}
                    value={settingsForm.concurrency}
                    onChange={(event) => handleSettingsFieldChange('concurrency', event.target.value)}
                  />
                  {settingsErrors.concurrency && <span className="form-error">{settingsErrors.concurrency}</span>}
                </div>
              </div>

              <div className="checkbox-field">
                <input
                  id="settings-update-checks"
                  type="checkbox"
                  checked={Boolean(settingsForm.enableUpdateChecks)}
                  onChange={(event) => handleSettingsCheckboxChange('enableUpdateChecks', event.target.checked)}
                />
                <label htmlFor="settings-update-checks" className="form-label" style={{ textTransform: 'none', letterSpacing: 0 }}>
                  Enable automatic update checks for installed mods
                </label>
              </div>

              <div className="button-row">
                <button
                  type="button"
                  className="steam-button"
                  onClick={handleSettingsSave}
                  disabled={settingsSubmitting}
                >
                  {settingsSubmitting ? 'Saving…' : 'Save Settings'}
                </button>
                <button type="button" className="steam-button secondary" onClick={closeSettingsModal}>
                  Cancel
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {isImageLightboxOpen && modDetailState.mod?.previewUrls?.length ? (
        <div
          className="image-lightbox"
          role="dialog"
          aria-modal="true"
          onClick={() => setIsImageLightboxOpen(false)}
        >
          <button
            type="button"
            className="image-lightbox__close"
            onClick={() => setIsImageLightboxOpen(false)}
            aria-label="Close image viewer"
          >
            ×
          </button>
          <div
            className="image-lightbox__body"
            onClick={(event) => {
              event.stopPropagation();
            }}
          >
            <img
              src={modDetailState.mod.previewUrls[lightboxImageIndex]}
              alt={modDetailState.mod.title || 'Mod preview'}
              referrerPolicy="no-referrer"
            />
          </div>
          {modDetailState.mod.previewUrls.length > 1 && (
            <div
              className="image-lightbox__nav"
              onClick={(event) => {
                event.stopPropagation();
              }}
            >
              <button
                type="button"
                className="image-lightbox__nav-button"
                onClick={() => setLightboxImageIndex((prev) => (prev - 1 + modDetailState.mod.previewUrls.length) % modDetailState.mod.previewUrls.length)}
                aria-label="Previous image"
              >
                ‹
              </button>
              <button
                type="button"
                className="image-lightbox__nav-button"
                onClick={() => setLightboxImageIndex((prev) => (prev + 1) % modDetailState.mod.previewUrls.length)}
                aria-label="Next image"
              >
                ›
              </button>
            </div>
          )}
        </div>
      ) : null}

      <aside
        className={`downloads-panel ${isDownloadsPanelOpen ? 'downloads-panel--open' : ''}`}
        aria-live="polite"
      >
        <div className="downloads-panel__header">
          <h3>Downloads</h3>
          <button
            type="button"
            className="downloads-panel__close"
            onClick={toggleDownloadsPanel}
            aria-label="Close downloads panel"
          >
            ×
          </button>
        </div>
        <div className="downloads-panel__content">
          {downloadJobsForProfile.length === 0 ? (
            <div className="downloads-panel__empty">No downloads in progress.</div>
          ) : (
            downloadJobsForProfile.map((job) => renderDownloadJobCard(job))
          )}
        </div>
      </aside>
      <div
        className={`downloads-panel__backdrop ${isDownloadsPanelOpen ? 'downloads-panel__backdrop--visible' : ''}`}
        onClick={() => setIsDownloadsPanelOpen(false)}
        role="presentation"
      />
      <div className="toast-container" aria-live="polite" role="status">
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={`toast toast--${toast.type ?? 'info'}${toast.exiting ? ' toast--exiting' : ''}`}
          >
            {toast.title && <div className="toast__title">{toast.title}</div>}
            {toast.message && <div className="toast__message">{toast.message}</div>}
            {toast.modName && <div className="toast__mod-name">{toast.modName}</div>}
          </div>
        ))}
      </div>
    </div>
  );
}
