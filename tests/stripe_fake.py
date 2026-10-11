"""A small stand-in for stripe.StripeClient(...).v1 covering what the API uses (no network), plus signed webhook events.

Use the `stripe_fake` fixture (tests/conftest.py): it puts a FakeStripe behind stripe_config.client() for both module
copies and a test secret in the cache.
"""

import hashlib
import hmac
import json
import time
from types import SimpleNamespace as NS

WHSEC = "whsec_testsecret"


class Obj(NS):
    """A Stripe object: attribute access, item access and to_dict()."""

    def __getitem__(self, k):
        return getattr(self, k)

    def get(self, k, default=None):
        return getattr(self, k, default)

    def to_dict(self):
        def plain(v):
            if isinstance(v, Obj):
                return v.to_dict()
            if isinstance(v, list):
                return [plain(x) for x in v]
            return v
        return {k: plain(v) for k, v in vars(self).items()}


class FakeStripe:
    def __init__(self):
        self.sessions, self.customers, self.refunds, self.intents, self.portals = [], [], [], [], []
        self.updated_subs, self.cancelled_subs = [], []
        self.fingerprint = "fp_card_1"
        self.fail_refunds = False   # Stripe refuses the refund (a 4xx: nothing refunded)
        self.refund_error = None    # any other exception to raise (e.g. a timeout: the refund may or may not exist)
        self._refund_keys = {}      # idempotency key -> the refund Stripe made for it (a replay gets the same one)
        self.prices = {"yourapp_plan_starter": "price_starter", "yourapp_plan_pro": "price_pro"}
        self.subs = {}              # id -> Obj
        self.charges = {}           # id -> Obj (charges.retrieve)
        self.pms = {"pm_1": Obj(id="pm_1", customer="cus_1",
                                card=Obj(brand="visa", last4="4242", exp_month=9, exp_year=2030, country="US", fingerprint="fp_card_1"))}
        self.default = None
        self.pi_status = "succeeded"
        self.v1 = NS(
            prices=NS(list=self._prices),
            customers=NS(create=self._customer, retrieve=lambda cid: Obj(id=cid, invoice_settings=Obj(default_payment_method=self.default)),
                         update=self._cus_update,
                         payment_methods=NS(list=lambda cid, params=None: Obj(data=[p for p in self.pms.values() if p.customer == cid]))),
            payment_methods=NS(retrieve=self._pm, detach=self._detach),
            checkout=NS(sessions=NS(create=self._session)),
            billing_portal=NS(sessions=NS(create=self._portal)),
            payment_intents=NS(retrieve=self._pi, create=self._pi_create),
            refunds=NS(create=self._refund, list=self._refund_list),
            subscriptions=NS(retrieve=self._sub, update=self._sub_update, cancel=self._sub_cancel),
            charges=NS(retrieve=lambda cid: self.charges[cid]),
            invoice_payments=NS(list=lambda params: Obj(data=[])),
        )

    # ---- prices, customers, cards
    def _prices(self, params):
        key = params["lookup_keys"][0]
        return Obj(data=[Obj(id=self.prices[key], product="prod_x", lookup_key=key)] if key in self.prices else [])

    def _customer(self, params, options=None):
        self.customers.append({**params, "idempotency_key": (options or {}).get("idempotency_key")})
        return Obj(id=f"cus_{len(self.customers)}")

    def _cus_update(self, cid, params=None):
        self.default = params["invoice_settings"]["default_payment_method"]

    def _pm(self, pid):
        if pid not in self.pms:
            import stripe
            raise stripe.InvalidRequestError("No such PaymentMethod", "id", code="resource_missing", http_status=404)
        return self.pms[pid]

    def _detach(self, pid):
        self.pms[pid].customer = None

    # ---- checkout, portal
    def _session(self, params, options=None):
        self.sessions.append({**params, "idempotency_key": (options or {}).get("idempotency_key")})
        return Obj(id=f"cs_test_{len(self.sessions)}", url="https://checkout.stripe.com/c/pay/cs_test")

    def _portal(self, params, options=None):
        self.portals.append(params)
        return Obj(id="bps_1", url="https://billing.stripe.com/p/session/test")

    # ---- payment intents
    def _pi(self, pi_id, params=None):
        card = Obj(brand="visa", last4="4242", exp_month=9, exp_year=2027, country="US", funding="credit", fingerprint=self.fingerprint)
        charge = Obj(id=f"ch_{pi_id}", payment_method_details=Obj(type="card", card=card), receipt_url="https://pay.stripe.com/r/1",
                     outcome=Obj(risk_level="normal", risk_score=12, network_status="approved_by_network"),
                     balance_transaction=Obj(fee=88, net=1912))
        made = next((i for i in self.intents if i["id"] == pi_id), None)
        if made:
            return Obj(**{**made, "latest_charge": charge, "metadata": Obj(**made["metadata"])})
        return Obj(id=pi_id, latest_charge=charge, metadata=Obj(), status="succeeded")

    def _pi_create(self, params, options=None):
        key = (options or {}).get("idempotency_key")
        old = next((i for i in self.intents if i["idempotency_key"] == key), None)
        if old:
            return Obj(**old)
        d = {"id": f"pi_site_{len(self.intents) + 1}", "status": self.pi_status, "amount": params["amount"],
             "amount_received": params["amount"], "customer": params["customer"], "metadata": params["metadata"],
             "idempotency_key": key, "params": params}
        if self.pi_status == "requires_action":
            d["next_action"] = {"redirect_to_url": {"url": "https://bank.example/3ds"}}
        self.intents.append(d)
        return Obj(**d)

    # ---- refunds
    def _refund(self, params, options=None):
        import stripe

        key = (options or {}).get("idempotency_key")
        if key and key in self._refund_keys:
            return self._refund_keys[key]
        if self.fail_refunds:
            raise stripe.InvalidRequestError("card_declined: refund failed", None, code="charge_disputed", http_status=400)
        if self.refund_error:
            raise self.refund_error
        self.refunds.append({**params, "idempotency_key": key})
        re = Obj(id=f"re_{len(self.refunds)}", status="succeeded", metadata=dict(params.get("metadata") or {}),
                 payment_intent=params.get("payment_intent"), amount=params.get("amount"))
        if key:
            self._refund_keys[key] = re
        return re

    def _refund_list(self, params):
        return Obj(data=[r for r in self._refund_keys.values() if r.payment_intent == params.get("payment_intent")])

    # ---- subscriptions
    def add_sub(self, sub_id="sub_1", customer="cus_1", status="active", price="price_starter"):
        self.subs[sub_id] = {"id": sub_id, "customer": customer, "status": status,
                             "items": {"data": [{"id": f"si_{sub_id}", "price": {"id": price}}]}}
        return self.subs[sub_id]

    def _sub(self, sub_id):
        if sub_id not in self.subs:
            import stripe
            raise stripe.InvalidRequestError("No such subscription", "id", code="resource_missing", http_status=404)
        return self.subs[sub_id]

    def _sub_update(self, sub_id, params=None, options=None):
        self.updated_subs.append({"id": sub_id, **(params or {}), "idempotency_key": (options or {}).get("idempotency_key")})
        return self.subs[sub_id]

    def _sub_cancel(self, sub_id, params=None):
        self._sub(sub_id)
        self.cancelled_subs.append(sub_id)
        self.subs[sub_id]["status"] = "canceled"
        return self.subs[sub_id]

    def construct_event(self, payload, sig, secret):
        import stripe

        return stripe.StripeClient("sk_test_x").construct_event(payload, sig, secret)


def signed_event(evt: dict, secret: str = WHSEC) -> dict:
    raw = json.dumps(evt)
    t = int(time.time())
    sig = hmac.new(secret.encode(), f"{t}.{raw}".encode(), hashlib.sha256).hexdigest()
    return {"requestContext": {"http": {"method": "POST", "path": "/api/webhooks/stripe"}},
            "headers": {"Stripe-Signature": f"t={t},v1={sig}"}, "body": raw}


def event(evt_type: str, obj: dict, evt_id: str | None = None) -> dict:
    return {"id": evt_id or f"evt_{obj.get('id')}_{evt_type}", "object": "event", "type": evt_type, "api_version": "2026-09-30.endive",
            "data": {"object": obj}}


def topup_event(user="u1", pi="pi_1", paid=2000, credit=2200, pack="p20", evt_id=None, status="succeeded"):
    """payment_intent.succeeded for a top-up made on the site (its metadata says what to credit)."""
    return event("payment_intent.succeeded", {
        "id": pi, "object": "payment_intent", "status": status, "amount": paid, "amount_received": paid, "customer": "cus_1",
        "metadata": {"kind": "topup", "userId": user, "packId": pack, "credits": str(credit), "payCents": str(paid)}}, evt_id or f"evt_{pi}")
