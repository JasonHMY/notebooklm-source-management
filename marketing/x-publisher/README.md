# X Publisher

Local OAuth 2.0 helper for the NotebookLM Source Management promotion account.

This folder is for marketing automation only. It is not part of the Chrome extension runtime or release package.

## Setup

1. In the X Developer Portal, confirm the app uses OAuth 2.0 with read and write permissions.
2. Confirm the callback URL is exactly:

   ```text
   http://127.0.0.1:3000/callback
   ```

3. Copy `.env.example` to `.env` and fill it locally:

   ```bash
   cd marketing/x-publisher
   cp .env.example .env
   ```

4. Run the authorization flow:

   ```bash
   node x-auth.js auth
   ```

5. Open the printed X authorization URL, approve the app, and wait for the local callback to save `tokens.json`.
6. Verify the account:

   ```bash
   node x-auth.js me
   ```

## Import Existing Tokens

If the X Developer Portal generated an access token and refresh token directly, add them to `.env`:

```text
X_ACCESS_TOKEN=
X_REFRESH_TOKEN=
```

Then save them into `tokens.json`:

```bash
node x-auth.js import
node x-auth.js me
```

## Posting

Dry run:

```bash
node post.js --text "Testing local X API publishing for NotebookLM Source Management."
```

Actually post:

```bash
node post.js --text "Testing local X API publishing for NotebookLM Source Management." --yes
```

Post from a text file:

```bash
node post.js --file ../drafts/example.txt --yes
```

## Safety

- `.env` and `tokens.json` are ignored by git.
- `post.js` does not publish unless `--yes` is passed.
- Keep X credentials and tokens in a password manager or local ignored files only.
- Regenerate credentials if they were exposed in screenshots or chat.
