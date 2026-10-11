"""Account routes."""

try:
    from lib import config, db, params, response
    from lib.auth import get_token_claims
except ImportError:
    from api.lib import config, db, params, response
    from api.lib.auth import get_token_claims


def get_account(user_id: str, event: dict) -> dict:
    user = db.get_user(user_id)
    if not user:
        # Auto-create the profile on the first API call (Cognito handles the actual sign-up), unless the admin has
        # turned sign-ups off: then accounts that already have a profile keep working and new ones are refused.
        if not config.get_site_config()["signupsEnabled"]:
            return response.error("New sign-ups are closed right now. Please try again later.", 403, "SIGNUPS_CLOSED")
        # Email and name come from the Bearer token (Function URLs don't populate requestContext.authorizer)
        claims = get_token_claims(event)
        email = claims.get("email", "")
        name = claims.get("name", "")
        user = db.create_user(user_id, email, name)

    plan = user.get("plan", "free")
    limits = config.plan_limits()
    return response.ok({
        "userId": user.get("userId"),
        "email": user.get("email"),
        "name": user.get("name", ""),
        "plan": plan,
        "itemCount": user.get("itemCount", 0),
        "itemLimit": limits.get(plan, limits["free"]),  # None = unlimited
        "planLimits": limits,  # every plan's limit (the plan picker), from the admin config
        "createdAt": user.get("createdAt"),
        "settings": user.get("settings", {}),
    })


def update_name(user_id: str, event: dict) -> dict:
    body = params.body(event)
    name = params.text(body, "name").strip()
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

    body = params.body(event)
    current = user.get("settings", {})

    allowed = {"alertsEnabled", "digestEnabled", "remindersEnabled"}
    for key in allowed:
        if key in body:
            current[key] = bool(body[key])

    db.update_user_settings(user_id, current)
    return response.ok({"settings": current})
