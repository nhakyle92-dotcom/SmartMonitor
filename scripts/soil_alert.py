
import os
import json
import firebase_admin
from firebase_admin import credentials, db, messaging

DATABASE_URL = os.environ["FIREBASE_DATABASE_URL"]
SERVICE_ACCOUNT = json.loads(os.environ["FIREBASE_SERVICE_ACCOUNT"])

LOW = 30
HIGH = 70
SUDDEN_CHANGE = 15

cred = credentials.Certificate(SERVICE_ACCOUNT)
firebase_admin.initialize_app(cred, {"databaseURL": DATABASE_URL})


def timestamp_value(value):
    try:
        value = int(float(value))
        if value > 10**12:
            value //= 1000
        return value
    except (TypeError, ValueError):
        return 0


def collect_readings(node, found):
    if not isinstance(node, dict):
        return

    if "moisture" in node:
        try:
            moisture = float(node["moisture"])
            adc = int(float(node.get("adc", 0)))
            ts = timestamp_value(node.get("timestamp", 0))

            if 0 <= moisture <= 100 and ts > 0:
                found.append({
                    "moisture": moisture,
                    "adc": adc,
                    "timestamp": ts
                })
        except (TypeError, ValueError):
            pass

    for value in node.values():
        if isinstance(value, dict):
            collect_readings(value, found)


def get_latest_reading():
    found = []

    current = db.reference("current").get()
    collect_readings(current, found)

    if not found:
        readings = db.reference("readings").get()
        collect_readings(readings, found)

    if not found:
        raise RuntimeError(
            "Không tìm thấy bản ghi có moisture và timestamp hợp lệ."
        )

    return max(found, key=lambda item: item["timestamp"])


def get_tokens():
    data = db.reference("fcmTokens").get() or {}
    tokens = []

    def collect(node):
        if isinstance(node, str):
            if node.strip():
                tokens.append(node.strip())
        elif isinstance(node, dict):
            token = node.get("token")
            if isinstance(token, str) and token.strip():
                tokens.append(token.strip())
            else:
                for value in node.values():
                    if isinstance(value, (dict, str)):
                        collect(value)

    collect(data)
    return list(set(tokens))


reading = get_latest_reading()
moisture = reading["moisture"]
timestamp = reading["timestamp"]

state_ref = db.reference("automation/soilAlertState")
previous = state_ref.get() or {}

# Bỏ qua bản ghi đã xử lý.
if timestamp <= int(previous.get("timestamp", 0)):
    print("Không có bản ghi mới; bỏ qua.")
    raise SystemExit(0)

old_moisture = previous.get("moisture")
old_state = previous.get("state", "normal")

if moisture < LOW:
    new_state = "low"
elif moisture > HIGH:
    new_state = "high"
else:
    new_state = "normal"

reasons = []

if new_state != old_state and new_state in ("low", "high"):
    if new_state == "low":
        reasons.append("Độ ẩm đất thấp hơn ngưỡng 30%.")
    else:
        reasons.append("Độ ẩm đất vượt ngưỡng 70%.")

if old_moisture is not None:
    if abs(moisture - float(old_moisture)) >= SUDDEN_CHANGE:
        reasons.append(
            f"Độ ẩm thay đổi đột ngột: "
            f"{float(old_moisture):.1f}% → {moisture:.1f}%."
        )

tokens = get_tokens()

if reasons and not tokens:
    print("Có cảnh báo nhưng chưa tìm thấy FCM token.")
    print("Hãy kiểm tra mục fcmTokens trong Firebase.")
    raise SystemExit(1)

for token in tokens:
    message = messaging.Message(
        notification=messaging.Notification(
            title="SmartMonitor - Cảnh báo độ ẩm",
            body=f"{' '.join(reasons)} Độ ẩm hiện tại: {moisture:.1f}%."
        ),
        data={
            "moisture": str(moisture),
            "timestamp": str(timestamp),
            "type": new_state
        },
        token=token
    )

    try:
        messaging.send(message)
        print("Đã gửi thông báo FCM.")
    except Exception as error:
        print(f"Gửi FCM thất bại: {error}")

state_ref.set({
    "timestamp": timestamp,
    "moisture": moisture,
    "state": new_state
})

print(f"Đã xử lý độ ẩm {moisture:.1f}%.")
