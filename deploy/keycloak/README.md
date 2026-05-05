# Keycloak — realm and customisation

This directory holds the default Keycloak realm imported on first boot via `--import-realm`. The file is opinionated where it matters (PKCE on, brute-force protection on, locale `de`/`en`, three default realm roles) and minimal everywhere else.

## What ships

- **Realm:** `app`
- **Client:** `app-web` (Confidential, Authorization Code + PKCE, `S256`)
- **Realm roles:** `user`, `admin`, `ops`
- **Default test user:** `test@example.invalid` / `test1234` — has all three roles
- **Token lifespans:** access 5 min, refresh 30 min idle / 10 h max

## What customer admins do on first install

1. **Rotate the client secret** in the `app-web` client (Credentials tab) and update `KEYCLOAK_CLIENT_SECRET` in the customer's `.env`
2. **Delete or disable the test user** before the system is reachable from outside their network — operations doc has the exact step
3. **Adjust `redirectUris` and `webOrigins`** on the `app-web` client to the customer's actual hostname (defaults are `http://localhost:3000` and `https://*.example`)
4. **Wire identity federation** if the customer has an existing IdP (LDAP, AD, Azure AD, Okta) — Keycloak admin UI under *Identity Providers* / *User Federation*
5. **Set `sslRequired` to `all`** once a real cert is in place (defaults to `external`)
6. **Configure the realm SMTP** for password reset emails (Realm settings → Email)

The template **does not** ship with any of these wired up — all of it is customer-side configuration.

## Re-exporting the realm after changes

If we change the default realm in this repo (new role, new mapper, etc.), regenerate the JSON via:

```bash
docker compose exec keycloak \
  /opt/keycloak/bin/kc.sh export \
  --dir /opt/keycloak/data/export --realm app
```

…and copy the resulting file back into `deploy/keycloak/`. Diff carefully — Keycloak exports many fields with defaults that are noise.

## Bumping Keycloak major version

See ADR 0011. Process:

1. Bring the new image up against a copy of staging
2. Let Keycloak run its own schema migration on the dedicated `postgres-keycloak` database
3. Re-export the realm, diff for new fields, decide which to keep
4. Pin the new image tag in `docker-compose.yml`, write a release note in `CHANGELOG.md`

Never mix a Keycloak major bump with other infrastructure changes in the same release.
