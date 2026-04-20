import json
import os
from datetime import datetime, timezone, timedelta
from openai import OpenAI
from pydantic import BaseModel
from dotenv import load_dotenv

load_dotenv()

# Lazy client — only creates OpenAI client on first API call
# so the server can boot even without OPENAI_API_KEY (health check works)
_client = None

def _get_client():
    global _client
    if _client is None:
        _client = OpenAI()
    return _client

# ──────────────────────────────────────────────
#  SCHEDULE-AWARENESS HELPER
# ──────────────────────────────────────────────

def _build_schedule_context(calendar_data=None) -> str:
    """
    Accepts calendar data (from Firestore) and returns it as a JSON string
    enriched with current_time and minutes_until_next_meeting.
    The LLM deduces busyness and meal-type context from the raw data.
    """
    now = datetime.now().astimezone()
    now_iso = now.isoformat()
    today_str = now.strftime("%Y-%m-%d")

    # --- fallback when no calendar data is available ---
    if not calendar_data:
        return json.dumps({"current_time": now_iso, "calendar": None})

    # --- compute minutes until next upcoming event ---
    events = calendar_data.get("events", [])
    upcoming = []
    for ev in events:
        try:
            start = datetime.fromisoformat(ev["start"])
            if start > now:
                upcoming.append({"title": ev["title"], "start": start})
        except (ValueError, KeyError):
            continue
    upcoming.sort(key=lambda e: e["start"])

    if upcoming:
        mins_until = int((upcoming[0]["start"] - now).total_seconds() / 60)
        next_meeting = {"title": upcoming[0]["title"], "minutes_until": mins_until}
    else:
        next_meeting = None

    return json.dumps({
        "current_time": now_iso,
        "today": today_str,
        "minutes_until_next_meeting": next_meeting,
        "calendar": calendar_data
    })


# ──────────────────────────────────────────────
#  WEATHER-AWARENESS HELPER
# ──────────────────────────────────────────────

def _build_weather_context(weather_data=None) -> str:
    """
    Formats weather data into a JSON string for the LLM.
    Weather data should contain temp, condition, humidity, etc.
    """
    if not weather_data:
        return json.dumps({"weather": None})
    return json.dumps({"weather": weather_data})


# ──────────────────────────────────────────────
#  MODELS
# ──────────────────────────────────────────────

# --- MENU MODELS ---
class RecommendedItem(BaseModel):
    item_name: str
    explanation: str

class RestaurantAnalysis(BaseModel):
    overall_advice: str
    restaurant_id: str
    cuisine_type: str
    recommended_items: list[RecommendedItem]

# --- FEED MODELS ---
class RecommendedRestaurant(BaseModel):
    restaurant_name: str
    explanation: str

class FeedAnalysis(BaseModel):
    overall_advice: str
    recommended_restaurants: list[RecommendedRestaurant]

# --- CUISINE MODELS ---
class RecommendedCuisine(BaseModel):
    cuisine_name: str
    explanation: str

class CuisineAnalysis(BaseModel):
    overall_advice: str
    recommended_cuisines: list[RecommendedCuisine]


# ──────────────────────────────────────────────
#  SYSTEM INSTRUCTIONS
# ──────────────────────────────────────────────

_SCHEDULE_SYSTEM = """
You are NuMi, an expert dietary AI assistant.
When making food suggestions, take the user's real-time schedule into account:
  • If they have a meeting very soon (< 30 min), suggest quick, light items that won't cause sluggishness.
  • If they have a long gap between meetings or a free evening, they can enjoy a fuller, sit-down-style meal.
  • If the day is very busy, prioritise energy-sustaining, easy-to-eat options.
  • If the day is light/free, feel free to recommend more indulgent or elaborate options.
  • Factor in the time of day (breakfast / lunch / dinner / late-night snack) naturally.
Important: Always generate an 'overall_advice' string. The advice MUST explicitly synthesise their profile data (like age, goals, dietary preferences), calendar/schedule busyness, weather, and requested mood into a short, compelling 2-sentence summary of why you are showing these options (e.g. 'Since it is cold outside and you have a busy afternoon of meetings...').
""".strip()

