import axios from "axios";

const tavilyApiKey = import.meta.env.VITE_TAVILY_API_KEY;
const TAVILY_URL = "https://api.tavily.com/search";

function shouldUseWebSearch(question) {
  const lower = question.toLowerCase();
  const webIntentPattern =
    /(latest|today|current|recent|news|update|price|score|weather|temperature|forecast|rain|humidity|trend|release|version|as of|now|who is|what is|where is|when is|\@web)/;

  return webIntentPattern.test(lower);
}

function formatSearchResults(answer, results = []) {
  const formattedAnswer = answer ? `Tavily answer: ${answer}` : "";

  if (!results.length) {
    return formattedAnswer || "No web results found.";
  }

  const formattedResults = results
    .map((item, index) => {
      const title = item.title || "Untitled";
      const url = item.url || "No URL";
      const rawContent = item.content || "No summary available.";
      const content =
        rawContent.length > 350 ? `${rawContent.slice(0, 350)}...` : rawContent;
      return `${index + 1}. ${title}\nURL: ${url}\nSummary: ${content}`;
    })
    .join("\n\n");

  return [formattedAnswer, formattedResults].filter(Boolean).join("\n\n");
}

export async function getWebSearchContext(question) {
  if (!tavilyApiKey || !shouldUseWebSearch(question)) {
    return "";
  }

  try {
    const cleanQuery = question.replace("@web", "").trim();

    const { data } = await axios.post(
      TAVILY_URL,
      {
        query: cleanQuery,
        search_depth: "advanced",
        topic: "general",
        max_results: 5,
        include_answer: "advanced",
        include_raw_content: false,
        time_range: "day",
        auto_parameters: true,
      },
      {
        headers: {
          Authorization: `Bearer ${tavilyApiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    return formatSearchResults(data?.answer, data?.results || []);
  } catch (error) {
    console.error("Tavily search failed:", error?.response?.data || error?.message || error);
    return "";
  }
}

function extractYouTubeWatchUrl(results = []) {
  const youtubeResult = results.find((item) => {
    const url = item?.url || "";
    return (
      url.includes("youtube.com/watch") ||
      url.includes("youtu.be/") ||
      url.includes("music.youtube.com/watch")
    );
  });

  return youtubeResult?.url || "";
}

function normalizeMusicIntent(input) {
  if (typeof input === "string") {
    return {
      rawQuery: input,
      songName: "",
      artistName: "",
      wantsPlaylist: false,
    };
  }

  return {
    rawQuery: input?.rawQuery || "",
    songName: input?.songName || "",
    artistName: input?.artistName || "",
    wantsPlaylist: Boolean(input?.wantsPlaylist),
  };
}

function normalizeSearchText(text) {
  return (text || "")
    .replace(/[,“”"'`]/g, "")
    .replace(/[.,;:!?]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function buildDisplayQuery(musicIntent) {
  if (musicIntent.songName && musicIntent.artistName) {
    return `${musicIntent.songName} by ${musicIntent.artistName}`;
  }

  if (musicIntent.artistName && musicIntent.wantsPlaylist) {
    return `${musicIntent.artistName} playlist`;
  }

  if (musicIntent.artistName) {
    return `${musicIntent.artistName} songs`;
  }

  return musicIntent.rawQuery;
}

function buildYouTubeMusicSearchQuery(input) {
  const musicIntent = normalizeMusicIntent(input);
  const song = normalizeSearchText(musicIntent.songName);
  const artist = normalizeSearchText(musicIntent.artistName);
  const raw = normalizeSearchText(musicIntent.rawQuery);

  if (song && artist) {
    return `${song} ${artist} official music video`;
  }

  if (artist && musicIntent.wantsPlaylist) {
    return `${artist} top songs playlist`;
  }

  if (artist) {
    return `${artist} best songs`;
  }

  return raw;
}

function buildTavilyYouTubeRetrievalQuery(input) {
  const musicIntent = normalizeMusicIntent(input);
  const song = normalizeSearchText(musicIntent.songName);
  const artist = normalizeSearchText(musicIntent.artistName);
  const raw = normalizeSearchText(musicIntent.rawQuery);

  if (song && artist) {
    return `site:youtube.com/watch ${song} ${artist} official music video -shorts -cover -live -karaoke`;
  }

  if (artist && musicIntent.wantsPlaylist) {
    return `site:youtube.com ${artist} official playlist -shorts -cover -live`;
  }

  if (artist) {
    return `site:youtube.com/watch ${artist} official songs -shorts -cover -live -karaoke`;
  }

  return `site:youtube.com/watch ${raw} official music -shorts -cover -live`;
}

function buildYouTubeSearchUrl(searchQuery) {
  return `https://www.youtube.com/results?search_query=${encodeURIComponent(searchQuery)}`;
}

export async function findYouTubeMusicLink(input) {
  if (!tavilyApiKey) {
    return {
      url: "",
      query: "",
      searchUrl: "",
      displayQuery: "",
      reason: "missing-tavily-key",
    };
  }

  const normalizedIntent = normalizeMusicIntent(input);
  const query = buildYouTubeMusicSearchQuery(normalizedIntent);
  const tavilyQuery = buildTavilyYouTubeRetrievalQuery(normalizedIntent);
  const displayQuery = buildDisplayQuery(normalizedIntent);
  const searchUrl = buildYouTubeSearchUrl(query);

  try {
    const { data } = await axios.post(
      TAVILY_URL,
      {
        query: tavilyQuery,
        search_depth: "advanced",
        topic: "general",
        max_results: 6,
        include_answer: false,
        include_raw_content: false,
      },
      {
        headers: {
          Authorization: `Bearer ${tavilyApiKey}`,
          "Content-Type": "application/json",
        },
        timeout: 15000,
      }
    );

    const directUrl = extractYouTubeWatchUrl(data?.results || []);

    return {
      url: directUrl || searchUrl,
      query,
      searchUrl,
      displayQuery,
      reason: directUrl ? "direct-video-found" : "fallback-search-url",
    };
  } catch (error) {
    console.error("YouTube link search failed:", error?.response?.data || error?.message || error);
    return {
      url: searchUrl,
      query,
      searchUrl,
      displayQuery,
      reason: "search-failed-fallback-url",
    };
  }
}
