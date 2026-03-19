from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
import firebase_admin
from firebase_admin import credentials, firestore
from analyzer import process_menu_with_ai, process_feed_with_ai, process_chat_with_ai, process_cuisines_with_ai

app = Flask(__name__)
CORS(app) 

cred = credentials.Certificate("serviceAccountKey.json")
firebase_admin.initialize_app(cred)
db = firestore.client()

# --- GLOBAL ACTIVE USER STATE ---
ACTIVE_USER_ID = None 

@app.route('/set-active-user', methods=['POST'])
def set_active_user():
    global ACTIVE_USER_ID
    data = request.get_json()
    new_user_id = data.get('userId')
    
    if new_user_id:
        ACTIVE_USER_ID = new_user_id
        print(f"✅ Python AI is now synced to new user: {ACTIVE_USER_ID}")
        return jsonify({"status": "success", "activeUser": ACTIVE_USER_ID}), 200
    return jsonify({"error": "No userId provided"}), 400

def get_user_profile(user_id):
    """Fetches user data from Firestore 'nui-userdata-1' collection."""
    if not user_id:
        print("⚠️ No active user set! Using default blank profile.")
        return {"age": 25, "dietary_preferences": [], "allergies": [], "health_goals": "General health"}
        
    try:
        doc_ref = db.collection("nui-userdata-1").document(user_id)
        doc = doc_ref.get()
        if doc.exists:
            profile_data = doc.to_dict()
            return profile_data
        else:
            print(f"❌ User {user_id} not found in database.")
            return {"age": 25, "dietary_preferences": [], "allergies": [], "health_goals": "General health"}
    except Exception as e:
        print(f"❌ Firestore Error: {e}")
        return None

# --- NEW CUISINE ENDPOINT ---
@app.route('/cuisines', methods=['POST'])
def get_cuisines():
    global ACTIVE_USER_ID
    data = request.get_json() or {}
    user_id = data.get('userId', ACTIVE_USER_ID)
    
    dynamic_user_profile = get_user_profile(user_id)
    
    try:
        print(f"🍽️ Fetching initial cuisines for user: {user_id}")
        ai_recommendations = process_cuisines_with_ai(dynamic_user_profile)
        return jsonify({"status": "success", "data": ai_recommendations}), 200
    except Exception as e:
        print(f"❌ Error fetching cuisines: {e}")
        return jsonify({"error": str(e)}), 500

@app.route('/save', methods=['POST'])
def save_data():
    global ACTIVE_USER_ID
    data = request.get_json()
    if not data: return jsonify({"error": "No data received"}), 400

    user_id = data.get('userId', ACTIVE_USER_ID) 
    dynamic_user_profile = get_user_profile(user_id)

    try:
        if data.get('dataType') == 'feed':
            raw_file_path = os.path.join(os.path.dirname(__file__), "feed_raw.json")
            with open(raw_file_path, 'w', encoding='utf-8') as f: json.dump(data, f, indent=4)
            ai_recommendations = process_feed_with_ai(raw_file_path, dynamic_user_profile)
            return jsonify({"status": "success", "data": ai_recommendations}), 200
        else:
            raw_file_path = os.path.join(os.path.dirname(__file__), "menu_raw.json")
            with open(raw_file_path, 'w', encoding='utf-8') as f: json.dump(data, f, indent=4)
            ai_recommendations = process_menu_with_ai(raw_file_path, dynamic_user_profile)
            return jsonify({"status": "success", "data": ai_recommendations}), 200
    except Exception as e:
        import traceback
        with open("error_log.txt", "w") as f: f.write(traceback.format_exc())
        print("💥 ERROR IN /save:", e)
        return jsonify({"error": str(e)}), 500

@app.route('/chat', methods=['POST'])
def handle_chat():
    global ACTIVE_USER_ID
    data = request.get_json()
    if not data or 'message' not in data:
        return jsonify({"error": "No message received"}), 400

    user_message = data['message']
    context_type = data.get('contextType', 'menu')
    user_id = data.get('userId', ACTIVE_USER_ID) 
    dynamic_user_profile = get_user_profile(user_id)
    
    try:
        ai_reply = process_chat_with_ai(user_message, context_type, dynamic_user_profile)
        return jsonify({"status": "success", "reply": ai_reply}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(debug=True, port=5001)