# Turning on accounts and online saving

The cloud service (`apps/cloud`, SPEC section 8.4) serves the editor and the sign-in API from one address. These are the
steps only the instructor can do. Nothing here is done yet.

## 1. Choose the address

Use a subdomain of its own at the root, for example `https://archboard.<your-domain>/`. The service refuses a folder
(`https://example.org/archboard/`), and it refuses plain http unless the address is localhost. That address is `PUBLIC_URL`
below.

## 2. Register the sign-in apps

GitHub (start with this one):

1. Go to github.com → Settings → Developer settings → OAuth Apps → New OAuth App.
2. Set **Homepage URL** to `PUBLIC_URL`.
3. Set **Authorization callback URL** to `PUBLIC_URL` + `auth/github/callback`.
4. Copy the Client ID. Then generate a client secret and copy it too.

Google (optional):

1. Go to console.cloud.google.com → APIs & Services.
2. On the OAuth consent screen, choose External and add the scopes `openid` and `profile`.
3. Go to Credentials → Create credentials → OAuth client ID → Web application.
4. Under Authorised redirect URIs, add `PUBLIC_URL` + `auth/google/callback`.
5. Copy the client ID and the client secret.

For trying it on your own computer, you can register a second GitHub app. Set its callback to
`http://localhost:8788/auth/github/callback` and use `PUBLIC_URL=http://localhost:8788/`.

## 3. Run it

```sh
docker build -f apps/cloud/Dockerfile -t archboard-cloud .
docker run -d --name archboard-cloud --restart unless-stopped \
  -p 127.0.0.1:8788:8788 -v archboard-data:/app/data \
  -e PUBLIC_URL=https://archboard.example.org/ \
  -e GITHUB_CLIENT_ID=... -e GITHUB_CLIENT_SECRET=... \
  archboard-cloud
```

Your https proxy (the one in front of labsite, for example) forwards the address to `127.0.0.1:8788`. All diagrams live
in the `archboard-data` volume, in `archboard.db`. Back up that file as you back up labsite's database.

## 4. Try it without any provider (local only)

From the repository root, after building the editor and the service:

```sh
PUBLIC_URL=http://localhost:4320/ PORT=4320 ARCHBOARD_DEV_LOGIN=1 ARCHBOARD_DB=./data/test.db \
ARCHBOARD_STATIC=apps/editor/dist node --disable-warning=ExperimentalWarning apps/cloud/dist/server.js
```

Open http://localhost:4320/ and choose "Sign in with a test account". `ARCHBOARD_DEV_LOGIN` only works with a localhost
address.

## What the service keeps about a person

For each person the service keeps:

- the provider (GitHub or Google);
- the provider's id number for them;
- a display name;
- their diagrams.

It keeps no email address, no picture and no password. "Delete account" in the editor removes the person, their sessions
and all their diagrams. Keeping people's names and diagrams on your server is your decision; this note is here so you can
make it knowingly.
