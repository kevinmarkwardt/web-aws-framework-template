"""Account routes.

  GET  /api/account                     the profile (created on the first call), plan, standing, balance when credits are on
  PUT  /api/account/settings {name?, language?, notifications?: {key: bool}}   validated (lib/prefs.py); unknown keys -> 400
  GET  /api/account/notes               account alerts for the user menu (api/lib/notes.py)
  POST /api/account/notes/dismiss {id}
  POST /api/account/referral {code}     a new account records who invited it (credits mode, referrals on)
"""

try:
    from lib import accounts, autoreload, config, credits, db, i18n, notes, params, prefs, response, subscriptions
    from lib.auth import get_token_claims
except ImportError:
    from api.lib import accounts, autoreload, config, credits, db, i18n, notes, params, prefs, response, subscriptions
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
        user = db.create_user(user_id, claims.get("email", ""), claims.get("name", ""))

    # The profile's language (emails and alerts use it) starts as the site's language; the Settings page changes it.
    if not user.get("language") and (lang := i18n.sent_language(event)):
        prefs.save(user_id, {"language": lang})
        user["language"] = lang

    if config.credits_on():  # the optional earning hooks (config.BILLING): each runs once, whatever the retries
        if "paidCredits" not in user:  # a new account (or one from before credits were on)
            credits.signup_gift(user_id)
        credits.daily_bonus(user_id, user)
        credits.release_due(user_id)
        user = db.get_user(user_id) or user

    plan = subscriptions.effective_plan(user)
    limits = config.plan_limits()
    out = {
        "userId": user.get("userId"),
        "email": user.get("email"),
        "plan": plan,  # the plan in effect (free after a failed renewal's grace period)
        "itemCount": user.get("itemCount", 0),
        "itemLimit": limits.get(plan, limits["free"]),  # None = unlimited
        "planLimits": limits,  # every plan's limit (the plan picker), from the admin config
        "createdAt": user.get("createdAt"),
        **prefs.view(user),  # name, language, notifications
        "isAdmin": user.get("isAdmin") is True,  # shows the Admin link; the admin API re-checks it on every call
        **accounts.standing(user),
        "activeWarnings": accounts.active_warnings(user_id),
        "warningsToBan": int(config.ACCOUNT_RULES["warningsToBan"]),  # the banner: how many more make it read-only
        "billingMode": config.billing_mode(),
    }
    if config.subscriptions_on():
        out["subscription"] = subscriptions.state(user)
    if config.credits_on():
        out.update(credits.balance(user), creditName=credits.unit_name(), autoReload=autoreload.settings(user),
                   hasToppedUp=bool(user.get("hasToppedUp")))
    return response.ok(out)


def update_settings(user_id: str, event: dict) -> dict:
    """The Settings page: name, language and email notifications, all checked (lib/prefs.py). Allowed while banned:
    they are the user's own preferences, not the app's records."""
    user = db.get_user(user_id)
    if not user:
        return response.error("User not found", 404)
    try:
        fields = prefs.validate(params.body(event), user)
    except prefs.Invalid as e:
        return response.error(i18n.message_of(e), 400)
    prefs.save(user_id, fields)
    return response.ok(prefs.view({**user, **fields}))


def list_notes(user_id: str, event: dict) -> dict:
    return response.ok({"notes": notes.visible(user_id)})


def dismiss_note(user_id: str, event: dict) -> dict:
    note_id = params.text(params.body(event), "id")
    if not notes.dismiss(user_id, note_id):
        return response.not_found("Alert not found")
    return response.ok({"dismissed": True})


def set_referral(user_id: str, event: dict) -> dict:
    """A new account records who invited it (rewards on hold after its first top-up; credits.pay_referral)."""
    if not credits.referrals_on():
        return response.not_found("No route: POST /api/account/referral")
    code = params.text(params.body(event), "code").strip()
    why = credits.set_referrer(user_id, code) if code else i18n.Text("Missing invite code")
    return response.error(why, 400) if why else response.ok({"referred": True})