_WEATHER_SYSTEM = """
Also factor in the current weather when suggesting food:
  • Cold or chilly weather → favour warm, hearty, comforting meals (soups, stews, warm bowls). Suggest immune-boosting ingredients (ginger, turmeric, citrus).
  • Hot or humid weather → favour lighter, hydrating meals (salads, poke bowls, smoothies, cold noodles).
  • Rainy or gloomy weather → lean towards serotonin-boosting comfort foods within the user's health goals.
  • If the user has poor sleep (from Oura data) combined with cold weather, prioritise immune-supportive foods.
""".strip()

_MOOD_SYSTEM = """
The user has selected a desired mood/feeling. Tailor food suggestions to support this goal:
  • "energetic" → High-protein options, complex carbs, B-vitamin rich foods. Avoid heavy/greasy meals that cause crashes.
  • "De-stress" → Magnesium-rich foods (leafy greens, nuts), anti-inflammatory options, warm comforting meals. Avoid caffeine-heavy or spicy items.
  • "focused" → Omega-3 rich foods (salmon, walnuts), low glycemic index options for sustained brain energy. Avoid sugar spikes.
  • "relaxed" → Tryptophan-containing foods, comfort food within health bounds, warm beverages. Gentle on digestion.
  • "balanced" → General well-being, a mix of macronutrients. Default sensible recommendations.
""".strip()


# ──────────────────────────────────────────────
#  ANALYZERS
# ──────────────────────────────────────────────

# --- MENU ANALYZER ---
def process_menu_with_ai(input_file_path: str, user_profile: dict, calendar_data=None, mood='balanced', weather_data=None):
    if not os.path.exists(input_file_path): return {"error": "File not found"}
    with open(input_file_path, 'r', encoding='utf-8') as f:
        raw_data = json.load(f)
    restaurant_id = raw_data.get('restaurantId', 'unknown')
    items_to_analyze = raw_data.get('items', [])[:]

    schedule_ctx = _build_schedule_context(calendar_data)
    weather_ctx = _build_weather_context(weather_data)

    prompt_content = f"""
    Analyze these menu items based on the user profile, their current schedule, current weather, and their desired mood ({mood}), then suggest the top 5 most beneficial items.

    Schedule Context:
    {schedule_ctx}

    Weather Context:
    {weather_ctx}

    Desired Mood: {mood}

    User Profile: {json.dumps(user_profile)}
    Menu Data: {json.dumps(items_to_analyze)}
    """

    completion = _get_client().beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": f"You are a dietary nutritionist.\n\n{_SCHEDULE_SYSTEM}\n\n{_WEATHER_SYSTEM}\n\n{_MOOD_SYSTEM}"},
            {"role": "user", "content": prompt_content}
        ],
        response_format=RestaurantAnalysis, temperature=0.2
    )
    return json.loads(completion.choices[0].message.parsed.model_dump_json())


# --- FEED ANALYZER ---
def process_feed_with_ai(input_file_path: str, user_profile: dict, calendar_data=None, mood='balanced', weather_data=None):
    if not os.path.exists(input_file_path): return {"error": "File not found"}
    with open(input_file_path, 'r', encoding='utf-8') as f:
        raw_data = json.load(f)
    stores_to_analyze = raw_data.get('stores', [])[:]

    schedule_ctx = _build_schedule_context(calendar_data)
    weather_ctx = _build_weather_context(weather_data)

    prompt_content = f"""
    Analyze the following list of restaurants currently visible on the user's food delivery feed.
    Based on the user profile, their current schedule, current weather, and their desired mood ({mood}), suggest the top 5 restaurants that are most likely to offer healthy meals fitting their goals right now.

    Schedule Context:
    {schedule_ctx}

    Weather Context:
    {weather_ctx}

    Desired Mood: {mood}

    User Profile: {json.dumps(user_profile, indent=2)}
    Visible Restaurants: {json.dumps(stores_to_analyze)}
    """

    completion = _get_client().beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": f"You are a dietary nutritionist analyzing restaurant options.\n\n{_SCHEDULE_SYSTEM}\n\n{_WEATHER_SYSTEM}\n\n{_MOOD_SYSTEM}"},
            {"role": "user", "content": prompt_content}
        ],
        response_format=FeedAnalysis, temperature=0.2
    )
    return json.loads(completion.choices[0].message.parsed.model_dump_json())


