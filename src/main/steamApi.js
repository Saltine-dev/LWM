const API_BASE_URL = 'https://api.steampowered.com';
const GET_PUBLISHED_FILE_DETAILS = `${API_BASE_URL}/ISteamRemoteStorage/GetPublishedFileDetails/v1/`;
const GET_DETAILS_URL = `${API_BASE_URL}/IPublishedFileService/GetDetails/v1/`;
const QUERY_FILES_URL = `${API_BASE_URL}/IPublishedFileService/QueryFiles/v1/`;
const GET_PLAYER_SUMMARIES = `${API_BASE_URL}/ISteamUser/GetPlayerSummaries/v2/`;

const COMMON_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) LocalWorkshopManager/1.0',
  Accept: 'application/json',
};

async function postForm(url, payload = {}) {
  const params = new URLSearchParams();

  Object.entries(payload).forEach(([key, value]) => {
    if (value === undefined || value === null) {
      return;
    }

    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item === undefined || item === null) {
          return;
        }
        params.append(key, String(item));
      });
      return;
    }

    params.append(key, String(value));
  });

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...COMMON_HEADERS,
      'Content-Type': 'application/x-www-form-urlencoded; charset=utf-8',
      Referer: 'https://steamcommunity.com/',
    },
    body: params.toString(),
    redirect: 'follow',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(
      `Steam request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`,
    );
  }

  return response.json();
}

function calculateScore(entry) {
  // Debug: log available fields
  const voteFields = ['score', 'vote_score', 'rating', 'vote_data', 'votes_up', 'votes_down', 'votesUp', 'votesDown'];
  const availableFields = voteFields.filter(field => entry[field] !== null && entry[field] !== undefined);
  if (availableFields.length > 0) {
    console.log(`[Score Debug] Available vote fields for mod ${entry.publishedfileid}:`, availableFields);
  }

  // Try direct score field first
  if (entry.score !== null && entry.score !== undefined) {
    console.log(`[Score Debug] Using direct score field: ${entry.score}`);
    return entry.score;
  }

  // Try vote_score field
  if (entry.vote_score !== null && entry.vote_score !== undefined) {
    console.log(`[Score Debug] Using vote_score field: ${entry.vote_score}`);
    return entry.vote_score;
  }

  // Try to calculate from vote_data
  if (entry.vote_data) {
    try {
      const voteData = typeof entry.vote_data === 'string' ? JSON.parse(entry.vote_data) : entry.vote_data;
      if (voteData && typeof voteData.score === 'number') {
        // Steam's vote_data.score is on a 0-1 scale, convert to 0-100
        const score = voteData.score <= 1 ? voteData.score * 100 : voteData.score;
        console.log(`[Score Debug] Using vote_data.score: ${voteData.score} -> ${score}%`);
        return score;
      }
      if (voteData && typeof voteData.votes_up === 'number' && typeof voteData.votes_down === 'number') {
        const total = voteData.votes_up + voteData.votes_down;
        if (total > 0) {
          const calculated = (voteData.votes_up / total) * 100;
          console.log(`[Score Debug] Calculated from vote_data: ${calculated} (${voteData.votes_up} up, ${voteData.votes_down} down)`);
          return calculated;
        }
      }
    } catch (error) {
      console.warn('[Score Debug] Failed to parse vote_data', error);
    }
  }

  // Try to calculate from votes_up and votes_down
  const votesUp = entry.votes_up ?? entry.votesUp ?? null;
  const votesDown = entry.votes_down ?? entry.votesDown ?? null;
  if (votesUp !== null && votesDown !== null && (votesUp + votesDown) > 0) {
    const calculated = ((votesUp / (votesUp + votesDown)) * 100);
    console.log(`[Score Debug] Calculated from votes_up/down: ${calculated} (${votesUp} up, ${votesDown} down)`);
    return calculated;
  }

  console.log(`[Score Debug] No score found for mod ${entry.publishedfileid}`);
  return null;
}

function extractScoreFromWorkshopPage(html) {
  if (!html || typeof html !== 'string') {
    return null;
  }

  // Try to find the workshop item data variable (g_rgWorkshopItem)
  const workshopItemMatch = html.match(/g_rgWorkshopItem\s*=\s*({[\s\S]*?});/);
  if (workshopItemMatch) {
    try {
      const workshopItem = JSON.parse(workshopItemMatch[1]);
      if (workshopItem && typeof workshopItem === 'object') {
        // Look for score in various locations
        const score = workshopItem.score ?? workshopItem.vote_score ?? workshopItem.rating ?? null;
        if (score !== null && typeof score === 'number') {
          console.log(`[Score Debug] Found score in g_rgWorkshopItem: ${score}`);
          return score;
        }
        // Try to calculate from votes
        const votesUp = workshopItem.votes_up ?? workshopItem.votesUp ?? null;
        const votesDown = workshopItem.votes_down ?? workshopItem.votesDown ?? null;
        if (votesUp !== null && votesDown !== null && (votesUp + votesDown) > 0) {
          const calculated = ((votesUp / (votesUp + votesDown)) * 100);
          console.log(`[Score Debug] Calculated from g_rgWorkshopItem votes: ${calculated} (${votesUp} up, ${votesDown} down)`);
          return calculated;
        }
      }
    } catch (error) {
      console.warn('[Score Debug] Failed to parse g_rgWorkshopItem', error);
    }
  }

  // Try to find vote_data in the page
  const voteDataMatch = html.match(/vote_data\s*[:=]\s*({[\s\S]*?});/i);
  if (voteDataMatch) {
    try {
      const voteData = JSON.parse(voteDataMatch[1]);
      if (voteData && typeof voteData === 'object') {
        if (voteData.score !== null && typeof voteData.score === 'number') {
          console.log(`[Score Debug] Found score in vote_data: ${voteData.score}`);
          return voteData.score;
        }
        if (voteData.votes_up !== null && voteData.votes_down !== null && (voteData.votes_up + voteData.votes_down) > 0) {
          const calculated = ((voteData.votes_up / (voteData.votes_up + voteData.votes_down)) * 100);
          console.log(`[Score Debug] Calculated from vote_data votes: ${calculated} (${voteData.votes_up} up, ${voteData.votes_down} down)`);
          return calculated;
        }
      }
    } catch (error) {
      console.warn('[Score Debug] Failed to parse vote_data', error);
    }
  }

  // Try to find the rating display in the HTML (Steam shows it as stars)
  // Look for data attributes or classes related to rating
  const ratingDisplayMatch = html.match(/data-rating["\s]*[:=]["\s]*(\d+(?:\.\d+)?)/i) ||
                            html.match(/rating["\s]*[:=]["\s]*(\d+(?:\.\d+)?)/i) ||
                            html.match(/vote.*score["\s]*[:=]["\s]*(\d+(?:\.\d+)?)/i);
  if (ratingDisplayMatch) {
    const rating = parseFloat(ratingDisplayMatch[1]);
    if (!isNaN(rating)) {
      console.log(`[Score Debug] Found rating in HTML: ${rating}`);
      // If it's a 0-5 scale, convert to 0-100
      if (rating <= 5) {
        return rating * 20;
      }
      return rating;
    }
  }

  // Try to extract from the workshop item's vote display
  // Steam often shows votes as "X% positive" or similar
  const positiveMatch = html.match(/(\d+(?:\.\d+)?)%\s*positive/i) ||
                       html.match(/(\d+(?:\.\d+)?)\s*%.*positive/i);
  if (positiveMatch) {
    const percentage = parseFloat(positiveMatch[1]);
    if (!isNaN(percentage)) {
      console.log(`[Score Debug] Found positive percentage: ${percentage}%`);
      return percentage;
    }
  }

  console.log('[Score Debug] No score found in workshop page HTML');
  return null;
}

