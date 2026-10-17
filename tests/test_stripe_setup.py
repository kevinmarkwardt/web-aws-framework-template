"""scripts/stripe-setup.py creates what the API looks up: a monthly price per paid plan (lookup_key yourapp_plan_{id}),
a price per credit pack (yourapp_credits_{packId}) and the webhook for exactly the mode's events. Run against a
recording stand-in for Stripe and moto's Secrets Manager: nothing leaves the machine."""

import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace as NS

import boto3
import pytest
from moto import mock_aws

from api.lib import config
from api.routes import webhooks

ROOT = Path(__file__).resolve().parents[1]


def _load():
    spec = importlib.util.spec_from_file_location("stripe_setup", ROOT / "scripts/stripe-setup.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


class _Page(list):
    data = property(list)

    def auto_paging_iter(self):
        return iter(self)


class _RecordingStripe:
    """A Stripe account that records what the script creates, and remembers it for a second run."""

    def __init__(self):
        self.products, self.prices, self.endpoints, self.archived = [], [], [], []
        self.v1 = NS(
            products=NS(list=lambda params: _Page(self.products), create=self._product, update=lambda *a, **k: None),
            prices=NS(list=self._price_list, create=self._price, update=lambda pid, params: self.archived.append(pid)),
            webhook_endpoints=NS(list=lambda params: _Page(self.endpoints), create=self._endpoint,
                                 update=lambda *a, **k: None, delete=lambda eid: None),
        )

    def _product(self, params):
        p = NS(id=f"prod_{len(self.products) + 1}", created=len(self.products), **params)
        self.products.append(p)
        return p

    def _price(self, params):
        p = NS(id=f"price_{len(self.prices) + 1}", active=True, **params)
        self.prices.append(p)
        return p

    def _price_list(self, params):
        key = params["lookup_keys"][0]
        return _Page([p for p in self.prices if p.lookup_key == key and p.id not in self.archived])

    def _endpoint(self, params):
        e = NS(id=f"we_{len(self.endpoints) + 1}", secret="whsec_fake", **params)
        self.endpoints.append(e)
        return e


@pytest.fixture
def setup(monkeypatch, aws_credentials):
    script = _load()
    fake = _RecordingStripe()
    monkeypatch.setattr(script.stripe, "StripeClient", lambda key, stripe_version: fake)
    with mock_aws():
        sm = boto3.client("secretsmanager", region_name="us-east-1")
        sm.create_secret(Name="yourapp/test/stripe", SecretString=json.dumps({"secretKey": "sk_test_fake"}))
        sm.create_secret(Name="yourapp/prod/stripe", SecretString=json.dumps({"secretKey": "sk_test_wrong_stage"}))
        yield script, fake, sm


def _made(fake):
    return {p.lookup_key: (p.unit_amount, bool(getattr(p, "recurring", None))) for p in fake.prices}


def test_both_modes_create_plan_and_pack_prices_and_the_webhook(setup, monkeypatch):
    script, fake, sm = setup
    monkeypatch.setenv("BILLING_MODE", "both")
    assert script.main("test", apply=True) == 0
    want = {f"yourapp_plan_{p['id']}": (p["monthlyUsd"] * 100, True) for p in config.PAID_PLANS}
    want.update({f"yourapp_credits_{p['id']}": (p["payCents"], False) for p in config.packs()})
    assert _made(fake) == want
    assert [e.enabled_events for e in fake.endpoints] == [webhooks.events_for("both")]
    assert fake.endpoints[0].url == "https://test.yourapp.com/api/webhooks/stripe" and fake.endpoints[0].api_version
    stored = json.loads(sm.get_secret_value(SecretId="yourapp/test/stripe")["SecretString"])
    assert stored == {"secretKey": "sk_test_fake", "webhookSecret": "whsec_fake", "webhookEndpointId": "we_1"}
    # a second run finds everything by lookup key and changes nothing
    assert script.main("test", apply=True) == 0
    assert len(fake.prices) == len(want) and len(fake.endpoints) == 1


def test_each_mode_sets_up_only_its_own_prices_and_events(setup, monkeypatch):
    script, fake, _ = setup
    monkeypatch.setenv("BILLING_MODE", "credits")
    script.main("test", apply=True)
    assert all(k.startswith("yourapp_credits_") for k in _made(fake)) and "invoice.paid" not in fake.endpoints[0].enabled_events
    assert "payment_intent.succeeded" in fake.endpoints[0].enabled_events


def test_a_dry_run_changes_nothing(setup, monkeypatch):
    script, fake, sm = setup
    monkeypatch.setenv("BILLING_MODE", "subscriptions")
    assert script.main("test") == 0
    assert not fake.prices and not fake.endpoints and not fake.products
    assert "webhookSecret" not in json.loads(sm.get_secret_value(SecretId="yourapp/test/stripe")["SecretString"])


def test_it_refuses_a_key_of_the_wrong_kind(setup):
    script, fake, _ = setup
    assert script.main("prod", apply=True) == 1  # prod holds a sandbox key
    assert not fake.prices and not fake.endpoints


def test_the_api_finds_prices_by_the_keys_the_script_creates():
    assert 'f"{stripe_config.KEY_PREFIX}_plan_{plan}"' in (ROOT / "api/lib/subscriptions.py").read_text()
    assert 'APP = "yourapp"' in (ROOT / "scripts/stripe-setup.py").read_text()
    from api.lib import stripe_config
    assert stripe_config.KEY_PREFIX == "yourapp"
