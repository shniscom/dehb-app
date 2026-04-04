// firebase-messaging-sw.js — FCM Service Worker
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-app-compat.js');
importScripts('https://www.gstatic.com/firebasejs/10.7.1/firebase-messaging-compat.js');

firebase.initializeApp({
  apiKey:            "AIzaSyC9RljovCj2oZJhQnCKifl_OqPkuEgQO_c",
  authDomain:        "gorev-kahramani-df6b2.firebaseapp.com",
  projectId:         "gorev-kahramani-df6b2",
  storageBucket:     "gorev-kahramani-df6b2.firebasestorage.app",
  messagingSenderId: "591412780640",
  appId:             "1:591412780640:web:cfb136e913761007516d05",
});

const messaging = firebase.messaging();

messaging.onBackgroundMessage(payload => {
  const { title, body } = payload.notification || {};
  const url = payload.data?.url || '/';
  self.registration.showNotification(title || 'Görev Kahramanı', {
    body:    body || '',
    icon:    '/icons/icon-192.png',
    badge:   '/icons/badge-72.png',
    tag:     payload.data?.tag || 'gk',
    data:    { url },
    vibrate: [100, 50, 100],
  });
});

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const url = event.notification.data?.url || '/';
  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(clientList => {
      for (const client of clientList) {
        if ('focus' in client) return client.focus();
      }
      if (clients.openWindow) return clients.openWindow(url);
    })
  );
});
