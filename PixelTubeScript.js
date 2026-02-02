/**
 * PixelTube Grayjay Plugin
 *
 */

// =============================================================================
// CONSTANTS
// =============================================================================

/** Platform identifier */
const PLATFORM = "PixelTube";

/** Base URL for the PixelTube instance */
const BASE_URL = "https://pixeltube.org";

/** CDN URL for media files */
const CDN_URL = "https://cdn.pixeltube.org";

/** API endpoints (used for search and home feed only) */
const API_VIDEOS = "/api/videos";
const API_CHANNELS = "/api/channels";

/** Default page size for video listings */
const DEFAULT_VIDEO_LIMIT = 24;

/** Default page size for channel listings */
const DEFAULT_CHANNEL_LIMIT = 12;

/** URL patterns for content detection */
const VIDEO_URL_REGEX = /^https?:\/\/(www\.)?pixeltube\.org\/w\/([a-zA-Z0-9_-]+)/i;
const CHANNEL_URL_REGEX = /^https?:\/\/(www\.)?pixeltube\.org\/c\/([a-zA-Z0-9_-]+)/i;

/** Plugin logo URL (fallback) */
const PLUGIN_LOGO_URL = "https://stefancruz.github.io/grayjay-plugin-pixeltube/PixelTubeIcon.png";

/** HTTP headers for ActivityPub requests */
const ACTIVITYPUB_HEADERS = {
	"Accept": "application/activity+json"
};

/** Platform link patterns for channel social links detection */
const PLATFORM_LINK_PATTERNS = {
	"Patreon": ["patreon.com"],
	"Twitter": ["twitter.com", "x.com"],
	"YouTube": ["youtube.com", "youtu.be"],
	"Instagram": ["instagram.com"],
	"Facebook": ["facebook.com", "fb.com"],
	"Reddit": ["reddit.com"],
	"Discord": ["discord.gg", "discord.com"],
	"Twitch": ["twitch.tv"],
	"TikTok": ["tiktok.com"],
	"LinkedIn": ["linkedin.com"],
	"GitHub": ["github.com"],
	"Ko-fi": ["ko-fi.com"],
	"Buy Me a Coffee": ["buymeacoffee.com"],
	"Nebula": ["nebula.tv", "nebula.app"],
	"Floatplane": ["floatplane.com"],
	"Odysee": ["odysee.com"],
	"Rumble": ["rumble.com"],
	"BitChute": ["bitchute.com"],
	"Mastodon": ["mastodon", "mstdn."],
	"Threads": ["threads.net"],
	"Bluesky": ["bluesky", "bsky.app"],
	"Spotify": ["spotify.com"],
	"SoundCloud": ["soundcloud.com"],
	"Bandcamp": ["bandcamp.com"],
	"Apple Podcasts": ["apple.com/podcast", "podcasts.apple.com"],
	"Store": ["dftba.com", "store."],
	"Gumroad": ["gumroad.com"],
	"Substack": ["substack.com"],
	"Medium": ["medium.com"],
	"PayPal": ["paypal.com", "paypal.me"],
	"Venmo": ["venmo.com"],
	"Cash App": ["cashapp.com", "cash.app"],
	"Liberapay": ["liberapay.com"],
	"Open Collective": ["opencollective.com"]
};

// =============================================================================
// STATE
// =============================================================================

/** Plugin configuration */
let config = {};

// =============================================================================
// SOURCE FUNCTIONS
// =============================================================================

/**
 * Enables the plugin with the given configuration and settings.
 * Called when the plugin is loaded or settings are changed.
 *
 * @param {Object} conf - Plugin configuration object
 * @param {Object} settings - User settings object
 * @param {string|null} saveStateStr - Serialized saved state (unused)
 */
source.enable = function(conf, settings, saveStateStr) {
	config = conf || {};
	log("PixelTube plugin enabled");
};

/**
 * Returns the home feed with paginated video results.
 * Uses the custom API as ActivityPub doesn't provide a global feed.
 *
 * @returns {VideoPager} Pager containing home feed videos
 */
source.getHome = function() {
	return getVideoPagerFromAPI(1);
};

/**
 * Returns the search capabilities of this plugin.
 *
 * @returns {Object} Search capabilities object
 */
source.getSearchCapabilities = function() {
	return {
		types: [Type.Feed.Mixed],
		sorts: [],
		filters: []
	};
};

