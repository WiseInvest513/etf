"""Wise ID OIDC integration for Wise ETF.

OAuth/OIDC protocol details are delegated to Authlib.  Wise ETF only keeps an
opaque, revocable local session in Redis and exposes the public user profile to
the browser through a same-origin session endpoint.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
import secrets
import time
from dataclasses import dataclass
from typing import Any, Callable, Optional
from urllib.parse import parse_qsl, urlencode, urlsplit, urlunsplit

from fastapi import APIRouter, HTTPException, Request
from fastapi.responses import JSONResponse, RedirectResponse

try:
    from authlib.integrations.base_client import OAuthError
    from authlib.integrations.starlette_client.apps import StarletteOAuth2App
    from authlib.integrations.starlette_client import OAuth
except ImportError:  # Keep non-auth data routes importable before dependencies install.
    OAuth = None
    StarletteOAuth2App = None

    class OAuthError(Exception):
        error = "oauth_unavailable"
        description = "Authlib is not installed"


logger = logging.getLogger(__name__)

DEFAULT_ISSUER = "https://wise-invest.org"
DEFAULT_CLIENT_ID = "wise_etf"
DEFAULT_SCOPE = "openid profile email wise.membership"
DEFAULT_PRODUCTION_REDIRECT_URI = "https://www.wise-etf.com/api/auth/callback/wise"
DEFAULT_SESSION_TTL = 30 * 24 * 60 * 60
MAX_SESSION_TTL = 30 * 24 * 60 * 60
MEMBERSHIP_TIERS = {"MEMBER", "VIP", "VIP_PLUS"}


def canonicalize_wise_endpoint(value: Any) -> Any:
    """Route Wise OIDC network calls directly to the canonical www host.

    The provider intentionally keeps ``issuer=https://wise-invest.org`` but its
    HTTP endpoints currently redirect to ``www.wise-invest.org``.  Following
    that redirect is unsafe for authenticated token/userinfo calls because
    HTTP clients strip Authorization when the host changes.  Only endpoint
    transport URLs are rewritten; the OIDC issuer remains untouched.
    """
    if not isinstance(value, str):
        return value
    parsed = urlsplit(value)
    if parsed.scheme != "https" or parsed.hostname != "wise-invest.org":
        return value
    return urlunsplit((parsed.scheme, "www.wise-invest.org", parsed.path, parsed.query, parsed.fragment))


if StarletteOAuth2App is not None:
    class WiseOAuth2App(StarletteOAuth2App):
        async def load_server_metadata(self):
            metadata = await super().load_server_metadata()
            for key in (
                "authorization_endpoint",
                "token_endpoint",
                "userinfo_endpoint",
                "jwks_uri",
            ):
                if key in metadata:
                    metadata[key] = canonicalize_wise_endpoint(metadata[key])
            return metadata
else:  # pragma: no cover - exercised only when optional auth deps are absent.
    WiseOAuth2App = None


def is_production() -> bool:
    app_env = os.environ.get("APP_ENV", "").strip().lower()
    vercel_env = os.environ.get("VERCEL_ENV", "").strip().lower()
    return app_env in {"production", "prod"} or vercel_env == "production"


def oauth_flow_secret() -> str:
    """Secret used only for Authlib's short-lived state/PKCE session cookie."""
    configured = os.environ.get("WISE_AUTH_SESSION_SECRET", "").strip()
    if configured:
        return configured
    # The OAuth client secret is already high entropy. Domain-separated hashing
    # gives the short-lived state cookie an independent key without requiring a
    # second production secret to be managed in Vercel.
    client_secret = os.environ.get("WISE_AUTH_CLIENT_SECRET", "").strip()
    if client_secret:
        material = f"wise-etf:oauth-flow:v1:{client_secret}".encode("utf-8")
        return hashlib.sha256(material).hexdigest()
    # Stable development fallback keeps non-auth routes importable. Login still
    # rejects the request until WISE_AUTH_CLIENT_SECRET is configured.
    return "wise-etf-local-oauth-flow-only-change-in-production"


def oauth_cookie_name() -> str:
    return "__Host-wise_etf_oauth" if is_production() else "wise_etf_oauth"


