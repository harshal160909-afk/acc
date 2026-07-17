import type { RawMarketSignal } from "../market-intelligence";

export type MarketConnectorName = "reddit" | "youtube";

export type MarketConnectorStatus = {
  provider: MarketConnectorName;
  label: string;
  sourceType: string;
  configured: boolean;
  complianceApproved: boolean;
  available: boolean;
  status: "available" | "credentials_required" | "approval_required";
  message: string;
  termsUrl: string;
};

type EnvRecord = Record<string, string | undefined>;

function enabled(value: string | undefined) {
  return value?.trim().toLowerCase() === "true";
}

function cleanQuery(value: string) {
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/\s+/g, " ").trim().slice(0, 180);
}

function cleanText(value: unknown, maximum: number) {
  if (typeof value !== "string") return "";
  return value.replace(/[\u0000-\u001f\u007f]/g, " ").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim().slice(0, maximum);
}

async function environment(): Promise<EnvRecord> {
  const { env } = await import("cloudflare:workers");
  return env as unknown as EnvRecord;
}

export async function marketConnectorStatuses(): Promise<MarketConnectorStatus[]> {
  const env = await environment();
  const redditConfigured = Boolean(env.REDDIT_CLIENT_ID?.trim() && env.REDDIT_CLIENT_SECRET?.trim() && env.REDDIT_USER_AGENT?.trim());
  const redditApproved = enabled(env.REDDIT_COMMERCIAL_APPROVAL);
  const youtubeConfigured = Boolean(env.YOUTUBE_DATA_API_KEY?.trim());
  const youtubeApproved = enabled(env.YOUTUBE_COMPLIANCE_APPROVED);
  return [
    {
      provider: "reddit",
      label: "Reddit official Data API",
      sourceType: "public_community",
      configured: redditConfigured,
      complianceApproved: redditApproved,
      available: redditConfigured && redditApproved,
      status: !redditConfigured ? "credentials_required" : !redditApproved ? "approval_required" : "available",
      message: !redditConfigured
        ? "Official Reddit credentials are not configured."
        : !redditApproved
          ? "Reddit access is configured but commercial-data approval has not been confirmed."
          : "Official Reddit access and the explicit approval gate are configured.",
      termsUrl: "https://support.reddithelp.com/hc/en-us/articles/16471395473812-Moderation-Bots-Tooling",
    },
    {
      provider: "youtube",
      label: "YouTube Data API",
      sourceType: "public_video_comment",
      configured: youtubeConfigured,
      complianceApproved: youtubeApproved,
      available: youtubeConfigured && youtubeApproved,
      status: !youtubeConfigured ? "credentials_required" : !youtubeApproved ? "approval_required" : "available",
      message: !youtubeConfigured
        ? "A YouTube Data API key is not configured."
        : !youtubeApproved
          ? "The API key exists, but the YouTube policy-compliance gate has not been confirmed."
          : "YouTube public search and comment access is configured with the policy gate enabled.",
      termsUrl: "https://developers.google.com/youtube/terms/developer-policies",
    },
  ];
}

async function fetchJson(url: string, init: RequestInit, timeoutMs = 18_000): Promise<unknown> {
  const response = await fetch(url, { ...init, signal: AbortSignal.timeout(timeoutMs) });
  if (!response.ok) throw new Error(`Provider returned HTTP ${response.status}`);
  return response.json();
}

type YoutubeSearchItem = { id?: { videoId?: string }; snippet?: { title?: string; description?: string; publishedAt?: string } };
type YoutubeCommentItem = { id?: string; snippet?: { topLevelComment?: { id?: string; snippet?: { textDisplay?: string; publishedAt?: string; likeCount?: number } }; totalReplyCount?: number } };

