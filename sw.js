// Minimal service worker — exists only so browsers consider SplitBooks
// installable as a home-screen app. It intentionally does NOT cache or
// serve stale data: this is a live-synced finance app, and showing an old
// cached balance instead of a network error would be worse than no
// offline support at all. Every request just passes straight through to
// the network.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', () => {
  // No respondWith() call — default browser network handling applies.
});
