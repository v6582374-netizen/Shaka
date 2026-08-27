import { useEffect, useMemo, useState } from "react";
import {
  deleteYouTubeVideo,
  disconnectYouTube,
  fetchYouTubeUpdates,
  fetchYouTubeVideoCaption,
  getYouTubeOAuthSettings,
  getYouTubeStatus,
  getYouTubeTranslationSettings,
  getYouTubeVideo,
  getYouTubeVideos,
  saveYouTubeOAuthSettings,
  saveYouTubeTranslationSettings,
  setYouTubeVideoSelected,
  startYouTubeOAuth,
  testYouTubeTranslation,
  translateYouTubeVideo,
  type YouTubeOAuthSettings,
  type YouTubeStatus,
  type YouTubeTranslationSettings,
  type YouTubeVideo,
} from "../api";
import { PanelHead } from "./PanelHead";
import { Icon } from "./Icon";
import { BrandIcon } from "./brandIcons";
import "./youtube-prototype.css";

type LibraryView = "library" | "reader";
type BrowseMode = "date" | "channel";
type DateFilter = "all" | "today" | "yesterday" | "week";
type ReaderFilter = "all" | "selected" | "ready" | "translated" | "attention";
type PreviewMode = "translation" | "caption";

type VideoMeta = YouTubeVideo & {
  avatar: string;
  dateKey: string;
  dateLabel: string;
  publishedLabel: string;
};

const TIME_ZONE = "Asia/Shanghai";

function partsFor(value: number | string | null | undefined) {
  const date =
    typeof value === "number" ? new Date(value * 1000) : new Date(value || "");
  if (Number.isNaN(date.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(date);
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    dateKey: `${map.year}-${map.month}-${map.day}`,
    weekday: map.weekday,
    hour: map.hour,
    minute: map.minute,
    monthDay: new Intl.DateTimeFormat("en-US", {
      timeZone: TIME_ZONE,
      month: "short",
      day: "numeric",
    }).format(date),
  };
}

function dateKeyForNow(offsetDays = 0): string {
  return (
    partsFor(new Date(Date.now() - offsetDays * 86400000).toISOString())
      ?.dateKey || ""
  );
}

function dateLabel(dateKey: string, monthDay: string, weekday: string): string {
  if (dateKey === dateKeyForNow()) return `Today · ${monthDay}`;
  if (dateKey === dateKeyForNow(1)) return `Yesterday · ${monthDay}`;
  return `${weekday} · ${monthDay}`;
}

function weekStartKey(): string {
  const now = new Date();
  return (
    partsFor(
      new Date(
        now.getTime() - ((now.getDay() + 6) % 7) * 86400000,
      ).toISOString(),
    )?.dateKey || ""
  );
}

function avatarFor(title: string): string {
  const words = title.trim().split(/\s+/).filter(Boolean);
  return words.length
    ? words
        .slice(0, 2)
        .map((word) => word[0])
        .join("")
        .toUpperCase()
    : "CH";
}

function toMeta(video: YouTubeVideo): VideoMeta {
  const parts = partsFor(video.published_ts ?? video.published_at);
  const dateKey = parts?.dateKey || "unknown";
  return {
    ...video,
    avatar: avatarFor(video.channel_title),
    dateKey,
    dateLabel: parts
      ? dateLabel(dateKey, parts.monthDay, parts.weekday)
      : "Unknown date",
    publishedLabel: parts
      ? `${parts.weekday} · ${parts.hour}:${parts.minute}`
      : video.published_at,
  };
}

function statusClass(video: YouTubeVideo): "ready" | "pending" | "missing" {
  if (video.caption_status === "ready") return "ready";
  if (video.caption_status === "error") return "missing";
  return "pending";
}

function statusLabel(video: YouTubeVideo): string {
  if (video.caption_status === "ready") return "Caption ready";
  if (video.caption_status === "error") return "No caption";
  return "Caption not fetched";
}

function formatTime(value?: number | null): string {
  if (!value) return "No updates fetched yet";
  return new Intl.DateTimeFormat("en-US", {
    timeZone: TIME_ZONE,
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value * 1000));
}

function Status({ video }: { video: YouTubeVideo }) {
  return (
    <span className={`yt-status yt-status-${statusClass(video)}`}>
      <i />
      {statusLabel(video)}
    </span>
  );
}

function SelectBox({
  checked,
  onClick,
}: {
  checked: boolean;
  onClick: () => void;
}) {
  return (
    <span
      className={`yt-select-box${checked ? " is-selected" : ""}`}
      role="checkbox"
      aria-checked={checked}
      aria-label={
        checked ? "Remove from translation selection" : "Select for translation"
      }
      tabIndex={0}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          event.stopPropagation();
          onClick();
        }
      }}
    >
      {checked ? "✓" : ""}
    </span>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="yt-prototype-page">
      <div className="yt-prototype-scroll hairline-scroll">
        <div className="yt-prototype-content">{children}</div>
      </div>
    </main>
  );
}

