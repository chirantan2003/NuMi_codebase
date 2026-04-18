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
#  MODELS
# ──────────────────────────────────────────────

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

# --- CUISINE MODELS ---
class RecommendedCuisine(BaseModel):
    cuisine_name: str
    explanation: str

class CuisineAnalysis(BaseModel):
    recommended_cuisines: list[RecommendedCuisine]


# ──────────────────────────────────────────────
#  SCHEDULE-AWARE SYSTEM INSTRUCTION
# ──────────────────────────────────────────────

_SCHEDULE_SYSTEM = """
You are NuMi, an expert dietary AI assistant.
When making food suggestions, take the user's real-time schedule into account:
  • If they have a meeting very soon (< 30 min), suggest quick, light items that won't cause sluggishness.
  • If they have a long gap between meetings or a free evening, they can enjoy a fuller, sit-down-style meal.
  • If the day is very busy, prioritise energy-sustaining, easy-to-eat options.
  • If the day is light/free, feel free to recommend more indulgent or elaborate options.
  • Factor in the time of day (breakfast / lunch / dinner / late-night snack) naturally.
Never explicitly tell the user you are reading their calendar — just let it inform your choices seamlessly.
""".strip()


# ──────────────────────────────────────────────
#  ANALYZERS
# ──────────────────────────────────────────────

# --- MENU ANALYZER ---
def process_menu_with_ai(input_file_path: str, user_profile: dict, calendar_data=None):
    if not os.path.exists(input_file_path): return {"error": "File not found"}
    with open(input_file_path, 'r', encoding='utf-8') as f:
        raw_data = json.load(f)
    restaurant_id = raw_data.get('restaurantId', 'unknown')
    items_to_analyze = raw_data.get('items', [])[:]

    schedule_ctx = _build_schedule_context(calendar_data)

    prompt_content = f"""
    Analyze these menu items based on the user profile and their current schedule, then suggest the top 5 most beneficial items.

    Schedule Context:
    {schedule_ctx}

    User Profile: {json.dumps(user_profile)}
    Menu Data: {json.dumps(items_to_analyze)}
    """

    completion = _get_client().beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": f"You are a dietary nutritionist.\n\n{_SCHEDULE_SYSTEM}"},
            {"role": "user", "content": prompt_content}
        ],
        response_format=RestaurantAnalysis, temperature=0.2
    )
    return json.loads(completion.choices[0].message.parsed.model_dump_json())


# --- FEED ANALYZER ---
def process_feed_with_ai(input_file_path: str, user_profile: dict, calendar_data=None):
    if not os.path.exists(input_file_path): return {"error": "File not found"}
    with open(input_file_path, 'r', encoding='utf-8') as f:
        raw_data = json.load(f)
    stores_to_analyze = raw_data.get('stores', [])[:]

    schedule_ctx = _build_schedule_context(calendar_data)

    prompt_content = f"""
    Analyze the following list of restaurants currently visible on the user's food delivery feed.
    Based on the user profile and their current schedule, suggest the top 5 restaurants that are most likely to offer healthy meals fitting their goals right now.

    Schedule Context:
    {schedule_ctx}

    User Profile: {json.dumps(user_profile, indent=2)}
    Visible Restaurants: {json.dumps(stores_to_analyze)}
    """

    completion = _get_client().beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": f"You are a dietary nutritionist analyzing restaurant options.\n\n{_SCHEDULE_SYSTEM}"},
            {"role": "user", "content": prompt_content}
        ],
        response_format=FeedAnalysis, temperature=0.2
    )
    return json.loads(completion.choices[0].message.parsed.model_dump_json())


# --- CHAT INTERFACE ANALYZER ---
def process_chat_with_ai(user_message: str, context_type: str, user_profile: dict, calendar_data=None):
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

    prompt_content = f"""
    You are NuMi, a helpful, candid, and interactive dietary AI assistant built into a Chrome extension.
    The user is currently looking at a DoorDash {context_type}. Answer their questions directly.

    CRITICAL RULE: Never use prefatory phrases like "Based on your profile..." or "Since you like high protein...".
    Treat the user's profile information as shared mental context and seamlessly weave it into your advice naturally.

    Schedule Context:
    {schedule_ctx}

    User Profile: {json.dumps(user_profile)}

    Current Page Context ({context_type}):
    {context_data}

    User's Message: {user_message}
    """

    completion = _get_client().chat.completions.create(
        model="gpt-4o",
        messages=[
            {"role": "system", "content": f"You are a helpful dietary assistant. Keep your answers concise, plain text, and conversational.\n\n{_SCHEDULE_SYSTEM}"},
            {"role": "user", "content": prompt_content}
        ],
        temperature=0.7
    )

    return completion.choices[0].message.content


# --- CUISINE ANALYZER ---
def process_cuisines_with_ai(user_profile: dict, calendar_data=None):
    schedule_ctx = _build_schedule_context(calendar_data)

    prompt_content = f"""
    Based on the following user profile and their current schedule, suggest the top 5 broad food cuisines
    (e.g., Thai, Mediterranean, Vegan) that best fit their dietary preferences, allergies, health goals,
    and what would work well given how their day looks right now.

    Schedule Context:
    {schedule_ctx}

    User Profile: {json.dumps(user_profile)}
    """

    completion = _get_client().beta.chat.completions.parse(
        model="gpt-4o-2024-08-06",
        messages=[
            {"role": "system", "content": f"You are NuMi, an expert dietary AI assistant. Recommend exactly 5 cuisines. Keep explanations under 2 sentences.\n\n{_SCHEDULE_SYSTEM}"},
            {"role": "user", "content": prompt_content}
        ],
        response_format=CuisineAnalysis,
        temperature=0.7
    )

    return json.loads(completion.choices[0].message.content)