/**
 * Searches for videos matching the given query.
 * Uses the custom API as ActivityPub doesn't provide search.
 *
 * @param {string} query - Search query
 * @param {string|null} type - Content type filter (unused)
 * @param {string|null} order - Sort order (unused)
 * @param {Object|null} filters - Additional filters (unused)
 * @returns {VideoPager} Pager containing search results
 */
source.search = function(query, type, order, filters) {
	if (source.isContentDetailsUrl(query)) {
		try {
			return new ContentPager([source.getContentDetails(query)], false);
		} catch (e) {
			log("Error fetching video from URL, falling back to search: " + e);
		}
	}
	return getSearchVideoPagerFromAPI(query, 1);
};

/**
 * Searches for channels matching the given query.
 * Uses the custom API as ActivityPub doesn't provide search.
 *
 * @param {string} query - Search query
 * @returns {ChannelPager} Pager containing channel results
 */
source.searchChannels = function(query) {
	return getChannelPagerFromAPI(query, 1);
};

/**
 * Checks if the given URL is a video content URL.
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if this is a video URL
 */
source.isContentDetailsUrl = function(url) {
	return VIDEO_URL_REGEX.test(url);
};

/**
 * Gets detailed information about a video using ActivityPub.
 * Fetches video metadata, sources, channel info, and engagement counts.
 *
 * @param {string} url - Video URL
 * @returns {PlatformVideoDetails} Video details object
 * @throws {ScriptException} If video cannot be fetched or parsed
 */
source.getContentDetails = function(url) {
	let videoId = extractVideoId(url);
	if (!videoId) {
		throw new ScriptException("Invalid video URL: " + url);
	}

	let videoPageUrl = BASE_URL + "/w/" + videoId;

	// Fetch video data via ActivityPub
	let videoResponse = http.GET(videoPageUrl, ACTIVITYPUB_HEADERS, false);

	if (!videoResponse.isOk) {
		throw new ScriptException("Failed to fetch video: " + videoResponse.code);
	}

	let apVideo = JSON.parse(videoResponse.body);

	// Extract channel info from attributedTo
	let channelInfo = extractChannelFromAttributedTo(apVideo.attributedTo);
	let channelUsername = channelInfo.username;
	let channelActorUrl = channelInfo.actorUrl;

	// Fetch channel info and likes/dislikes counts in parallel
	let batchRequest = http.batch();
	let hasChannelRequest = false;
	let hasLikesRequest = false;
	let hasDislikesRequest = false;
	let hasAnyRequest = false;

	if (channelActorUrl) {
		batchRequest.GET(channelActorUrl, ACTIVITYPUB_HEADERS, false);
		hasChannelRequest = true;
		hasAnyRequest = true;
	}
	if (apVideo.likes) {
		batchRequest.GET(apVideo.likes, ACTIVITYPUB_HEADERS, false);
		hasLikesRequest = true;
		hasAnyRequest = true;
	}
	if (apVideo.dislikes) {
		batchRequest.GET(apVideo.dislikes, ACTIVITYPUB_HEADERS, false);
		hasDislikesRequest = true;
		hasAnyRequest = true;
	}

	let batchResponses = hasAnyRequest ? batchRequest.execute() : [];
	let channelIdx = hasChannelRequest ? 0 : -1;
	let likesIdx = hasLikesRequest ? (hasChannelRequest ? 1 : 0) : -1;
	let dislikesIdx = hasDislikesRequest ? (hasChannelRequest ? 1 : 0) + (hasLikesRequest ? 1 : 0) : -1;

	// Parse channel info
	let channelName = channelUsername || "Unknown Channel";
	let channelAvatar = PLUGIN_LOGO_URL;
	if (channelIdx >= 0 && batchResponses[channelIdx] && batchResponses[channelIdx].isOk) {
		try {
			let channelData = JSON.parse(batchResponses[channelIdx].body);
			channelName = channelData.name || channelData.preferredUsername || channelName;
			let channelIcons = asArray(channelData.icon);
			if (channelIcons.length > 0) {
				let iconCandidate = channelIcons[0].url || channelIcons[0];
				if (typeof iconCandidate === "string") {
					channelAvatar = iconCandidate;
				}
			}
		} catch (e) {
			log("Error parsing channel data: " + e);
		}
	}

	// Parse likes count
	let likesCount = 0;
	if (likesIdx >= 0 && batchResponses[likesIdx] && batchResponses[likesIdx].isOk) {
		try {
			let likesData = JSON.parse(batchResponses[likesIdx].body);
			likesCount = likesData.totalItems || 0;
		} catch (e) {
			log("Error parsing likes: " + e);
		}
	}

	// Parse dislikes count
	let dislikesCount = 0;
	if (dislikesIdx >= 0 && batchResponses[dislikesIdx] && batchResponses[dislikesIdx].isOk) {
		try {
			let dislikesData = JSON.parse(batchResponses[dislikesIdx].body);
			dislikesCount = dislikesData.totalItems || 0;
		} catch (e) {
			log("Error parsing dislikes: " + e);
		}
	}

	// Build video sources from ActivityPub url array
	let videoSources = extractVideoSources(apVideo);

	if (videoSources.length === 0) {
		throw new UnavailableException("No video sources found");
	}

	// Extract thumbnail
	let thumbnailUrl = CDN_URL + "/thumbnails/" + videoId + ".jpg";
	let icons = asArray(apVideo.icon);
	if (icons.length > 0) {
		let iconCandidate = icons[0].url || icons[0];
		if (typeof iconCandidate === "string") {
			thumbnailUrl = iconCandidate;
		}
	}

	// Build the result
	let channelIdValue = channelUsername || "unknown";
	let channelUrl = channelUsername ? (BASE_URL + "/c/" + channelUsername) : BASE_URL;

	let result = new PlatformVideoDetails({
		id: new PlatformID(PLATFORM, videoId, config.id),
		name: apVideo.name || "Untitled",
		thumbnails: new Thumbnails([new Thumbnail(thumbnailUrl, 0)]),
		author: new PlatformAuthorLink(
			new PlatformID(PLATFORM, channelIdValue, config.id),
			channelName,
			channelUrl,
			channelAvatar
		),
		datetime: parseISODate(apVideo.published),
		duration: parseISODuration(apVideo.duration),
		viewCount: apVideo.views || 0,
		url: videoPageUrl,
		isLive: false,
		description: apVideo.content || "",
		video: new VideoSourceDescriptor(videoSources),
		rating: new RatingLikesDislikes(likesCount, dislikesCount)
	});

	// Add content recommendations
	result.getContentRecommendations = function() {
		return source.getContentRecommendations(url, { 
			channelUsername: channelUsername,
			channelAvatar: channelAvatar,
			channelName: channelName
		});
	};

	return result;
};

