/** SHA-256 of the exact local PDF bytes used for a reviewed sheet source. */
export async function fingerprintPdfBytes(bytes) {
  if (!bytes?.length) throw new Error('The PDF is empty or could not be read.');
  const digest = await globalThis.crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
