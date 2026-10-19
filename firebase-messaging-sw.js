/* Firebase Messaging service worker.
   Replace YOUR_FIREBASE_WEB_API_KEY with the same web API key used in script.js.
   For automatic background push, a trusted backend must send an FCM message to the registered token. */
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js");
importScripts("https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js");

firebase.initializeApp({
  apiKey: "YOUR_FIREBASE_WEB_API_KEY",
  authDomain: "smartmonitor-37eb1.firebaseapp.com",
  databaseURL: "https://smartmonitor-37eb1-default-rtdb.firebaseio.com",
  projectId: "smartmonitor-37eb1",
  storageBucket: "smartmonitor-37eb1.firebasestorage.app",
  messagingSenderId: "834907305033",
  appId: "1:834907305033:web:4df2971addd9cb1c453b98"
});

const messaging = firebase.messaging();

// Background messages are displayed by the browser when the backend sends a notification payload.
messaging.onBackgroundMessage((payload) => {
  const title = (payload.notification && payload.notification.title) || "Smart Soil Monitor";
  const options = {
    body: (payload.notification && payload.notification.body) || "Có cảnh báo mới từ cảm biến độ ẩm đất.",
    data: payload.data || {},
    tag: "smart-soil-alert"
  };
  self.registration.showNotification(title, options);
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(clients.matchAll({ type: "window", includeUncontrolled: true }).then((clientList) => {
    for (const client of clientList) {
      if ("focus" in client) return client.focus();
    }
    if (clients.openWindow) return clients.openWindow("./");
  }));
});
