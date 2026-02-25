import json
import os
from openai import OpenAI
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()
client = OpenAI()

# --- MENU MODELS (Existing) ---
class RecommendedItem(BaseModel):
    item_name: str
    explanation: str

class RestaurantAnalysis(BaseModel):
    restaurant_id: str
    cuisine_type: str
    recommended_items: list[RecommendedItem]

# --- FEED MODELS (NEW) ---
class RecommendedRestaurant(BaseModel):
    restaurant_name: str
    explanation: str

class FeedAnalysis(BaseModel):
    recommended_restaurants: list[RecommendedRestaurant]

# --- MENU ANALYZER (Existing) ---
def process_menu_with_ai(input_file_path: str, user_profile: dict):
    # ... (Keep your exact existing process_menu_with_ai function here) ...
    with open(input_file_path, 'r', encoding='utf-8') as f:
        raw_data = json.load(f)
    restaurant_id = raw_data.get('restaurantId', 'unknown')
    items_to_analyze = raw_data.get('items', [])[:]
    
    prompt_content = f"""
    Analyze these menu items based on the user profile and suggest the top 5 most beneficial items.
    User Profile: {json.dumps(user_profile)}
    Menu Data: {json.dumps(items_to_analyze)}
    """
    
    completion = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06", 
        messages=[
            {"role": "system", "content": "You are a dietary nutritionist."},
            {"role": "user", "content": prompt_content}
        ],
        response_format=RestaurantAnalysis, temperature=0.2 
    )
    return json.loads(completion.choices[0].message.parsed.model_dump_json())

# --- FEED ANALYZER (NEW) ---
def process_feed_with_ai(input_file_path: str, user_profile: dict):
    if not os.path.exists(input_file_path):
        return {"error": "File not found"}

    with open(input_file_path, 'r', encoding='utf-8') as f:
        raw_data = json.load(f)

    stores_to_analyze = raw_data.get('stores', [])[:]
    
    prompt_content = f"""
    Analyze the following list of restaurants currently visible on the user's food delivery feed.
    Based on the user profile provided, suggest the top 5 restaurants that are most likely to offer healthy meals fitting their goals.
    For each restaurant, provide the exact restaurant name and a brief explanation of why it fits the user.
    
    User Profile:
    {json.dumps(user_profile, indent=2)}
    
    Visible Restaurants: {json.dumps(stores_to_analyze)}
    """

    print("Sending feed data to OpenAI...")

    completion = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06", 
        messages=[
            {"role": "system", "content": "You are a dietary nutritionist analyzing restaurant options."},
            {"role": "user", "content": prompt_content}
        ],
        response_format=FeedAnalysis, 
        temperature=0.2 
    )

    structured_result = completion.choices[0].message.parsed
    return json.loads(structured_result.model_dump_json())