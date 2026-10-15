/**
 * Cloudflare Worker entrypoint for Curate's Vite static frontend.
 *
 * Static assets are served by Cloudflare's assets router first. This handler
 * is the fallback for requests that do not match a static file.
 */
export default {
  async fetch(request, env) {
    return env.ASSETS.fetch(request);
  },
};
