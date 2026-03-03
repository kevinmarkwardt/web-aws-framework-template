"""Account routes."""

import json

try:
    from lib import db, response
    from lib.auth import get_token_claims
except ImportError:
    from api.lib import db, response
    from api.lib.auth import get_token_claims


def get_account(user_id: str, event: dict) -> dict:
    user = db.get_user(user_id)
    if not user:
        # Auto-create user profile on first API call (Cognito handles actual signup)
        # Extract email and name from the Bearer token (Function URLs don't populate requestContext.authorizer)
        claims = get_token_claims(event)
        email = claims.get("email", "")
        name = claims.get("name", "")
        user = db.create_user(user_id, email, name)

    # Strip DynamoDB keys from response
    return response.ok({
        "userId": user.get("userId"),
        "email": user.get("email"),
        "name": user.get("name", ""),
        "plan": user.get("plan"),
        "linkCount": user.get("linkCount", 0),
        "createdAt": user.get("createdAt"),
        "settings": user.get("settings", {}),
    })


def update_name(user_id: str, event: dict) -> dict:
    body = json.loads(event.get("body", "{}"))
    name = body.get("name", "").strip()
    if not name:
        return response.error("Name cannot be empty.")
    if len(name) > 100:
        return response.error("Name must be 100 characters or less.")

    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)

    db.update_user_name(user_id, name)
    return response.ok({"name": name})


def update_settings(user_id: str, event: dict) -> dict:
    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)

    body = json.loads(event.get("body", "{}"))
    current = user.get("settings", {})

    allowed = {"alertsEnabled", "digestEnabled", "remindersEnabled"}
    for key in allowed:
        if key in body:
            current[key] = bool(body[key])

    db.update_user_settings(user_id, current)
    return response.ok({"settings": current})