/**
 * Gets content recommendations for a video using ActivityPub.
 * Returns other videos from the same channel via the outbox.
 *
 * @param {string} url - Video URL
 * @param {Object} videoData - Parsed video data with channelUsername
 * @returns {VideoPager} Pager containing recommended videos
 */
source.getContentRecommendations = function(url, videoData) {
	let channelUsername = videoData ? videoData.channelUsername : null;
	let channelAvatar = videoData ? videoData.channelAvatar : null;
	let channelName = videoData ? videoData.channelName : null;

	if (!channelUsername) {
		let videoId = extractVideoId(url);
		if (videoId) {
			try {
				let videoResponse = http.GET(BASE_URL + "/w/" + videoId, ACTIVITYPUB_HEADERS, false);
				if (videoResponse.isOk) {
					let apVideo = JSON.parse(videoResponse.body);
					channelUsername = extractChannelFromAttributedTo(apVideo.attributedTo).username;
				}
			} catch (e) {
				log("Error fetching video for recommendations: " + e);
			}
		}
	}

	if (channelUsername) {
		let pager = getChannelVideosPagerFromAP(channelUsername, null, channelAvatar, channelName);
		// Filter out current video
		let currentVideoId = extractVideoId(url);
		pager.results = pager.results.filter(function(v) {
			return v.id.value !== currentVideoId;
		});
		return pager;
	}

	return new VideoPager([], false);
};

/**
 * Checks if the given URL is a channel URL.
 *
 * @param {string} url - URL to check
 * @returns {boolean} True if this is a channel URL
 */
source.isChannelUrl = function(url) {
	return CHANNEL_URL_REGEX.test(url);
};

/**
 * Gets detailed information about a channel using ActivityPub.
 *
 * @param {string} url - Channel URL
 * @returns {PlatformChannel} Channel details object
 * @throws {ScriptException} If channel cannot be fetched
 */
