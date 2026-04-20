from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
import time
import requests as http_requests
import firebase_admin
from firebase_admin import credentials, firestore
from analyzer import process_menu_with_ai, process_feed_with_ai, process_chat_with_ai, process_cuisines_with_ai

app = Flask(__name__)
CORS(app, origins=["*"])  # In production, restrict to your extension's origin

# --- Firebase Initialization ---
# Support both local (serviceAccountKey.json) and production (env var) modes
if os.path.exists("serviceAccountKey.json"):
    cred = credentials.Certificate("serviceAccountKey.json")
else:
    # For Railway / Render: use FIREBASE_SERVICE_ACCOUNT env var (JSON string)
    service_account_json = os.environ.get("FIREBASE_SERVICE_ACCOUNT")
    if service_account_json:
        cred = credentials.Certificate(json.loads(service_account_json))
    else:
        raise RuntimeError("No Firebase credentials found. Set FIREBASE_SERVICE_ACCOUNT env var or provide serviceAccountKey.json")

firebase_admin.initialize_app(cred)
db = firestore.client()

# ============================================================
# HELPER: Get user profile from Firestore
# ============================================================
def get_user_profile(user_id):
    """Fetches user data from Firestore 'nui-userdata-1' collection."""
    if not user_id:
        print("⚠️ No user ID provided. Using default blank profile.")
        return {"age": 25, "dietary_preferences": [], "allergies": [], "health_goals": "General health"}

    try:
        doc_ref = db.collection("nui-userdata-1").document(user_id)
        doc = doc_ref.get()
        if doc.exists:
            return doc.to_dict()
        else:
            print(f"❌ User {user_id} not found in database.")
            return {"age": 25, "dietary_preferences": [], "allergies": [], "health_goals": "General health"}
    except Exception as e:
        print(f"❌ Firestore Error: {e}")
        return {"age": 25, "dietary_preferences": [], "allergies": [], "health_goals": "General health"}


def get_calendar_data(user_id):
    """Fetches calendar data from Firestore for a given user."""
    if not user_id:
        return None
    
    try:
        doc_ref = db.collection("nui-userdata-1").document(user_id).collection("calendarContext").document("current")
        doc = doc_ref.get()
        if doc.exists:
            return doc.to_dict()
        
        # Fallback: try calendarSnapshots collection by email
        user_profile = get_user_profile(user_id)
        email = user_profile.get("googleEmail", "")
        if email:
            email_key = email.replace(".", "_").replace("@", "_")
            snapshot_ref = db.collection("calendarSnapshots").document(email_key)
            snapshot_doc = snapshot_ref.get()
            if snapshot_doc.exists:
                return snapshot_doc.to_dict()
    except Exception as e:
        print(f"❌ Calendar Firestore Error: {e}")
    
    return None


# ============================================================
# HELPER: Get current weather (cached 30 minutes)
# ============================================================
_weather_cache = {"data": None, "timestamp": 0}
WEATHER_CACHE_DURATION = 1800  # 30 minutes

def get_weather():
    """Fetches current weather from wttr.in. Cached for 30 minutes."""
    now = time.time()
    if _weather_cache["data"] and (now - _weather_cache["timestamp"]) < WEATHER_CACHE_DURATION:
        return _weather_cache["data"]

    try:
        resp = http_requests.get("https://wttr.in/?format=j1", timeout=5)
        if resp.status_code == 200:
            raw = resp.json()
            current = raw.get("current_condition", [{}])[0]
            weather_data = {
                "temp_f": current.get("temp_F", "?"),
                "temp_c": current.get("temp_C", "?"),
                "condition": current.get("weatherDesc", [{}])[0].get("value", "Unknown"),
                "humidity": current.get("humidity", "?"),
                "feels_like_f": current.get("FeelsLikeF", "?"),
                "wind_mph": current.get("windspeedMiles", "?"),
            }
            _weather_cache["data"] = weather_data
            _weather_cache["timestamp"] = now
            print(f"🌤️ Weather fetched: {weather_data['condition']}, {weather_data['temp_f']}°F")
            return weather_data
    except Exception as e:
        print(f"⚠️ Weather fetch failed: {e}")

    return None


# ============================================================
# HEALTH CHECK
# ============================================================
@app.route('/health', methods=['GET'])
def health_check():
    return jsonify({"status": "ok", "service": "numi-backend"}), 200


# ============================================================
# CUISINE ENDPOINT
# ============================================================
@app.route('/cuisines', methods=['POST'])
def get_cuisines():
    data = request.get_json() or {}
    user_id = data.get('userId')
    mood = data.get('mood', 'balanced')

    dynamic_user_profile = get_user_profile(user_id)
    calendar_data = get_calendar_data(user_id)
    weather_data = get_weather()

    try:
        print(f"🍽️ Fetching initial cuisines for user: {user_id} | mood: {mood}")
        ai_recommendations = process_cuisines_with_ai(dynamic_user_profile, calendar_data, mood, weather_data)
        return jsonify({"status": "success", "data": ai_recommendations, "user_profile": dynamic_user_profile}), 200
    except Exception as e:
        print(f"❌ Error fetching cuisines: {e}")
        return jsonify({"error": str(e)}), 500


# ============================================================
# SAVE ENDPOINT (Menu/Feed data → AI analysis)
# ============================================================
@app.route('/save', methods=['POST'])
def save_data():
    data = request.get_json()
    if not data: return jsonify({"error": "No data received"}), 400

    user_id = data.get('userId')
    mood = data.get('mood', 'balanced')
    dynamic_user_profile = get_user_profile(user_id)
    calendar_data = get_calendar_data(user_id)
    weather_data = get_weather()

    try:
        if data.get('dataType') == 'feed':
            raw_file_path = os.path.join(os.path.dirname(__file__), "feed_raw.json")
            with open(raw_file_path, 'w', encoding='utf-8') as f: json.dump(data, f, indent=4)
            ai_recommendations = process_feed_with_ai(raw_file_path, dynamic_user_profile, calendar_data, mood, weather_data)
            return jsonify({"status": "success", "data": ai_recommendations, "user_profile": dynamic_user_profile}), 200
        else:
            raw_file_path = os.path.join(os.path.dirname(__file__), "menu_raw.json")
            with open(raw_file_path, 'w', encoding='utf-8') as f: json.dump(data, f, indent=4)
            ai_recommendations = process_menu_with_ai(raw_file_path, dynamic_user_profile, calendar_data, mood, weather_data)
            return jsonify({"status": "success", "data": ai_recommendations, "user_profile": dynamic_user_profile}), 200
    except Exception as e:
        import traceback
        with open("error_log.txt", "w") as f: f.write(traceback.format_exc())
        print("💥 ERROR IN /save:", e)
        return jsonify({"error": str(e)}), 500


# ============================================================
# CHAT ENDPOINT
# ============================================================
@app.route('/chat', methods=['POST'])
def handle_chat():
    data = request.get_json()
    if not data or 'message' not in data:
        return jsonify({"error": "No message received"}), 400

    user_message = data['message']
    context_type = data.get('contextType', 'menu')
    user_id = data.get('userId')
    mood = data.get('mood', 'balanced')
    dynamic_user_profile = get_user_profile(user_id)
    calendar_data = get_calendar_data(user_id)
    weather_data = get_weather()

    try:
        ai_reply = process_chat_with_ai(user_message, context_type, dynamic_user_profile, calendar_data, mood, weather_data)
        return jsonify({"status": "success", "reply": ai_reply}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == '__main__':
    port = int(os.environ.get('PORT', 5001))
    app.run(debug=False, host='0.0.0.0', port=port)