import { expect } from "@playwright/test";
import { test } from "./fixtures";

const SIDECAR_REDIRECT_URI = "http://127.0.0.1:8765/v1/youtube/oauth/callback";

async function mockYouTube(page, initialConfigured = false) {
  let configured = initialConfigured;
  let clientId = initialConfigured
    ? "existing-client.apps.googleusercontent.com"
    : "";
  let hasClientSecret = initialConfigured;
  let startRedirectUri: string | null = null;

  await page.route("**/v1/youtube/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/v1/youtube/status") {
      return json({
        configured,
        connected: false,
        needs_authorization: true,
        subscriptions_synced_at: null,
        last_scan_at: null,
        channel_count: 0,
        video_count: 0,
      });
    }
    if (path === "/v1/youtube/videos") return json({ videos: [] });
    if (path === "/v1/youtube/oauth/settings" && request.method() === "GET") {
      return json({
        configured,
        client_id: clientId,
        has_client_secret: hasClientSecret,
        redirect_uri: SIDECAR_REDIRECT_URI,
        source: configured ? "local" : "none",
      });
    }
    if (path === "/v1/youtube/oauth/settings" && request.method() === "PUT") {
      const body = request.postDataJSON();
      configured = true;
      clientId = body.client_id;
      hasClientSecret = true;
      return json({
        ok: true,
        configured: true,
        client_id: clientId,
        has_client_secret: true,
        redirect_uri: body.redirect_uri,
        source: "local",
      });
    }
    if (path === "/v1/youtube/oauth/start") {
      startRedirectUri = new URL(request.url()).searchParams.get(
        "redirect_uri",
      );
      return json({
        ok: true,
        authorization_url: "https://accounts.google.test/youtube",
      });
    }
    return route.fallback();
  });

  return { startRedirectUri: () => startRedirectUri };
}

async function installPopupRecorder(page) {
  await page.addInitScript(() => {
    const state = window as typeof window & {
      __youtubeAssignedUrl: string | null;
    };
    state.__youtubeAssignedUrl = null;
    window.open = (() =>
      ({
        opener: null,
        location: {
          assign(next: string) {
            state.__youtubeAssignedUrl = next;
          },
        },
        close() {},
      }) as unknown as Window) as typeof window.open;
  });
}

async function openYouTube(page) {
  await page.goto("/");
  await page.getByTestId("nav-youtube").click();
}

test("an unconfigured Connect YouTube opens settings inside the library", async ({
  page,
}) => {
  await mockYouTube(page);
  await openYouTube(page);

  await page
    .locator("button")
    .filter({ hasText: "Connect YouTube" })
    .first()
    .click();

  await expect(
    page.getByRole("heading", { name: "Connect YouTube" }),
  ).toBeVisible();
  await expect(page.getByTestId("youtube-client-id")).toBeVisible();
  await expect(page.getByTestId("youtube-client-secret")).toBeVisible();
  await expect(page.getByTestId("youtube-redirect-uri")).toHaveValue(
    new URL("/v1/youtube/oauth/callback", page.url()).toString(),
  );
  await expect(
    page.getByRole("button", { name: "Back to library" }),
  ).toBeVisible();
});

test("saving OAuth settings continues directly to Google authorization", async ({
  page,
}) => {
  await installPopupRecorder(page);
  await mockYouTube(page);
  await openYouTube(page);

  await page
    .locator("button")
    .filter({ hasText: "Connect YouTube" })
    .first()
    .click();
  await page
    .getByTestId("youtube-client-id")
    .fill("new-client.apps.googleusercontent.com");
  await page.getByTestId("youtube-client-secret").fill("local-secret");
  await page.getByTestId("youtube-save-connect").click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __youtubeAssignedUrl: string | null })
            .__youtubeAssignedUrl,
      ),
    )
    .toBe("https://accounts.google.test/youtube");
  await expect(
    page.getByText("Finish Google sign-in in the new tab, then return here."),
  ).toBeVisible();
});

test("an already configured Connect YouTube opens authorization immediately", async ({
  page,
}) => {
  await installPopupRecorder(page);
  const youtube = await mockYouTube(page, true);
  await openYouTube(page);

  await page
    .locator("button")
    .filter({ hasText: "Connect YouTube" })
    .first()
    .click();

  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as typeof window & { __youtubeAssignedUrl: string | null })
            .__youtubeAssignedUrl,
      ),
    )
    .toBe("https://accounts.google.test/youtube");
  expect(youtube.startRedirectUri()).toBe(
    new URL("/v1/youtube/oauth/callback", page.url()).toString(),
  );
  await expect(
    page.getByRole("heading", { name: "Connect YouTube" }),
  ).toHaveCount(0);
});

