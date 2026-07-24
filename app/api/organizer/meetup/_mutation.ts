import { SafeApplicationError } from "@/lib/validation/server-observability";

const INVALID_MUTATION_MESSAGE = "The request could not be validated.";

/**
 * Organizer mutations are cookie-authenticated browser requests. Requiring an
 * exact Origin match prevents another site from driving those mutations with
 * the signed-in user's ambient credentials.
 */
export function requireSameOriginMutation(request: Request): void {
  const originHeader = request.headers.get("origin");
  if (!originHeader) {
    throw invalidMutation();
  }

  try {
    const origin = new URL(originHeader);
    const requestUrl = new URL(request.url);
    if (originHeader !== origin.origin || origin.origin !== requestUrl.origin) {
      throw invalidMutation();
    }
  } catch (error) {
    if (error instanceof SafeApplicationError) throw error;
    throw invalidMutation();
  }
}

/**
 * Reads a request stream with a hard byte ceiling. Content-Length is only an
 * early rejection hint; the streamed byte count remains authoritative so a
 * missing, chunked, or dishonest length cannot bypass the cap.
 */
export async function readBoundedUtf8Body(
  request: Request,
  maxBytes: number,
): Promise<string> {
  const contentLength = request.headers.get("content-length");
  if (contentLength !== null) {
    if (!/^\d+$/u.test(contentLength)) throw invalidMutation();
    const declaredBytes = Number(contentLength);
    if (!Number.isSafeInteger(declaredBytes) || declaredBytes > maxBytes) {
      throw invalidMutation();
    }
  }

  if (!request.body) return "";

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const result = await reader.read();
      if (result.done) break;
      totalBytes += result.value.byteLength;
      if (totalBytes > maxBytes) {
        await reader.cancel();
        throw invalidMutation();
      }
      chunks.push(result.value);
    }
  } finally {
    reader.releaseLock();
  }

  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(body);
  } catch {
    throw invalidMutation();
  }
}

export function parseJsonBody(body: string): unknown {
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw invalidMutation();
  }
}

function invalidMutation() {
  return new SafeApplicationError(
    "validation_failed",
    400,
    INVALID_MUTATION_MESSAGE,
  );
}
