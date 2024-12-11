const version = '0.1.A.0.454';
const html = [
    '/',
    '/index.html',
];
const css = [
    '/css/reader.css',
    '/css/animation.css',
    '/css/horizontal.css',
    '/css/vertical.css',
    '/css/normalize.css',
    '/css/fonts.css',
];
const js = [
    '/js/mime.js',
    '/js/badge.js',
    '/js/signaling.js',
    '/js/manga.js',
    '/js/plugin.js',
    '/js/psd.js',
];
const wasm = [
    '/wasm/plugin.wasm',
];
const img = [
    '/cursor/arrow_left.cur',
    '/cursor/arrow_right.cur',
    '/img/angle-down-duotone.svg',
    '/img/angle-up-duotone.svg',
    '/img/books-duotone.svg',
    '/img/c.svg',
    '/img/chart-network-duotone.svg',
    '/img/check-duotone.svg',
    '/img/close.svg',
    '/img/copy-duotone.svg',
    '/img/dir.png',
    '/img/download-duotone.svg',
    '/img/error.svg',
    '/img/expand-wide-duotone.svg',
    '/img/folder-open-duotone.svg',
    '/img/folder-open-light.svg',
    '/img/hamburger.svg',
    '/img/help.png',
    '/img/logo-candidate-1.svg',
    '/img/ltr.png',
    '/img/paste-duotone.svg',
    '/img/rotate-right-duotone.svg',
    '/img/scroll.png',
    '/img/sliders-h-duotone.svg',
    '/img/spinner-third-duotone.svg',
    '/img/stars.svg',
    '/img/sun.svg',
    '/img/sync-duotone.svg',
];
const cdn = [
    '//cdn.staticfile.org/firebase/10.7.2/firebase-app-compat.js',
    '//cdn.staticfile.org/firebase/10.7.2/firebase-auth-compat.js',
    '//cdn.staticfile.org/firebase/10.7.2/firebase-database-compat.js',
];
const resources = Array.prototype.concat(html, css, js, wasm, img, cdn);

// Cache all resources on Service-Worker install
async function precache() {
    return caches.open(version).then(cache => cache.addAll(resources));
}

// Cache First
async function fetch(request) {
    const cachedResponse = await caches.match(request);
    if (cachedResponse) {
        return cachedResponse;
    }
    try {
        const networkResponse = await fetch(request);
        if (networkResponse.ok) {
            const cache = await caches.open(version);
            cache.put(request, networkResponse.clone());
        }
        return networkResponse;
    } catch (error) {
        return Response.error();
    }
}

self.importScripts('/js/badge.js');

self.addEventListener("install", (event) => {
    console.log(...Badge.args(badges.ServiceWorker), 'Install event');
    // Kill running out-dated service worker
    self.skipWaiting();
    // Send current version code to window
    clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
        console.log(...Badge.args(badges.ServiceWorker), 'Clients:', clients);
        clients.forEach(client => {
            console.log(...Badge.args(badges.ServiceWorker), 'Client:', client);
            // Send message to window
            client.postMessage({ command: 'version', version: version });
        });
    });
    // Cache all resources
    event.waitUntil(precache());
});

self.addEventListener("fetch", (event) => {
    // console.log(...Badge.args(badges.ServiceWorker), 'Fetch event:', event.request.url);
    const url = new URL(event.request.url);
    if (resources.includes(url.pathname)) {
        event.respondWith(fetch(event.request));
    }
});

// Delete out-dated cache
self.addEventListener("activate", event => {
    console.log(...Badge.args(badges.ServiceWorker), 'Activate event');
    event.waitUntil(
        caches.keys().then(versions => {
            return Promise.all([
                // Update all client Service Worker
                self.clients.claim(),
                // Delete out-dated cache
                versions.map(entry => {
                    if (entry !== version) {
                        console.info(...Badge.args(badges.ServiceWorker), 'Deleting cache entry:', entry)
                        return caches.delete(entry);
                    }
                })
            ]);
        }).then(
            // Send reload command to window
            clients.matchAll({ includeUncontrolled: true, type: 'window' }).then(clients => {
                clients.forEach(client => {
                    // Send message to window
                    client.postMessage({ command: 'reload' });
                });
            })
        )
    );
});