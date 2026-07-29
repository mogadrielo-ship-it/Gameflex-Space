import dotenv from 'dotenv';
import { createClient } from '@supabase/supabase-js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const envPath = path.resolve(__dirname, '../artifacts/api-server/.env');

dotenv.config({ path: envPath });

const SUPABASE_URL = process.env.SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY ?? process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL or SUPABASE_SERVICE_KEY / SUPABASE_SECRET_KEY / SUPABASE_ANON_KEY in', envPath);
  process.exit(1);
}

const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: {
    persistSession: false,
    autoRefreshToken: false,
  },
});

function parseArgs(argv) {
  const args = {
    backupFile: null,
    copyStorage: false,
    oldBaseUrl: null,
  };

  for (const arg of argv) {
    if (arg === '--copy-storage') {
      args.copyStorage = true;
    } else if (arg.startsWith('--old-base-url=')) {
      args.oldBaseUrl = arg.split('=')[1];
    } else if (!arg.startsWith('--')) {
      args.backupFile = arg;
    }
  }

  return args;
}

function chunkArray(items, size) {
  const chunks = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

function extractStorageObject(urlString) {
  try {
    const url = new URL(urlString);
    const match = url.pathname.match(/\/storage\/v1\/object\/public\/([^/]+)\/(.+)$/);
    if (!match) return null;
    return {
      bucket: match[1],
      objectPath: decodeURIComponent(match[2].replace(/^[\/]+/, '')),
    };
  } catch {
    return null;
  }
}

async function collectStorageUrls(tables) {
  const urls = new Set();
  for (const rows of Object.values(tables)) {
    if (!Array.isArray(rows)) continue;
    for (const row of rows) {
      if (!row || typeof row !== 'object') continue;
      for (const value of Object.values(row)) {
        if (typeof value === 'string' && value.includes('/storage/v1/object/public/')) {
          urls.add(value);
        }
      }
    }
  }
  return Array.from(urls);
}

async function ensureBucket(bucketName) {
  const response = await fetch(`${SUPABASE_URL}/storage/v1/bucket`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ name: bucketName, public: true }),
  });

  if (response.ok) {
    console.log(`Created storage bucket ${bucketName}`);
    return true;
  }

  const text = await response.text();
  if (response.status === 400 && text.includes('already exists')) {
    return true;
  }

  console.warn(`Unable to ensure storage bucket ${bucketName}: ${response.status} ${text}`);
  return false;
}

async function copyStorageAssets(oldBaseUrl, tables) {
  const urls = await collectStorageUrls(tables);
  if (!urls.length) {
    console.log('No storage URLs found in backup rows. Nothing to copy.');
    return;
  }

  console.log(`Found ${urls.length} storage asset URLs in backup; copying to ${SUPABASE_URL}`);

  const bucketsSeen = new Set();
  for (const url of urls) {
    const storageObject = extractStorageObject(url);
    if (!storageObject) {
      console.warn('Skipping unsupported storage URL:', url);
      continue;
    }

    const { bucket, objectPath } = storageObject;
    if (!bucketsSeen.has(bucket)) {
      await ensureBucket(bucket);
      bucketsSeen.add(bucket);
    }

    try {
      const response = await fetch(url);
      if (!response.ok) {
        console.warn(`Failed to download ${url}: ${response.status} ${response.statusText}`);
        continue;
      }
      const buffer = Buffer.from(await response.arrayBuffer());
      const { error } = await supabase.storage.from(bucket).upload(objectPath, buffer, { upsert: true });
      if (error) {
        console.warn(`Failed to upload ${bucket}/${objectPath}:`, error.message || error);
        continue;
      }
      console.log(`Copied ${bucket}/${objectPath}`);
    } catch (err) {
      console.warn(`Error processing ${url}:`, err);
    }
  }
}

async function importTables(tables) {
  const importOrder = [
    'profiles',
    'achievements',
    'tournaments',
    'marketplace_listings',
    'payments',
    'registrations',
    'user_statuses',
    'matches',
  ];

  const allTableKeys = [...new Set(Object.keys(tables))];
  const orderedTables = [...importOrder.filter((key) => allTableKeys.includes(key)), ...allTableKeys.filter((key) => !importOrder.includes(key))];

  for (const tableName of orderedTables) {
    const rows = tables[tableName];
    if (!Array.isArray(rows) || rows.length === 0) {
      console.log(`Skipping ${tableName}: no rows to import`);
      continue;
    }

    console.log(`Importing ${rows.length} rows into table '${tableName}'`);
    const chunks = chunkArray(rows, 250);
    for (let index = 0; index < chunks.length; index += 1) {
      const chunk = chunks[index];
      const { error } = await supabase.from(tableName).upsert(chunk, { onConflict: 'id', returning: 'minimal' });
      if (error) {
        throw new Error(`Import failed for table ${tableName} chunk ${index + 1}: ${error.message || JSON.stringify(error)}`);
      }
      console.log(`  ✓ Imported chunk ${index + 1}/${chunks.length} (${chunk.length} rows)`);
    }
  }
}

async function main() {
  const { backupFile, copyStorage, oldBaseUrl } = parseArgs(process.argv.slice(2));

  const repoRoot = path.resolve(__dirname, '..');
  const fallbackBackupFile = path.resolve(repoRoot, 'artifacts/api-server/mybackup.json');
  const resolvedBackupFile = backupFile ?? fallbackBackupFile;

  if (!resolvedBackupFile) {
    console.error('Usage: node import-supabase-backup.mjs <backup-file.json> [--copy-storage] [--old-base-url=https://old.supabase.co]');
    process.exit(1);
  }

  const backupPath = path.isAbsolute(resolvedBackupFile)
    ? resolvedBackupFile
    : path.resolve(repoRoot, resolvedBackupFile);
  console.log('Loading backup file:', backupPath);

  const backupText = await fs.readFile(backupPath, 'utf8');
  const backup = JSON.parse(backupText);

  if (!backup?.tables || typeof backup.tables !== 'object') {
    console.error('Invalid backup format. Expected { tables: { ... } }');
    process.exit(1);
  }

  try {
    await importTables(backup.tables);
    console.log('Database import completed successfully.');

    if (copyStorage) {
      await copyStorageAssets(oldBaseUrl, backup.tables);
      console.log('Storage asset copy completed.');
    }
  } catch (error) {
    console.error('Import error:', error instanceof Error ? error.message : error);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('Fatal error:', error);
  process.exit(1);
});