function normalizeRequirementCandidates(requirementCandidates) {
  if (!Array.isArray(requirementCandidates) || requirementCandidates.length === 0) {
    return [];
  }

  const requirementsMap = new Map();

  requirementCandidates.forEach((rawItem) => {
    let item = rawItem;
    if (!item && item !== 0) return;

    if (typeof item === 'number' || (typeof item === 'string' && /^\d+$/.test(item.trim()))) {
      const appid = String(item).trim();
      item = { appid };
    }

    if (!item || typeof item !== 'object') {
      return;
    }

    const publishedId =
      item.publishedfileid ??
      item.publishedFileId ??
      item.publishedFileID ??
      item.fileid ??
      item.file_id ??
      item.itemid ??
      item.item_id ??
      null;

    const appIdOnly =
      item.appid ??
      item.required_appid ??
      item.consumer_appid ??
      item.creator_appid ??
      item.appId ??
      null;

    const normalizedAppId = appIdOnly ? String(appIdOnly) : null;

    if (publishedId) {
      const key = String(publishedId);
      if (!requirementsMap.has(key)) {
        requirementsMap.set(key, {
          id: key,
          kind: 'workshop',
          typeCode: item.filetype ?? item.type ?? null,
          typeLabel: mapRequirementTypeLabel(item),
          title:
            item.title ??
            item.name ??
            item.file_title ??
            item.item_title ??
            item.filename ??
            null,
          appId: normalizedAppId,
        });
      }
    }

    if (!publishedId && normalizedAppId) {
      const key = `app-${normalizedAppId}`;
      if (!requirementsMap.has(key)) {
        requirementsMap.set(key, {
          id: key,
          appId: normalizedAppId,
          kind: 'app',
          title: item.app_name ?? item.title ?? item.name ?? `App ${normalizedAppId}`,
          typeLabel: mapRequirementTypeLabel(item) ?? 'DLC',
        });
      }
    }
  });

  const requirements = Array.from(requirementsMap.values());
  requirements.sort((a, b) => {
    if (a.kind === b.kind) return 0;
    return a.kind === 'workshop' ? -1 : 1;
  });

  return requirements;
}

export async function fetchWorkshopPageJson(modId) {
  if (!modId) {
    throw new Error('modId is required');
  }

  const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(modId)}`;
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...COMMON_HEADERS,
      Referer: 'https://steamcommunity.com/',
    },
    redirect: 'follow',
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to fetch workshop page JSON: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
  }

  const pageText = await response.text();

  const extractStructure = (label) => {
    const regex = new RegExp(`${label}\\s*=\\s*([\\[{][\\s\\S]*?[\\]}])\\s*;`);
    const match = pageText.match(regex);
    if (!match || match.length < 2) {
      return null;
    }
    try {
      return JSON.parse(match[1]);
    } catch (error) {
      console.error('Failed to parse workshop page structure', label, error);
      return null;
    }
  };

  const toArray = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) {
      return value;
    }
    if (typeof value === 'object') {
      return Object.values(value);
    }
    return [];
  };

  const requiredItems = toArray(extractStructure('g_rgRequiredItems'));
  const children = toArray(extractStructure('g_rgChildrenPublishedFiles'));
  const collectionChildren = toArray(extractStructure('g_rgCollectionChildren'));
  const requiredApps = toArray(extractStructure('g_rgRequiredApps'));
  const requiredAppIDs = toArray(extractStructure('g_rgRequiredAppIDs'));

  return {
    requiredItems,
    children,
    collectionChildren,
    requiredApps,
    requiredAppIDs,
    rawHtml: pageText,
  };
}

async function fetchRequirementsFromWorkshopPage(modId) {
  try {
    const pageData = await fetchWorkshopPageJson(modId);

    const requiredDlcMatches = [];
    const dlcRegex = /<div class="requiredDLCItem"[\s\S]*?<a href="https:\/\/store\.steampowered\.com\/app\/(\d+)[^>]*>\s*(?:<img[^>]*>)?\s*<\/a>[\s\S]*?<span class="requiredDLCName">\s*<a[^>]*>([^<]+)<\/a>/gi;
    let dlcMatch;
    while ((dlcMatch = dlcRegex.exec(pageData.rawHtml)) !== null) {
      requiredDlcMatches.push({ appid: dlcMatch[1], name: dlcMatch[2] });
    }

    const candidates = [
      ...pageData.requiredItems,
      ...pageData.children,
      ...pageData.collectionChildren,
      ...pageData.requiredApps,
      ...pageData.requiredAppIDs,
      ...requiredDlcMatches,
    ];

    if (!candidates.length) {
      return [];
    }

    return normalizeRequirementCandidates(candidates);
  } catch (error) {
    console.error('Failed to fetch workshop page requirements', error);
    return [];
  }
}

async function fetchDetailsWithApiKey(modIds, apiKey) {
  if (!apiKey) {
    return null;
  }

  try {
    const params = new URLSearchParams({
      key: apiKey,
      language: '0',
      includechildren: '1',
      includerequireditems: '1',
      includeadditionalpreviews: '1',
      includemetadata: '1',
      includeappinfo: '1',
      includetags: '1',
      includekvtags: '1',
      includevotes: '1',
    });

    modIds.forEach((id, index) => {
      if (id !== undefined && id !== null && id !== '') {
        params.append(`publishedfileids[${index}]`, String(id));
      }
    });

    if (!params.has('publishedfileids[0]')) {
      return null;
    }

    const response = await fetch(`${GET_DETAILS_URL}?${params.toString()}`, {
      method: 'GET',
      headers: {
        ...COMMON_HEADERS,
        Referer: 'https://steamcommunity.com/',
      },
      redirect: 'follow',
    });

    if (!response.ok) {
      const text = await response.text().catch(() => '');
      throw new Error(`Steam API request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
    }

    const data = await response.json();
    return data?.response?.publishedfiledetails ?? null;
  } catch (error) {
    console.warn('IPublishedFileService/GetDetails request failed; falling back to legacy endpoint', error);
    return null;
  }
}

async function fetchDetailsFromLegacyApi(modIds) {
  const payload = {
    itemcount: modIds.length,
    includechildren: 1,
    includeadditionalpreviews: 1,
    includemetadata: 1,
    includeappinfo: 1,
    includetags: 1,
    includekvtags: 1,
    includerequireditems: 1,
  };

  modIds.forEach((id, index) => {
    payload[`publishedfileids[${index}]`] = id;
  });

  const data = await postForm(GET_PUBLISHED_FILE_DETAILS, payload);
  return data?.response?.publishedfiledetails ?? [];
}

async function loadPublishedFileDetails(modIds, apiKey) {
  if (!Array.isArray(modIds) || modIds.length === 0) {
    return [];
  }

  const withKey = await fetchDetailsWithApiKey(modIds, apiKey);
  if (withKey && withKey.length) {
    return withKey;
  }

  return fetchDetailsFromLegacyApi(modIds);
}

function collectPreviewUrls(entry) {
  const previews = new Set();

  if (entry.preview_url) {
    previews.add(entry.preview_url);
  }

  const previewUrl = entry.previewUrl || entry.previewurl;
  if (previewUrl) {
    previews.add(previewUrl);
  }

  const candidateArrays = [entry.previews, entry.additional_previews];

  candidateArrays.forEach((list) => {
    if (Array.isArray(list)) {
      list.forEach((item) => {
        const url = item?.url ?? item?.preview_url;
        if (url) {
          previews.add(url);
        }
      });
    }
  });

  return Array.from(previews);
}

function mapRequirementTypeLabel(item) {
  if (!item) {
    return null;
  }

  const fileType = Number(item.filetype ?? item.type);
  if (item.appid && !item.publishedfileid && !item.fileid) {
    return 'DLC';
  }

  switch (fileType) {
    case 0:
    case 2:
    case 4:
    case 5:
      return 'Workshop Item';
    case 9:
      return 'Collection';
    default:
      return item.publishedfileid || item.fileid ? 'Workshop Item' : null;
  }
}

