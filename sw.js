// Lets phones install the game as an app (full screen, no browser bar). It caches nothing:
// every request goes to the network as usual, so a new deploy shows up on the next start.
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));
self.addEventListener('fetch', (event) => event.respondWith(fetch(event.request)));
