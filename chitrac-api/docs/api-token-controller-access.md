# API Token Controller Access

Permanent API tokens now store `allowedControllers` on their `auth-tokens` record.
Valid IDs, in UI order: `general`, `settings`, `spindle`, `milnor`, `softrol`.
Unknown, duplicate, missing or malformed grants deny access. An empty array grants
no controller access. Permissions are read from MongoDB on each request, not JWT
claims; updating grants or deactivating a token takes effect on the next request.

## Administration

Go to Settings > API Tokens (`/ng/settings/tokens`) and choose the controller
access shield in an active token's Actions column. Move controllers between
Allowed and Not Allowed, then Save. Cancel leaves the record unchanged.

`GET /api/auth/tokens` includes `controllers` (IDs and labels), and
`allowedControllers` on each active/inactive token. Secrets and hashes are not
included. A signed-in user with permission level 0 or 1 can update an active token:

```http
PUT /api/auth/tokens/:id/controllers
Content-Type: application/json
Authorization: Bearer <user-login-token>

{"allowedControllers":["general","milnor"]}
```

The response contains `success` and the saved `allowedControllers`. Invalid
payloads/IDs return 400; missing tokens return 404; inactive tokens return 409;
insufficient user permissions return 403. Permanent API tokens cannot use token
management or user-identity management endpoints, even with Settings access.
This prevents them minting unrestricted user tokens or changing their own grants.

## Controller Groups

| ID | Routes |
| --- | --- |
| spindle | `/api/spindle` and descendants |
| milnor | `/api/milnor` and descendants |
| softrol | `/api/softrol` and descendants |
| settings | `/api/auth`, `/api/preferences`, `/api/system-preferences`, `/api/utilities`; user/passport management remains interactive-user-only |
| general | All remaining API controllers, including alpha, machine (including XML), operator, item, dashboard, fault, reports, history, biko, status and jira |

Controller access does not enable integrations disabled by `SPINDLE`, `MILNOR` or
`SOFTROL`, or override existing endpoint-level user permission checks. Ordinary
signed-in users are not restricted by API token scopes. Existing API key header,
Bearer, query and body token transports are still supported.

## Deployment and Compatibility

Startup runs an idempotent migration **before registering routes or listening**.
Only records with no `allowedControllers` field receive all five groups to
preserve existing integrations. Explicit empty/malformed values are not replaced.
New tokens are created with `[]`; configure their grants before using them.
No manual token regeneration or database script is required.
New token hashes digest the entire JWT before bcrypt and use a unique JWT ID,
avoiding bcrypt's 72-byte truncation when names are reused. Legacy hashes remain
supported; hashes and their versions are never exposed by list responses.

All data API routes now require authentication when `enableApiTokenCheck` is true,
including routes which previously lacked a check. Anonymous clients must supply
a configured token. The existing explicit authentication-disabled configuration
still bypasses authentication and scope enforcement; do not use it for a secured
deployment.

Exact login, current-session, logout, safe public settings-bootstrap and
password-reset completion routes remain available without API controller grants.
The old test-token generator now requires a signed-in root user; fabricated test
identities are not accepted as real user authentication.

## Verification

Run `npm test` in `chitrac-api` for schema, migration, scope matrix, public-route,
revocation, header transport and token-management authorization tests.
In the UI, save General-only access, verify a machine API returns 200 and a Milnor
API returns 403 (with Milnor enabled), then change grants using the same token.
Verify an inactive token returns 401, and Save/Cancel/error retry work as expected.