function normalizeModDetails(entry) {
  if (!entry) return null;

  const previewUrls = collectPreviewUrls(entry).map((url) => {
    if (typeof url !== 'string') {
      return url;
    }
    const trimmed = url.trim();
    if (!trimmed) {
      return trimmed;
    }
    if (trimmed.startsWith('http://')) {
      return `https://${trimmed.slice('http://'.length)}`;
    }
    return trimmed;
  });
  const tags = Array.isArray(entry.tags)
    ? entry.tags.map((tag) => (typeof tag === 'string' ? tag : tag.tag)).filter(Boolean)
    : [];

  const requirementCandidates = [];
  if (Array.isArray(entry.required_items)) {
    requirementCandidates.push(...entry.required_items);
  }
  if (Array.isArray(entry.dependencies)) {
    requirementCandidates.push(...entry.dependencies);
  }
  if (Array.isArray(entry.children)) {
    entry.children.forEach((child) => {
      if (!child) return;
      requirementCandidates.push(child);
    });
  }
  if (Array.isArray(entry.required_appids)) {
    requirementCandidates.push(...entry.required_appids);
  }
  if (Array.isArray(entry.required_apps)) {
    requirementCandidates.push(...entry.required_apps);
  }
  if (entry.required_appid) {
    requirementCandidates.push(entry.required_appid);
  }
  const requirements = normalizeRequirementCandidates(requirementCandidates);

  const creatorCandidates = [
    entry.creator_steamid,
    entry.creator,
    entry.owner,
    entry.creatorid,
  ]
    .map((value) => {
      if (value === undefined || value === null) return null;
      const str = String(value).trim();
      return str.length ? str : null;
    })
    .filter(Boolean);

  const authorId = creatorCandidates[0] ?? null;

  const authorNameCandidate =
    entry.creator_name ??
    entry.ownername ??
    entry.creator_name_english ??
    entry.owner ??
    null;

  return {
    modId: String(entry.publishedfileid ?? ''),
    appId: entry.consumer_appid ?? entry.appid ?? entry.creator_appid ?? null,
    title: entry.title ?? entry.name ?? entry.file_title ?? entry.filename ?? 'Untitled Mod',
    description: entry.file_description ?? entry.description ?? entry.short_description ?? entry.overview ?? '',
    shortDescription: entry.short_description ?? entry.description ?? entry.overview ?? '',
    authorId,
    author:
      authorNameCandidate ??
      entry.creator ??
      entry.owner ??
      entry.creator_appid ??
      '',
    previewUrl: previewUrls[0] ?? '',
    previewUrls,
    fileSizeBytes: entry.file_size ?? entry.file_size_bytes ?? entry.size ?? null,
    fileCount: entry.filecount ?? entry.childcount ?? entry.children?.length ?? 0,
    timeCreated: entry.time_created ?? entry.timecreated,
    timeUpdated: entry.time_updated ?? entry.timeupdated,
    tags,
    visibility: entry.visibility,
    language: entry.language,
    banned: Boolean(entry.banned),
    banReason: entry.ban_reason ?? '',
    url: entry.file_url ?? '',
    requirements,
    stats: {
      score: calculateScore(entry) ?? null,
      subscriptions: entry.subscriptions ?? entry.lifetime_subscriptions ?? null,
      favorites: entry.favorited ?? entry.lifetime_favorited ?? null,
      followers: entry.followers ?? entry.lifetime_followers ?? null,
      views: entry.views ?? entry.lifetime_unique_visitors ?? null,
    },
  };
}

export async function fetchModDetails(modId, { apiKey, appId } = {}) {
  if (!modId) {
    throw new Error('modId is required');
  }

  const [details] = await loadPublishedFileDetails([modId], apiKey);

  if (!details) {
    throw new Error(`No details returned for mod ${modId}`);
  }

  if (details.result !== 1) {
    throw new Error(`Steam API returned error for mod ${modId}: ${details.result}`);
  }

  let mod = normalizeModDetails(details);

  // If score is missing, try to get it from the workshop page
  if (!mod.stats?.score) {
    try {
      const pageData = await fetchWorkshopPageJson(mod.modId);
      const score = extractScoreFromWorkshopPage(pageData.rawHtml);
      if (score !== null) {
        mod = {
          ...mod,
          stats: {
            ...mod.stats,
            score,
          },
        };
      }
    } catch (error) {
      console.warn('Failed to extract score from workshop page', error);
    }
  }

  if (!mod.requirements.length) {
    const fallbackRequirements = await fetchRequirementsFromWorkshopPage(mod.modId);
    if (fallbackRequirements.length) {
      mod = {
        ...mod,
        requirements: fallbackRequirements,
      };
    }
  }

  return mod;
}

export async function fetchRawModDetails(modId) {
  if (!modId) {
    throw new Error('modId is required');
  }

  const payload = {
    itemcount: 1,
    'publishedfileids[0]': modId,
    includechildren: 1,
    includeadditionalpreviews: 1,
    includemetadata: 1,
    includeappinfo: 1,
    includetags: 1,
    includekvtags: 1,
    includerequireditems: 1,
  };

  const data = await postForm(GET_PUBLISHED_FILE_DETAILS, payload);
  const details = data?.response?.publishedfiledetails?.[0];

  if (!details) {
    throw new Error(`No details returned for mod ${modId}`);
  }

  if (details.result !== 1) {
    throw new Error(`Steam API returned error for mod ${modId}: ${details.result}`);
  }

  return details;
}

export async function fetchMultipleModDetails(modIds, { apiKey, appId } = {}) {
  if (!Array.isArray(modIds) || modIds.length === 0) {
    return [];
  }

  const details = await loadPublishedFileDetails(modIds, apiKey);
  return Promise.all(
    details
      .filter((entry) => entry.result === 1)
      .map(async (entry) => {
        const mod = normalizeModDetails(entry);
        const fallbackRequirements = await fetchRequirementsFromWorkshopPage(mod.modId);
        if (fallbackRequirements.length) {
          return {
            ...mod,
            requirements: fallbackRequirements,
          };
        }

        return mod;
      }),
  );
}

export async function fetchCollectionDetails(collectionId) {
  if (!collectionId) {
    throw new Error('collectionId is required');
  }

  const endpoint = `${API_BASE_URL}/ISteamRemoteStorage/GetCollectionDetails/v1/`;
  const payload = {
    collectioncount: 1,
    'publishedfileids[0]': collectionId,
  };

  const data = await postForm(endpoint, payload);
  const details = data?.response?.collectiondetails?.[0];

  if (!details) {
    throw new Error(`No collection details returned for ${collectionId}`);
  }

  if (details.result !== 1) {
    throw new Error(`Steam API returned error for collection ${collectionId}: ${details.result}`);
  }

  return {
    collectionId: String(collectionId),
    items: details.children?.map((child) => ({
      fileId: child.publishedfileid,
      type: child.filetype,
    })) ?? [],
  };
}

