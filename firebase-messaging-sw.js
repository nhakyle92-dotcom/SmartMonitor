
importScripts(
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js'
);
importScripts(
  'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js'
);

firebase.initializeApp({
  apiKey: "AIzaSyC_nR9b_Yc1V_kl74DNs1xHgZ3SYxKZJQk",
  authDomain: "smartmonitor-37eb1.firebaseapp.com",
  databaseURL: "https://smartmonitor-37eb1-default-rtdb.firebaseio.com",
  projectId: "smartmonitor-37eb1",
  storageBucket: "smartmonitor-37eb1.firebasestorage.app",
  messagingSenderId: "834907305033",
  appId: "1:834907305033:web:4df2971addd9cb1c453b98",
  measurementId: "G-B2NT2XX8NK"
});

firebase.messaging();
