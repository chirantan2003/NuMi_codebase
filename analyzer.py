import json
import os
from openai import OpenAI
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()
client = OpenAI()

# --- MENU MODELS ---
class RecommendedItem(BaseModel):
    item_name: str
    explanation: str

class RestaurantAnalysis(BaseModel):
    restaurant_id: str
    cuisine_type: str
    recommended_items: list[RecommendedItem]

# --- FEED MODELS ---
class RecommendedRestaurant(BaseModel):
    restaurant_name: str
    explanation: str

class FeedAnalysis(BaseModel):
    recommended_restaurants: list[RecommendedRestaurant]

# --- MENU ANALYZER ---
def process_menu_with_ai(input_file_path: str, user_profile: dict):
    if not os.path.exists(input_file_path): return {"error": "File not found"}
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

# --- FEED ANALYZER ---
def process_feed_with_ai(input_file_path: str, user_profile: dict):
    if not os.path.exists(input_file_path): return {"error": "File not found"}
    with open(input_file_path, 'r', encoding='utf-8') as f:
        raw_data = json.load(f)
    stores_to_analyze = raw_data.get('stores', [])[:]
    
    prompt_content = f"""
    Analyze the following list of restaurants currently visible on the user's food delivery feed.
    Based on the user profile provided, suggest the top 5 restaurants that are most likely to offer healthy meals fitting their goals.
    User Profile: {json.dumps(user_profile, indent=2)}
    Visible Restaurants: {json.dumps(stores_to_analyze)}
    """

    completion = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06", 
        messages=[
            {"role": "system", "content": "You are a dietary nutritionist analyzing restaurant options."},
            {"role": "user", "content": prompt_content}
        ],
        response_format=FeedAnalysis, temperature=0.2 
    )
    return json.loads(completion.choices[0].message.parsed.model_dump_json())

# --- NEW: CHAT INTERFACE ANALYZER ---
def process_chat_with_ai(user_message: str, context_type: str, user_profile: dict):
    # Determine which file to read context from
    file_path = "menu_raw.json" if context_type == 'menu' else "feed_raw.json"
    
    context_data = "No specific menu or feed data available."
    if os.path.exists(file_path):
        with open(file_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)
            # Limit the items we send to OpenAI to prevent hitting token limits
            if context_type == 'menu':
                context_data = json.dumps(raw_data.get('items', [])[:80]) 
            else:
                context_data = json.dumps(raw_data.get('stores', [])[:20])

    prompt_content = f"""
    You are NuMi, a helpful, candid, and interactive dietary AI assistant built into a Chrome extension. 
    The user is currently looking at a DoorDash {context_type}. Answer their questions directly.
    
    CRITICAL RULE: Never use prefatory phrases like "Based on your profile..." or "Since you like high protein...". 
    Treat the user's profile information as shared mental context and seamlessly weave it into your advice naturally.
    
    User Profile: {json.dumps(user_profile)}
    
    Current Page Context ({context_type}):
    {context_data}
    
    User's Message: {user_message}
    """
    
    # We use the standard chat completions endpoint here (not `.parse()`) because we just want text back!
    completion = client.chat.completions.create(
        model="gpt-4o", 
        messages=[
            {"role": "system", "content": "You are a helpful dietary assistant. Keep your answers concise, plain text, and conversational."},
            {"role": "user", "content": prompt_content}
        ],
        temperature=0.7 
    )
    
    return completion.choices[0].message.content

# --- CUISINE MODELS ---
class RecommendedCuisine(BaseModel):
    cuisine_name: str
    explanation: str

class CuisineAnalysis(BaseModel):
    recommended_cuisines: list[RecommendedCuisine]

# --- CUISINE ANALYZER ---
def process_cuisines_with_ai(user_profile: dict):
    prompt_content = f"""
    Based on the following user profile, suggest the top 5 broad food cuisines (e.g., Thai, Mediterranean, Vegan) that best fit their dietary preferences, allergies, and health goals.
    User Profile: {json.dumps(user_profile)}
    """
    
    completion = client.beta.chat.completions.parse(
        model="gpt-4o-2024-08-06", 
        messages=[
            {"role": "system", "content": "You are NuMi, an expert dietary AI assistant. Recommend exactly 5 cuisines. Keep explanations under 2 sentences."},
            {"role": "user", "content": prompt_content}
        ],
        response_format=CuisineAnalysis,
        temperature=0.7
    )
    
    return json.loads(completion.choices[0].message.content)