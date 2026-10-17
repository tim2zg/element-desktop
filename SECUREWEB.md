# SecureWeb desktop clients

Last updated: 2026-10-17

Audience: desktop users and homelab operators. These client forks add a native
v2 envelope transport to Nextcloud Desktop and Element Desktop. Initial packages
are Windows x64 prereleases. Native application encryption and permissions remain
separate from SecureWeb transport protection.

Windows x64 previews:
[Nextcloud Desktop](https://github.com/tim2zg/desktop-secureWeb-nc/releases/tag/secureweb-desktop-v0.1.0)
and [Element Desktop](https://github.com/tim2zg/element-desktop/releases/tag/secureweb-desktop-v0.1.0).
Each release includes checksums and source/build verification records.

## Gateway setup

Build the matching SecureWeb connector revision. Register each backend as a
service with its own UUID, capabilities `desktop:read` and `desktop:write`, and
explicit device/token routing grants. A service session needs the exact service
audience and current grants; registering a service alone grants no access.
The native session verifier requires the authoritative relay database. Backend
credentials do not substitute for a SecureWeb service session.

Add fixed loopback backends to `config.toml`, using your registered service UUIDs:

```toml
[[desktop_connectors]]
service_id = "123e4567-e89b-42d3-a456-426614174000"
upstream_url = "http://127.0.0.1:8081"
public_origin = "https://cloud.example.com"

[[desktop_connectors]]
service_id = "123e4567-e89b-42d3-a456-426614174002"
upstream_url = "http://127.0.0.1:8008"
public_origin = "https://matrix.example.com"
```

Nextcloud must trust the configured public hostname and the loopback proxy;
Synapse needs its normal proxy configuration. Keep both backends private.
The connector opens service envelopes in the gateway process, verifies the
native session/current routing authority, then forwards to the fixed backend.
This separates gateway/service keys, but does not provide process isolation.

## Client profile

Create a private JSON file for each client. Use a newly issued native service
JWT and public key pins obtained from an independently trusted administrator.
Keys use standard base64. Never include private keys. Example placeholders must
be replaced; the client rejects malformed UUIDs, keys and sessions.

```json
{
  "gateway_origin": "https://secure.example.com",
  "upstream_origin": "https://cloud.example.com",
  "service_id": "123e4567-e89b-42d3-a456-426614174000",
  "device_id": "123e4567-e89b-42d3-a456-426614174001",
  "gateway_public_key": "BASE64_XWING_GATEWAY_PUBLIC_KEY",
  "service_public_key": "BASE64_XWING_SERVICE_PUBLIC_KEY",
  "service_session": "NATIVE_SERVICE_JWT"
}
```

For Element use its Matrix service UUID/key and Matrix public origin. Point the
client's homeserver at that origin. In SecureWeb mode Nextcloud's account wizard
uses its existing username/app-password form. Use a Nextcloud application password,
not the browser login flow. Those credentials travel inside the service
envelope, separately from the native session.

Set `SECUREWEB_NEXTCLOUD_PROFILE` or `SECUREWEB_ELEMENT_PROFILE` to the absolute
profile path before starting that app. Alternatively place `secureweb.json` in
Nextcloud's application configuration directory or Element's user-data directory.
Quit an already-running client first. With no selected profile, the app retains
its ordinary upstream networking mode. Once selected, transport failure never
falls back to ordinary HTTPS. Nextcloud latches its selected path at startup.

Profiles contain bearer sessions: restrict file access to your OS user, exclude
them from repositories and replace expired sessions explicitly. This version
does not renew sessions or automatically accept changed key pins. Revocation
denies later service operations; it does not remove local files or message keys.

## Initial scope and verification

The first transport buffers a maximum of 32 MiB per application request/response.
Nextcloud upload chunks must fit that limit; larger downloads and Matrix media
are refused. Leave Nextcloud upload speed unlimited: the buffered adapter does
not support bandwidth-throttled upload devices in this preview.
Large-file streaming, automatic enrollment/session renewal,
browser-based SSO, Nextcloud push sockets and Element voice/video are outside
this prerelease's supported scope. Matrix's existing room encryption is retained;
its algorithm is not changed to PQ by the outer envelope transport.

Each client bundles `secureweb-desktop-transport`, invoked through private stdin
and stdout pipes, without a listening local proxy or credentials in arguments.
The shared helper uses the existing Rust X-Wing/HPKE and bincode implementation.
Client tests and a synthetic gateway test exercise routing, sealed response
opening, tampering, unsealed replies, credential separation and error handling.
These tests do not establish live Nextcloud sync, Matrix account login,
revocation on a deployed database, installer execution or a homelab deployment.

Run the [build commands](https://github.com/00ong/secureWeb/blob/codex/desktop-clients/docs/BUILD.md) and the client forks' release workflows;
publish artifacts only after their test/build jobs succeed. Check release notes
for the exact source revision, executed validation and outstanding live tests.