export function YouTubeView() {
  const [status, setStatus] = useState<YouTubeStatus | null>(null);
  const [videos, setVideos] = useState<VideoMeta[]>([]);
  const [view, setView] = useState<LibraryView>("library");
  const [browseMode, setBrowseMode] = useState<BrowseMode>("date");
  const [dateFilter, setDateFilter] = useState<DateFilter>("all");
  const [readerFilter, setReaderFilter] = useState<ReaderFilter>("all");
  const [previewMode, setPreviewMode] = useState<PreviewMode>("caption");
  const [activeId, setActiveId] = useState<string | null>(null);
  const [detail, setDetail] = useState<YouTubeVideo | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<
    "connect" | "disconnect" | "updates" | "delete" | null
  >(null);
  const [captioningId, setCaptioningId] = useState<string | null>(null);
  const [translatingId, setTranslatingId] = useState<string | null>(null);
  const [waitingForOAuth, setWaitingForOAuth] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsLoading, setSettingsLoading] = useState(false);
  const [settingsError, setSettingsError] = useState<string | null>(null);
  const [oauthSettings, setOAuthSettings] =
    useState<YouTubeOAuthSettings | null>(null);
  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [redirectUri, setRedirectUri] = useState("");
  const [copiedRedirect, setCopiedRedirect] = useState(false);
  const [translationSettingsOpen, setTranslationSettingsOpen] = useState(false);
  const [translationSettingsLoading, setTranslationSettingsLoading] = useState(false);
  const [translationSettingsError, setTranslationSettingsError] = useState<string | null>(null);
  const [translationSettingsNotice, setTranslationSettingsNotice] = useState<string | null>(null);
  const [translationSettings, setTranslationSettings] =
    useState<YouTubeTranslationSettings | null>(null);
  const [translationBaseUrl, setTranslationBaseUrl] = useState("");
  const [translationModel, setTranslationModel] = useState("");
  const [translationApiKey, setTranslationApiKey] = useState("");
  const [translationPrompt, setTranslationPrompt] = useState("");
  const [translationSettingsBusy, setTranslationSettingsBusy] = useState<
    "save" | "test" | null
  >(null);

  const load = async () => {
    setLoading(true);
    try {
      const [nextStatus, nextVideos, nextTranslationSettings] = await Promise.all([
        getYouTubeStatus(),
        getYouTubeVideos(),
        getYouTubeTranslationSettings(),
      ]);
      setStatus(nextStatus);
      setVideos(nextVideos.videos.map(toMeta));
      setTranslationSettings(nextTranslationSettings);
      setError(null);
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to load YouTube data.",
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  useEffect(() => {
    if (!waitingForOAuth) return;
    const poll = window.setInterval(() => {
      getYouTubeStatus()
        .then((next) => {
          if (!next.connected) return;
          setWaitingForOAuth(false);
          setNotice("YouTube connected. Fetch updates whenever you are ready.");
          void load();
        })
        .catch(() => {});
    }, 2000);
    return () => window.clearInterval(poll);
  }, [waitingForOAuth]);

  useEffect(() => {
    if (!activeId) return;
    const cached = videos.find((video) => video.video_id === activeId);
    if (!cached) return;
    setDetail((current) => (current?.video_id === activeId ? current : cached));
    getYouTubeVideo(activeId)
      .then((result) => setDetail(result.video))
      .catch(() => {});
  }, [activeId, videos]);

  const selectedCount = videos.filter((video) => video.selected).length;
  const readyCount = videos.filter(
    (video) => video.caption_status === "ready",
  ).length;
  const attentionCount = videos.filter(
    (video) => video.caption_status !== "ready",
  ).length;
  const translatedCount = videos.filter(
    (video) => video.translation_status === "ready",
  ).length;
  const channelCount = new Set(videos.map((video) => video.channel_title)).size;

  const openOAuthPopup = () => {
    const popup = window.open(
      "about:blank",
      "youtube-oauth",
      "popup,width=560,height=760",
    );
    if (popup) popup.opener = null;
    return popup;
  };

  const browserRedirectUri = () =>
    new URL("/v1/youtube/oauth/callback", window.location.origin).toString();

  const authorizeWithPopup = async (popup: Window | null) => {
    const result = await startYouTubeOAuth(browserRedirectUri());
    if (!result.ok || !result.authorization_url)
      throw new Error(result.error || "Unable to start YouTube authorization.");
    if (!popup)
      throw new Error(
        "The Google sign-in window was blocked. Allow pop-ups for Vegapunk, then try again.",
      );
    popup.location.assign(result.authorization_url);
    setWaitingForOAuth(true);
    setNotice("Finish Google sign-in in the new tab, then return here.");
  };

  const openSettings = async () => {
    setSettingsOpen(true);
    setSettingsLoading(true);
    setSettingsError(null);
    setError(null);
    try {
      const next = await getYouTubeOAuthSettings();
      setOAuthSettings(next);
      setClientId(next.client_id || "");
      setClientSecret("");
      setRedirectUri(
        next.source === "environment"
          ? next.redirect_uri || ""
          : browserRedirectUri(),
      );
    } catch (cause) {
      setSettingsError(
        cause instanceof Error
          ? cause.message
          : "Unable to load YouTube OAuth settings.",
      );
    } finally {
      setSettingsLoading(false);
    }
  };

  const openTranslationSettings = async () => {
    setTranslationSettingsOpen(true);
    setTranslationSettingsLoading(true);
    setTranslationSettingsError(null);
    setTranslationSettingsNotice(null);
    setError(null);
    try {
      const next = await getYouTubeTranslationSettings();
      setTranslationSettings(next);
      setTranslationBaseUrl(next.base_url || "");
      setTranslationModel(next.model || "");
      setTranslationApiKey("");
      setTranslationPrompt(next.prompt || "");
    } catch (cause) {
      setTranslationSettingsError(
        cause instanceof Error
          ? cause.message
          : "Unable to load translation settings.",
      );
    } finally {
      setTranslationSettingsLoading(false);
    }
  };

  const persistTranslationSettings = async () => {
    if (!translationBaseUrl.trim())
      throw new Error("API Base URL is required.");
    if (!translationModel.trim()) throw new Error("Model is required.");
    if (!translationPrompt.trim())
      throw new Error("Translation Prompt is required.");
    const saved = await saveYouTubeTranslationSettings({
      base_url: translationBaseUrl.trim(),
      model: translationModel.trim(),
      api_key: translationApiKey.trim(),
      prompt: translationPrompt.trim(),
    });
    if (!saved.ok)
      throw new Error(saved.error || "Unable to save translation settings.");
    setTranslationSettings(saved);
    setTranslationApiKey("");
    return saved;
  };

  const saveTranslationSettings = async () => {
    setTranslationSettingsBusy("save");
    setTranslationSettingsError(null);
    setTranslationSettingsNotice(null);
    try {
      await persistTranslationSettings();
      setTranslationSettingsOpen(false);
      setNotice("Translation model settings saved locally.");
    } catch (cause) {
      setTranslationSettingsError(
        cause instanceof Error
          ? cause.message
          : "Unable to save translation settings.",
      );
    } finally {
      setTranslationSettingsBusy(null);
    }
  };

  const saveAndTestTranslation = async () => {
    setTranslationSettingsBusy("test");
    setTranslationSettingsError(null);
    setTranslationSettingsNotice(null);
    try {
      await persistTranslationSettings();
      const tested = await testYouTubeTranslation();
      const next = await getYouTubeTranslationSettings();
      setTranslationSettings(next);
      if (!tested.ok)
        throw new Error(tested.error || "The model connection test failed.");
      setTranslationSettingsNotice("Model connection verified.");
    } catch (cause) {
      setTranslationSettingsError(
        cause instanceof Error
          ? cause.message
          : "The model connection test failed.",
      );
    } finally {
      setTranslationSettingsBusy(null);
    }
  };

  const connect = async () => {
    if (!status?.configured) {
      await openSettings();
      return;
    }
    setError(null);
    setNotice(null);
    setBusy("connect");
    const popup = openOAuthPopup();
    try {
      await authorizeWithPopup(popup);
      setSettingsOpen(false);
    } catch (cause) {
      popup?.close();
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to start YouTube authorization.",
      );
    } finally {
      setBusy(null);
    }
  };

  const saveSettingsAndConnect = async () => {
    if (!clientId.trim()) {
      setSettingsError("Google OAuth Client ID is required.");
      return;
    }
    if (!clientSecret.trim() && !oauthSettings?.has_client_secret) {
      setSettingsError("Google OAuth Client Secret is required.");
      return;
    }
    if (!redirectUri.trim()) {
      setSettingsError("OAuth redirect URI is required.");
      return;
    }
    const popup = openOAuthPopup();
    if (!popup) {
      setSettingsError(
        "The Google sign-in window was blocked. Allow pop-ups for Vegapunk, then try again.",
      );
      return;
    }
    setBusy("connect");
    setSettingsError(null);
    setError(null);
    try {
      const saved = await saveYouTubeOAuthSettings({
        client_id: clientId.trim(),
        client_secret: clientSecret.trim(),
        redirect_uri: redirectUri.trim(),
      });
      if (!saved.ok)
        throw new Error(
          saved.error || "Unable to save YouTube OAuth settings.",
        );
      setOAuthSettings(saved);
      setStatus((current) =>
        current ? { ...current, configured: true, connected: false } : current,
      );
      await authorizeWithPopup(popup);
      setSettingsOpen(false);
    } catch (cause) {
      popup.close();
      setSettingsError(
        cause instanceof Error
          ? cause.message
          : "Unable to save YouTube OAuth settings.",
      );
    } finally {
      setBusy(null);
    }
  };

  const copyRedirectUri = async () => {
    await navigator.clipboard.writeText(redirectUri);
    setCopiedRedirect(true);
    window.setTimeout(() => setCopiedRedirect(false), 1400);
  };

  const disconnect = async () => {
    setBusy("disconnect");
    try {
      await disconnectYouTube();
      setNotice("YouTube disconnected. Your local video library was kept.");
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to disconnect YouTube.",
      );
    } finally {
      setBusy(null);
    }
  };

  const fetchUpdates = async () => {
    setBusy("updates");
    try {
      const result = await fetchYouTubeUpdates();
      if (!result.ok)
        throw new Error(result.error || "Unable to fetch YouTube updates.");
      const discovered = result.discovered || 0;
      const channelFailures = result.channel_failures?.length || 0;
      setNotice(
        `${discovered} new video${discovered === 1 ? "" : "s"} found${channelFailures ? ` · ${channelFailures} channel${channelFailures === 1 ? "" : "s"} could not be checked` : ""}. Select a video to fetch its caption.`,
      );
      await load();
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to fetch YouTube updates.",
      );
    } finally {
      setBusy(null);
    }
  };

  const toggleSelected = async (
    video: Pick<YouTubeVideo, "video_id" | "selected" | "caption_status">,
  ) => {
    const selected = !video.selected;
    setVideos((current) =>
      current.map((item) =>
        item.video_id === video.video_id ? { ...item, selected } : item,
      ),
    );
    setDetail((current) =>
      current?.video_id === video.video_id ? { ...current, selected } : current,
    );
    try {
      const result = await setYouTubeVideoSelected(video.video_id, selected);
      if (!result.ok)
        throw new Error(result.error || "Unable to update selection.");
    } catch (cause) {
      setVideos((current) =>
        current.map((item) =>
          item.video_id === video.video_id
            ? { ...item, selected: video.selected }
            : item,
        ),
      );
      setDetail((current) =>
        current?.video_id === video.video_id
          ? { ...current, selected: video.selected }
          : current,
      );
      setError(
        cause instanceof Error ? cause.message : "Unable to update selection.",
      );
      return;
    }

    if (!selected || video.caption_status === "ready") return;
    setCaptioningId(video.video_id);
    try {
      const result = await fetchYouTubeVideoCaption(video.video_id);
      if (result.video) {
        const nextVideo = toMeta(result.video);
        setVideos((current) =>
          current.map((item) =>
            item.video_id === video.video_id ? nextVideo : item,
          ),
        );
        setDetail((current) =>
          current?.video_id === video.video_id
            ? result.video || current
            : current,
        );
      }
      if (!result.ok)
        throw new Error(result.error || "Unable to fetch this caption.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to fetch this caption.",
      );
    } finally {
      setCaptioningId(null);
    }
  };

  const translateVideo = async (video: YouTubeVideo) => {
    if (video.caption_status !== "ready") {
      setError("Fetch this video's caption before translating it.");
      return;
    }
    if (!translationSettings?.configured) {
      setNotice("Configure a translation model before translating captions.");
      await openTranslationSettings();
      return;
    }
    setTranslatingId(video.video_id);
    setError(null);
    try {
      const result = await translateYouTubeVideo(video.video_id);
      if (result.video) {
        const nextVideo = toMeta(result.video);
        setVideos((current) =>
          current.map((item) =>
            item.video_id === video.video_id ? nextVideo : item,
          ),
        );
        setDetail(result.video);
      }
      if (!result.ok)
        throw new Error(result.error || "Unable to translate this caption.");
      setPreviewMode("translation");
      setNotice("Chinese translation saved to the local library.");
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Unable to translate this caption.",
      );
    } finally {
      setTranslatingId(null);
    }
  };

  const translateSelected = async () => {
    if (!translationSettings?.configured) {
      setNotice("Configure a translation model before translating captions.");
      await openTranslationSettings();
      return;
    }
    const eligible = videos.filter(
      (video) =>
        video.selected &&
        video.caption_status === "ready" &&
        video.translation_status !== "ready",
    );
    if (eligible.length === 0) {
      setNotice("No selected videos with a ready caption need translation.");
      return;
    }
    for (const video of eligible) {
      await translateVideo(video);
    }
  };

  const removeVideo = async (
    video: Pick<YouTubeVideo, "video_id" | "title">,
  ) => {
    if (!window.confirm(`Delete “${video.title}” from this local library?`))
      return;
    setBusy("delete");
    try {
      await deleteYouTubeVideo(video.video_id);
      setVideos((current) =>
        current.filter((item) => item.video_id !== video.video_id),
      );
      if (activeId === video.video_id) {
        setActiveId(null);
        setDetail(null);
      }
      setNotice("Video removed from the local library.");
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to delete video.",
      );
    } finally {
      setBusy(null);
    }
  };

  const filterDate = (video: VideoMeta) => {
    if (dateFilter === "all") return true;
    if (dateFilter === "today") return video.dateKey === dateKeyForNow();
    if (dateFilter === "yesterday") return video.dateKey === dateKeyForNow(1);
    return video.dateKey >= weekStartKey() && video.dateKey <= dateKeyForNow();
  };

  const libraryVideos = videos.filter(filterDate);
  const dateGroups = useMemo(() => {
    const groups = new Map<string, { label: string; videos: VideoMeta[] }>();
    libraryVideos.forEach((video) => {
      const group = groups.get(video.dateKey);
      if (group) group.videos.push(video);
      else
        groups.set(video.dateKey, { label: video.dateLabel, videos: [video] });
    });
    return [...groups.values()];
  }, [libraryVideos]);
  const channelGroups = useMemo(() => {
    const groups = new Map<string, VideoMeta[]>();
    libraryVideos.forEach((video) =>
      groups.set(video.channel_title, [
        ...(groups.get(video.channel_title) || []),
        video,
      ]),
    );
    return [...groups.entries()];
  }, [libraryVideos]);
  const readerVideos = videos.filter((video) =>
    readerFilter === "selected"
      ? video.selected
      : readerFilter === "ready"
        ? video.caption_status === "ready"
        : readerFilter === "translated"
          ? video.translation_status === "ready"
        : readerFilter === "attention"
          ? video.caption_status !== "ready"
          : true,
  );
  const selectedVideo =
    (activeId ? videos.find((video) => video.video_id === activeId) : null) ||
    readerVideos[0] ||
    videos[0] ||
    null;

  const openReader = (video: VideoMeta) => {
    setActiveId(video.video_id);
    setView("reader");
  };
  const row = (video: VideoMeta) => (
    <article
      className={`yt-list-row${activeId === video.video_id ? " is-active" : ""}`}
      key={video.video_id}
      role="button"
      tabIndex={0}
      onClick={() => openReader(video)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          openReader(video);
        }
      }}
    >
      <SelectBox
        checked={video.selected}
        onClick={() => void toggleSelected(video)}
      />
      <span className="yt-avatar">{video.avatar}</span>
      <span className="yt-list-copy">
        <strong>{video.title}</strong>
        <span>
          {video.channel_title} · {video.publishedLabel}
        </span>
      </span>
      <span className="yt-row-status">
        <Status video={video} />
        <span className="yt-source-state">
          {video.translation_status === "ready"
            ? `Chinese ready · ${video.translation?.model || "translated"}`
            : video.translation_status === "error"
              ? video.translation_error
              : video.caption?.source ||
            video.caption_error ||
            (captioningId === video.video_id
              ? "Fetching caption…"
              : "Select to fetch caption")}
        </span>
      </span>
      <button
        className="yt-row-delete"
        type="button"
        aria-label={`Delete ${video.title}`}
        title="Delete video"
        onClick={(event) => {
          event.stopPropagation();
          void removeVideo(video);
        }}
      >
        <Icon name="trash" size={13} />
      </button>
      <Icon name="chevronRight" size={14} className="text-faint" />
    </article>
  );

  if (loading && !status)
    return (
      <Shell>
        <div className="yt-empty-state">
          <span className="yt-loading-dot" />
          <span>Loading YouTube library…</span>
        </div>
      </Shell>
    );

  if (translationSettingsOpen) {
    return (
      <Shell>
        <button
          className="yt-settings-back"
          type="button"
          onClick={() => setTranslationSettingsOpen(false)}
        >
          <Icon name="arrowLeft" size={14} />
          Back to library
        </button>
        <div className="yt-settings-heading">
          <span className="yt-settings-brand yt-translation-brand">
            <Icon name="sparkle" size={25} />
          </span>
          <div>
            <span className="yt-kicker">YouTube translation</span>
            <h2>Translation model</h2>
            <p>
              This connection belongs only to YouTube Library and does not use
              Vegapunk's global model configuration.
            </p>
          </div>
        </div>
        {translationSettingsLoading ? (
          <div className="yt-settings-loading yt-card">
            <span className="yt-loading-dot" />
            Loading translation settings…
          </div>
        ) : (
          <div className="yt-settings-grid">
            <aside className="yt-settings-guide yt-card">
              <div className="yt-section-label">How translation works</div>
              <ol>
                <li>
                  <span>1</span>
                  <div>
                    <strong>OpenAI-compatible endpoint</strong>
                    <p>
                      Use a hosted provider or a local server that exposes
                      <code>/chat/completions</code>.
                    </p>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Test before translating</strong>
                    <p>A tiny request verifies the URL, key, and model name.</p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Edit the Prompt</strong>
                    <p>
                      Available placeholders: <code>{"{title}"}</code>,{" "}
                      <code>{"{channel}"}</code>, <code>{"{language}"}</code>,{" "}
                      <code>{"{part}"}</code>, <code>{"{parts}"}</code>, and{" "}
                      <code>{"{caption}"}</code>.
                    </p>
                  </div>
                </li>
              </ol>
            </aside>
            <form
              className="yt-settings-form yt-card"
              onSubmit={(event) => {
                event.preventDefault();
                void saveTranslationSettings();
              }}
            >
              <div className="yt-settings-form-head">
                <div>
                  <span className="yt-kicker">Local configuration</span>
                  <h3>Model and Prompt</h3>
                </div>
                {translationSettings?.configured && (
                  <span className="yt-settings-saved">Saved locally</span>
                )}
              </div>
              {translationSettingsError && (
                <div className="yt-inline-alert yt-inline-alert-error">
                  <span>{translationSettingsError}</span>
                  <button
                    type="button"
                    onClick={() => setTranslationSettingsError(null)}
                    aria-label="Dismiss error"
                  >
                    ×
                  </button>
                </div>
              )}
              {translationSettingsNotice && (
                <div className="yt-inline-alert">
                  <span>{translationSettingsNotice}</span>
                </div>
              )}
              <label className="yt-settings-field">
                <span>API Base URL</span>
                <input
                  data-testid="youtube-translation-base-url"
                  value={translationBaseUrl}
                  onChange={(event) => setTranslationBaseUrl(event.target.value)}
                  placeholder="https://api.openai.com/v1"
                  autoComplete="off"
                  spellCheck={false}
                />
                <small>The module adds /chat/completions automatically.</small>
              </label>
              <label className="yt-settings-field">
                <span>Model</span>
                <input
                  data-testid="youtube-translation-model"
                  value={translationModel}
                  onChange={(event) => setTranslationModel(event.target.value)}
                  placeholder="Your translation model name"
                  autoComplete="off"
                  spellCheck={false}
                />
              </label>
              <label className="yt-settings-field">
                <span>API Key</span>
                <input
                  data-testid="youtube-translation-api-key"
                  type="password"
                  value={translationApiKey}
                  onChange={(event) => setTranslationApiKey(event.target.value)}
                  placeholder={
                    translationSettings?.has_api_key
                      ? "Saved — leave blank to keep the current key"
                      : "Optional for local models"
                  }
                  autoComplete="new-password"
                  spellCheck={false}
                />
                <small>The key is saved in the local secret store and never returned.</small>
              </label>
              <label className="yt-settings-field">
                <span>Translation Prompt</span>
                <textarea
                  className="yt-translation-prompt"
                  data-testid="youtube-translation-prompt"
                  value={translationPrompt}
                  onChange={(event) => setTranslationPrompt(event.target.value)}
                  rows={13}
                  spellCheck={false}
                />
              </label>
              <div className="yt-settings-security">
                <Icon name="shield" size={14} />
                <span>
                  Captions are sent only to this endpoint when you explicitly
                  translate a selected video.
                </span>
              </div>
              <div className="yt-settings-actions">
                <button
                  className="btn sm"
                  type="button"
                  onClick={() => setTranslationSettingsOpen(false)}
                >
                  Cancel
                </button>
                <button
                  className="btn sm"
                  type="submit"
                  disabled={translationSettingsBusy !== null}
                >
                  {translationSettingsBusy === "save" ? "Saving…" : "Save"}
                </button>
                <button
                  className="btn-primary sm"
                  type="button"
                  onClick={() => void saveAndTestTranslation()}
                  disabled={translationSettingsBusy !== null}
                >
                  <Icon
                    name="refresh"
                    size={13}
                    className={
                      translationSettingsBusy === "test" ? "yt-spin" : undefined
                    }
                  />
                  {translationSettingsBusy === "test" ? "Testing…" : "Save and test"}
                </button>
              </div>
            </form>
          </div>
        )}
      </Shell>
    );
  }

  if (settingsOpen) {
    let redirectRequiresHttps = false;
    try {
      const parsed = new URL(redirectUri);
      const loopback =
        parsed.hostname === "localhost" ||
        parsed.hostname === "127.0.0.1" ||
        parsed.hostname === "[::1]";
      redirectRequiresHttps = parsed.protocol === "http:" && !loopback;
    } catch {
      redirectRequiresHttps = false;
    }
    const managedByEnvironment = oauthSettings?.source === "environment";
    return (
      <Shell>
        <button
          className="yt-settings-back"
          type="button"
          onClick={() => setSettingsOpen(false)}
        >
          <Icon name="arrowLeft" size={14} />
          Back to library
        </button>
        <div className="yt-settings-heading">
          <span className="yt-settings-brand">
            <BrandIcon name="youtube" size={30} />
          </span>
          <div>
            <span className="yt-kicker">YouTube OAuth</span>
            <h2>Connect YouTube</h2>
            <p>
              Use your own Google OAuth application. The credentials and refresh
              token stay in Vegapunk's local secret store.
            </p>
          </div>
        </div>
        {settingsLoading ? (
          <div className="yt-settings-loading yt-card">
            <span className="yt-loading-dot" />
            Loading OAuth settings…
          </div>
        ) : (
          <div className="yt-settings-grid">
            <aside className="yt-settings-guide yt-card">
              <div className="yt-section-label">Google Cloud setup</div>
              <ol>
                <li>
                  <span>1</span>
                  <div>
                    <strong>Enable the API</strong>
                    <p>
                      Enable YouTube Data API v3 for your Google Cloud project.
                    </p>
                  </div>
                </li>
                <li>
                  <span>2</span>
                  <div>
                    <strong>Configure consent</strong>
                    <p>
                      Create the OAuth consent screen and add your Google
                      account as a test user if the app is in testing.
                    </p>
                  </div>
                </li>
                <li>
                  <span>3</span>
                  <div>
                    <strong>Create credentials</strong>
                    <p>
                      Create an OAuth Client ID with application type{" "}
                      <em>Web application</em>.
                    </p>
                  </div>
                </li>
                <li>
                  <span>4</span>
                  <div>
                    <strong>Add the redirect URI</strong>
                    <p>
                      Copy the exact URI shown here into Authorized redirect
                      URIs.
                    </p>
                  </div>
                </li>
              </ol>
              <a
                className="btn sm yt-cloud-link"
                href="https://console.cloud.google.com/apis/credentials"
                target="_blank"
                rel="noreferrer"
              >
                Open Google Cloud Console <Icon name="chevronRight" size={13} />
              </a>
            </aside>
            <form
              className="yt-settings-form yt-card"
              onSubmit={(event) => {
                event.preventDefault();
                void saveSettingsAndConnect();
              }}
            >
              <div className="yt-settings-form-head">
                <div>
                  <span className="yt-kicker">Local configuration</span>
                  <h3>OAuth credentials</h3>
                </div>
                {oauthSettings?.configured && (
                  <span className="yt-settings-saved">
                    {managedByEnvironment ? "Server managed" : "Saved locally"}
                  </span>
                )}
              </div>
              {settingsError && (
                <div className="yt-inline-alert yt-inline-alert-error">
                  <span>{settingsError}</span>
                  <button
                    type="button"
                    onClick={() => setSettingsError(null)}
                    aria-label="Dismiss error"
                  >
                    ×
                  </button>
                </div>
              )}
              {managedByEnvironment && (
                <div className="yt-inline-alert">
                  <span>
                    These credentials are managed by the Sidecar environment.
                    Continue to Google, or remove the environment configuration
                    before replacing them here.
                  </span>
                </div>
              )}
              <label className="yt-settings-field">
                <span>Authorized redirect URI</span>
                <div className="yt-settings-copy-row">
                  <input
                    data-testid="youtube-redirect-uri"
                    value={redirectUri}
                    onChange={(event) => setRedirectUri(event.target.value)}
                    spellCheck={false}
                    disabled={managedByEnvironment}
                  />
                  <button
                    type="button"
                    onClick={() => void copyRedirectUri()}
                    disabled={!redirectUri}
                  >
                    <Icon name="copy" size={13} />
                    {copiedRedirect ? "Copied" : "Copy"}
                  </button>
                </div>
                <small>
                  This value must exactly match the redirect URI in Google
                  Cloud.
                </small>
              </label>
              {redirectRequiresHttps && (
                <div className="yt-settings-warning">
                  <Icon name="shield" size={14} />
                  <span>
                    Google only allows plain HTTP for localhost. Tailscale or
                    LAN access needs a stable HTTPS address before this redirect
                    URI can be accepted.
                  </span>
                </div>
              )}
              <label className="yt-settings-field">
                <span>Google OAuth Client ID</span>
                <input
                  data-testid="youtube-client-id"
                  value={clientId}
                  onChange={(event) => setClientId(event.target.value)}
                  placeholder="1234567890-….apps.googleusercontent.com"
                  autoComplete="off"
                  spellCheck={false}
                  disabled={managedByEnvironment}
                />
              </label>
              <label className="yt-settings-field">
                <span>Google OAuth Client Secret</span>
                <input
                  data-testid="youtube-client-secret"
                  type="password"
                  value={clientSecret}
                  onChange={(event) => setClientSecret(event.target.value)}
                  placeholder={
                    oauthSettings?.has_client_secret
                      ? "Saved — leave blank to keep the current secret"
                      : "GOCSPX-…"
                  }
                  autoComplete="new-password"
                  spellCheck={false}
                  disabled={managedByEnvironment}
                />
                <small>
                  The secret is never returned to the browser after it is saved.
                </small>
              </label>
              <div className="yt-settings-security">
                <Icon name="shield" size={14} />
                <span>
                  Stored locally with user-only file permissions. Saving new
                  credentials disconnects the previous OAuth grant.
                </span>
              </div>
              <div className="yt-settings-actions">
                <button
                  className="btn sm"
                  type="button"
                  onClick={() => setSettingsOpen(false)}
                >
                  Cancel
                </button>
                {managedByEnvironment ? (
                  <button
                    className="btn-primary sm"
                    type="button"
                    onClick={() => void connect()}
                    disabled={busy !== null}
                  >
                    {busy === "connect" ? "Opening…" : "Continue to Google"}
                  </button>
                ) : (
                  <button
                    className="btn-primary sm"
                    data-testid="youtube-save-connect"
                    type="submit"
                    disabled={busy !== null}
                  >
                    {busy === "connect"
                      ? "Saving…"
                      : oauthSettings?.configured
                        ? "Save and reconnect"
                        : "Save and continue"}
                  </button>
                )}
              </div>
            </form>
          </div>
        )}
      </Shell>
    );
  }

  const fetchMeta = status?.last_scan_at
    ? `Last fetched ${formatTime(status.last_scan_at)}`
    : "No updates fetched yet";
  return (
    <Shell>
      <div className="yt-heading-row">
        <PanelHead
          title="YouTube library"
          sub="Fetch subscription updates when you are ready, then keep the raw captions you want to read or translate."
        />
        <div className="yt-page-actions">
          <span
            className={`yt-fetch-state${busy === "updates" ? " is-loading" : ""}`}
            aria-live="polite"
          >
            <i />
            {busy === "updates" ? "Checking subscriptions…" : fetchMeta}
          </span>
          {status?.connected ? (
            <button
              className="btn sm"
              type="button"
              onClick={disconnect}
              disabled={busy !== null}
            >
              <Icon name="plug" size={14} />
              {busy === "disconnect" ? "Disconnecting…" : "Disconnect"}
            </button>
          ) : (
            <button
              className="btn sm"
              type="button"
              onClick={connect}
              disabled={busy !== null}
            >
              <BrandIcon name="youtube" size={15} />
              {busy === "connect" ? "Opening…" : "Connect YouTube"}
            </button>
          )}
          <button
            className="btn-primary sm"
            type="button"
            onClick={fetchUpdates}
            disabled={busy !== null || !status?.connected}
          >
            <Icon
              name="refresh"
              size={14}
              className={busy === "updates" ? "yt-spin" : undefined}
            />
            {busy === "updates" ? "Fetching…" : "Get updates"}
          </button>
        </div>
      </div>
      {error && (
        <div className="yt-inline-alert yt-inline-alert-error">
          <span>{error}</span>
          <button
            type="button"
            onClick={() => setError(null)}
            aria-label="Dismiss error"
          >
            ×
          </button>
        </div>
      )}
      {notice && (
        <div className="yt-inline-alert">
          <span>{notice}</span>
          <button
            type="button"
            onClick={() => setNotice(null)}
            aria-label="Dismiss notice"
          >
            ×
          </button>
        </div>
      )}
      <div
        className={`yt-connection yt-card${status?.connected ? "" : " yt-connection-disconnected"}`}
      >
        <span className="yt-connection-mark" role="img" aria-label="YouTube">
          <BrandIcon name="youtube" size={28} />
        </span>
        <div className="yt-connection-copy">
          <strong>
            {status?.connected
              ? "YouTube is connected"
              : status?.configured
                ? "Connect your YouTube account"
                : "YouTube OAuth setup required"}
          </strong>
          <span>
            {status?.connected
              ? `${status.account_title || "Personal account"} · ${status.channel_count} subscriptions synced locally`
              : status?.configured
                ? "Google sign-in is required before updates can be fetched."
                : "Add your Google OAuth credentials here, then continue to sign in."}
          </span>
        </div>
        <div className="yt-connection-actions">
          <button
            className="yt-connection-settings"
            type="button"
            onClick={() => void openSettings()}
          >
            <Icon name="gear" size={13} />
            OAuth settings
          </button>
          <span
            className={`yt-connected-dot${status?.connected ? "" : " yt-disconnected-dot"}`}
          >
            <i />
            {status?.connected ? "Connected" : "Not connected"}
          </span>
        </div>
      </div>
      <div
        className={`yt-connection yt-card yt-translation-connection${translationSettings?.configured ? "" : " yt-connection-disconnected"}`}
      >
        <span className="yt-connection-mark yt-translation-mark" aria-hidden="true">
          <Icon name="sparkle" size={23} />
        </span>
        <div className="yt-connection-copy">
          <strong>
            {translationSettings?.configured
              ? "Translation model is ready"
              : "Translation model setup required"}
          </strong>
          <span>
            {translationSettings?.configured
              ? `${translationSettings.model} · independent YouTube configuration`
              : "Choose an OpenAI-compatible endpoint, model, API key, and Prompt."}
          </span>
        </div>
        <div className="yt-connection-actions">
          <button
            className="yt-connection-settings"
            type="button"
            onClick={() => void openTranslationSettings()}
          >
            <Icon name="gear" size={13} />
            Translation settings
          </button>
          <span
            className={`yt-connected-dot${translationSettings?.last_test_ok ? "" : " yt-disconnected-dot"}`}
          >
            <i />
            {translationSettings?.last_test_ok
              ? "Tested"
              : translationSettings?.configured
                ? "Not tested"
                : "Not configured"}
          </span>
        </div>
      </div>
      {!status?.connected && (
        <div className="yt-setup-card yt-card">
          <div>
            <span className="yt-kicker">First step</span>
            <h3>Connect once, then fetch updates when you want them.</h3>
            <p>
              The OAuth refresh token stays in the local secret store.
              Disconnecting removes the token but keeps your local video
              library.
            </p>
          </div>
          <button
            className="btn-primary sm"
            type="button"
            onClick={connect}
            disabled={busy !== null}
          >
            {busy === "connect" ? "Opening…" : "Connect YouTube"}
          </button>
        </div>
      )}
      <div
        className="yt-view-tabs"
        role="tablist"
        aria-label="YouTube library workspace"
      >
        <button
          type="button"
          role="tab"
          aria-selected={view === "library"}
          className={view === "library" ? "is-active" : ""}
          onClick={() => setView("library")}
        >
          Library <span>{videos.length}</span>
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={view === "reader"}
          className={view === "reader" ? "is-active" : ""}
          onClick={() => setView("reader")}
        >
          Reader <span>{readyCount}</span>
        </button>
      </div>
      {view === "library" && (
        <>
          <div className="yt-summary-row">
            <div>
              <strong>{videos.length}</strong>
              <span>videos in library</span>
            </div>
            <div>
              <strong>{readyCount}</strong>
              <span>captions ready</span>
            </div>
            <div>
              <strong>{translatedCount}</strong>
              <span>Chinese translations</span>
            </div>
            <div>
              <strong>{channelCount}</strong>
              <span>channels</span>
            </div>
          </div>
          <div className="yt-toolbar">
            <span>
              {libraryVideos.length}{" "}
              {libraryVideos.length === 1 ? "video" : "videos"} shown
            </span>
            <div
              className="yt-segmented"
              role="group"
              aria-label="Filter caption status"
            >
              <button
                type="button"
                className={dateFilter === "all" ? "is-active" : ""}
                onClick={() => setDateFilter("all")}
              >
                All history
              </button>
              <button
                type="button"
                className={dateFilter === "today" ? "is-active" : ""}
                onClick={() => setDateFilter("today")}
              >
                Today
              </button>
              <button
                type="button"
                className={dateFilter === "yesterday" ? "is-active" : ""}
                onClick={() => setDateFilter("yesterday")}
              >
                Yesterday
              </button>
              <button
                type="button"
                className={dateFilter === "week" ? "is-active" : ""}
                onClick={() => setDateFilter("week")}
              >
                This week
              </button>
            </div>
          </div>
          <div
            className="yt-browser-tabs"
            role="tablist"
            aria-label="Browse library"
          >
            <span>Browse</span>
            <button
              type="button"
              role="tab"
              aria-selected={browseMode === "date"}
              className={browseMode === "date" ? "is-active" : ""}
              onClick={() => setBrowseMode("date")}
            >
              <Icon name="clock" size={13} />
              By date
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={browseMode === "channel"}
              className={browseMode === "channel" ? "is-active" : ""}
              onClick={() => setBrowseMode("channel")}
            >
              <BrandIcon name="youtube" size={13} />
              By channel
            </button>
          </div>
          {browseMode === "date" ? (
            <div className="yt-history-list">
              {dateGroups.length === 0 && (
                <div className="yt-empty yt-card">
                  No videos match this date range.
                </div>
              )}
              {dateGroups.map((group) => (
                <section className="yt-date-group" key={group.label}>
                  <div className="yt-date-group-head">
                    <span>{group.label}</span>
                    <span>
                      {group.videos.length}{" "}
                      {group.videos.length === 1 ? "video" : "videos"}
                    </span>
                  </div>
                  <div className="yt-list yt-card">{group.videos.map(row)}</div>
                </section>
              ))}
            </div>
          ) : (
            <div className="yt-history-list">
              {channelGroups.length === 0 && (
                <div className="yt-empty yt-card">No channel history yet.</div>
              )}
              {channelGroups.map(([channel, group]) => (
                <section className="yt-channel-group" key={channel}>
                  <div className="yt-channel-group-head">
                    <span className="yt-channel-title">
                      <span className="yt-avatar">
                        {group[0]?.avatar || avatarFor(channel)}
                      </span>
                      <strong>{channel}</strong>
                    </span>
                    <span>
                      {group.length} {group.length === 1 ? "video" : "videos"}
                    </span>
                  </div>
                  <div className="yt-list yt-card">{group.map(row)}</div>
                </section>
              ))}
            </div>
          )}
          {selectedCount > 0 && (
            <div className="yt-selection-bar">
              <span>
                <strong>{selectedCount}</strong> videos selected for translation.
              </span>
              <div className="yt-selection-actions">
                <span className="yt-selection-note">
                  A raw caption is fetched when a video is selected.
                </span>
                <button
                  className="btn-primary sm"
                  type="button"
                  onClick={() => void translateSelected()}
                  disabled={translatingId !== null}
                >
                  <Icon name="sparkle" size={13} />
                  {translatingId ? "Translating…" : "Translate ready"}
                </button>
              </div>
            </div>
          )}
          <p className="yt-footnote">
            <Icon name="database" size={13} /> Local library · original captions
            and Chinese translations · remove any video at any time.
          </p>
        </>
      )}
      {view === "reader" && (
        <div className="yt-reader-layout">
          <section className="yt-reader-queue yt-card">
            <div className="yt-section-label">
              Caption queue <span>{readerVideos.length}</span>
            </div>
            <div
              className="yt-reader-tabs"
              role="tablist"
              aria-label="Caption queue filter"
            >
              <button
                type="button"
                role="tab"
                aria-selected={readerFilter === "all"}
                className={readerFilter === "all" ? "is-active" : ""}
                onClick={() => setReaderFilter("all")}
              >
                All videos <span>{videos.length}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={readerFilter === "selected"}
                className={readerFilter === "selected" ? "is-active" : ""}
                onClick={() => setReaderFilter("selected")}
              >
                Selected <span>{selectedCount}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={readerFilter === "ready"}
                className={readerFilter === "ready" ? "is-active" : ""}
                onClick={() => setReaderFilter("ready")}
              >
                Ready <span>{readyCount}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={readerFilter === "translated"}
                className={readerFilter === "translated" ? "is-active" : ""}
                onClick={() => setReaderFilter("translated")}
              >
                Translated <span>{translatedCount}</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={readerFilter === "attention"}
                className={readerFilter === "attention" ? "is-active" : ""}
                onClick={() => setReaderFilter("attention")}
              >
                Not ready <span>{attentionCount}</span>
              </button>
            </div>
            {readerVideos.map((video) => (
              <button
                className={`yt-reader-item${activeId === video.video_id ? " is-active" : ""}`}
                key={video.video_id}
                type="button"
                onClick={() => setActiveId(video.video_id)}
              >
                <SelectBox
                  checked={video.selected}
                  onClick={() => void toggleSelected(video)}
                />
                <span className="yt-reader-item-copy">
                  <strong>{video.title}</strong>
                  <span>
                    {video.channel_title} · {video.dateLabel}
                  </span>
                </span>
                <span
                  className={`yt-reader-dot yt-reader-dot-${statusClass(video)}`}
                />
              </button>
            ))}
            {readerVideos.length === 0 && (
              <div className="yt-empty">Nothing in this queue.</div>
            )}
          </section>
          <article className="yt-reader-preview yt-card">
            {selectedVideo ? (
              <>
                <div className="yt-preview-header">
                  <div
                    className="yt-preview-switch"
                    role="group"
                    aria-label="Reader language"
                  >
                    <button
                      type="button"
                      className={previewMode === "translation" ? "is-active" : ""}
                      onClick={() => setPreviewMode("translation")}
                      disabled={selectedVideo.translation_status !== "ready"}
                    >
                      Chinese translation
                    </button>
                    <button
                      type="button"
                      className={previewMode === "caption" ? "is-active" : ""}
                      onClick={() => setPreviewMode("caption")}
                    >
                      Original caption
                    </button>
                  </div>
                  <Status video={selectedVideo} />
                </div>
                <div className="yt-preview-channel">
                  <span className="yt-avatar yt-avatar-large">
                    {avatarFor(selectedVideo.channel_title)}
                  </span>
                  <div>
                    <strong>{selectedVideo.channel_title}</strong>
                    <span>
                      {selectedVideo.dateLabel} ·{" "}
                      {selectedVideo.publishedLabel.split(" · ").pop()}
                    </span>
                  </div>
                </div>
                <h3>{selectedVideo.title}</h3>
                <div className="yt-preview-meta">
                  <span>
                    {previewMode === "translation"
                      ? "Simplified Chinese"
                      : selectedVideo.caption?.language_name || "No caption"}
                  </span>
                  <span>·</span>
                  <span>
                    {previewMode === "translation"
                      ? selectedVideo.translation?.model ||
                        selectedVideo.translation_error ||
                        "Not translated"
                      : selectedVideo.caption?.source ||
                        selectedVideo.caption_error ||
                        (captioningId === selectedVideo.video_id
                          ? "Fetching caption…"
                          : "Select to fetch caption")}
                  </span>
                </div>
                <div className="yt-caption-body">
                  {previewMode === "translation"
                    ? detail?.video_id === selectedVideo.video_id &&
                      detail.translation_body
                      ? detail.translation_body
                      : selectedVideo.translation_status === "error"
                        ? selectedVideo.translation_error
                        : translatingId === selectedVideo.video_id
                          ? "Translating the caption into Chinese…"
                          : "Translate this caption to create a Chinese version."
                    : detail?.video_id === selectedVideo.video_id &&
                        detail.caption_body
                      ? detail.caption_body
                      : selectedVideo.caption_status === "error"
                        ? selectedVideo.caption_error
                        : selectedVideo.caption_status === "pending"
                          ? captioningId === selectedVideo.video_id
                            ? "Fetching the best available caption…"
                            : "Select this video to fetch its best available caption."
                          : "Caption body is loading…"}
                </div>
                <div className="yt-preview-actions">
                  <a
                    className="btn sm"
                    href={selectedVideo.url}
                    target="_blank"
                    rel="noreferrer"
                  >
                    Open on YouTube
                  </a>
                  <button
                    className={`btn sm${selectedVideo.selected ? " yt-btn-selected" : ""}`}
                    type="button"
                    onClick={() => void toggleSelected(selectedVideo)}
                    disabled={captioningId === selectedVideo.video_id}
                  >
                    {captioningId === selectedVideo.video_id
                      ? "Fetching caption…"
                      : selectedVideo.selected
                      ? "Selected"
                      : "Select for translation"}
                  </button>
                  <button
                    className="btn-primary sm"
                    type="button"
                    onClick={() => void translateVideo(selectedVideo)}
                    disabled={
                      selectedVideo.caption_status !== "ready" ||
                      translatingId !== null
                    }
                  >
                    <Icon
                      name="sparkle"
                      size={13}
                      className={
                        translatingId === selectedVideo.video_id
                          ? "yt-spin"
                          : undefined
                      }
                    />
                    {translatingId === selectedVideo.video_id
                      ? "Translating…"
                      : selectedVideo.translation_status === "ready"
                        ? "Translate again"
                        : "Translate to Chinese"}
                  </button>
                  <button
                    className="btn sm danger-btn"
                    type="button"
                    onClick={() => void removeVideo(selectedVideo)}
                  >
                    <Icon name="trash" size={13} /> Delete
                  </button>
                </div>
              </>
            ) : (
              <div className="yt-empty-state">
                <span>Select a video to inspect its caption.</span>
              </div>
            )}
          </article>
        </div>
      )}
    </Shell>
  );
}
