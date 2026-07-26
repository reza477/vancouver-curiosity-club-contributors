import { validationIssue } from "@/lib/validation";
import { SafeApplicationError } from "@/lib/validation/server-observability";
import {
  parseJsonBody,
  readBoundedUtf8Body,
  requireSameOriginMutation,
} from "./meetup/_mutation";

export async function readOrganizerMutationBody(
  request: Request,
  maxBytes = 16_384,
): Promise<unknown> {
  try {
    requireSameOriginMutation(request);
  } catch {
    throw new SafeApplicationError(
      "authorization_denied",
      403,
      "This request is not permitted.",
    );
  }
  let body: string;
  try {
    body = await readBoundedUtf8Body(request, maxBytes);
  } catch {
    throw validationIssue(
      "body",
      "invalid_body",
      "Expected a bounded UTF-8 request body.",
    );
  }
  try {
    return parseJsonBody(body);
  } catch {
    throw validationIssue(
      "body",
      "invalid_json",
      "Expected a JSON object.",
    );
  }
}
