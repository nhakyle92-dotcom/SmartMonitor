// Smart Soil Monitor — bản sạch, không chứa dữ liệu mẫu.
// Khi tích hợp ESP32/Firebase, chuyển dữ liệu thật vào processIncomingReading().
const THRESHOLD_LOW = 30;
const THRESHOLD_HIGH = 70;
const $ = (id) => document.getElementById(id);
let readings = [];
let abnormalEvents = [];
let currentPeriod = 'day';
let firebaseConnectionState = 'Đang khởi tạo Firebase…';

function buildSampleEvents(rows) {
  const events = [];
  rows.forEach((row, index) => {
    if (row.moisture < THRESHOLD_LOW) {
      events.push({ timestamp: row.timestamp, type: 'low', title: 'Độ ẩm đất thấp', value: `${row.moisture}%`, threshold: `Dưới ${THRESHOLD_LOW}%`, note: 'Độ ẩm thấp hơn ngưỡng tham chiếu; cần kiểm tra đất và tưới nước nếu cần.' });
    }
    if (index > 0 && Math.abs(row.moisture - rows[index - 1].moisture) >= 15) {
      events.push({ timestamp: row.timestamp, type: 'change', title: 'Độ ẩm thay đổi đột ngột', value: `${rows[index - 1].moisture}% → ${row.moisture}%`, threshold: `Thay đổi ≥ 15 điểm %`, note: 'Kiểm tra điều kiện đất và vị trí tiếp xúc của cảm biến.' });
    }
    if (row.moisture > THRESHOLD_HIGH) {
      events.push({ timestamp: row.timestamp, type: 'high', title: 'Độ ẩm đất cao', value: `${row.moisture}%`, threshold: `Trên ${THRESHOLD_HIGH}%`, note: 'Độ ẩm vượt ngưỡng tham chiếu; nên kiểm tra tình trạng thoát nước.' });
    }
  });
  return events.sort((a, b) => b.timestamp - a.timestamp);
}
function average(rows) { return rows.length ? Math.round(rows.reduce((sum, row) => sum + row.moisture, 0) / rows.length) : 0; }
function statusFor(value) {
  if (value < THRESHOLD_LOW) return { text: 'Độ ẩm thấp', className: 'status-low', key: 'low' };
  if (value > THRESHOLD_HIGH) return { text: 'Độ ẩm cao', className: 'status-high', key: 'high' };
  return { text: 'Bình thường', className: 'status-normal', key: 'normal' };
}
function formatDateTime(timestamp) { return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(timestamp)); }
function formatShortTime(timestamp) { return new Intl.DateTimeFormat('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).format(new Date(timestamp)); }
function rangeStart(range) {
  const duration = { '24h': 24 * 60 * 60 * 1000, '7d': 7 * 24 * 60 * 60 * 1000, '30d': 30 * 24 * 60 * 60 * 1000 }[range];
  return duration ? Date.now() - duration : 0;
}
function rowsForRange(rows, range) { const start = rangeStart(range); return rows.filter(row => row.timestamp >= start); }
function updateOverview() {
  const latest = readings[readings.length - 1];
  const recent = rowsForRange(readings, '24h');
  const recentEvents = rowsForRange(abnormalEvents, '24h');
  $('current-moisture').textContent = latest ? latest.moisture : '—';
  $('current-adc').textContent = latest ? latest.adc : '—';
  $('moisture-meter').style.width = latest ? `${Math.max(0, Math.min(100, latest.moisture))}%` : '0%';
  $('moisture-status').textContent = latest ? statusFor(latest.moisture).text : 'Chưa có dữ liệu';
  $('moisture-status').className = `status-badge ${latest ? statusFor(latest.moisture).className : 'status-normal'}`;
  $('average-moisture').textContent = recent.length ? average(recent) : '—';
  $('adc-meter').style.width = latest ? `${Math.min(100, latest.adc / 4095 * 100)}%` : '0%';
  $('last-updated').textContent = latest ? `Dữ liệu nhận lúc ${new Date(latest.timestamp).toLocaleTimeString('vi-VN', {hour:'2-digit', minute:'2-digit', second:'2-digit'})}` : 'Chưa nhận dữ liệu từ thiết bị';
  $('alert-count').textContent = recentEvents.length;
  $('sidebar-alert-count').textContent = recentEvents.length;
  $('abnormal-total').textContent = abnormalEvents.length;
  $('current-date').textContent = new Intl.DateTimeFormat('vi-VN', { weekday:'long', day:'2-digit', month:'long', year:'numeric' }).format(new Date());
  const chip = document.querySelector('.demo-chip');
  if (chip) chip.innerHTML = `<span class="pulse-dot"></span> ${readings.length ? 'Đã nhận dữ liệu' : firebaseConnectionState}`;
  const deviceStatus = $('device-status');
  if (deviceStatus) deviceStatus.textContent = readings.length ? 'Đã nhận dữ liệu từ Firebase' : firebaseConnectionState;
  const pill = document.querySelector('.demo-pill');
  if (pill) pill.innerHTML = `<span class="pulse-dot"></span> ${readings.length ? 'ĐÃ CÓ DỮ LIỆU' : 'ĐANG CHỜ DỮ LIỆU'}`;
}
function drawChart(data) {
  const canvas = $('moisture-chart');
  const ctx = canvas.getContext('2d');
  const rect = canvas.getBoundingClientRect();
  if (!rect.width || !rect.height) return;
  const dpr = window.devicePixelRatio || 1;
  canvas.width = Math.floor(rect.width * dpr); canvas.height = Math.floor(rect.height * dpr);
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  const width = rect.width, height = rect.height;
  const pad = { top: 18, right: 15, bottom: 34, left: 36 };
  const chartW = width - pad.left - pad.right, chartH = height - pad.top - pad.bottom;
  const x = i => pad.left + (data.length <= 1 ? chartW / 2 : i / (data.length - 1) * chartW);
  const y = v => pad.top + ((100 - v) / 100) * chartH;
  ctx.clearRect(0, 0, width, height); ctx.font = '10px DM Sans, sans-serif'; ctx.textBaseline = 'middle';
  [0, 20, 40, 60, 80, 100].forEach(tick => { const yy = y(tick); ctx.beginPath(); ctx.moveTo(pad.left, yy); ctx.lineTo(width-pad.right, yy); ctx.strokeStyle='#edf1ed'; ctx.lineWidth=1; ctx.stroke(); ctx.fillStyle='#9aa69d'; ctx.textAlign='right'; ctx.fillText(String(tick), pad.left-10, yy); });
  ctx.beginPath(); ctx.setLineDash([5,5]); ctx.moveTo(pad.left,y(THRESHOLD_LOW)); ctx.lineTo(width-pad.right,y(THRESHOLD_LOW)); ctx.strokeStyle='#dfa15a'; ctx.lineWidth=1.4; ctx.stroke(); ctx.setLineDash([]);
  if (data.length) {
    ctx.beginPath(); data.forEach((p,i)=>i===0?ctx.moveTo(x(i),y(p.moisture)):ctx.lineTo(x(i),y(p.moisture)));
    ctx.lineTo(x(data.length-1),pad.top+chartH); ctx.lineTo(x(0),pad.top+chartH); ctx.closePath();
    const gradient=ctx.createLinearGradient(0,pad.top,0,pad.top+chartH); gradient.addColorStop(0,'rgba(51,148,96,.18)'); gradient.addColorStop(1,'rgba(51,148,96,.015)'); ctx.fillStyle=gradient; ctx.fill();
    ctx.beginPath(); data.forEach((p,i)=>i===0?ctx.moveTo(x(i),y(p.moisture)):ctx.lineTo(x(i),y(p.moisture))); ctx.strokeStyle='#329465'; ctx.lineWidth=2.5; ctx.lineJoin='round'; ctx.lineCap='round'; ctx.stroke();
    data.forEach((p,i)=>{ctx.beginPath();ctx.arc(x(i),y(p.moisture),p.moisture<THRESHOLD_LOW?4:3,0,Math.PI*2);ctx.fillStyle=p.moisture<THRESHOLD_LOW?'#df9c4f':'#329465';ctx.fill();});
    const step=data.length>8?Math.ceil(data.length/6):1; data.forEach((p,i)=>{if(i%step!==0&&i!==data.length-1)return;ctx.fillStyle='#89968c';ctx.textAlign='center';ctx.fillText(p.label,x(i),height-15);});
  } else { ctx.fillStyle='#89968c'; ctx.textAlign='center'; ctx.fillText('Không có dữ liệu trong khoảng thời gian này', width/2, height/2); }
}
function renderPeriod(period) {
  currentPeriod = period;
  document.querySelectorAll('.toggle-btn').forEach(button => {
    const active = button.dataset.period === period;
    button.classList.toggle('active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  const start = period === 'day' ? rangeStart('24h') : rangeStart('7d');
  const filtered = readings.filter(row => row.timestamp >= start).sort((a, b) => a.timestamp - b.timestamp);
  const data = filtered.map(row => ({
    label: new Date(row.timestamp).toLocaleTimeString('vi-VN', { hour:'2-digit', minute:'2-digit' }),
    moisture: row.moisture,
    timestamp: row.timestamp
  }));
  $('chart-period-label').textContent = period === 'day' ? 'Diễn biến trong 24 giờ gần nhất' : 'Diễn biến trong 7 ngày gần nhất';
  $('chart-average').textContent = data.length ? average(data) : '—';
  $('max-moisture').textContent = data.length ? `${Math.max(...data.map(item => item.moisture))}%` : '—';
  $('min-moisture').textContent = data.length ? `${Math.min(...data.map(item => item.moisture))}%` : '—';
  const max = data.length ? data.reduce((best, item) => item.moisture > best.moisture ? item : best, data[0]) : null;
  const min = data.length ? data.reduce((best, item) => item.moisture < best.moisture ? item : best, data[0]) : null;
  $('max-time').textContent = max ? formatShortTime(max.timestamp) : 'Chưa có dữ liệu';
  $('min-time').textContent = min ? formatShortTime(min.timestamp) : 'Chưa có dữ liệu';
  $('below-count').textContent = `${data.filter(item => item.moisture < THRESHOLD_LOW).length} điểm`;
  $('sample-count').textContent = data.length;
  drawChart(data);
}
function renderHistoryTable() {
  const range=$('history-range').value, statusFilter=$('history-status').value, query=$('history-search').value.trim().toLowerCase();
  const filtered=rowsForRange(readings,range).filter(row=>{
    const status=statusFor(row.moisture).key;
    const searchable=`${formatDateTime(row.timestamp)} ${row.moisture} ${row.adc} ${status}`.toLowerCase();
    return (statusFilter==='all'||status===statusFilter)&&(!query||searchable.includes(query));
  }).sort((a,b)=>b.timestamp-a.timestamp);
  $('history-table-body').innerHTML='';
  if(!filtered.length) $('history-table-body').innerHTML='<tr><td colspan="4" class="empty-cell">Chưa có dữ liệu đo. Bảng sẽ tự cập nhật khi hệ thống nhận số liệu thật.</td></tr>';
  filtered.forEach(row=>{const status=statusFor(row.moisture);const tr=document.createElement('tr');tr.innerHTML=`<td><strong>${formatDateTime(row.timestamp)}</strong><small class="subcell">Thời điểm ghi nhận</small></td><td><strong class="moisture-cell">${row.moisture}%</strong></td><td>${row.adc}</td><td><span class="table-status ${status.className}">${status.text}</span></td>`;$('history-table-body').appendChild(tr);});
  $('history-result-count').textContent = readings.length ? `Đang hiển thị ${filtered.length} / ${readings.length} bản ghi` : 'Chưa có bản ghi nào';
}
function renderAlerts() {
  const range=$('alert-range').value, type=$('alert-type').value, query=$('alert-search').value.trim().toLowerCase();
  const filtered=rowsForRange(abnormalEvents,range).filter(event=>{
    const searchable=`${formatDateTime(event.timestamp)} ${event.title} ${event.value} ${event.threshold} ${event.note}`.toLowerCase();
    return (type==='all'||event.type===type)&&(!query||searchable.includes(query));
  }).sort((a,b)=>b.timestamp-a.timestamp);
  $('alert-table-body').innerHTML='';
  if(!filtered.length) $('alert-table-body').innerHTML='<tr><td colspan="5" class="empty-cell">Chưa ghi nhận bất thường nào.</td></tr>';
  filtered.forEach(event=>{const cls=event.type==='low'?'status-low':event.type==='high'?'status-high':'status-change';const tr=document.createElement('tr');tr.innerHTML=`<td><strong>${formatDateTime(event.timestamp)}</strong><small class="subcell">Ghi nhận tại thời điểm phát hiện</small></td><td><span class="table-status ${cls}">${event.title}</span></td><td><strong>${event.value}</strong></td><td>${event.threshold}</td><td class="note-cell">${event.note}</td>`;$('alert-table-body').appendChild(tr);});
  $('alert-result-count').textContent = abnormalEvents.length ? `Đang hiển thị ${filtered.length} / ${abnormalEvents.length} sự kiện` : 'Chưa ghi nhận sự kiện bất thường';
}
function exportHistoryCSV() {
  const rows=[...$('history-table-body').querySelectorAll('tr')].filter(row=>!row.querySelector('.empty-cell'));
  if(!rows.length){alert('Không có bản ghi để xuất. Hãy điều chỉnh bộ lọc trước.');return;}
  const csv=[['Thời gian ghi nhận','Độ ẩm đất (%)','Giá trị ADC','Đánh giá'],...rows.map(tr=>[...tr.querySelectorAll('td')].map((td,i)=>i===0?td.querySelector('strong')?.textContent: i===3?td.querySelector('.table-status')?.textContent:td.textContent.trim()))];
  const content='\uFEFF'+csv.map(row=>row.map(value=>`"${String(value??'').replace(/"/g,'""')}"`).join(',')).join('\r\n');
  const blob=new Blob([content],{type:'text/csv;charset=utf-8;'});const url=URL.createObjectURL(blob);const a=document.createElement('a');a.href=url;a.download='lich-su-do-am-dat.csv';a.click();URL.revokeObjectURL(url);
}
// Điểm tích hợp dữ liệu thật: gọi hàm này mỗi khi nhận một bản ghi từ ESP32/Firebase.
// Hàm sẽ gắn thời điểm nhận dữ liệu và tạo sự kiện khi độ ẩm vượt ngưỡng hoặc thay đổi mạnh.
function processIncomingReading(reading) {
  const row={timestamp:reading.timestamp||Date.now(),moisture:Number(reading.moisture),adc:Number(reading.adc)};
  if(!Number.isFinite(row.moisture)||!Number.isFinite(row.adc)) return;
  const previous=readings[readings.length-1];readings.push(row);
  if(row.moisture<THRESHOLD_LOW) abnormalEvents.unshift({timestamp:row.timestamp,type:'low',title:'Độ ẩm đất thấp',value:`${row.moisture}%`,threshold:`Dưới ${THRESHOLD_LOW}%`,note:'Độ ẩm thấp hơn ngưỡng tham chiếu; cần kiểm tra đất và tưới nước nếu cần.'});
  if(row.moisture>THRESHOLD_HIGH) abnormalEvents.unshift({timestamp:row.timestamp,type:'high',title:'Độ ẩm đất cao',value:`${row.moisture}%`,threshold:`Trên ${THRESHOLD_HIGH}%`,note:'Độ ẩm vượt ngưỡng tham chiếu; nên kiểm tra tình trạng thoát nước.'});
  if(previous&&Math.abs(row.moisture-previous.moisture)>=15) abnormalEvents.unshift({timestamp:row.timestamp,type:'change',title:'Độ ẩm thay đổi đột ngột',value:`${previous.moisture}% → ${row.moisture}%`,threshold:'Thay đổi ≥ 15 điểm %',note:'Kiểm tra điều kiện đất và vị trí tiếp xúc của cảm biến.'});
  updateOverview();renderPeriod(currentPeriod);renderHistoryTable();renderAlerts();
}
window.processIncomingReading = processIncomingReading;
document.querySelectorAll('.toggle-btn').forEach(button=>button.addEventListener('click',()=>renderPeriod(button.dataset.period)));
['history-range','history-status','history-search'].forEach(id=>$(id).addEventListener(id==='history-search'?'input':'change',renderHistoryTable));
['alert-range','alert-type','alert-search'].forEach(id=>$(id).addEventListener(id==='alert-search'?'input':'change',renderAlerts));
$('export-history').addEventListener('click',exportHistoryCSV);
window.addEventListener('resize',()=>renderPeriod(currentPeriod));
updateOverview();renderPeriod('day');renderHistoryTable();renderAlerts();


// Firebase Realtime Database: website chỉ ĐỌC dữ liệu.
// ESP32 sẽ được cấu hình quyền ghi riêng ở bước tiếp theo.
const firebaseConfig = {
  apiKey: "AIzaSyC_nR9b_Yc1V_kl74DNs1xHgZ3SYxKZJQk",
  authDomain: "smartmonitor-37eb1.firebaseapp.com",
  databaseURL: "https://smartmonitor-37eb1-default-rtdb.firebaseio.com",
  projectId: "smartmonitor-37eb1",
  storageBucket: "smartmonitor-37eb1.firebasestorage.app",
  messagingSenderId: "834907305033",
  appId: "1:834907305033:web:4df2971addd9cb1c453b98",
  measurementId: "G-B2NT2XX8NK"
};

function showFirebaseStatus(message) {
  firebaseConnectionState = message;
  const deviceStatus = $('device-status');
  if (deviceStatus && !readings.length) deviceStatus.textContent = message;
  const chip = document.querySelector('.demo-chip');
  if (chip && !readings.length) chip.innerHTML = `<span class="pulse-dot"></span> ${message}`;
}

function rebuildAbnormalEvents(rows) {
  const events = [];
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    if (row.moisture < THRESHOLD_LOW) {
      events.push({timestamp: row.timestamp, type:'low', title:'Độ ẩm đất thấp', value:`${row.moisture}%`, threshold:`Dưới ${THRESHOLD_LOW}%`, note:'Độ ẩm thấp hơn ngưỡng tham chiếu; cần kiểm tra đất và tưới nước nếu cần.'});
    }
    if (row.moisture > THRESHOLD_HIGH) {
      events.push({timestamp: row.timestamp, type:'high', title:'Độ ẩm đất cao', value:`${row.moisture}%`, threshold:`Trên ${THRESHOLD_HIGH}%`, note:'Độ ẩm vượt ngưỡng tham chiếu; nên kiểm tra tình trạng thoát nước.'});
    }
    if (i > 0 && Math.abs(row.moisture - rows[i-1].moisture) >= 15) {
      events.push({timestamp: row.timestamp, type:'change', title:'Độ ẩm thay đổi đột ngột', value:`${rows[i-1].moisture}% → ${row.moisture}%`, threshold:'Thay đổi ≥ 15 điểm %', note:'Kiểm tra điều kiện đất và vị trí tiếp xúc của cảm biến.'});
    }
  }
  return events.sort((a,b) => b.timestamp - a.timestamp);
}

function connectFirebaseReadOnly() {
  if (!window.firebase) {
    showFirebaseStatus('Không tải được Firebase SDK');
    return;
  }
  try {
    if (!firebase.apps.length) firebase.initializeApp(firebaseConfig);
    const auth = firebase.auth();
    const database = firebase.database();
    showFirebaseStatus('Đang đăng nhập Firebase…');

    auth.signInAnonymously().then(() => {
      showFirebaseStatus('Đã kết nối Firebase · Chờ dữ liệu');
      // ESP32 sẽ gửi bản ghi vào /readings/{id} với timestamp mili-giây, moisture và adc.
      database.ref('readings').on('value', (snapshot) => {
        const value = snapshot.val() || {};
        const rows = Object.keys(value).map((key) => {
          const item = value[key] || {};
          let timestamp = Number(item.timestamp);
          if (timestamp > 0 && timestamp < 1000000000000) timestamp *= 1000; // chấp nhận Unix seconds
          return { timestamp, moisture: Number(item.moisture), adc: Number(item.adc), id: key };
        }).filter(row => Number.isFinite(row.timestamp) && row.timestamp > 0 && Number.isFinite(row.moisture) && row.moisture >= 0 && row.moisture <= 100 && Number.isFinite(row.adc) && row.adc >= 0 && row.adc <= 4095)
          .sort((a,b) => a.timestamp - b.timestamp);
        readings = rows;
        abnormalEvents = rebuildAbnormalEvents(readings);
        showFirebaseStatus(readings.length ? 'Đã nhận dữ liệu từ Firebase' : 'Đã kết nối Firebase · Chờ dữ liệu');
        updateOverview();
        renderPeriod(currentPeriod);
        renderHistoryTable();
        renderAlerts();
      }, (error) => {
        console.error('Firebase Database:', error);
        showFirebaseStatus('Lỗi quyền truy cập database');
      });
    }).catch((error) => {
      console.error('Firebase Authentication:', error);
      showFirebaseStatus('Chưa bật đăng nhập ẩn danh');
    });
  } catch (error) {
    console.error('Firebase initialization:', error);
    showFirebaseStatus('Không khởi tạo được Firebase');
  }
}

connectFirebaseReadOnly();

// ================================
// Firebase Cloud Messaging (FCM)
// Đăng ký trình duyệt nhận thông báo và hiển thị token để kiểm tra.
// Lưu ý: index.html cần tải firebase-messaging-compat.js trước script.js.
// ================================
const FCM_VAPID_PUBLIC_KEY = 'BLCTyeXySEoPFFMLmndskD3Ft9CDitp9E24OBOQient4UUpBihOGe7J1puuPwSy7-Zw01ycVd7m4cFw2bHAgg0Y';

function getNotificationStatusElement() {
  let status = $('notification-status');
  if (status) return status;

  // Nếu HTML chưa có vùng trạng thái, tự tạo một khu vực nhỏ để báo kết quả.
  const button = $('enable-notifications');
  if (!button) return null;
  status = document.createElement('p');
  status.id = 'notification-status';
  status.setAttribute('role', 'status');
  status.setAttribute('aria-live', 'polite');
  status.style.marginTop = '12px';
  button.insertAdjacentElement('afterend', status);
  return status;
}

async function enableSoilNotifications() {
  const status = getNotificationStatusElement();

  if (!status) {
    alert('Chưa tìm thấy nút bật thông báo. Hãy kiểm tra index.html có id="enable-notifications".');
    return;
  }

  try {
    if (!('serviceWorker' in navigator) || !('Notification' in window)) {
      status.textContent = 'Trình duyệt này không hỗ trợ thông báo web.';
      return;
    }

    if (!window.firebase || typeof firebase.messaging !== 'function') {
      status.textContent = 'Thiếu Firebase Messaging SDK. Hãy thêm firebase-messaging-compat.js vào index.html trước script.js.';
      return;
    }

    // Firebase Database phía trên thường đã khởi tạo app; chỉ khởi tạo nếu chưa có.
    if (!firebase.apps.length) {
      firebase.initializeApp(firebaseConfig);
    }

    if (!window.isSecureContext) {
      status.textContent = 'Thông báo cần HTTPS. Hãy mở website qua GitHub Pages hoặc localhost.';
      return;
    }

    status.textContent = 'Đang xin quyền thông báo…';
    const permission = await Notification.requestPermission();
    if (permission !== 'granted') {
      status.textContent = permission === 'denied'
        ? 'Quyền thông báo đang bị chặn trong cài đặt trình duyệt.'
        : 'Bà chưa cấp quyền thông báo.';
      return;
    }

    const registration = await navigator.serviceWorker.register('./firebase-messaging-sw.js');
    await navigator.serviceWorker.ready;

    const messaging = firebase.messaging();
    const token = await messaging.getToken({
      vapidKey: FCM_VAPID_PUBLIC_KEY,
      serviceWorkerRegistration: registration
    });

    if (!token) {
      status.textContent = 'Chưa lấy được FCM token. Kiểm tra service worker, VAPID key và cài đặt Firebase.';
      return;
    }

    let tokenBox = $('fcm-token-box');
    if (!tokenBox) {
      const wrapper = document.createElement('div');
      wrapper.id = 'fcm-token-wrapper';
      wrapper.style.marginTop = '12px';
      wrapper.style.width = '100%';

      const label = document.createElement('label');
      label.htmlFor = 'fcm-token-box';
      label.textContent = 'FCM token của thiết bị này (không đăng công khai):';
      label.style.display = 'block';
      label.style.marginBottom = '6px';
      label.style.fontWeight = '600';

      tokenBox = document.createElement('textarea');
      tokenBox.id = 'fcm-token-box';
      tokenBox.readOnly = true;
      tokenBox.rows = 5;
      tokenBox.setAttribute('aria-label', 'FCM token');
      tokenBox.style.width = '100%';
      tokenBox.style.boxSizing = 'border-box';
      tokenBox.style.padding = '10px';
      tokenBox.style.overflowWrap = 'anywhere';

      const copyButton = document.createElement('button');
      copyButton.type = 'button';
      copyButton.id = 'copy-fcm-token';
      copyButton.textContent = 'Sao chép FCM token';
      copyButton.style.marginTop = '8px';
      copyButton.addEventListener('click', async () => {
        try {
          if (navigator.clipboard && window.isSecureContext) {
            await navigator.clipboard.writeText(tokenBox.value);
            status.textContent = 'Đã sao chép token. Hãy dán token vào Firebase Console để gửi thông báo thử.';
          } else {
            tokenBox.focus();
            tokenBox.select();
            const copied = document.execCommand('copy');
            status.textContent = copied
              ? 'Đã sao chép token.'
              : 'Hãy nhấn giữ token rồi chọn Sao chép.';
          }
        } catch (error) {
          tokenBox.focus();
          tokenBox.select();
          status.textContent = 'Hãy nhấn giữ token rồi chọn Sao chép.';
        }
      });

      wrapper.appendChild(label);
      wrapper.appendChild(tokenBox);
      wrapper.appendChild(copyButton);
      status.insertAdjacentElement('afterend', wrapper);
    }

    tokenBox.value = token;
    status.textContent = 'Đăng ký thông báo thành công! Sao chép token để gửi thông báo thử từ Firebase Console.';
    console.log('FCM registration token (không chia sẻ công khai):', token);
  } catch (error) {
    console.error('Lỗi đăng ký thông báo:', error);
    let message = 'Đăng ký thông báo thất bại. Mở Console (F12) để xem lỗi.';
    if (error && error.code === 'messaging/permission-blocked') {
      message = 'Quyền thông báo đang bị chặn trong cài đặt trình duyệt.';
    } else if (error && error.code === 'messaging/unsupported-browser') {
      message = 'Trình duyệt hoặc chế độ mở website chưa hỗ trợ Firebase Web Push.';
    } else if (error && error.code === 'messaging/failed-service-worker-registration') {
      message = 'Không đăng ký được service worker. Kiểm tra file firebase-messaging-sw.js ở thư mục gốc.';
    } else if (error && error.code === 'messaging/invalid-vapid-key') {
      message = 'VAPID key không hợp lệ. Hãy kiểm tra lại Firebase Console.';
    }
    const currentStatus = getNotificationStatusElement();
    if (currentStatus) currentStatus.textContent = message;
  }
}

const notificationButton = $('enable-notifications');
if (notificationButton) {
  notificationButton.addEventListener('click', enableSoilNotifications);
}
