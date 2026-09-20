'use strict';
/**
 * sw.js — Service Worker cho ứng dụng PWA (AMS Pro)
 * Chiến lược:
 *   - Tài nguyên tĩnh (HTML/CSS/JS/Icons): Cache-first với Stale-while-revalidate ngầm.
 *   - Điều hướng (navigate): Mạng trước, fallback về trang /index.html trong cache khi offline.
 *   - API (/api/*): Mạng trực tiếp, khi ngoại tuyến trả về JSON báo offline lịch sự.
 */

const CACHE_NAME = 'ams-pwa-v1.2.0';

const PRECACHE_ASSETS = [
  '/',
  '/index.html',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable.png',
  '/css/app.css',
  '/js/core.js',
  '/js/ui.js',
  '/js/pages.js',
  '/js/scan.js',
  '/js/app.js',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(PRECACHE_ASSETS).catch((err) => {
        console.warn('[SW] Cảnh báo precache một số tài sản:', err);
      });
    }).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k))
      );
    }).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Không can thiệp vào các phương thức ghi dữ liệu (POST, PUT, DELETE, ...)
  if (req.method !== 'GET') return;

  // Xử lý API
  if (url.pathname.startsWith('/api/')) {
    event.respondWith(
      fetch(req).catch(() => {
        return new Response(
          JSON.stringify({
            success: false,
            offline: true,
            error: 'Thiết bị đang ngoại tuyến. Vui lòng kết nối mạng để tải dữ liệu máy chủ.',
          }),
          {
            status: 503,
            headers: { 'Content-Type': 'application/json; charset=utf-8' },
          }
        );
      })
    );
    return;
  }

  // Điều hướng màn hình (SPA fallback)
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => {
        return caches.match('/index.html').then((res) => {
          return res || caches.match('/');
        });
      })
    );
    return;
  }

  // Tài nguyên tĩnh: Stale-While-Revalidate
  event.respondWith(
    caches.match(req).then((cached) => {
      const fetchPromise = fetch(req).then((networkRes) => {
        if (networkRes && networkRes.status === 200) {
          const clone = networkRes.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, clone));
        }
        return networkRes;
      }).catch(() => null);

      return cached || fetchPromise;
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