# --- CHAT INTERFACE ANALYZER ---
def process_chat_with_ai(user_message: str, context_type: str, user_profile: dict, calendar_data=None, mood='balanced', weather_data=None):
    file_path = "menu_raw.json" if context_type == 'menu' else "feed_raw.json"

    context_data = "No specific menu or feed data available."
    if os.path.exists(file_path):
        with open(file_path, 'r', encoding='utf-8') as f:
            raw_data = json.load(f)
            if context_type == 'menu':
                context_data = json.dumps(raw_data.get('items', [])[:80])
            else:
                context_data = json.dumps(raw_data.get('stores', [])[:20])

    schedule_ctx = _build_schedule_context(calendar_data)
    weather_ctx = _build_weather_context(weather_data)

    # Extract Oura biometric data if available
    oura_data = user_profile.get('ouraMetrics', None)
    oura_connected = user_profile.get('ouraConnected', False)
    if oura_connected and oura_data:
        biometrics_ctx = json.dumps({
            "oura_connected": True,
            "sleep_hours": oura_data.get("sleep", "unknown"),
            "stress_level": oura_data.get("stress", "unknown"),
            "readiness_score": oura_data.get("readiness", "unknown"),
            "activity_score": oura_data.get("activity", "unknown")
        })
    else:
        biometrics_ctx = json.dumps({"oura_connected": False})

    prompt_content = f"""
    You are NuMi, a helpful, candid, and interactive dietary AI assistant built into a Chrome extension.
    The user is currently looking at a DoorDash {context_type}. Answer their questions directly.
    The user wants to feel: {mood}.

    CRITICAL RULES:
    - Never use prefatory phrases like "Based on your profile..." or "Since you like high protein...".
    - Treat the user's profile, biometrics, and preferences as shared mental context — weave them in naturally.
    - If the user asks about their body, energy, sleep, or stress, use the Oura Ring biometric data below.
    - Connect biometric signals to food advice: low sleep → energy-boosting foods, high stress → calming nutrients, low readiness → easy-to-digest comfort meals.

    Biometrics (Oura Ring):
    {biometrics_ctx}

    Schedule Context:
    {schedule_ctx}

    Weather Context:
    {weather_ctx}

    Desired Mood: {mood}

    User Profile: {json.dumps(user_profile)}

    Current Page Context ({context_type}):
    {context_data}

    User's Message: {user_message}
    """

    completion = _get_client().chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": f"You are a helpful dietary assistant. Keep your answers concise, plain text, and conversational.\n\n{_SCHEDULE_SYSTEM}\n\n{_WEATHER_SYSTEM}\n\n{_MOOD_SYSTEM}"},
            {"role": "user", "content": prompt_content}
        ],
        temperature=0.7
    )

    return completion.choices[0].message.content


# --- CUISINE ANALYZER ---
def process_cuisines_with_ai(user_profile: dict, calendar_data=None, mood='balanced', weather_data=None):
    schedule_ctx = _build_schedule_context(calendar_data)
    weather_ctx = _build_weather_context(weather_data)

    prompt_content = f"""
    Based on the following user profile, their current schedule, current weather, and their desired mood ({mood}),
    suggest the top 5 broad food cuisines (e.g., Thai, Mediterranean, Vegan) that best fit their dietary preferences,
    allergies, health goals, and what would work well given how their day and the weather look right now.

    Schedule Context:
    {schedule_ctx}

    Weather Context:
    {weather_ctx}

    Desired Mood: {mood}

    User Profile: {json.dumps(user_profile)}
    """

    completion = _get_client().beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": f"You are NuMi, an expert dietary AI assistant. Recommend exactly 5 cuisines. Keep explanations under 2 sentences.\n\n{_SCHEDULE_SYSTEM}\n\n{_WEATHER_SYSTEM}\n\n{_MOOD_SYSTEM}"},
            {"role": "user", "content": prompt_content}
        ],
        response_format=CuisineAnalysis,
        temperature=0.7
    )

    return json.loads(completion.choices[0].message.content)