export async function fetchPlayerSummaries(steamIds = [], apiKey) {
  if (!Array.isArray(steamIds) || steamIds.length === 0) {
    return [];
  }

  if (!apiKey) {
    throw new Error('Steam Web API key is required to resolve author names. Add your key in settings.');
  }

  const uniqueIds = Array.from(new Set(steamIds.filter(Boolean).map((id) => String(id).trim())));
  if (uniqueIds.length === 0) {
    return [];
  }

  const params = new URLSearchParams({
    key: apiKey,
    steamids: uniqueIds.join(','),
  });

  const response = await fetch(`${GET_PLAYER_SUMMARIES}?${params.toString()}`, {
    method: 'GET',
    headers: COMMON_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Steam API request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
  }

  const data = await response.json();
  return data?.response?.players ?? [];
}

export async function queryWorkshopFiles({
  appId,
  cursor = '*',
  page = 1,
  pageSize = 30,
  searchText = '',
  requiredTags = [],
  excludedTags = [],
  sort = 'trend',
  queryType = 0,
  days,
  daysRange,
  section = 'readytouseitems',
  actualSort,
  publishedFileIds = [],
  apiKey,
}) {
  if (!appId && (!Array.isArray(publishedFileIds) || publishedFileIds.length === 0)) {
    throw new Error('Either appId or publishedFileIds are required to query workshop files');
  }

  if (!apiKey) {
    throw new Error('Steam Web API key is required to browse workshop content. Add your key in settings.');
  }

  const payload = {
    key: apiKey,
    page,
    cursor,
    numperpage: pageSize,
    search_text: searchText,
    sortmethod: sort,
    query_type: queryType,
    return_details: 1,
    return_tags: 1,
    return_kv_tags: 1,
    return_previews: 1,
    return_children: 1,
    return_short_description: 1,
    return_metadata: 1,
    return_vote_data: 1,
    return_for_game: 1,
    return_playtime_stats: 0,
    strip_description_bbcode: 1,
    language: 0,
    section,
    actualsort: actualSort ?? sort,
  };

  if (Array.isArray(publishedFileIds) && publishedFileIds.length > 0) {
    publishedFileIds.forEach((id, index) => {
      if (id !== undefined && id !== null && id !== '') {
        payload[`publishedfileids[${index}]`] = String(id);
      }
    });
  }

  if (appId) {
    payload.appid = appId;
    payload.creator_appid = appId;
  }

  const hasExplicitDays = typeof days === 'number' && !Number.isNaN(days);
  if (hasExplicitDays) {
    const normalizedDays = Math.floor(days);
    if (normalizedDays > 0) {
      payload.days = normalizedDays;
    }
  }

  if (Array.isArray(daysRange) && daysRange.length === 2) {
    const [startRaw, endRaw] = daysRange;
    const start = Math.max(0, Math.floor(Number(startRaw) || 0));
    const end = Math.max(start + 1, Math.floor(Number(endRaw) || 0));
    payload.days = end;
    payload.days_partner = start;
  }

  requiredTags.forEach((tag, index) => {
    payload[`requiredtags[${index}]`] = tag;
  });

  excludedTags.forEach((tag, index) => {
    payload[`excludedtags[${index}]`] = tag;
  });

  const params = new URLSearchParams();
  Object.entries(payload).forEach(([key, value]) => {
    if (Array.isArray(value)) {
      value.forEach((item) => {
        if (item !== undefined && item !== null) {
          params.append(key, String(item));
        }
      });
    } else if (value !== undefined && value !== null) {
      params.append(key, String(value));
    }
  });

  const requestUrl = `${QUERY_FILES_URL}?${params.toString()}`;
  const response = await fetch(requestUrl, {
    method: 'GET',
    headers: COMMON_HEADERS,
    redirect: 'follow',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Steam API request failed: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
  }

  const data = await response.json();
  const responseBody = data?.response ?? {};
  const details = responseBody.publishedfiledetails ?? [];
  const items = details.filter((entry) => entry?.result === 1).map(normalizeModDetails);
  const nextCursor = responseBody.next_cursor ?? null;
  const hasMore = Boolean(nextCursor && nextCursor !== '0');

  return {
    total: responseBody.total ?? items.length,
    items,
    nextCursor,
    hasMore,
    cursor,
    page,
  };
}

export async function fetchWorkshopTagTotals(appId, tags = [], apiKey) {
  if (!appId) {
    throw new Error('appId is required');
  }

  if (!Array.isArray(tags) || tags.length === 0) {
    return [];
  }

  if (!apiKey) {
    throw new Error('Steam Web API key is required to resolve tag totals. Add your key in settings.');
  }

  const uniqueTags = Array.from(
    new Set(
      tags
        .map((tag) => (typeof tag === 'string' ? tag.trim() : ''))
        .filter((tag) => tag.length > 0),
    ),
  );

  if (uniqueTags.length === 0) {
    return [];
  }

  const MAX_TAGS = 200;
  const MAX_CONCURRENCY = 4;
  const limitedTags = uniqueTags.slice(0, MAX_TAGS);
  const totalsMap = new Map();
  let nextIndex = 0;

  async function worker() {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const currentIndex = nextIndex;
      nextIndex += 1;
      if (currentIndex >= limitedTags.length) {
        break;
      }

      const tagName = limitedTags[currentIndex];

      try {
        const response = await queryWorkshopFiles({
          appId,
          pageSize: 1,
          sort: 'trend',
          actualSort: 'trend',
          queryType: 0,
          section: 'readytouseitems',
          requiredTags: [tagName],
          apiKey,
        });

        const totalRaw = response?.total;
        const total = Number.isFinite(totalRaw) ? totalRaw : Number(totalRaw ?? 0);
        totalsMap.set(tagName, Number.isFinite(total) ? total : 0);
      } catch (error) {
        console.warn('Failed to fetch total for tag', tagName, error);
        totalsMap.set(tagName, 0);
      }
    }
  }

  const workerCount = Math.min(MAX_CONCURRENCY, limitedTags.length);
  await Promise.all(Array.from({ length: workerCount }, () => worker()));

  return limitedTags.map((tagName) => ({
    name: tagName,
    count: totalsMap.get(tagName) ?? 0,
  }));
}

function escapeRegExp(str) {
  return String(str).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function decodeHtmlEntities(input) {
  if (!input) {
    return '';
  }

  return String(input)
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_match, hex) => {
      const code = Number.parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCharCode(code) : _match;
    })
    .replace(/&#(\d+);/g, (_match, num) => {
      const code = Number.parseInt(num, 10);
      return Number.isFinite(code) ? String.fromCharCode(code) : _match;
    });
}

function sanitizeChangeNoteHtml(html) {
  if (!html) {
    return '';
  }

  return String(html)
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<style[\s\S]*?<\/style>/gi, '')
    .replace(/\son[a-z]+=("[^"]*"|'[^']*'|[^\s>]+)/gi, '')
    .replace(/javascript:/gi, '');
}

function stripOuterElement(html, tagName = 'div') {
  if (!html) {
    return '';
  }

  const lowerTag = tagName.toLowerCase();
  const lowerHtml = html.toLowerCase();
  const openTag = `<${lowerTag}`;
  const closeTag = `</${lowerTag}>`;

  const firstOpen = lowerHtml.indexOf(openTag);
  if (firstOpen === -1) {
    return html;
  }

  const firstCloseBracket = html.indexOf('>', firstOpen);
  if (firstCloseBracket === -1) {
    return html;
  }

  const withoutOuterOpen = html.slice(firstCloseBracket + 1);
  const lastClose = withoutOuterOpen.toLowerCase().lastIndexOf(closeTag);
  if (lastClose === -1) {
    return withoutOuterOpen;
  }

  return withoutOuterOpen.slice(0, lastClose);
}

function extractDivBlock(html, startIndex) {
  const tagRegex = /<div[^>]*>|<\/div>/gi;
  tagRegex.lastIndex = startIndex;

  let depth = 0;
  let endIndex = html.length;
  let match;

  while ((match = tagRegex.exec(html)) !== null) {
    if (match.index < startIndex) {
      continue;
    }

    if (match[0][1] === '/') {
      depth -= 1;
      if (depth === 0) {
        endIndex = match.index + match[0].length;
        break;
      }
    } else {
      depth += 1;
    }
  }

  return html.slice(startIndex, endIndex);
}

function extractElementByClass(html, classNames) {
  const targetClasses = Array.isArray(classNames) ? classNames : [classNames];
  const pattern = targetClasses.map((cls) => escapeRegExp(cls)).join('|');
  const openingTagRegex = new RegExp(`<div[^>]*class=["'][^"']*(?:${pattern})[^"']*["'][^>]*>`, 'i');
  const match = openingTagRegex.exec(html);

  if (!match) {
    return '';
  }

  const start = match.index;
  const block = extractDivBlock(html, start);
  return stripOuterElement(block);
}

function normalizeWhitespace(text) {
  return String(text ?? '').replace(/\s+/g, ' ').trim();
}

function parseWorkshopHeadlineTimestamp(rawHeadline) {
  if (!rawHeadline) {
    return { title: '', timestamp: null };
  }

  const cleanedHeadline = normalizeWhitespace(rawHeadline);
  const withoutPrefix = cleanedHeadline.replace(/^update:\s*/i, '').trim();

  if (!withoutPrefix) {
    return { title: cleanedHeadline, timestamp: null };
  }

  const hasYear = /\d{4}/.test(withoutPrefix);
  const currentYear = new Date().getFullYear();
  let timestamp = null;

  if (withoutPrefix.includes('@')) {
    const [datePartRaw, timePartRaw] = withoutPrefix.split('@');
    const datePart = normalizeWhitespace(datePartRaw.replace(/,\s*$/u, ''));
    const timePart = normalizeWhitespace(timePartRaw);

    const dateWithYear = hasYear ? datePart : `${datePart}, ${currentYear}`;
    const normalizedTime = timePart.replace(/(am|pm)$/i, ' $1').toUpperCase();
    const parsedCandidate = new Date(`${dateWithYear} ${normalizedTime}`);
    if (!Number.isNaN(parsedCandidate.getTime())) {
      timestamp = parsedCandidate.toISOString();
    } else {
      const fallback = Date.parse(`${dateWithYear} ${normalizedTime}`);
      if (Number.isFinite(fallback)) {
        timestamp = new Date(fallback).toISOString();
      }
    }
  } else {
    const dateWithYear = hasYear ? withoutPrefix : `${withoutPrefix} ${currentYear}`;
    const parsed = new Date(dateWithYear);
    if (!Number.isNaN(parsed.getTime())) {
      timestamp = parsed.toISOString();
    } else {
      const fallback = Date.parse(dateWithYear);
      if (Number.isFinite(fallback)) {
        timestamp = new Date(fallback).toISOString();
      }
    }
  }

  return { title: cleanedHeadline, timestamp };
}

function extractAuthorFromHtml(authorHtml) {
  if (!authorHtml) {
    return '';
  }

  const text = normalizeWhitespace(authorHtml.replace(/<[^>]+>/g, ' '));
  return text.replace(/^by\s+/i, '').trim();
}