async function collectYoutube(env: EnvRecord, query: string, geography: string): Promise<RawMarketSignal[]> {
  const key = env.YOUTUBE_DATA_API_KEY?.trim();
  if (!key || !enabled(env.YOUTUBE_COMPLIANCE_APPROVED)) throw new Error("YouTube connector is not available");
  const now = Date.now();
  const after = new Date(now - 90 * 86_400_000).toISOString();
  const search = new URL("https://www.googleapis.com/youtube/v3/search");
  search.searchParams.set("part", "snippet");
  search.searchParams.set("type", "video");
  search.searchParams.set("q", cleanQuery(query));
  search.searchParams.set("maxResults", "8");
  search.searchParams.set("order", "date");
  search.searchParams.set("publishedAfter", after);
  search.searchParams.set("safeSearch", "moderate");
  search.searchParams.set("regionCode", geography.toLowerCase().includes("india") ? "IN" : "US");
  search.searchParams.set("key", key);
  const searchBody = await fetchJson(search.toString(), { headers: { accept: "application/json" } }) as { items?: YoutubeSearchItem[] };
  const videos = (searchBody.items ?? []).flatMap((item) => item.id?.videoId ? [{ videoId: item.id.videoId, snippet: item.snippet }] : []).slice(0, 4);
  const results: RawMarketSignal[] = [];
  for (const video of videos) {
    const comments = new URL("https://www.googleapis.com/youtube/v3/commentThreads");
    comments.searchParams.set("part", "snippet");
    comments.searchParams.set("videoId", video.videoId);
    comments.searchParams.set("maxResults", "25");
    comments.searchParams.set("order", "time");
    comments.searchParams.set("textFormat", "plainText");
    comments.searchParams.set("key", key);
    try {
      const body = await fetchJson(comments.toString(), { headers: { accept: "application/json" } }) as { items?: YoutubeCommentItem[] };
      for (const item of body.items ?? []) {
        const comment = item.snippet?.topLevelComment;
        const text = cleanText(comment?.snippet?.textDisplay, 280);
        if (!comment?.id || !text) continue;
        results.push({
          provider: "youtube",
          externalId: comment.id,
          publicUrl: `https://www.youtube.com/watch?v=${encodeURIComponent(video.videoId)}`,
          sourceType: "public_video_comment",
          title: cleanText(video.snippet?.title, 180) || "YouTube public discussion",
          excerpt: text,
          publishedAt: Date.parse(comment.snippet?.publishedAt ?? "") || now,
          retrievedAt: now,
          language: null,
          geography: null,
          engagement: { likeCount: Number(comment.snippet?.likeCount ?? 0), replyCount: Number(item.snippet?.totalReplyCount ?? 0) },
        });
      }
    } catch {
      // Comments can be disabled per video. Other videos remain usable and the
      // collection summary records the provider-level result honestly.
    }
  }
  return results;
}

type RedditChild = { data?: { id?: string; permalink?: string; title?: string; selftext?: string; created_utc?: number; score?: number; num_comments?: number; is_self?: boolean; over_18?: boolean; removed_by_category?: string | null } };

async function collectReddit(env: EnvRecord, query: string): Promise<RawMarketSignal[]> {
  const clientId = env.REDDIT_CLIENT_ID?.trim();
  const secret = env.REDDIT_CLIENT_SECRET?.trim();
  const userAgent = env.REDDIT_USER_AGENT?.trim();
  if (!clientId || !secret || !userAgent || !enabled(env.REDDIT_COMMERCIAL_APPROVAL)) throw new Error("Reddit connector is not available");
  const tokenBody = await fetchJson("https://www.reddit.com/api/v1/access_token", {
    method: "POST",
    headers: {
      authorization: `Basic ${btoa(`${clientId}:${secret}`)}`,
      "content-type": "application/x-www-form-urlencoded",
      "user-agent": userAgent,
    },
    body: "grant_type=client_credentials",
  }) as { access_token?: string };
  if (!tokenBody.access_token) throw new Error("Reddit did not issue an access token");
  const search = new URL("https://oauth.reddit.com/search");
  search.searchParams.set("q", cleanQuery(query));
  search.searchParams.set("sort", "new");
  search.searchParams.set("t", "month");
  search.searchParams.set("limit", "50");
  search.searchParams.set("type", "link");
  search.searchParams.set("raw_json", "1");
  const body = await fetchJson(search.toString(), {
    headers: { authorization: `Bearer ${tokenBody.access_token}`, "user-agent": userAgent, accept: "application/json" },
  }) as { data?: { children?: RedditChild[] } };
  const now = Date.now();
  return (body.data?.children ?? []).flatMap((child): RawMarketSignal[] => {
    const row = child.data;
    const title = cleanText(row?.title, 180);
    const excerpt = cleanText(row?.selftext, 280);
    if (!row?.id || !row.permalink || !title || row.removed_by_category) return [];
    return [{
      provider: "reddit",
      externalId: row.id,
      publicUrl: `https://www.reddit.com${row.permalink}`,
      sourceType: "public_community_post",
      title,
      excerpt,
      publishedAt: Number.isFinite(row.created_utc) ? Math.round(Number(row.created_utc) * 1_000) : now,
      retrievedAt: now,
      language: null,
      geography: null,
      engagement: { score: Number(row.score ?? 0), comments: Number(row.num_comments ?? 0), selfPost: Boolean(row.is_self), mature: Boolean(row.over_18) },
    }];
  });
}

export async function collectPermittedMarketSignals(provider: MarketConnectorName, input: { query: string; geography: string }) {
  const env = await environment();
  if (provider === "youtube") return collectYoutube(env, input.query, input.geography);
  return collectReddit(env, input.query);
}