source.getChannel = function(url) {
	let username = extractChannelUsername(url);
	if (!username) {
		throw new ScriptException("Invalid channel URL: " + url);
	}

	// Fetch channel data via ActivityPub
	// We speculatively fetch followers to parallelize requests
	let actorUrl = BASE_URL + "/actors/" + username;
	let speculativeFollowersUrl = actorUrl + "/followers";
	
	let batch = http.batch();
	batch.GET(actorUrl, ACTIVITYPUB_HEADERS, false);
	batch.GET(speculativeFollowersUrl, ACTIVITYPUB_HEADERS, false);
	let responses = batch.execute();

	let actorResponse = responses[0];
	let speculativeFollowersResponse = responses[1];

	if (!actorResponse || !actorResponse.isOk) {
		let code = actorResponse ? actorResponse.code : "unknown";
		throw new ScriptException("Failed to fetch channel: " + code);
	}

	let apActor = JSON.parse(actorResponse.body);

	// Extract avatar
	let avatar = PLUGIN_LOGO_URL;
	let icons = asArray(apActor.icon);
	if (icons.length > 0) {
		let iconCandidate = icons[0].url || icons[0];
		if (typeof iconCandidate === "string") {
			avatar = iconCandidate;
		}
	}

	// Extract banner
	let banner = "";
	let images = asArray(apActor.image);
	if (images.length > 0) {
		let imageCandidate = images[0].url || images[0];
		if (typeof imageCandidate === "string") {
			banner = imageCandidate;
		}
	}

	// Extract follower count from followers endpoint
	let followers = 0;
	if (apActor.followers) {
		let followersResponse = null;
		
		// Use speculative response if URL matches and it was successful
		// Compare case-insensitively to avoid double-fetching if server normalizes URL casing
		if (apActor.followers && speculativeFollowersUrl && 
			apActor.followers.toLowerCase() === speculativeFollowersUrl.toLowerCase() && 
			speculativeFollowersResponse && speculativeFollowersResponse.isOk) {
			followersResponse = speculativeFollowersResponse;
		} else {
			// Otherwise fetch the correct URL
			try {
				followersResponse = http.GET(apActor.followers, ACTIVITYPUB_HEADERS, false);
			} catch (e) {
				log("Error fetching followers count: " + e);
			}
		}

		if (followersResponse && followersResponse.isOk) {
			try {
				let followersData = JSON.parse(followersResponse.body);
				followers = followersData.totalItems || 0;
			} catch (e) {
				log("Error parsing followers data: " + e);
			}
		}
	}

	// Extract links from summary/description
	let links = extractLinksFromMarkdown(apActor.summary || "");

	// Also check support field for additional links
	if (apActor.support) {
		let supportLinks = extractLinksFromMarkdown(apActor.support);
		for (let key in supportLinks) {
			if (!links[key]) {
				links[key] = supportLinks[key];
			}
		}
	}

	return new PlatformChannel({
		id: new PlatformID(PLATFORM, username, config.id),
		name: apActor.name || apActor.preferredUsername || username,
		thumbnail: avatar,
		banner: banner,
		subscribers: followers,
		description: apActor.summary || "",
		url: BASE_URL + "/c/" + username,
		links: links
	});
};

/**
 * Gets the capabilities for channel content filtering.
 *
 * @returns {Object} Channel capabilities object
 */
source.getChannelCapabilities = function() {
	return {
		types: [Type.Feed.Videos],
		sorts: [],
		filters: []
	};
};

/**
 * Gets paginated video content from a channel using ActivityPub outbox.
 *
 * @param {string} url - Channel URL
 * @returns {VideoPager} Pager containing channel videos
 */
source.getChannelContents = function(url) {
	let username = extractChannelUsername(url);
	if (!username) {
		return new VideoPager([], false);
	}

	let actorUrl = BASE_URL + "/actors/" + username;
	let outboxUrl = BASE_URL + "/actors/" + username + "/outbox?page=true";

	let batch = http.batch();
	batch.GET(actorUrl, ACTIVITYPUB_HEADERS, false);
	batch.GET(outboxUrl, ACTIVITYPUB_HEADERS, false);
	let responses = batch.execute();

	let actorResponse = responses[0];
	let outboxResponse = responses[1];

	let avatar = null;
	let actorName = null;
	if (actorResponse && actorResponse.isOk) {
		try {
			let actor = JSON.parse(actorResponse.body);
			actorName = actor.name || actor.preferredUsername || username;
			let icons = asArray(actor.icon);
			if (icons.length > 0) {
				let iconCandidate = icons[0].url || icons[0];
				if (typeof iconCandidate === "string") {
					avatar = iconCandidate;
				}
			}
		} catch (e) {
			log("Error parsing channel avatar: " + e);
		}
	}

	if (outboxResponse && outboxResponse.isOk) {
		let parsed = parseOutboxResponse(outboxResponse.body, username, avatar, actorName);
		return new APChannelVideoPager(parsed.videos, parsed.hasMore, {
			username: username,
			nextPageUrl: parsed.nextPageUrl,
			avatar: avatar,
			name: actorName
		});
	}

	return new APChannelVideoPager([], false, { username: username, nextPageUrl: null, avatar: avatar, name: actorName });
};


