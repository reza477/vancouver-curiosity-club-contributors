import {
  CSV_IMPORT_CANONICAL_COLUMNS,
  CSV_IMPORT_IGNORE,
  CSV_IMPORT_MAX_FILE_BYTES,
  type CsvImportHeaderSelection,
} from "@/lib/imports/csv";
import { validationIssue } from "@/lib/validation";
import { SafeApplicationError } from "@/lib/validation/server-observability";
import { requireSameOriginMutation } from "../meetup/_mutation";

const MAX_MULTIPART_OVERHEAD_BYTES = 256 * 1024;

export type CsvImportMultipartInput = Readonly<{
  file: File;
  headerSelections: readonly CsvImportHeaderSelection[];
  inspectionBatchId: string | null;
  sourceLabel: string | null;
  sourceNamespace: string | null;
}>;

export async function readCsvImportMultipart(
  request: Request,
  options: Readonly<{ requireMapping: boolean }>,
): Promise<CsvImportMultipartInput> {
  try {
    requireSameOriginMutation(request);
  } catch {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "This request is not permitted.",
    );
  }
  const contentLength = boundedContentLength(
    request.headers.get("content-length"),
  );
  if (
    contentLength !== null &&
    contentLength > CSV_IMPORT_MAX_FILE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES
  ) {
    throw invalidUpload("The CSV upload is too large.");
  }
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.toLowerCase().startsWith("multipart/form-data;")) {
    throw invalidUpload("Expected a local CSV upload.");
  }

  const bytes = await readBoundedBody(
    request,
    CSV_IMPORT_MAX_FILE_BYTES + MAX_MULTIPART_OVERHEAD_BYTES,
  );
  if (contentLength !== null && contentLength !== bytes.byteLength) {
    throw invalidUpload("The upload size is invalid.");
  }
  let form: FormData;
  try {
    form = await new Request(request.url, {
      body: bytes,
      headers: { "content-type": contentType },
      method: "POST",
    }).formData();
  } catch {
    throw invalidUpload("The upload body could not be read.");
  }
  const expectedKeys = new Set([
    "file",
    "headerSelections",
    "inspectionBatchId",
    "sourceLabel",
    "sourceNamespace",
  ]);
  for (const [key] of form) {
    if (!expectedKeys.has(key)) {
      throw invalidUpload("The upload contains an unsupported form field.");
    }
  }
  assertSinglePart(form, "file", true, true);
  assertSinglePart(form, "sourceLabel", false, false);
  assertSinglePart(form, "sourceNamespace", false, false);
  if (options.requireMapping) {
    assertSinglePart(form, "headerSelections", false, true);
    assertSinglePart(form, "inspectionBatchId", false, true);
  } else if (
    form.getAll("headerSelections").length > 0 ||
    form.getAll("inspectionBatchId").length > 0
  ) {
    throw invalidUpload("The inspection upload contains preview-only fields.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) {
    throw invalidUpload("Choose one local CSV file.");
  }
  if (file.size > CSV_IMPORT_MAX_FILE_BYTES) {
    throw invalidUpload("The CSV upload is too large.");
  }
  const headerSelections = options.requireMapping
    ? parseHeaderSelections(form.get("headerSelections"))
    : Object.freeze([]);
  return Object.freeze({
    file,
    headerSelections,
    inspectionBatchId: optionalFormString(
      form.get("inspectionBatchId"),
      "inspectionBatchId",
    ),
    sourceLabel: optionalFormString(form.get("sourceLabel"), "sourceLabel"),
    sourceNamespace: optionalFormString(
      form.get("sourceNamespace"),
      "sourceNamespace",
    ),
  });
}

function parseHeaderSelections(
  value: FormDataEntryValue | null,
): readonly CsvImportHeaderSelection[] {
  if (typeof value !== "string") {
    throw invalidUpload("Provide one mapping choice for every CSV header.");
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw invalidUpload("The CSV mapping is malformed.");
  }
  if (!Array.isArray(parsed) || parsed.length > 40) {
    throw invalidUpload("The CSV mapping is malformed.");
  }
  const allowed = new Set<string>([
    ...CSV_IMPORT_CANONICAL_COLUMNS,
    CSV_IMPORT_IGNORE,
  ]);
  return Object.freeze(
    parsed.map((selection) => {
      if (selection === null) return null;
      if (typeof selection !== "string" || !allowed.has(selection)) {
        throw invalidUpload("The CSV mapping contains an unsupported field.");
      }
      return selection as CsvImportHeaderSelection;
    }),
  );
}

function optionalFormString(
  value: FormDataEntryValue | null,
  path: string,
): string | null {
  if (value === null || value === "") return null;
  if (typeof value !== "string" || value.length > 160) {
    throw validationIssue(
      path,
      "invalid_import_field",
      "Use a bounded text value.",
    );
  }
  return value;
}

function boundedContentLength(value: string | null): number | null {
  if (value === null) {
    throw invalidUpload("The upload size is required.");
  }
  if (!/^\d{1,10}$/u.test(value)) {
    throw invalidUpload("The upload size is invalid.");
  }
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed)) {
    throw invalidUpload("The upload size is invalid.");
  }
  return parsed;
}

async function readBoundedBody(
  request: Request,
  maximumBytes: number,
): Promise<Uint8Array<ArrayBuffer>> {
  if (!request.body) throw invalidUpload("The upload body is missing.");
  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel();
        throw invalidUpload("The CSV upload is too large.");
      }
      chunks.push(value);
    }
  } catch (error) {
    if (
      error instanceof Error &&
      error.name === "InputValidationError"
    ) {
      throw error;
    }
    throw invalidUpload("The upload body could not be read.");
  }
  const body = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function assertSinglePart(
  form: FormData,
  key: string,
  file: boolean,
  required: boolean,
): void {
  const values = form.getAll(key);
  if (values.length === 0 && !required) return;
  if (values.length !== 1) {
    throw invalidUpload("The upload contains missing or repeated form fields.");
  }
  const value = values[0];
  if (file ? !(value instanceof File) : typeof value !== "string") {
    throw invalidUpload("The upload contains an invalid form field.");
  }
}

function invalidUpload(message: string): Error {
  return validationIssue("file", "invalid_csv_upload", message);
}