@dataclass(frozen=True)
class AuthSettings:
    issuer: str
    client_id: str
    client_secret: str
    scope: str
    redirect_uri: str
    session_ttl: int

    @classmethod
    def from_env(cls) -> "AuthSettings":
        ttl_text = os.environ.get("WISE_AUTH_SESSION_TTL", str(DEFAULT_SESSION_TTL))
        try:
            ttl = int(ttl_text)
        except (TypeError, ValueError):
            ttl = DEFAULT_SESSION_TTL
        ttl = min(MAX_SESSION_TTL, max(15 * 60, ttl))
        return cls(
            issuer=os.environ.get("WISE_AUTH_ISSUER", DEFAULT_ISSUER).rstrip("/"),
            client_id=os.environ.get("WISE_AUTH_CLIENT_ID", DEFAULT_CLIENT_ID).strip(),
            client_secret=os.environ.get("WISE_AUTH_CLIENT_SECRET", "").strip(),
            scope=os.environ.get("WISE_AUTH_SCOPE", DEFAULT_SCOPE).strip(),
            redirect_uri=os.environ.get(
                "WISE_AUTH_REDIRECT_URI",
                DEFAULT_PRODUCTION_REDIRECT_URI if is_production() else "",
            ).strip(),
            session_ttl=ttl,
        )

    def missing(self) -> list[str]:
        missing = []
        if not self.client_id:
            missing.append("WISE_AUTH_CLIENT_ID")
        if not self.client_secret:
            missing.append("WISE_AUTH_CLIENT_SECRET")
        return missing


def sanitize_return_to(value: Optional[str]) -> str:
    """Accept only a same-origin relative path to prevent open redirects."""
    candidate = (value or "/").strip()
    if not candidate.startswith("/") or candidate.startswith("//") or len(candidate) > 2048:
        return "/"
    parsed = urlsplit(candidate)
    if parsed.scheme or parsed.netloc:
        return "/"
    return urlunsplit(("", "", parsed.path or "/", parsed.query, parsed.fragment))


def append_query(path: str, **params: str) -> str:
    parsed = urlsplit(sanitize_return_to(path))
    query = dict(parse_qsl(parsed.query, keep_blank_values=True))
    query.update({key: value for key, value in params.items() if value})
    return urlunsplit(("", "", parsed.path or "/", urlencode(query), parsed.fragment))


def membership_label(tier: str) -> str:
    return {
        "MEMBER": "普通用户",
        "VIP": "Wise VIP",
        "VIP_PLUS": "Wise SVIP",
    }.get(tier, "普通用户")