// =============================================================================
// PAGER CLASSES
// =============================================================================

/**
 * Video pager for home feed and search results (API-based).
 */
class APIVideoPager extends VideoPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}

	nextPage() {
		let nextPageNum = (this.context.page || 1) + 1;
		if (this.context.search) {
			return getSearchVideoPagerFromAPI(this.context.search, nextPageNum);
		}
		return getVideoPagerFromAPI(nextPageNum);
	}
}

/**
 * Video pager for channel content (ActivityPub-based).
 */
class APChannelVideoPager extends VideoPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}

	nextPage() {
		return getChannelVideosPagerFromAP(this.context.username, this.context.nextPageUrl, this.context.avatar, this.context.name);
	}
}

/**
 * Channel pager for search results (API-based).
 */
class APIChannelPager extends ChannelPager {
	constructor(results, hasMore, context) {
		super(results, hasMore, context);
	}

	nextPage() {
		let nextPageNum = (this.context.page || 1) + 1;
		return getChannelPagerFromAPI(this.context.search, nextPageNum);
	}
}

// =============================================================================
// PAGER FACTORY FUNCTIONS (API)
// =============================================================================

/**
 * Creates a video pager for the home feed using the custom API.
 *
 * @param {number} page - Page number (1-indexed)
 * @returns {APIVideoPager} Video pager with results
 */
function getVideoPagerFromAPI(page) {
	let url = BASE_URL + API_VIDEOS + "?page=" + page + "&limit=" + DEFAULT_VIDEO_LIMIT;

	try {
		let response = http.GET(url, {}, false);
		if (!response.isOk) {
			log("Failed to fetch videos: " + response.code);
			return new APIVideoPager([], false, { page: page });
		}

		let data = JSON.parse(response.body);
		let videos = (data.videos || []).map(function(v) {
			return mapAPIVideoToResult(v);
		});

		let hasMore = (data.total || 0) > page * DEFAULT_VIDEO_LIMIT;
		return new APIVideoPager(videos, hasMore, { page: page });
	} catch (e) {
		log("Error fetching videos: " + e);
		return new APIVideoPager([], false, { page: page });
	}
}

/**
 * Creates a video pager for search results using the custom API.
 *
 * @param {string} query - Search query
 * @param {number} page - Page number (1-indexed)
 * @returns {APIVideoPager} Video pager with search results
 */
function getSearchVideoPagerFromAPI(query, page) {
	let url = BASE_URL + API_VIDEOS + "?page=" + page + "&limit=" + DEFAULT_VIDEO_LIMIT + "&search=" + encodeURIComponent(query);

	try {
		let response = http.GET(url, {}, false);
		if (!response.isOk) {
			log("Failed to search videos: " + response.code);
			return new APIVideoPager([], false, { page: page, search: query });
		}

		let data = JSON.parse(response.body);
		let videos = (data.videos || []).map(function(v) {
			return mapAPIVideoToResult(v);
		});

		let hasMore = (data.total || 0) > page * DEFAULT_VIDEO_LIMIT;
		return new APIVideoPager(videos, hasMore, { page: page, search: query });
	} catch (e) {
		log("Error searching videos: " + e);
		return new APIVideoPager([], false, { page: page, search: query });
	}
}

/**
 * Creates a channel pager for search results using the custom API.
 *
 * @param {string} query - Search query
 * @param {number} page - Page number (1-indexed)
 * @returns {APIChannelPager} Channel pager with results
 */