test("Get updates discovers videos and selection fetches only the chosen caption", async ({
  page,
}) => {
  let selected = false;
  let captionReady = false;
  let captionRequests = 0;
  const video = () => ({
    video_id: "abc",
    channel_id: "chan",
    channel_title: "Channel",
    title: "Fresh video",
    url: "https://youtu.be/abc",
    published_at: "2026-08-20T00:00:00Z",
    published_ts: 1787184000,
    discovered_at: 1787220000,
    selected,
    caption_status: captionReady ? "ready" : "pending",
    caption_error: null,
    caption: captionReady
      ? {
          language_code: "en",
          language_name: "English",
          track_kind: "standard",
          source: "test",
        }
      : null,
    caption_body: captionReady ? "Hello" : null,
  });

  await page.route("**/v1/youtube/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(body),
      });
    if (path === "/v1/youtube/status")
      return json({
        configured: true,
        connected: true,
        needs_authorization: false,
        account_title: "Vincent",
        subscriptions_synced_at: 1787220000,
        last_scan_at: 1787220000,
        channel_count: 1,
        video_count: 1,
      });
    if (path === "/v1/youtube/videos" && request.method() === "GET") {
      return json({ videos: [video()] });
    }
    if (path === "/v1/youtube/updates" && request.method() === "POST") {
      return json({
        ok: true,
        discovered: 1,
        channel_failures: [],
        scan_finished_at: 1787220000,
      });
    }
    if (path === "/v1/youtube/videos/abc" && request.method() === "PATCH") {
      selected = request.postDataJSON().selected;
      return json({ ok: true, video: video() });
    }
    if (
      path === "/v1/youtube/videos/abc/caption" &&
      request.method() === "POST"
    ) {
      captionRequests += 1;
      captionReady = true;
      return json({ ok: true, video: video() });
    }
    if (path === "/v1/youtube/videos/abc" && request.method() === "GET") {
      return json({ video: video() });
    }
    return route.fallback();
  });

  await openYouTube(page);
  await page.getByRole("button", { name: "Get updates" }).click();
  expect(captionRequests).toBe(0);

  await page.getByRole("checkbox", { name: "Select for translation" }).click();

  await expect.poll(() => captionRequests).toBe(1);
  await expect(page.getByText("Caption ready").first()).toBeVisible();
});

test("YouTube translation has local model settings, a test action, and Chinese output", async ({
  page,
}) => {
  let configured = false;
  let translated = false;
  let testRequests = 0;
  const video = () => ({
    video_id: "abc",
    channel_id: "chan",
    channel_title: "Channel",
    title: "Fresh video",
    url: "https://youtu.be/abc",
    published_at: "2026-08-20T00:00:00Z",
    published_ts: 1787184000,
    discovered_at: 1787220000,
    selected: true,
    caption_status: "ready",
    caption_error: null,
    caption: {
      language_code: "en",
      language_name: "English",
      track_kind: "standard",
      source: "test",
    },
    caption_body: "Hello",
    translation_status: translated ? "ready" : "pending",
    translation_error: null,
    translation: translated
      ? { language_code: "zh-CN", model: "translator-model", translated_at: 1 }
      : null,
    translation_body: translated ? "你好" : null,
  });

  await page.route("**/v1/youtube/**", async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname;
    const json = (body: unknown) =>
      route.fulfill({ contentType: "application/json", body: JSON.stringify(body) });
    if (path === "/v1/youtube/status")
      return json({
        configured: true,
        connected: true,
        needs_authorization: false,
        account_title: "Vincent",
        channel_count: 1,
        video_count: 1,
      });
    if (path === "/v1/youtube/videos" && request.method() === "GET")
      return json({ videos: [video()] });
    if (path === "/v1/youtube/videos/abc" && request.method() === "GET")
      return json({ video: video() });
    if (path === "/v1/youtube/translation/settings" && request.method() === "GET")
      return json({
        configured,
        base_url: configured ? "https://models.example/v1" : "",
        model: configured ? "translator-model" : "",
        has_api_key: configured,
        prompt: "Translate to Chinese:\n{caption}",
      });
    if (path === "/v1/youtube/translation/settings" && request.method() === "PUT") {
      configured = true;
      return json({ ok: true, configured: true, has_api_key: true, ...request.postDataJSON() });
    }
    if (path === "/v1/youtube/translation/test" && request.method() === "POST") {
      testRequests += 1;
      return json({ ok: true, checked_at: 1 });
    }
    if (path === "/v1/youtube/videos/abc/translate" && request.method() === "POST") {
      translated = true;
      return json({ ok: true, video: video() });
    }
    return route.fallback();
  });

  await openYouTube(page);
  await page.getByRole("button", { name: "Translation settings" }).click();
  await page.getByTestId("youtube-translation-base-url").fill("https://models.example/v1");
  await page.getByTestId("youtube-translation-model").fill("translator-model");
  await page.getByTestId("youtube-translation-api-key").fill("translation-key");
  await page.getByRole("button", { name: "Save and test" }).click();
  await expect.poll(() => testRequests).toBe(1);
  await expect(page.getByText("Model connection verified.")).toBeVisible();
  await page.getByRole("button", { name: "Back to library" }).click();

  await page.getByText("Fresh video", { exact: true }).click();
  await page.getByRole("button", { name: "Translate to Chinese" }).click();
  await expect(page.getByText("你好", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Original caption" }).click();
  await expect(page.getByText("Hello", { exact: true })).toBeVisible();
});
