#!/usr/bin/env node

const fs = require('fs');
const path = require('path');
const { getMe, getUsableTokens, loadEnv } = require('./x-auth');

function parseArgs(argv) {
  const args = {
    yes: false
  };
  for (let index = 2; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === '--yes') {
      args.yes = true;
    } else if (value === '--text') {
      args.text = argv[index + 1];
      index += 1;
    } else if (value === '--file') {
      args.file = argv[index + 1];
      index += 1;
    } else if (!value.startsWith('--') && !args.text) {
      args.text = value;
    } else {
      throw new Error(`Unknown argument: ${value}`);
    }
  }
  return args;
}

function readPostText(args) {
  if (args.file) {
    return fs.readFileSync(path.resolve(process.cwd(), args.file), 'utf8').trim();
  }
  return String(args.text || '').trim();
}

function validatePostText(text) {
  if (!text) throw new Error('Post text is required. Use --text "..." or --file path.txt');
  if ([...text].length > 280) {
    throw new Error(`Post text is ${[...text].length} characters; keep it at 280 or less for this helper.`);
  }
}

async function createPost(accessToken, text) {
  const response = await fetch('https://api.x.com/2/tweets', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ text })
  });
  const payload = await response.json();
  if (!response.ok) {
    throw new Error(`Post failed (${response.status}): ${JSON.stringify(payload)}`);
  }
  return payload;
}

async function main() {
  const args = parseArgs(process.argv);
  const text = readPostText(args);
  validatePostText(text);

  const env = loadEnv();
  const tokens = await getUsableTokens(env);
  const me = await getMe(tokens.access_token);

  console.log(`Account: @${me.data.username} (${me.data.id})`);
  console.log(`Characters: ${[...text].length}`);
  console.log('Post text:');
  console.log(text);

  if (!args.yes) {
    console.log('');
    console.log('Dry run only. Add --yes to publish.');
    return;
  }

  const result = await createPost(tokens.access_token, text);
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error.message);
    process.exit(1);
  });
}

module.exports = {
  createPost,
  parseArgs,
  readPostText,
  validatePostText
};