function getChannelPagerFromAPI(query, page) {
	let url = BASE_URL + API_CHANNELS + "?page=" + page + "&limit=" + DEFAULT_CHANNEL_LIMIT;
	if (query) {
		url += "&search=" + encodeURIComponent(query);
	}

	try {
		let response = http.GET(url, {}, false);
		if (!response.isOk) {
			log("Failed to fetch channels: " + response.code);
			return new APIChannelPager([], false, { page: page, search: query });
		}

		let data = JSON.parse(response.body);
		let channels = (data.channels || []).map(function(c) {
			return new PlatformAuthorLink(
				new PlatformID(PLATFORM, c.username, config.id),
				c.name,
				BASE_URL + "/c/" + c.username,
				c.avatar || PLUGIN_LOGO_URL,
				c.followers || 0
			);
		});

		let hasMore = (data.total || 0) > page * DEFAULT_CHANNEL_LIMIT;
		return new APIChannelPager(channels, hasMore, { page: page, search: query });
	} catch (e) {
		log("Error fetching channels: " + e);
		return new APIChannelPager([], false, { page: page, search: query });
	}
}

// =============================================================================
// PAGER FACTORY FUNCTIONS (ACTIVITYPUB)
// =============================================================================

/**
 * Parses an ActivityPub outbox response and extracts video objects.
 *
 * @param {string} responseBody - Raw JSON response body from outbox endpoint
 * @param {string} username - Channel username for building video URLs
 * @param {string|null} channelAvatar - Channel avatar URL for video author links
 * @returns {Object} Object with videos array, hasMore boolean, and nextPageUrl
 */
function parseOutboxResponse(responseBody, username, channelAvatar, channelName) {
	try {
		let data = JSON.parse(responseBody);
		let videos = [];

		// Extract videos from orderedItems (Create activities with Video objects)
		if (data.orderedItems) {
			for (let i = 0; i < data.orderedItems.length; i++) {
				let activity = data.orderedItems[i];
				if (!activity) continue;
				if (activity.type === "Create" && activity.object && activity.object.type === "Video") {
					let video = mapAPVideoToResult(activity.object, username, channelAvatar, channelName);
					if (video) {
						videos.push(video);
					}
				}
			}
		}

		return {
			videos: videos,
			hasMore: !!data.next,
			nextPageUrl: data.next || null
		};
	} catch (e) {
		log("Error parsing outbox response: " + e);
		return { videos: [], hasMore: false, nextPageUrl: null };
	}
}

/**
 * Creates a video pager for channel content using ActivityPub outbox.
 *
 * @param {string} username - Channel username
 * @param {string|null} pageUrl - URL for next page, or null for first page
 * @param {string|null} channelAvatar - URL of the channel avatar
 * @returns {APChannelVideoPager} Video pager with channel videos
 */
function getChannelVideosPagerFromAP(username, pageUrl, channelAvatar, channelName) {
	let url = pageUrl || (BASE_URL + "/actors/" + username + "/outbox?page=true");

	try {
		let response = http.GET(url, ACTIVITYPUB_HEADERS, false);
		if (!response.isOk) {
			log("Failed to fetch channel outbox: " + response.code);
			return new APChannelVideoPager([], false, { username: username, nextPageUrl: null, avatar: channelAvatar, name: channelName });
		}

		let parsed = parseOutboxResponse(response.body, username, channelAvatar, channelName);
		
		return new APChannelVideoPager(parsed.videos, parsed.hasMore, {
			username: username,
			nextPageUrl: parsed.nextPageUrl,
			avatar: channelAvatar,
			name: channelName
		});
	} catch (e) {
		log("Error fetching channel videos: " + e);
		return new APChannelVideoPager([], false, { username: username, nextPageUrl: null, avatar: channelAvatar, name: channelName });
	}
}

// =============================================================================
// UTILITY FUNCTIONS
// =============================================================================

/**
 * Ensures a value is an array.
 * 
 * According to the ActivityStreams 2.0 specification (Section 3.6), properties that take multiple values
 * MAY be represented as a single element if only one value is present. This behavior is inherited from JSON-LD.
 * This function standardizes access to fields like `icon`, `url`, and `attributedTo` to always return an array.
 * 
 * @see https://www.w3.org/TR/activitystreams-core/#jsonld
 * @param {any} value - The value to ensure is an array
 * @returns {any[]} The value as an array
 */
function asArray(value) {
	if (value === null || value === undefined) return [];
	if (Array.isArray(value)) return value;
	return [value];
}

/**
 * Extracts the video ID from a PixelTube video URL.
 *
 * @param {string} url - Video URL
 * @returns {string|null} Video ID or null if not found
 */
function extractVideoId(url) {
	let match = url.match(VIDEO_URL_REGEX);
	return match ? match[2] : null;
}

/**
 * Extracts the channel username from a PixelTube channel URL.
 *
 * @param {string} url - Channel URL
 * @returns {string|null} Channel username or null if not found
 */