class WiseAuthService:
    def __init__(self, redis_factory: Callable[[], Any]):
        self.redis_factory = redis_factory
        self.router = APIRouter(prefix="/api/auth", tags=["auth"])
        self._oauth = None
        self._oauth_signature = None
        self._register_routes()

    @staticmethod
    def _session_cookie_name() -> str:
        return "__Host-wise_etf_session" if is_production() else "wise_etf_session"

    @staticmethod
    def _session_key(session_id: str) -> str:
        digest = hashlib.sha256(session_id.encode("utf-8", "ignore")).hexdigest()
        return f"wise:sso:session:{digest}"

    def _redis(self):
        redis = self.redis_factory()
        if not redis:
            raise HTTPException(status_code=503, detail="登录服务暂时不可用")
        return redis

    def _settings(self, request: Optional[Request] = None) -> AuthSettings:
        settings = AuthSettings.from_env()
        missing = settings.missing()
        if OAuth is None:
            missing.append("authlib")
        if missing:
            logger.error("[wise-auth] missing configuration: %s", ", ".join(sorted(set(missing))))
            raise HTTPException(status_code=503, detail="Wise ID 登录尚未完成配置")
        if not settings.redirect_uri and request is not None:
            settings = AuthSettings(
                issuer=settings.issuer,
                client_id=settings.client_id,
                client_secret=settings.client_secret,
                scope=settings.scope,
                redirect_uri=str(request.url_for("wise_auth_callback")),
                session_ttl=settings.session_ttl,
            )
        return settings

    def _client(self, settings: AuthSettings):
        signature = (
            settings.issuer,
            settings.client_id,
            settings.client_secret,
            settings.scope,
        )
        if self._oauth is None or signature != self._oauth_signature:
            oauth = OAuth()
            # Keep discovery authoritative while preventing authenticated OIDC
            # requests from losing their Authorization header on a cross-host
            # 307 redirect from wise-invest.org to www.wise-invest.org.
            oauth.oauth2_client_cls = WiseOAuth2App
            oauth.register(
                name="wise",
                client_id=settings.client_id,
                client_secret=settings.client_secret,
                server_metadata_url=f"{settings.issuer}/.well-known/openid-configuration",
                client_kwargs={
                    "scope": settings.scope,
                    "code_challenge_method": "S256",
                    "token_endpoint_auth_method": "client_secret_basic",
                    # Both Wise domains currently canonicalize to www with 307.
                    # Authlib/httpx does not follow redirects unless opted in,
                    # which otherwise breaks discovery and token exchange.
                    "follow_redirects": True,
                },
            )
            self._oauth = oauth
            self._oauth_signature = signature
        client = self._oauth.create_client("wise")
        if client is None:
            raise HTTPException(status_code=503, detail="Wise ID 登录客户端不可用")
        return client

    @staticmethod
    def _safe_picture(value: Any) -> Optional[str]:
        picture = str(value or "").strip()
        if not picture or len(picture) > 2048:
            return None
        parsed = urlsplit(picture)
        return picture if parsed.scheme == "https" and parsed.netloc else None

    @classmethod
    def _normalize_profile(cls, claims: dict[str, Any]) -> dict[str, Any]:
        subject = str(claims.get("sub") or "").strip()
        wise_user_id = str(claims.get("wise_user_id") or subject).strip()
        email = str(claims.get("email") or "").strip().lower()
        verified = claims.get("email_verified") is True
        if not subject or not wise_user_id or not email or not verified:
            raise HTTPException(status_code=403, detail="Wise ID 缺少已验证的用户信息")
        tier = str(claims.get("membership_tier") or "MEMBER").strip().upper()
        if tier not in MEMBERSHIP_TIERS:
            tier = "MEMBER"
        name = str(claims.get("name") or email.split("@", 1)[0] or wise_user_id).strip()[:200]
        return {
            "sub": subject[:200],
            "wise_user_id": wise_user_id[:200],
            "email": email[:320],
            "email_verified": True,
            "name": name,
            "picture": cls._safe_picture(claims.get("picture")),
            "membership_tier": tier,
            "membership_label": membership_label(tier),
        }

    def _create_session(self, profile: dict[str, Any], ttl: int) -> str:
        redis = self._redis()
        session_id = secrets.token_urlsafe(48)
        now = int(time.time())
        record = {
            **profile,
            "created_at": now,
            "expires_at": now + ttl,
        }
        try:
            redis.set(
                self._session_key(session_id),
                json.dumps(record, ensure_ascii=False),
                ex=ttl,
            )
        except Exception as exc:
            logger.error("[wise-auth] session write failed: %s", type(exc).__name__)
            raise HTTPException(status_code=503, detail="登录会话创建失败") from exc
        return session_id

    def _read_session(self, request: Request) -> Optional[dict[str, Any]]:
        session_id = request.cookies.get(self._session_cookie_name(), "")
        if not session_id or len(session_id) > 256:
            return None
        try:
            value = self._redis().get(self._session_key(session_id))
            if not value:
                return None
            if isinstance(value, bytes):
                value = value.decode("utf-8")
            record = json.loads(value) if isinstance(value, str) else value
            if not isinstance(record, dict) or int(record.get("expires_at") or 0) <= int(time.time()):
                return None
            return record
        except HTTPException:
            raise
        except Exception as exc:
            logger.warning("[wise-auth] session read failed: %s", type(exc).__name__)
            return None

    @staticmethod
    def _public_user(record: dict[str, Any]) -> dict[str, Any]:
        fields = (
            "wise_user_id", "email", "email_verified", "name", "picture",
            "membership_tier", "membership_label",
        )
        return {field: record.get(field) for field in fields}

    def _delete_session(self, request: Request) -> None:
        session_id = request.cookies.get(self._session_cookie_name(), "")
        if not session_id:
            return
        try:
            self._redis().delete(self._session_key(session_id))
        except Exception as exc:
            logger.warning("[wise-auth] session delete failed: %s", type(exc).__name__)

    def require_user(self, request: Request) -> dict[str, Any]:
        record = self._read_session(request)
        if not record:
            raise HTTPException(status_code=401, detail="请先使用 Wise ID 登录")
        return record

    def require_membership(self, *allowed_tiers: str):
        allowed = {tier.upper() for tier in allowed_tiers}

        def dependency(request: Request) -> dict[str, Any]:
            record = self.require_user(request)
            if str(record.get("membership_tier") or "MEMBER").upper() not in allowed:
                raise HTTPException(status_code=403, detail="当前会员等级无权使用此功能")
            return record

        return dependency

    @staticmethod
    def _no_store(response):
        response.headers["Cache-Control"] = "no-store, private"
        response.headers["Pragma"] = "no-cache"
        return response

    def _set_session_cookie(self, response, session_id: str, settings: AuthSettings) -> None:
        response.set_cookie(
            key=self._session_cookie_name(),
            value=session_id,
            max_age=settings.session_ttl,
            expires=settings.session_ttl,
            path="/",
            secure=is_production() or settings.redirect_uri.startswith("https://"),
            httponly=True,
            samesite="lax",
        )

    def _clear_session_cookie(self, response) -> None:
        response.delete_cookie(
            key=self._session_cookie_name(),
            path="/",
            secure=is_production(),
            httponly=True,
            samesite="lax",
        )

    def _register_routes(self) -> None:
        @self.router.get("/login/wise", name="wise_auth_login")
        async def login(request: Request, return_to: str = "/"):
            settings = self._settings(request)
            safe_return_to = sanitize_return_to(return_to)
            request.session["wise_return_to"] = safe_return_to
            try:
                client = self._client(settings)
                response = await client.authorize_redirect(request, settings.redirect_uri)
                return self._no_store(response)
            except Exception as exc:
                request.session.clear()
                logger.error("[wise-auth] authorize redirect failed: %s", type(exc).__name__)
                return self._no_store(RedirectResponse(
                    append_query(safe_return_to, auth_error="login_failed"),
                    status_code=302,
                ))

        @self.router.get("/callback/wise", name="wise_auth_callback")
        async def callback(request: Request):
            return_to = sanitize_return_to(request.session.pop("wise_return_to", "/"))
            try:
                settings = self._settings(request)
                client = self._client(settings)
                token = await client.authorize_access_token(request)
                claims = dict(token.get("userinfo") or {})
                # UserInfo is authoritative for membership and profile fields.  If it
                # is temporarily unavailable, the already-verified ID token claims
                # remain an acceptable login identity.
                try:
                    userinfo = await client.userinfo(token=token)
                    claims.update(dict(userinfo or {}))
                except Exception as exc:
                    logger.warning("[wise-auth] userinfo fallback: %s", type(exc).__name__)
                profile = self._normalize_profile(claims)
                session_id = self._create_session(profile, settings.session_ttl)
                request.session.clear()
                response = RedirectResponse(return_to, status_code=302)
                self._set_session_cookie(response, session_id, settings)
                logger.info("[wise-auth] login success: %s", profile["wise_user_id"])
                return self._no_store(response)
            except HTTPException as exc:
                request.session.clear()
                logger.warning("[wise-auth] callback rejected: http_%s", exc.status_code)
                return self._no_store(RedirectResponse(append_query(return_to, auth_error="login_failed"), status_code=302))
            except OAuthError as exc:
                request.session.clear()
                logger.warning("[wise-auth] oauth callback rejected: %s", getattr(exc, "error", type(exc).__name__))
                return self._no_store(RedirectResponse(append_query(return_to, auth_error="authorization_failed"), status_code=302))
            except Exception as exc:
                request.session.clear()
                logger.error("[wise-auth] callback failed: %s", type(exc).__name__)
                return self._no_store(RedirectResponse(append_query(return_to, auth_error="login_failed"), status_code=302))

        @self.router.get("/session", name="wise_auth_session")
        async def session(request: Request):
            record = self._read_session(request)
            payload = {
                "ok": True,
                "authenticated": bool(record),
                "user": self._public_user(record) if record else None,
            }
            return self._no_store(JSONResponse(payload))

        @self.router.post("/logout", name="wise_auth_logout")
        async def logout(request: Request):
            self._delete_session(request)
            request.session.clear()
            response = JSONResponse({"ok": True})
            self._clear_session_cookie(response)
            return self._no_store(response)

        # Explicitly retire the password API instead of leaving an undocumented
        # legacy credential path active after the UI migrates to Wise ID.
        @self.router.post("/register", include_in_schema=False)
        @self.router.post("/login", include_in_schema=False)
        @self.router.post("/change_password", include_in_schema=False)
        async def legacy_password_auth_retired():
            raise HTTPException(status_code=410, detail="请使用 Wise ID 统一登录")