function extractBodyFromChangeLog(entryHtml) {
  if (!entryHtml) {
    return '';
  }

  let body = stripOuterElement(entryHtml);
  if (!body.trim()) {
    return '';
  }

  const removalPatterns = [
    /<div[^>]*class=["'][^"']*changelog[^"']*headline[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]*class=["'][^"']*headline[^"']*changelog[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]*class=["'][^"']*changelog[^"']*author[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]*class=["'][^"']*author[^"']*changelog[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
    /<div[^>]*style=["'][^"']*clear:[^"']*["'][^>]*><\/div>/gi,
    /<div[^>]*class=["'][^"']*commentslink[^"']*["'][^>]*>[\s\S]*?<\/div>/gi,
  ];

  removalPatterns.forEach((pattern) => {
    body = body.replace(pattern, '');
  });

  body = body.trim();

  if (!body) {
    const paragraphMatch = entryHtml.match(/<p[^>]*>[\s\S]*?<\/p>/i);
    body = paragraphMatch ? paragraphMatch[0] : '';
  }

  return sanitizeChangeNoteHtml(body).trim();
}

function extractChangeLogEntriesFromHtml(html) {
  if (!html) {
    return [];
  }

  const lowerHtml = html.toLowerCase();
  const entries = [];
  const announcementRegex = /<div[^>]*class=["'][^"']*workshopannouncement[^"']*["'][^>]*>/gi;
  let match;

  while ((match = announcementRegex.exec(lowerHtml)) !== null) {
    const start = match.index;
    const block = extractDivBlock(html, start);
    if (!block) {
      continue;
    }

    entries.push(block);
    announcementRegex.lastIndex = start + block.length;
  }

  const mapped = entries
    .map((entryHtml, index) => {
      if (!entryHtml) {
        return null;
      }

      const idMatch =
        entryHtml.match(/data-?announcementid=["']?(\d+)/i)
        || entryHtml.match(/id=["']?workshopannouncement_(\d+)/i)
        || entryHtml.match(/<p[^>]*id=["']?(\d+)/i);
      const timestampMatch = entryHtml.match(/data-timestamp=["']?(\d+)/i);
      const titleHtml = extractElementByClass(entryHtml, [
        'workshopAnnouncementTitle',
        'workshopannouncementtitle',
        'changelog headline',
        'headline changelog',
      ]);
      const authorHtml = extractElementByClass(entryHtml, [
        'workshopAnnouncementAuthor',
        'workshopannouncementauthor',
        'changelog author',
        'author changelog',
      ]);

      const { title: headlineText, timestamp: parsedTimestamp } = parseWorkshopHeadlineTimestamp(
        decodeHtmlEntities(titleHtml.replace(/<[^>]+>/g, ' ')),
      );
      const author = decodeHtmlEntities(extractAuthorFromHtml(authorHtml));

      let timestampSeconds = null;
      let timestampIso = parsedTimestamp ?? null;

      if (timestampMatch) {
        const numeric = Number.parseInt(timestampMatch[1], 10);
        if (Number.isFinite(numeric)) {
          timestampSeconds = numeric;
          timestampIso = new Date(numeric * 1000).toISOString();
        }
      }

      if (!Number.isFinite(timestampSeconds) && timestampIso) {
        const derived = Math.floor(Date.parse(timestampIso) / 1000);
        if (Number.isFinite(derived)) {
          timestampSeconds = derived;
        }
      }

      return {
        id: idMatch?.[1] ?? `${index}`,
        timestamp: timestampIso,
        timestampSeconds: Number.isFinite(timestampSeconds) ? timestampSeconds : null,
        title: headlineText,
        author,
        bodyHtml: extractBodyFromChangeLog(entryHtml),
      };
    })
    .filter((item) => item && (item.title || item.bodyHtml));

  mapped.sort((a, b) => {
    const timeA = a.timestampSeconds ?? 0;
    const timeB = b.timestampSeconds ?? 0;
    if (timeA === timeB) {
      return 0;
    }
    return timeB - timeA;
  });

  return mapped;
}

function extractChangeLogEntriesFromScript(html) {
  if (!html) {
    return null;
  }

  const scriptMatch = html.match(/g_rgChangeLog\s*=\s*(\[[\s\S]*?\]);/i);
  if (!scriptMatch) {
    return null;
  }

  try {
    const parsed = JSON.parse(scriptMatch[1]);
    if (!Array.isArray(parsed)) {
      return null;
    }

    const mapped = parsed
      .map((entry, index) => {
        if (!entry || typeof entry !== 'object') {
          return null;
        }

        const timestampSeconds = Number.parseInt(
          entry.posttime ?? entry.time ?? entry.timestamp ?? entry.date ?? entry.updated ?? entry.created ?? 0,
          10,
        );
        const idCandidate = entry.gid ?? entry.id ?? entry.announcementid ?? entry.postid ?? entry.changenumber;
        const bodyCandidate = entry.body ?? entry.text ?? entry.description ?? entry.contents ?? entry.html ?? '';
        const titleCandidate = entry.headline ?? entry.title ?? entry.name ?? '';

        const timestampIso = Number.isFinite(timestampSeconds) ? new Date(timestampSeconds * 1000).toISOString() : null;

        return {
          id: idCandidate ? String(idCandidate) : `${index}`,
          timestamp: timestampIso,
          timestampSeconds: Number.isFinite(timestampSeconds) ? timestampSeconds : null,
          title: decodeHtmlEntities(String(titleCandidate || '').trim()),
          author: decodeHtmlEntities(String(entry.author ?? entry.posted_by ?? '').trim()),
          bodyHtml: sanitizeChangeNoteHtml(String(bodyCandidate || '')).trim(),
        };
      })
      .filter((item) => item && (item.title || item.bodyHtml));

    mapped.sort((a, b) => {
      const timeA = a.timestampSeconds ?? 0;
      const timeB = b.timestampSeconds ?? 0;
      if (timeA === timeB) {
        return 0;
      }
      return timeB - timeA;
    });

    return mapped;
  } catch (error) {
    console.warn('Failed to parse change log script data', error);
    return null;
  }
}

async function fetchChangeNotesPage(modId, { language, page }) {
  const url = new URL(`https://steamcommunity.com/sharedfiles/filedetails/changelog/${encodeURIComponent(modId)}`);
  url.searchParams.set('insideModal', '1');
  url.searchParams.set('l', language);
  if (page > 1) {
    url.searchParams.set('p', String(page));
  }

  const response = await fetch(url.toString(), {
    method: 'GET',
    headers: {
      ...COMMON_HEADERS,
      Accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
      Referer: `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(modId)}`,
    },
    redirect: 'follow',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to fetch change notes: ${response.status} ${response.statusText}${text ? ` - ${text}` : ''}`);
  }

  const html = await response.text();
  const fromScript = extractChangeLogEntriesFromScript(html);
  if (fromScript?.length) {
    return {
      entries: fromScript,
      hasNext: false,
    };
  }

  const fromHtml = extractChangeLogEntriesFromHtml(html);
  const hasNext = /<a[^>]*class=["']pagebtn["'][^>]*>\s*&gt;/i.test(html);

  return {
    entries: fromHtml,
    hasNext,
  };
}

export async function fetchChangeNotes(modId, options = {}) {
  if (!modId) {
    throw new Error('modId is required');
  }

  const language = typeof options === 'object' && options !== null ? options.language ?? 'english' : 'english';
  const pageLimitRaw = typeof options === 'object' && options !== null ? options.pageLimit : null;
  const pageLimit = Number.isFinite(pageLimitRaw) && pageLimitRaw > 0 ? Math.min(20, Math.floor(pageLimitRaw)) : 10;

  const dedupe = new Map();
  const allEntries = [];

  for (let page = 1; page <= pageLimit; page += 1) {
    const { entries, hasNext } = await fetchChangeNotesPage(modId, { language, page });

    entries.forEach((entry) => {
      if (!entry) {
        return;
      }

      const key = entry.id ?? `${entry.timestamp ?? ''}-${entry.title ?? ''}`;
      if (!dedupe.has(key)) {
        dedupe.set(key, true);
        allEntries.push(entry);
      }
    });

    if (!hasNext || entries.length === 0) {
      break;
    }
  }

  allEntries.sort((a, b) => {
    const timeA = a.timestampSeconds ?? (a.timestamp ? Date.parse(a.timestamp) / 1000 : 0) ?? 0;
    const timeB = b.timestampSeconds ?? (b.timestamp ? Date.parse(b.timestamp) / 1000 : 0) ?? 0;

    if (timeA === timeB) {
      return 0;
    }

    return timeB - timeA;
  });

  return allEntries.slice(0, 500);
}

export async function fetchAppDetails(appId) {
  if (!appId) {
    throw new Error('appId is required');
  }

  const url = `https://store.steampowered.com/api/appdetails?appids=${encodeURIComponent(appId)}&cc=us&l=en`;

  const response = await fetch(url, {
    method: 'GET',
    headers: COMMON_HEADERS,
  });

  if (!response.ok) {
    throw new Error(`Failed to fetch app details (status ${response.status})`);
  }

  const json = await response.json();
  const entry = json?.[appId];
  if (!entry?.success || !entry?.data) {
    throw new Error('Steam returned no data for this app');
  }

  return entry.data;
}

function extractReviewSummary(json) {
  if (!json || typeof json !== 'object') {
    return null;
  }

  const summary = {
    reviewScore: json.review_score ?? null,
    reviewScoreDesc: json.review_score_desc ?? null,
    totalReviews: json.total_reviews ?? null,
    totalPositive: json.total_positive ?? null,
    totalNegative: json.total_negative ?? null,
  };

  const hasData = Object.values(summary).some((value) => value !== null && value !== undefined);
  return hasData ? summary : null;
}

export async function fetchAppReviewSummaries(appId) {
  if (!appId) {
    throw new Error('appId is required');
  }

  const base = `https://store.steampowered.com/appreviews/${encodeURIComponent(appId)}?json=1&purchase_type=all&language=english`;

  const [recentRes, englishRes] = await Promise.all([
    fetch(`${base}&filter=recent`, {
      method: 'GET',
      headers: COMMON_HEADERS,
    }),
    fetch(base, {
      method: 'GET',
      headers: COMMON_HEADERS,
    }),
  ]);

  const recentJson = recentRes.ok ? await recentRes.json() : null;
  const englishJson = englishRes.ok ? await englishRes.json() : null;

  return {
    recent: extractReviewSummary(recentJson),
    english: extractReviewSummary(englishJson),
  };
}

// Helper function to check if text looks like a date
function isDateText(text) {
  if (!text || typeof text !== 'string') return false;
  
  const trimmed = text.trim();
  // Check for common date patterns
  const datePatterns = [
    /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{1,2}/i, // "Oct 19"
    /^\d{1,2}\/\d{1,2}\/\d{2,4}/, // "10/19/2024"
    /@\s*\d{1,2}:\d{2}/i, // "@ 4:29pm"
    /&nbsp;/, // "&nbsp;"
    /^\d{1,2}:\d{2}\s*(am|pm)/i, // "4:29pm"
    /\d{1,2}:\d{2}\s*(am|pm)/i, // "4:29pm"
    /(today|yesterday|ago)/i,
    /\d{4}-\d{2}-\d{2}/, // "2024-10-19"
  ];
  
  return datePatterns.some(pattern => pattern.test(trimmed));
}

function parseCommentTimestamp(timestampStr) {
  if (!timestampStr) return null;
  try {
    const timestamp = parseInt(timestampStr, 10);
    if (!isNaN(timestamp) && timestamp > 0) {
      return timestamp * 1000; // Convert to milliseconds
    }
  } catch (error) {
    console.error('Failed to parse comment timestamp', error);
  }
  return null;
}

// Cache for storing total count from first page to use in pagination
const commentsCache = new Map();

export async function fetchWorkshopComments(modId, start = 0, count = 50) {
  if (!modId) {
    throw new Error('modId is required');
  }

  // Always use scraping from workshop page
  // For pagination, we'll need to use the API endpoint to get additional comments
  // But first try to get comments from the API endpoint for pagination
  if (start > 0) {
    // Try API endpoint first for pagination
    // Steam uses POST with form data for pagination
    // URL format: /comment/PublishedFile_Public/render/{userId}/{modId}/
    // userId can be 0 or any valid user ID - using 0 as placeholder
    const apiUrl = `https://steamcommunity.com/comment/PublishedFile_Public/render/0/${encodeURIComponent(modId)}/`;
    
    try {
      // Get cached total count from first page if available
      const cachedData = commentsCache.get(modId);
      const totalCountForRequest = cachedData?.totalCount || 0;
      
      // Create form data like Steam does
      // Extended data should include appid if available
      const formData = new URLSearchParams();
      formData.append('start', String(start));
      formData.append('count', String(count));
      formData.append('totalcount', String(totalCountForRequest));
      formData.append('extended_data', JSON.stringify({
        contributors: [],
        appid: null,
        sharedfile: {
          m_parentsDetails: null,
          m_parentBundlesDetails: null,
          m_bundledChildren: [],
          m_ownedBundledItems: [],
        },
        parent_item_reported: false,
      }));
      formData.append('feature2', '-1');
      
      console.log(`Requesting comments page ${start / count + 1} with start=${start}, count=${count}, totalcount=${totalCountForRequest}`);
      
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/142.0.0.0 Safari/537.36',
          'Accept': 'text/javascript, text/html, application/xml, text/xml, */*',
          'Accept-Language': 'en-US,en;q=0.7',
          'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
          'Referer': `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(modId)}`,
          'Origin': 'https://steamcommunity.com',
          'X-Requested-With': 'XMLHttpRequest',
          'X-Prototype-Version': '1.7',
          'Connection': 'keep-alive',
        },
        body: formData.toString(),
        redirect: 'follow',
        cache: 'no-store',
      });

      if (response.ok) {
        const responseText = await response.text();
        
        try {
          const data = JSON.parse(responseText);
          
          // Try to parse comments HTML even if success is false - sometimes Steam returns HTML anyway
          const commentsHtml = data.comments_html || data.html || '';
          const totalCount = data.total_count || data.totalCount || 0;
          
          if (commentsHtml && commentsHtml.length > 0) {
            const result = parseCommentsFromHtml(commentsHtml, totalCount, 0, count);
            console.log(`Parsed ${result.comments.length} comments from API for page ${start / count + 1} (success: ${data.success})`);
            return {
              comments: result.comments,
              totalCount: totalCount || result.totalCount,
              hasMore: (totalCount || result.totalCount) > start + result.comments.length,
              start,
              count,
            };
          }
          
          // If no HTML but success is true, check for error
          if (data.success === false || data.success === 0) {
            console.warn(`API returned success=false for page ${start / count + 1}, error:`, data.error);
          }
        } catch (error) {
          console.warn('Failed to parse comments API response as JSON, trying as HTML', error);
          // Maybe the response is HTML directly, not JSON
          const result = parseCommentsFromHtml(responseText, 0, 0, count);
          if (result.comments.length > 0) {
            console.log(`Parsed ${result.comments.length} comments from API HTML response`);
            return {
              comments: result.comments,
              totalCount: result.totalCount,
              hasMore: result.hasMore,
              start,
              count,
            };
          }
        }
      }
    } catch (error) {
      console.warn('API request failed, falling back to scraping', error);
    }
    
    // If API fails, we can't scrape additional pages, so return empty
    // The workshop page only shows the first batch of comments
    console.log(`Cannot scrape page ${start / count + 1}, API unavailable. Only first page is available via scraping.`);
    return { comments: [], totalCount: 0, hasMore: false, start, count };
  }

  // For first page, scrape from workshop page
  const url = `https://steamcommunity.com/sharedfiles/filedetails/?id=${encodeURIComponent(modId)}`;
  
  const response = await fetch(url, {
    method: 'GET',
    headers: {
      ...COMMON_HEADERS,
      Referer: 'https://steamcommunity.com/',
    },
    redirect: 'follow',
    cache: 'no-store',
  });

  if (!response.ok) {
    const text = await response.text().catch(() => '');
    throw new Error(`Failed to fetch workshop page: ${response.status} ${response.statusText}${text ? ` - ${text.substring(0, 100)}` : ''}`);
  }

  const pageHtml = await response.text();
  console.log(`Fetched workshop page HTML, length: ${pageHtml.length}`);
  
  // Try to extract comments data from embedded JavaScript variables
  let totalCount = 0;
  let commentsHtml = '';
  
  // Look for g_rgComments variable
  const commentsVarMatch = pageHtml.match(/var\s+g_rgComments\s*=\s*(\{[\s\S]*?\});/);
  if (commentsVarMatch && commentsVarMatch[1]) {
    try {
      const commentsData = JSON.parse(commentsVarMatch[1]);
      commentsHtml = commentsData.comments_html || commentsData.html || '';
      totalCount = commentsData.total_count || commentsData.totalCount || 0;
      console.log(`Found g_rgComments: commentsHtml length=${commentsHtml.length}, totalCount=${totalCount}`);
    } catch (error) {
      console.warn('Failed to parse g_rgComments variable', error);
    }
  }
  
  // If not found in JavaScript variables, extract comments section from HTML directly
  if (!commentsHtml) {
    // Look for comment blocks directly in the page
    const commentBlocksMatch = pageHtml.match(/<div[^>]*class="[^"]*commentthread_comment[^"]*"[^>]*>/gi);
    if (commentBlocksMatch && commentBlocksMatch.length > 0) {
      console.log(`Found ${commentBlocksMatch.length} comment blocks in HTML`);
      // Use the full page HTML for parsing - extractDivBlock will handle extraction
      commentsHtml = pageHtml;
    } else {
      console.log('No comment blocks found in HTML');
    }
  }
  
  // Try to extract total count from page if not found in JavaScript
  if (totalCount === 0) {
    const totalCountMatch = pageHtml.match(/total[_\s]*count["\s]*[:=]["\s]*(\d+)/i) || 
                            pageHtml.match(/comments?["\s]*[:=]["\s]*(\d+)/i);
    if (totalCountMatch) {
      totalCount = parseInt(totalCountMatch[1], 10);
      console.log(`Found total count in HTML: ${totalCount}`);
    }
    
    // Count comment blocks in HTML as fallback
    if (totalCount === 0 && commentsHtml) {
      const commentBlockMatches = commentsHtml.match(/<div[^>]*class="[^"]*commentthread_comment[^"]*"[^>]*>/gi);
      if (commentBlockMatches) {
        totalCount = commentBlockMatches.length;
        console.log(`Counted ${totalCount} comment blocks from HTML`);
      }
    }
  }
  
  // Parse comments from the HTML (use full page if commentsHtml is empty, as extractDivBlock will search it)
  const htmlToParse = commentsHtml || pageHtml;
  console.log(`Parsing comments from HTML, length: ${htmlToParse.length}`);
  const result = parseCommentsFromHtml(htmlToParse, totalCount, 0, 1000); // Parse all comments first
  console.log(`Parsed ${result.comments.length} comments`);
  
  // Cache the total count for pagination
  if (result.totalCount > 0) {
    commentsCache.set(modId, { totalCount: result.totalCount });
  }
  
  // Apply pagination by slicing the results
  const paginatedComments = result.comments.slice(start, start + count);
  const hasMore = result.totalCount > start + paginatedComments.length;
  
  return {
    comments: paginatedComments,
    totalCount: result.totalCount,
    hasMore,
    start,
    count,
  };
}

function parseCommentsFromHtml(html, totalCount, start = 0, count = 50) {
  if (!html || typeof html !== 'string') {
    return { comments: [], totalCount: totalCount || 0, hasMore: false };
  }

  const comments = [];
  
  // Find all comment block starts - look for individual comment divs (not containers)
  // Individual comments have id="comment_..." and class="commentthread_comment"
  // We need to exclude container divs like "commentthread_comment_container"
  
  // Pattern 1: Find divs with id="comment_..." (most reliable)
  const commentIdPattern = /<div[^>]*id="comment_\d+"[^>]*class="[^"]*commentthread_comment[^"]*"/gi;
  const commentStarts = [];
  let match;
  
  while ((match = commentIdPattern.exec(html)) !== null) {
    commentStarts.push(match.index);
  }
  
  // Pattern 2: If no comments found with id, try finding by class pattern that excludes containers
  if (commentStarts.length === 0) {
    const fallbackPattern = /<div[^>]*class="[^"]*commentthread_comment\s+responsive_body_text[^"]*"[^>]*>/gi;
    while ((match = fallbackPattern.exec(html)) !== null) {
      commentStarts.push(match.index);
    }
  }
  
  // Pattern 3: Last resort - find any div with commentthread_comment class that's not a container
  if (commentStarts.length === 0) {
    const lastResortPattern = /<div[^>]*class="[^"]*commentthread_comment(?![_a-z])[^"]*"[^>]*>/gi;
    while ((match = lastResortPattern.exec(html)) !== null) {
      // Exclude container divs
      if (!match[0].includes('commentthread_comment_container') && 
          !match[0].includes('commentthread_comments')) {
        commentStarts.push(match.index);
      }
    }
  }
  
  console.log(`Found ${commentStarts.length} comment divs to parse`);
  
  // Extract each comment block using extractDivBlock to properly handle nested divs
  for (let i = 0; i < commentStarts.length; i++) {
    const startIndex = commentStarts[i];
    // Use extractDivBlock to properly extract the entire comment block including nested divs
    const block = extractDivBlock(html, startIndex);
    
    if (!block) {
      continue;
    }
    
    try {
      // Extract timestamp - can be in data-timestamp attribute or embedded in data
      let timestamp = null;
      const timestampMatch = block.match(/data-timestamp="(\d+)"/i) || 
                            block.match(/data-timestamp\s*=\s*["']?(\d+)["']?/i) ||
                            block.match(/timestamp["\s]*[:=]["\s]*(\d+)/i);
      if (timestampMatch) {
        timestamp = parseInt(timestampMatch[1], 10) * 1000;
      }
      
      // Extract profile picture/avatar URL
      let avatarUrl = null;
      const avatarMatch = block.match(/<img[^>]*src="([^"]*steamstatic[^"]*\.jpg[^"]*)"[^>]*>/i) ||
                         block.match(/<img[^>]*src="([^"]*avatars[^"]*)"[^>]*>/i);
      if (avatarMatch) {
        avatarUrl = avatarMatch[1];
      }
      
      // Extract author ID and name - try multiple patterns
      let authorId = null;
      let authorName = '';
      
      // Pattern 1: Find profile link and extract the ID, then look for author name in nearby elements
      const profileLinkMatch = block.match(/href="https:\/\/steamcommunity\.com\/profiles\/(\d+)"[^>]*>/i) ||
                              block.match(/href="[^"]*\/profiles\/(\d+)"[^>]*>/i);
      if (profileLinkMatch) {
        authorId = profileLinkMatch[1];
      }
      
      // Pattern 2: Look for author name in commentthread_comment_author div with bdi tag
      const authorDivMatch = block.match(/<div[^>]*class="[^"]*commentthread_comment_author[^"]*"[^>]*>[\s\S]*?<a[^>]*class="[^"]*commentthread_author_link[^"]*"[^>]*>[\s\S]*?<bdi>([^<]+)<\/bdi>/i);
      if (authorDivMatch) {
        const candidate = (authorDivMatch[1] || '').trim();
        if (candidate && !isDateText(candidate)) {
          authorName = candidate;
        }
      }
      
      // Pattern 2b: Fallback - look for author name in commentthread_comment_author div without bdi
      if (!authorName) {
        const authorDivMatch2 = block.match(/<div[^>]*class="[^"]*commentthread_comment_author[^"]*"[^>]*>[\s\S]*?<a[^>]*>([^<]+)<\/a>/i);
        if (authorDivMatch2) {
          const candidate = (authorDivMatch2[1] || '').trim();
          if (candidate && !isDateText(candidate)) {
            authorName = candidate;
          }
        }
      }
      
      // Pattern 3: Look for author name in commentthread_comment_author section (common structure)
      if (!authorName) {
        // Extract the author section first
        const authorSectionMatch = block.match(/<div[^>]*class="[^"]*commentthread_comment_author[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (authorSectionMatch) {
          const authorSection = authorSectionMatch[1];
          // First try to find bdi tag (most reliable)
          const bdiMatch = authorSection.match(/<bdi>([^<]+)<\/bdi>/i);
          if (bdiMatch && bdiMatch[1]) {
            const candidate = bdiMatch[1].trim();
            if (candidate && !isDateText(candidate)) {
              authorName = candidate;
            }
          } else {
            // Fallback: Look for text in links or spans within the author section
            const nameInSection = authorSection.match(/<a[^>]*>([^<]+)<\/a>/i) ||
                                 authorSection.match(/<span[^>]*>([^<]+)<\/span>/i) ||
                                 authorSection.match(/>([^<]{2,})</i);
            if (nameInSection) {
              const candidate = nameInSection[1].trim();
              // Filter out URLs, image sources, dates, and other non-name text
              if (candidate && !candidate.includes('http') && !candidate.includes('src=') && 
                  !isDateText(candidate) && candidate.length > 1 && candidate.length < 100) {
                authorName = candidate;
              }
            }
          }
        }
      }
      
      // Pattern 4: Look for author name in a span or div after the profile link
      if (!authorName) {
        // Try to find text after the profile link closing tag
        const afterLinkMatch = block.match(/href="[^"]*\/profiles\/\d+"[^>]*>[\s\S]*?<\/a>[\s\S]{0,200}<[^>]+>([^<]{2,})<\/[^>]+>/i);
        if (afterLinkMatch) {
          const candidate = afterLinkMatch[1].trim();
          if (candidate && !candidate.includes('http') && !isDateText(candidate) && 
              candidate.length > 1 && candidate.length < 100) {
            authorName = candidate;
          }
        }
      }
      
      // Pattern 5: Look for author name in commentthread_author_link with bdi tag
      if (!authorName) {
        const authorLinkBdiMatch = block.match(/<a[^>]*class="[^"]*commentthread_author_link[^"]*"[^>]*>[\s\S]*?<bdi>([^<]+)<\/bdi>/i);
        if (authorLinkBdiMatch) {
          const candidate = (authorLinkBdiMatch[1] || '').trim();
          if (candidate && !isDateText(candidate)) {
            authorName = candidate;
          }
        }
      }
      
      // Pattern 5b: Look for author name in a link with profile URL that contains text or bdi
      if (!authorName) {
        // Find all links with profile URLs and check if they contain text (not just images)
        const profileLinks = block.match(/<a[^>]*href="[^"]*\/profiles\/\d+"[^>]*>([\s\S]*?)<\/a>/gi);
        if (profileLinks) {
          for (const link of profileLinks) {
            // First try to extract from bdi tag
            const bdiMatch = link.match(/<bdi>([^<]+)<\/bdi>/i);
            if (bdiMatch && bdiMatch[1]) {
              const candidate = bdiMatch[1].trim();
              if (candidate && !isDateText(candidate)) {
                authorName = candidate;
                break;
              }
            }
            // Fallback: extract text from the link, skipping images
            const textMatch = link.match(/<a[^>]*>([^<]+)<\/a>/i);
            if (textMatch && textMatch[1]) {
              const candidate = textMatch[1].trim();
              if (candidate && !candidate.includes('http') && !candidate.includes('src=') &&
                  !isDateText(candidate) && candidate.length > 1 && candidate.length < 100) {
                authorName = candidate;
                break;
              }
            }
          }
        }
      }
      
      // Pattern 5c: Look for author name in links with /id/ URLs that contain bdi
      if (!authorName) {
        const idLinks = block.match(/<a[^>]*href="[^"]*\/id\/[^"]*"[^>]*>([\s\S]*?)<\/a>/gi);
        if (idLinks) {
          for (const link of idLinks) {
            const bdiMatch = link.match(/<bdi>([^<]+)<\/bdi>/i);
            if (bdiMatch && bdiMatch[1]) {
              const candidate = bdiMatch[1].trim();
              if (candidate && !isDateText(candidate)) {
                authorName = candidate;
                break;
              }
            }
          }
        }
      }
      
      // Pattern 6: Look for author name near profile link (but filter out dates)
      if (!authorName && authorId) {
        // Extract a larger section around the profile link
        const profileIndex = block.indexOf(`/profiles/${authorId}`);
        if (profileIndex !== -1) {
          const sectionStart = Math.max(0, profileIndex - 100);
          const sectionEnd = Math.min(block.length, profileIndex + 500);
          const section = block.substring(sectionStart, sectionEnd);
          
          // Look for text in various HTML elements
          const textMatches = [
            section.match(/<a[^>]*>([^<]{2,})<\/a>/i),
            section.match(/<span[^>]*>([^<]{2,})<\/span>/i),
            section.match(/<div[^>]*>([^<]{2,})<\/div>/i),
          ].filter(Boolean);
          
          for (const textMatch of textMatches) {
            if (textMatch && textMatch[1]) {
              const candidate = textMatch[1].trim();
              if (candidate && !candidate.includes('http') && !candidate.includes('src=') &&
                  !candidate.includes('avatar') && !candidate.includes('steamstatic') &&
                  !isDateText(candidate) && candidate.length > 1 && candidate.length < 100) {
                authorName = candidate;
                break;
              }
            }
          }
        }
      }
      
      // Pattern 7: Profile link with username (fallback)
      if (!authorName) {
        const profileUsernameMatch = block.match(/href="[^"]*\/id\/([^"]+)"[^>]*>([^<]+)<\/a>/i);
        if (profileUsernameMatch) {
          authorId = profileUsernameMatch[1];
          const candidate = (profileUsernameMatch[2] || '').trim();
          if (!isDateText(candidate)) {
            authorName = candidate;
          }
        }
      }
      
      // Debug: log if we can't find author name
      if (!authorName && i < 3) {
        console.log(`Comment ${i}: Could not find author name. AuthorId: ${authorId}, Block length: ${block.length}, first 1000 chars:`, block.substring(0, 1000));
      }
      
      // Extract comment text/content - look for commentthread_comment_text div
      let content = '';
      
      // First try to extract the comment_text div block properly
      const textDivStartMatch = block.match(/<div[^>]*class="[^"]*commentthread_comment_text[^"]*"[^>]*>/i);
      if (textDivStartMatch) {
        const textStartIndex = textDivStartMatch.index;
        const textBlock = extractDivBlock(block, textStartIndex);
        if (textBlock) {
          // Strip the outer div to get just the content
          content = stripOuterElement(textBlock, 'div');
        }
      }
      
      // Fallback: try regex extraction with non-greedy match
      if (!content) {
        const textDivMatch = block.match(/<div[^>]*class="[^"]*commentthread_comment_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
        if (textDivMatch) {
          content = textDivMatch[1] || '';
        } else {
          // Fallback: look for any div with comment_text class
          const textAltMatch = block.match(/<div[^>]*class="[^"]*comment_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
          if (textAltMatch) {
            content = textAltMatch[1] || '';
          }
        }
      }
      
      // If still no content, try to find text after author section
      if (!content) {
        const afterAuthorMatch = block.match(/commentthread_comment_author[^>]*>[\s\S]*?<\/a>[\s\S]*?<div[^>]*>([\s\S]*?)<\/div>/i);
        if (afterAuthorMatch) {
          content = afterAuthorMatch[1] || '';
        }
      }
      
      // Last resort: try to find any text content between divs
      if (!content) {
        // Look for text between author link and any closing div
        const anyTextMatch = block.match(/<\/a>[\s\S]*?<div[^>]*>([\s\S]{10,}?)<\/div>/i);
        if (anyTextMatch) {
          content = anyTextMatch[1] || '';
        }
      }
      
      // Debug: log if we can't find content
      if (!content && i < 3) {
        console.log(`Comment ${i}: Could not find content. Author found: ${!!authorName}, block length: ${block.length}`);
      }
      
      if (!content || !authorName) {
        continue; // Skip if we don't have essential data
      }
      
      // Clean up HTML content but preserve line breaks
      let cleanedContent = decodeHtmlEntities(content);
      
      // Preserve line breaks from HTML elements
      cleanedContent = cleanedContent
        .replace(/<br\s*\/?>/gi, '\n')
        .replace(/<br[^>]*>/gi, '\n')
        .replace(/<p[^>]*>/gi, '\n')
        .replace(/<\/p>/gi, '')
        .replace(/<div[^>]*>/gi, '\n')
        .replace(/<\/div>/gi, '')
        .replace(/<span[^>]*>/gi, '')
        .replace(/<\/span>/gi, '')
        .replace(/<a[^>]*>/gi, '')
        .replace(/<\/a>/gi, '')
        .replace(/<img[^>]*>/gi, '')
        .replace(/<[^>]+>/g, '')
        .replace(/&nbsp;/g, ' ')
        .replace(/\n{3,}/g, '\n\n')
        .replace(/^\s+|\s+$/gm, '') // Trim each line
        .trim();
      
      if (cleanedContent) {
        // Check if we already have this comment (avoid duplicates)
        const isDuplicate = comments.some(
          (c) => c.authorId === authorId && 
                 c.authorName === authorName &&
                 c.content === cleanedContent
        );
        
        if (!isDuplicate) {
          comments.push({
            authorId: authorId || 'unknown',
            authorName: authorName,
            avatarUrl: avatarUrl,
            content: cleanedContent,
            contentHtml: content,
            timestamp: timestamp,
            date: timestamp ? new Date(timestamp).toISOString() : null,
          });
        }
      }
    } catch (error) {
      console.error('Error parsing comment block:', error);
      continue;
    }
  }

  const hasMore = totalCount > start + comments.length;

  return {
    comments,
    totalCount: totalCount || comments.length,
    hasMore,
    start,
    count,
  };
}