function extractChannelUsername(url) {
	let match = url.match(CHANNEL_URL_REGEX);
	return match ? match[2] : null;
}

/**
 * Extracts channel info from ActivityPub attributedTo array.
 * Skips the mirror service actor and returns the actual channel.
 *
 * @param {Array} attributedTo - ActivityPub attributedTo array
 * @returns {Object} Object with username and actorUrl properties
 */
function extractChannelFromAttributedTo(attributedToVal) {
	let result = { username: null, actorUrl: null };
	let attributedTo = asArray(attributedToVal);
	if (attributedTo.length === 0) return result;

	for (let i = 0; i < attributedTo.length; i++) {
		let actor = attributedTo[i];
		if (!actor) continue;
		let actorUrl = typeof actor === "string" ? actor : actor.id;
		if (actorUrl && !actorUrl.includes("/mirrorservice")) {
			result.actorUrl = actorUrl;
			let match = actorUrl.match(/\/actors\/([^\/]+)\/?$/);
			if (match) {
				result.username = match[1];
			}
			break;
		}
	}
	return result;
}

/**
 * Maps an API video response object to a PlatformVideo.
 *
 * @param {Object} v - Video object from API
 * @returns {PlatformVideo} Platform video object
 */
function mapAPIVideoToResult(v) {
	return new PlatformVideo({
		id: new PlatformID(PLATFORM, v.id, config.id),
		name: v.name,
		thumbnails: new Thumbnails([
			new Thumbnail(v.thumbnailUrl || (CDN_URL + "/thumbnails/" + v.id + ".jpg"), 0)
		]),
		author: new PlatformAuthorLink(
			new PlatformID(PLATFORM, v.channelUsername, config.id),
			v.channelName,
			BASE_URL + "/c/" + v.channelUsername,
			v.channelAvatar || PLUGIN_LOGO_URL
		),
		datetime: parseISODate(v.publishedAt),
		duration: v.duration || 0,
		viewCount: v.views || 0,
		url: BASE_URL + "/w/" + v.id,
		isLive: false
	});
}

/**
 * Maps an ActivityPub video object to a PlatformVideo.
 *
 * @param {Object} apVideo - Video object from ActivityPub
 * @param {string} channelUsername - Channel username
 * @param {string|null} channelAvatar - Channel avatar URL
 * @returns {PlatformVideo|null} Platform video object or null
 */
function mapAPVideoToResult(apVideo, channelUsername, channelAvatar, channelNameArg) {
	if (!apVideo) return null;

	// Extract video UUID - prefer uuid field, fall back to parsing from id
	let videoUuid = apVideo.uuid;
	if (!videoUuid && apVideo.id) {
		let uuidMatch = apVideo.id.match(/([a-f0-9-]{36})$/i);
		if (uuidMatch) {
			videoUuid = uuidMatch[1];
		} else {
			let parts = apVideo.id.split("/");
			videoUuid = parts[parts.length - 1];
		}
	}
	if (!videoUuid) return null;

	// Extract thumbnail
	let thumbnailUrl = CDN_URL + "/thumbnails/" + videoUuid + ".jpg";
	let icons = asArray(apVideo.icon);
	if (icons.length > 0) {
		let iconCandidate = icons[0].url || icons[0];
		if (typeof iconCandidate === "string") {
			thumbnailUrl = iconCandidate;
		}
	}

	// Extract channel name from attributedTo if available
	let channelName = channelNameArg || channelUsername;
	let attributedTo = asArray(apVideo.attributedTo);
	if (attributedTo.length > 0) {
		for (let i = 0; i < attributedTo.length; i++) {
			let actor = attributedTo[i];
			if (actor && typeof actor === "object" && actor.name) {
				channelName = actor.name;
				break;
			}
		}
	}

	return new PlatformVideo({
		id: new PlatformID(PLATFORM, videoUuid, config.id),
		name: apVideo.name || "Untitled",
		thumbnails: new Thumbnails([new Thumbnail(thumbnailUrl, 0)]),
		author: new PlatformAuthorLink(
			new PlatformID(PLATFORM, channelUsername, config.id),
			channelName,
			BASE_URL + "/c/" + channelUsername,
			channelAvatar || PLUGIN_LOGO_URL
		),
		datetime: parseISODate(apVideo.published),
		duration: parseISODuration(apVideo.duration),
		viewCount: apVideo.views || 0,
		url: BASE_URL + "/w/" + videoUuid,
		isLive: false
	});
}

