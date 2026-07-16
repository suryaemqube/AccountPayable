export const ALLOWED_ATTACHMENT_TYPES = ['application/pdf'];
export const ALLOWED_ATTACHMENT_EXTENSIONS = ['.pdf'];
export const MAX_ATTACHMENT_SIZE_MB = 5;
export const MAX_ATTACHMENT_SIZE_BYTES = MAX_ATTACHMENT_SIZE_MB * 1024 * 1024;

export function validateAttachmentFiles(files) {
  const errors = [];
  const valid  = [];

  for (const file of files) {
    const ext  = '.' + file.name.split('.').pop().toLowerCase();
    const ok   = ALLOWED_ATTACHMENT_EXTENSIONS.includes(ext) && ALLOWED_ATTACHMENT_TYPES.includes(file.type);
    const size = file.size <= MAX_ATTACHMENT_SIZE_BYTES;

    if (!ok)   errors.push(`"${file.name}" — only PDF files are allowed.`);
    else if (!size) errors.push(`"${file.name}" — exceeds ${MAX_ATTACHMENT_SIZE_MB} MB limit.`);
    else valid.push(file);
  }

  return { valid, errors };
}
