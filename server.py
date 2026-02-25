from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
# Import the new chat function
from analyzer import process_menu_with_ai, process_feed_with_ai, process_chat_with_ai 

app = Flask(__name__)
CORS(app) 

# Shared user profile
sample_user_profile = {
    "age": 24,
    "dietary_preferences": ["high protein", "low carb"],
    "allergies": ["shellfish"],
    "health_goals": "muscle gain"
}

@app.route('/save', methods=['POST'])
def save_data():
    data = request.get_json()
    if not data: return jsonify({"error": "No data received"}), 400

    try:
        if data.get('dataType') == 'feed':
            raw_file_path = os.path.join(os.path.dirname(__file__), "feed_raw.json")
            with open(raw_file_path, 'w', encoding='utf-8') as f: json.dump(data, f, indent=4)
            ai_recommendations = process_feed_with_ai(raw_file_path, sample_user_profile)
            return jsonify({"status": "success", "data": ai_recommendations}), 200
        else:
            raw_file_path = os.path.join(os.path.dirname(__file__), "menu_raw.json")
            with open(raw_file_path, 'w', encoding='utf-8') as f: json.dump(data, f, indent=4)
            ai_recommendations = process_menu_with_ai(raw_file_path, sample_user_profile)
            return jsonify({"status": "success", "data": ai_recommendations}), 200
    except Exception as e:
        return jsonify({"error": str(e)}), 500

# --- NEW CHAT ENDPOINT ---
@app.route('/chat', methods=['POST'])
def handle_chat():
    data = request.get_json()
    if not data or 'message' not in data:
        return jsonify({"error": "No message received"}), 400

    user_message = data['message']
    context_type = data.get('contextType', 'menu') # Tells us if we are looking at a menu or feed
    
    try:
        print(f"Chat request received: {user_message}")
        ai_reply = process_chat_with_ai(user_message, context_type, sample_user_profile)
        return jsonify({"status": "success", "reply": ai_reply}), 200
    except Exception as e:
        print(f"Chat Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(port=5000)