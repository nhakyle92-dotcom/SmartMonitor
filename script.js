/* Smart Soil Monitor - Firebase Realtime Database + browser notifications
   Replace the Firebase config values below with your own project's web config.
   Do not put service-account credentials or FCM server keys in this file. */
(() => {
  "use strict";

  const firebaseConfig = {
    apiKey: "YOUR_FIREBASE_WEB_API_KEY",
    authDomain: "smartmonitor-37eb1.firebaseapp.com",
    databaseURL: "https://smartmonitor-37eb1-default-rtdb.firebaseio.com",
    projectId: "smartmonitor-37eb1",
    storageBucket: "smartmonitor-37eb1.firebasestorage.app",
    messagingSenderId: "834907305033",
    appId: "1:834907305033:web:4df2971addd9cb1c453b98"
  };

  // Public VAPID key from Firebase Console > Project settings > Cloud Messaging > Web Push certificates.
  const FCM_VAPID_PUBLIC_KEY = "YOUR_FIREBASE_WEB_PUSH_VAPID_PUBLIC_KEY";
  const DEFAULT_LOW = 30;
  const DEFAULT_HIGH = 70;
  const MAX_TABLE_ROWS = 100;

  let db = null;
  let messaging = null;
  let chart = null;
  let readings = [];
  let alertRows = [];
  let thresholdLow = DEFAULT_LOW;
  let thresholdHigh = DEFAULT_HIGH;
  let previousState = "unknown";
  let initializedReadings = false;
  let currentPeriod = "7days";
  let latestReading = null;
  let saveLock = false;

  const $ = (id) => document.getElementById(id);

  function setText(id, value) {
    const node = $(id);
    if (node) node.textContent = value;
  }

  function showConnection(ok, text) {
    const badge = $("connection-badge");
    badge.textContent = text;
    badge.className = "badge " + (ok ? "badge-good" : "badge-muted");
  }

  function dateFromTimestamp(value) {
    let n = Number(value || 0);
    if (!Number.isFinite(n) || n <= 0) return null;
    if (n < 1000000000000) n *= 1000;
    const date = new Date(n);
    return Number.isNaN(date.getTime()) ? null : date;
  }

  function formatDate(value) {
    const date = value instanceof Date ? value : dateFromTimestamp(value);
    if (!date) return "Chưa có thời gian";
    return new Intl.DateTimeFormat("vi-VN", {
      day: "2-digit", month: "2-digit", year: "numeric",
      hour: "2-digit", minute: "2-digit", second: "2-digit"
    }).format(date);
  }

  function dayStart(date = new Date()) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
  }

  function classify(moisture) {
    if (!Number.isFinite(Number(moisture))) return "unknown";
    if (Number(moisture) < thresholdLow) return "low";
    if (Number(moisture) > thresholdHigh) return "high";
    return "good";
  }

  function statusText(state) {
    if (state === "low") return "Độ ẩm thấp";
    if (state === "high") return "Độ ẩm cao";
    if (state === "good") return "Trong ngưỡng";
    return "Đang chờ dữ liệu";
  }

  function renderCurrent(reading) {
    if (!reading) {
      setText("current-moisture", "--");
      setText("current-adc", "--");
      setText("last-updated", "Chưa nhận dữ liệu");
      $("status-pill").textContent = "Đang chờ dữ liệu";
      $("status-pill").className = "status-pill status-unknown";
      return;
    }
    setText("current-moisture", `${reading.moisture}`);
    setText("current-adc", Number.isFinite(reading.adc) ? `${reading.adc}` : "--");
    setText("last-updated", `Cập nhật: ${formatDate(reading.timestamp)}`);
    const state = classify(reading.moisture);
    $("status-pill").textContent = statusText(state);
    $("status-pill").className = `status-pill status-${state}`;
  }

  function renderReadingsTable() {
    const tbody = $("readings-table");
    const list = readings.slice(-MAX_TABLE_ROWS).reverse();
    setText("reading-count", `${readings.length} bản ghi`);
    if (!list.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Chưa có dữ liệu lịch sử.</td></tr>';
      return;
    }
    tbody.innerHTML = list.map((r) => {
      const state = classify(r.moisture);
      const stateClass = state === "good" ? "state-ok" : (state === "unknown" ? "state-warn" : "state-alert");
      return `<tr><td>${escapeHtml(formatDate(r.timestamp))}</td><td><strong>${escapeHtml(r.moisture)}%</strong></td><td>${escapeHtml(Number.isFinite(r.adc) ? r.adc : "--")}</td><td><span class="state-label ${stateClass}">${escapeHtml(statusText(state))}</span></td></tr>`;
    }).join("");
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, (char) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    }[char]));
  }

  function renderAverage() {
    const todayRows = readings.filter((r) => {
      const d = dateFromTimestamp(r.timestamp);
      return d && d.getTime() >= dayStart();
    });
    if (!todayRows.length) {
      setText("average-moisture", "--");
      return;
    }
    const avg = todayRows.reduce((sum, r) => sum + r.moisture, 0) / todayRows.length;
    setText("average-moisture", Math.round(avg));
  }

  function getAlertState(r) {
    const state = classify(r.moisture);
    if (state === "low") return { type: "LOW", label: "Độ ẩm thấp", detail: `Thấp hơn ngưỡng ${thresholdLow}%` };
    if (state === "high") return { type: "HIGH", label: "Độ ẩm cao", detail: `Cao hơn ngưỡng ${thresholdHigh}%` };
    return null;
  }

  function makeAlertRows() {
    const out = [];
    let previous = "unknown";
    for (const r of readings) {
      const state = classify(r.moisture);
      if (state !== previous && (state === "low" || state === "high")) {
        const alert = getAlertState(r);
        out.push({
          key: `${r.key || r.timestamp}-${alert.type}`,
          timestamp: r.timestamp,
          moisture: r.moisture,
          type: alert.type,
          label: alert.label,
          detail: alert.detail
        });
      }
      previous = state;
    }
    return out.reverse();
  }

  function renderAlerts() {
    const tbody = $("alerts-table");
    alertRows = makeAlertRows();
    setText("abnormal-count", `${alertRows.length} sự kiện`);
    const todayCount = alertRows.filter((a) => {
      const d = dateFromTimestamp(a.timestamp);
      return d && d.getTime() >= dayStart();
    }).length;
    setText("alert-count", todayCount);
    if (!alertRows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Chưa có cảnh báo.</td></tr>';
      return;
    }
    tbody.innerHTML = alertRows.slice(0, MAX_TABLE_ROWS).map((a) =>
      `<tr><td>${escapeHtml(formatDate(a.timestamp))}</td><td><span class="state-label state-alert">${escapeHtml(a.label)}</span></td><td><strong>${escapeHtml(a.moisture)}%</strong></td><td>${escapeHtml(a.detail)}</td></tr>`
    ).join("");
  }

  function renderChart() {
    const canvas = $("moisture-chart");
    const now = Date.now();
    const from = currentPeriod === "today" ? dayStart() : now - 7 * 24 * 60 * 60 * 1000;
    const filtered = readings.filter((r) => {
      const d = dateFromTimestamp(r.timestamp);
      return d && d.getTime() >= from;
    });
    $("chart-empty").style.display = filtered.length ? "none" : "block";
    canvas.style.display = filtered.length ? "block" : "none";
    if (chart) {
      chart.destroy();
      chart = null;
    }
    if (!filtered.length || typeof Chart === "undefined") return;
    const labels = filtered.map((r) => {
      const d = dateFromTimestamp(r.timestamp);
      return d ? new Intl.DateTimeFormat("vi-VN", {
        day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit"
      }).format(d) : "";
    });
    chart = new Chart(canvas, {
      type: "line",
      data: {
        labels,
        datasets: [{
          label: "Độ ẩm đất (%)",
          data: filtered.map((r) => r.moisture),
          borderColor: "#176b4d",
          backgroundColor: "rgba(23,107,77,.12)",
          fill: true, tension: .28, pointRadius: filtered.length > 80 ? 0 : 2,
          pointHoverRadius: 5, borderWidth: 2
        }]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        interaction: { intersect: false, mode: "index" },
        plugins: { legend: { display: false } },
        scales: {
          y: { min: 0, max: 100, ticks: { callback: (v) => `${v}%` }, grid: { color: "#edf2ee" } },
          x: { ticks: { maxTicksLimit: 8, maxRotation: 0 }, grid: { display: false } }
        }
      }
    });
  }

  function renderAll() {
    renderCurrent(latestReading);
    renderReadingsTable();
    renderAverage();
    renderAlerts();
    renderChart();
  }

  async function addPersistentAlert(reading, state) {
    if (!db || !reading || !["low", "high"].includes(state)) return;
    const date = dateFromTimestamp(reading.timestamp);
    const keyTime = date ? date.getTime() : Date.now();
    // Stable key prevents the same threshold crossing from being saved repeatedly.
    const key = `${keyTime}_${state}_${reading.moisture}`.replace(/[.#$[\]/]/g, "_");
    const ref = db.ref(`alerts/${key}`);
    try {
      const snap = await ref.once("value");
      if (snap.exists()) return;
      await ref.set({
        timestamp: keyTime,
        moisture: reading.moisture,
        adc: Number.isFinite(reading.adc) ? reading.adc : null,
        type: state,
        message: state === "low"
          ? `Độ ẩm ${reading.moisture}% thấp hơn ngưỡng ${thresholdLow}%.`
          : `Độ ẩm ${reading.moisture}% cao hơn ngưỡng ${thresholdHigh}%.`
      });
    } catch (error) {
      console.warn("Không lưu được cảnh báo vào Firebase:", error);
    }
  }

  function showBrowserNotification(reading, state) {
    if (!("Notification" in window) || Notification.permission !== "granted") return;
    const title = state === "low" ? "⚠️ Độ ẩm đất thấp" : "⚠️ Độ ẩm đất cao";
    const body = state === "low"
      ? `Độ ẩm hiện tại ${reading.moisture}%, thấp hơn ngưỡng ${thresholdLow}%.`
      : `Độ ẩm hiện tại ${reading.moisture}%, cao hơn ngưỡng ${thresholdHigh}%.`;
    try {
      const notification = new Notification(title, { body, icon: "./icon.png", tag: `soil-${state}` });
      notification.onclick = () => window.focus();
    } catch (e) {
      console.warn("Trình duyệt không tạo được thông báo:", e);
    }
  }

  function checkCrossing(reading) {
    const state = classify(reading.moisture);
    if (initializedReadings && state !== previousState && (state === "low" || state === "high")) {
      showBrowserNotification(reading, state);
      addPersistentAlert(reading, state);
    }
    previousState = state;
    initializedReadings = true;
  }

  function normalizeRows(value) {
    if (!value || typeof value !== "object") return [];
    return Object.entries(value).map(([key, raw]) => {
      if (!raw || typeof raw !== "object") return null;
      const moisture = Number(raw.moisture);
      const adc = Number(raw.adc);
      const timestamp = Number(raw.timestamp || raw.time || 0);
      if (!Number.isFinite(moisture) || moisture < 0 || moisture > 100) return null;
      return { key, moisture, adc: Number.isFinite(adc) ? adc : NaN, timestamp };
    }).filter(Boolean).sort((a, b) => (Number(a.timestamp) || 0) - (Number(b.timestamp) || 0));
  }

  async function loadSettings() {
    try {
      const snap = await db.ref("settings").once("value");
      const settings = snap.val() || {};
      thresholdLow = Number.isFinite(Number(settings.thresholdLow)) ? Number(settings.thresholdLow) : DEFAULT_LOW;
      thresholdHigh = Number.isFinite(Number(settings.thresholdHigh)) ? Number(settings.thresholdHigh) : DEFAULT_HIGH;
      if (thresholdLow < 0 || thresholdLow > 99) thresholdLow = DEFAULT_LOW;
      if (thresholdHigh < 1 || thresholdHigh > 100) thresholdHigh = DEFAULT_HIGH;
      if (thresholdLow >= thresholdHigh) {
        thresholdLow = DEFAULT_LOW;
        thresholdHigh = DEFAULT_HIGH;
      }
      $("threshold-low").value = thresholdLow;
      $("threshold-high").value = thresholdHigh;
      setText("settings-message", "Đã tải cài đặt từ Firebase.");
    } catch (error) {
      setText("settings-message", "Không đọc được cài đặt. Kiểm tra quyền Firebase Database.");
      console.error(error);
    }
  }

  async function saveSettings() {
    if (saveLock) return;
    const low = Number($("threshold-low").value);
    const high = Number($("threshold-high").value);
    if (!Number.isInteger(low) || !Number.isInteger(high) || low < 0 || high > 100 || low >= high) {
      setText("settings-message", "Nhập số nguyên hợp lệ: 0 ≤ ngưỡng thấp < ngưỡng cao ≤ 100.");
      return;
    }
    saveLock = true;
    $("save-settings").disabled = true;
    setText("settings-message", "Đang lưu…");
    try {
      await db.ref("settings").update({ thresholdLow: low, thresholdHigh: high, updatedAt: Date.now() });
      thresholdLow = low;
      thresholdHigh = high;
      previousState = latestReading ? classify(latestReading.moisture) : "unknown";
      setText("settings-message", `Đã lưu: cảnh báo dưới ${low}% hoặc trên ${high}%.`);
      renderAll();
    } catch (error) {
      console.error(error);
      setText("settings-message", "Lưu thất bại. Kiểm tra quyền ghi /settings trong Firebase Rules.");
    } finally {
      saveLock = false;
      $("save-settings").disabled = false;
    }
  }

  async function enableNotifications() {
    if (!("Notification" in window)) {
      setText("notification-status", "Trình duyệt này không hỗ trợ Notification API.");
      return;
    }
    if (!window.isSecureContext) {
      setText("notification-status", "Thông báo cần HTTPS hoặc localhost. Hãy mở website bằng HTTPS.");
      return;
    }
    if (Notification.permission === "denied") {
      setText("notification-status", "Quyền thông báo đang bị chặn trong cài đặt trình duyệt.");
      return;
    }
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") {
        setText("notification-status", "Bạn chưa cấp quyền thông báo.");
        return;
      }
      // Basic browser notifications work while this page is open.
      setText("notification-status", "Đã bật thông báo trên trang này.");
      if (!firebase.messaging || FCM_VAPID_PUBLIC_KEY.startsWith("YOUR_")) {
        setText("notification-status", "Đã bật thông báo khi trang mở. Điền VAPID public key để đăng ký FCM push.");
        return;
      }
      if (!("serviceWorker" in navigator)) {
        setText("notification-status", "Đã bật thông báo khi trang mở; trình duyệt không hỗ trợ service worker.");
        return;
      }
      messaging = firebase.messaging();
      const registration = await navigator.serviceWorker.register("./firebase-messaging-sw.js");
      const token = await messaging.getToken({
        vapidKey: FCM_VAPID_PUBLIC_KEY,
        serviceWorkerRegistration: registration
      });
      if (token) {
        $("fcm-token").value = token;
        setText("notification-status", "Đã lấy FCM token. Để tự gửi push khi đóng trang, cần cấu hình backend an toàn.");
      } else {
        setText("notification-status", "Chưa lấy được FCM token. Kiểm tra cấu hình Firebase Cloud Messaging.");
      }
    } catch (error) {
      console.error(error);
      setText("notification-status", `Không bật được thông báo: ${error.message || error}`);
    }
  }

  async function initializeFirebase() {
    if (firebaseConfig.apiKey.startsWith("YOUR_")) {
      showConnection(false, "Thiếu Firebase config");
      setText("settings-message", "Mở script.js và điền apiKey Firebase Web.");
      $("readings-table").innerHTML = '<tr><td colspan="4" class="empty-cell">Cần cấu hình Firebase trước khi tải dữ liệu.</td></tr>';
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
      const auth = firebase.auth();
      await auth.signInAnonymously();
      db = firebase.database();
      showConnection(true, "Firebase đã kết nối");

      await loadSettings();

      // The ESP32 writes /current every 5 seconds.
      db.ref("current").on("value", (snapshot) => {
        const raw = snapshot.val();
        if (!raw) return;
        const rows = normalizeRows({ current: raw });
        if (!rows.length) return;
        latestReading = rows[0];
        renderCurrent(latestReading);
        checkCrossing(latestReading);
      }, (error) => {
        showConnection(false, "Lỗi đọc current");
        console.error(error);
      });

      // The ESP32 appends /readings about once per minute.
      db.ref("readings").limitToLast(2000).on("value", (snapshot) => {
        readings = normalizeRows(snapshot.val());
        if (!latestReading && readings.length) latestReading = readings[readings.length - 1];
        showConnection(true, "Đang nhận dữ liệu");
        renderAll();
      }, (error) => {
        showConnection(false, "Lỗi đọc readings");
        console.error(error);
      });

      db.ref("alerts").limitToLast(300).on("value", (snapshot) => {
        const val = snapshot.val() || {};
        const saved = Object.entries(val).map(([key, a]) => ({ key, ...a }))
          .filter((a) => Number.isFinite(Number(a.timestamp)))
          .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
        // Display persistent events in Firebase, while still deriving events from readings as a fallback.
        if (saved.length) {
          alertRows = saved.map((a) => ({
            key: a.key, timestamp: a.timestamp, moisture: Number(a.moisture),
            type: String(a.type || "low").toUpperCase(),
            label: String(a.type).toLowerCase() === "high" ? "Độ ẩm cao" : "Độ ẩm thấp",
            detail: a.message || "Cảnh báo đã lưu trong Firebase."
          }));
          renderSavedAlerts();
        } else {
          renderAlerts();
        }
      }, (error) => console.warn("Không đọc được alerts:", error));
    } catch (error) {
      console.error(error);
      showConnection(false, "Kết nối thất bại");
      setText("settings-message", "Không kết nối được Firebase. Kiểm tra API key, Anonymous Auth và Database Rules.");
    }
  }

  function renderSavedAlerts() {
    const tbody = $("alerts-table");
    setText("abnormal-count", `${alertRows.length} sự kiện đã lưu`);
    const todayCount = alertRows.filter((a) => {
      const d = dateFromTimestamp(a.timestamp);
      return d && d.getTime() >= dayStart();
    }).length;
    setText("alert-count", todayCount);
    if (!alertRows.length) {
      tbody.innerHTML = '<tr><td colspan="4" class="empty-cell">Chưa có cảnh báo.</td></tr>';
      return;
    }
    tbody.innerHTML = alertRows.slice(0, MAX_TABLE_ROWS).map((a) =>
      `<tr><td>${escapeHtml(formatDate(a.timestamp))}</td><td><span class="state-label state-alert">${escapeHtml(a.label)}</span></td><td><strong>${escapeHtml(a.moisture)}%</strong></td><td>${escapeHtml(a.detail)}</td></tr>`
    ).join("");
  }

  function bindEvents() {
    $("chart-period").addEventListener("change", (event) => {
      currentPeriod = event.target.value;
      renderChart();
    });
    $("save-settings").addEventListener("click", saveSettings);
    $("enable-notifications").addEventListener("click", enableNotifications);
    $("copy-token").addEventListener("click", async () => {
      const token = $("fcm-token").value;
      if (!token) {
        setText("notification-status", "Chưa có token để sao chép.");
        return;
      }
      try {
        await navigator.clipboard.writeText(token);
        setText("notification-status", "Đã sao chép FCM token.");
      } catch {
        $("fcm-token").select();
        document.execCommand("copy");
        setText("notification-status", "Đã sao chép token nếu trình duyệt cho phép.");
      }
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    bindEvents();
    initializeFirebase();
  });
})();
