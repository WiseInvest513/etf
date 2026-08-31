import json
import time
import unittest
from unittest.mock import patch

from fastapi import HTTPException
from starlette.requests import Request

from api.auth_sso import (
    AuthSettings,
    WiseAuthService,
    append_query,
    membership_label,
    oauth_flow_secret,
    sanitize_return_to,
)


class FakeRedis:
    def __init__(self):
        self.values = {}

    def set(self, key, value, ex=None, **_kwargs):
        self.values[key] = value
        return True

    def get(self, key):
        return self.values.get(key)

    def delete(self, key):
        self.values.pop(key, None)
        return 1


def request_with_cookie(name, value):
    headers = [(b"cookie", f"{name}={value}".encode())] if value else []
    return Request({"type": "http", "method": "GET", "path": "/", "headers": headers})


class RedirectSafetyTests(unittest.TestCase):
    def test_same_origin_relative_paths_are_preserved(self):
        self.assertEqual(sanitize_return_to("/qdii?code=017436#detail"), "/qdii?code=017436#detail")

    def test_external_or_protocol_relative_paths_are_rejected(self):
        for value in ("https://evil.example", "//evil.example/path", "javascript:alert(1)", ""):
            with self.subTest(value=value):
                self.assertEqual(sanitize_return_to(value), "/")

    def test_auth_error_is_added_without_dropping_existing_query(self):
        self.assertEqual(
            append_query("/qdii?code=017436#detail", auth_error="login_failed"),
            "/qdii?code=017436&auth_error=login_failed#detail",
        )


class ProfileContractTests(unittest.TestCase):
    def test_profile_maps_membership_and_verified_identity(self):
        profile = WiseAuthService._normalize_profile({
            "sub": "oidc-subject",
            "wise_user_id": "wise-123",
            "email": "User@Example.com",
            "email_verified": True,
            "name": "测试用户",
            "membership_tier": "vip_plus",
        })
        self.assertEqual(profile["email"], "user@example.com")
        self.assertEqual(profile["membership_tier"], "VIP_PLUS")
        self.assertEqual(profile["membership_label"], "Wise SVIP")

    def test_unverified_email_is_rejected(self):
        with self.assertRaises(HTTPException) as raised:
            WiseAuthService._normalize_profile({
                "sub": "oidc-subject",
                "email": "user@example.com",
                "email_verified": False,
            })
        self.assertEqual(raised.exception.status_code, 403)

    def test_unknown_membership_is_safely_downgraded(self):
        profile = WiseAuthService._normalize_profile({
            "sub": "oidc-subject",
            "email": "user@example.com",
            "email_verified": True,
            "membership_tier": "unexpected",
        })
        self.assertEqual(profile["membership_tier"], "MEMBER")
        self.assertEqual(membership_label(profile["membership_tier"]), "普通用户")


class SessionContractTests(unittest.TestCase):
    def setUp(self):
        self.redis = FakeRedis()
        self.service = WiseAuthService(lambda: self.redis)
        self.profile = {
            "sub": "oidc-subject",
            "wise_user_id": "wise-123",
            "email": "user@example.com",
            "email_verified": True,
            "name": "测试用户",
            "picture": None,
            "membership_tier": "VIP",
            "membership_label": "Wise VIP",
        }

    def test_server_side_session_round_trip_and_delete(self):
        session_id = self.service._create_session(self.profile, 3600)
        request = request_with_cookie(self.service._session_cookie_name(), session_id)

        record = self.service._read_session(request)
        self.assertEqual(record["wise_user_id"], "wise-123")
        self.assertNotIn(session_id, json.dumps(self.redis.values))

        self.service._delete_session(request)
        self.assertIsNone(self.service._read_session(request))

    def test_expired_session_is_not_authenticated(self):
        session_id = "expired-session"
        self.redis.set(self.service._session_key(session_id), json.dumps({
            **self.profile,
            "expires_at": int(time.time()) - 1,
        }))
        request = request_with_cookie(self.service._session_cookie_name(), session_id)
        self.assertIsNone(self.service._read_session(request))

    def test_membership_guard_uses_server_session(self):
        session_id = self.service._create_session(self.profile, 3600)
        request = request_with_cookie(self.service._session_cookie_name(), session_id)
        self.assertEqual(self.service.require_membership("VIP", "VIP_PLUS")(request)["membership_tier"], "VIP")
        with self.assertRaises(HTTPException) as raised:
            self.service.require_membership("VIP_PLUS")(request)
        self.assertEqual(raised.exception.status_code, 403)


class SettingsContractTests(unittest.TestCase):
    def test_production_only_requires_client_secret(self):
        with patch.dict("os.environ", {"APP_ENV": "production"}, clear=True):
            settings = AuthSettings.from_env()
            missing = settings.missing()
        self.assertIn("WISE_AUTH_CLIENT_SECRET", missing)
        self.assertEqual(settings.redirect_uri, "https://www.wise-etf.com/api/auth/callback/wise")
        self.assertNotIn("WISE_AUTH_SESSION_SECRET", missing)
        self.assertNotIn("WISE_AUTH_REDIRECT_URI", missing)

    def test_oauth_cookie_secret_is_domain_separated_from_client_secret(self):
        with patch.dict("os.environ", {"WISE_AUTH_CLIENT_SECRET": "client-secret"}, clear=True):
            derived = oauth_flow_secret()
        self.assertNotEqual(derived, "client-secret")
        self.assertEqual(len(derived), 64)

    def test_explicit_oauth_cookie_secret_remains_supported(self):
        with patch.dict("os.environ", {
            "WISE_AUTH_CLIENT_SECRET": "client-secret",
            "WISE_AUTH_SESSION_SECRET": "separate-session-secret",
        }, clear=True):
            self.assertEqual(oauth_flow_secret(), "separate-session-secret")


if __name__ == "__main__":
    unittest.main()
