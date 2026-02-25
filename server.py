from flask import Flask, request, jsonify
from flask_cors import CORS
import json
import os
from analyzer import process_menu_with_ai, process_feed_with_ai # Import both!

app = Flask(__name__)
CORS(app) 

@app.route('/save', methods=['POST'])
def save_data():
    data = request.get_json()
    if not data:
        return jsonify({"error": "No data received"}), 400

    # User profile payload
    sample_user_profile = {
        "age": 24,
        "dietary_preferences": ["high protein", "low carb"],
        "allergies": ["shellfish"],
        "health_goals": "muscle gain"
    }

    try:
        # Route 1: It's a Feed (List of Restaurants)
        if data.get('dataType') == 'feed':
            raw_file_path = os.path.join(os.path.dirname(__file__), "feed_raw.json")
            with open(raw_file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4)
                
            print("Analyzing Feed with AI...")
            ai_recommendations = process_feed_with_ai(raw_file_path, sample_user_profile)
            return jsonify({"status": "success", "data": ai_recommendations}), 200

        # Route 2: It's a Menu (List of Food Items)
        else:
            restaurant_id = data.get('restaurantId', 'unknown_restaurant')
            # raw_file_path = os.path.join(os.path.dirname(__file__), f"{restaurant_id}_raw.json")
            raw_file_path = os.path.join(os.path.dirname(__file__), "menu_raw.json")
            with open(raw_file_path, 'w', encoding='utf-8') as f:
                json.dump(data, f, indent=4)
                
            print("Analyzing Menu with AI...")
            ai_recommendations = process_menu_with_ai(raw_file_path, sample_user_profile)
            return jsonify({"status": "success", "data": ai_recommendations}), 200
            
    except Exception as e:
        print(f"Error: {e}")
        return jsonify({"error": str(e)}), 500

if __name__ == '__main__':
    app.run(port=5000)