/**
 * Extracts video sources from an ActivityPub video object.
 *
 * @param {Object} apVideo - ActivityPub video object
 * @returns {VideoUrlSource[]} Array of video sources
 */
function extractVideoSources(apVideo) {
	let sources = [];
	let urls = asArray(apVideo.url);

	if (urls.length > 0) {
		for (let i = 0; i < urls.length; i++) {
			let urlObj = urls[i];
			if (!urlObj) continue;
			// Only include video links, not HTML page links
			if (urlObj.type === "Link" && urlObj.mediaType && urlObj.mediaType.startsWith("video/")) {
				// Build source name with fallbacks
				let sourceName;
				if (urlObj.height) {
					sourceName = urlObj.height + "p";
				} else if (urlObj.width) {
					sourceName = urlObj.width + "w";
				} else {
					sourceName = urlObj.mediaType.replace("video/", "").toUpperCase();
				}

				sources.push(new VideoUrlSource({
					name: sourceName,
					url: urlObj.href,
					width: urlObj.width || 0,
					height: urlObj.height || 0,
					container: urlObj.mediaType,
					codec: urlObj.mediaType === "video/webm" ? "VP9" : "H264"
				}));
			}
		}
	}

	// Sort by resolution (highest first)
	sources.sort(function(a, b) {
		return b.height - a.height;
	});

	return sources;
}

/**
 * Parses an ISO 8601 date string to Unix timestamp.
 *
 * @param {string} isoDate - ISO date string
 * @returns {number} Unix timestamp in seconds
 */
function parseISODate(isoDate) {
	if (!isoDate) return 0;
	try {
		return Math.floor(new Date(isoDate).getTime() / 1000);
	} catch (e) {
		return 0;
	}
}

/**
 * Parses an ISO 8601 duration string to seconds.
 * Supports formats like "PT1377S", "PT22M57S", "PT1H22M57S".
 *
 * @param {string} isoDuration - ISO 8601 duration string
 * @returns {number} Duration in seconds
 */
function parseISODuration(isoDuration) {
	if (!isoDuration) return 0;
	try {
		let match = isoDuration.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
		if (!match) return 0;
		let hours = parseInt(match[1] || 0, 10);
		let minutes = parseInt(match[2] || 0, 10);
		let seconds = parseInt(match[3] || 0, 10);
		return hours * 3600 + minutes * 60 + seconds;
	} catch (e) {
		return 0;
	}
}

/**
 * Extracts platform links from markdown text.
 *
 * @param {string} markdown - Markdown text containing links
 * @returns {Object} Map of platform names to URLs
 */
function extractLinksFromMarkdown(markdown) {
	let links = {};
	if (!markdown) return links;

	// Match markdown links [text](url) and raw URLs
	// Note: Raw URL pattern excludes quotes and parens to avoid matching inside markdown/HTML
	let linkRegex = /\[([^\]]*)\]\((https?:\/\/[^)]+)\)|((?:^|[\s>]))(https?:\/\/[^\s\)<"]+)/gi;
	let match;

	while ((match = linkRegex.exec(markdown)) !== null) {
		let url = match[2] || match[4];
		if (!url) continue;

		// Skip pixeltube.org links
		if (url.includes("pixeltube.org")) continue;

		// Check for Mastodon ActivityPub pattern (/@username)
		if (!links["Mastodon"] && url.match(/https?:\/\/[^\/]+\/@[^\/\s]+/)) {
			links["Mastodon"] = url;
			continue;
		}

		// Match against configured platform patterns
		let platform = matchPlatformLink(url);
		if (platform) {
			if (!links[platform]) {
				links[platform] = url;
			}
		} else if (!links["Website"]) {
			links["Website"] = url;
		}
	}

	return links;
}

/**
 * Matches a URL against platform patterns and returns the platform name.
 *
 * @param {string} url - URL to match
 * @returns {string|null} Platform name or null if no match
 */
function matchPlatformLink(url) {
	for (let platform in PLATFORM_LINK_PATTERNS) {
		let patterns = PLATFORM_LINK_PATTERNS[platform];
		for (let i = 0; i < patterns.length; i++) {
			if (url.includes(patterns[i])) {
				return platform;
			}
		}
	}
	return null;
}

/**
 * Logs a message to the console.
 *
 * @param {string} message - Message to log
 */
function log(message) {
	bridge.log("[PixelTube] " + message);
}
