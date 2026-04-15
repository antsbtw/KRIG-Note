/**
 * Shared persisted session partition for all webview-backed surfaces.
 *
 * When Chromium storage inside an old partition becomes corrupted,
 * bumping this value gives WebView / AIView a clean browser profile
 * without changing the rest of the loading pipeline.
 */
export const WEBVIEW_PARTITION = 'persist:web-v2';
