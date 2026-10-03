import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || '';
const SUPABASE_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || '';

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

export const BUCKET_NAME = 'videos';

/**
 * Upload a file to Supabase Storage
 */
export async function uploadToSupabase(
  path: string,
  file: Blob | ArrayBuffer,
  contentType: string
): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .upload(path, file, {
      contentType,
      upsert: true,
    });

  if (error) {
    throw new Error(`Supabase upload failed: ${error.message}`);
  }

  return data.path;
}

/**
 * Generate a presigned URL for downloading a file
 */
export async function getPresignedUrl(path: string, expiresIn = 3600): Promise<string> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .createSignedUrl(path, expiresIn);

  if (error) {
    throw new Error(`Supabase presigned URL failed: ${error.message}`);
  }

  return data.signedUrl;
}

/**
 * Delete a file from Supabase Storage
 */
export async function deleteFromSupabase(path: string): Promise<void> {
  const { error } = await supabase.storage
    .from(BUCKET_NAME)
    .remove([path]);

  if (error) {
    console.error(`Supabase delete failed: ${error.message}`);
  }
}

/**
 * Download a file from Supabase Storage
 */
export async function downloadFromSupabase(path: string): Promise<ArrayBuffer> {
  const { data, error } = await supabase.storage
    .from(BUCKET_NAME)
    .download(path);

  if (error) {
    throw new Error(`Supabase download failed: ${error.message}`);
  }

  return await data.arrayBuffer();
}

// ─── Metadata Database Operations ───

export async function createJob(job: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('jobs').insert(job);
  if (error) throw new Error(`DB insert failed: ${error.message}`);
}

export async function updateJob(id: string, updates: Record<string, unknown>): Promise<void> {
  const { error } = await supabase.from('jobs').update(updates).eq('id', id);
  if (error) throw new Error(`DB update failed: ${error.message}`);
}

export async function getJob(id: string): Promise<Record<string, unknown> | null> {
  const { data, error } = await supabase.from('jobs').select('*').eq('id', id).single();
  if (error) throw new Error(`DB query failed: ${error.message}`);
  return data;
}
