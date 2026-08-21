import { env } from "cloudflare:workers";
import { tryNormalizeEmail } from "../../validation";
import type { PublicFormEmailConfiguration } from "./public-form-email";

export function readPublicFormEmailConfiguration(): PublicFormEmailConfiguration | null {
  const apiKey = runtimeString("RESEND_API_KEY");
  const fromEmail = tryNormalizeEmail(runtimeString("FORM_SUBMISSION_FROM_EMAIL"));
  const toEmail = tryNormalizeEmail(runtimeString("FORM_SUBMISSION_TO_EMAIL"));
  if (
    !apiKey ||
    apiKey.length < 12 ||
    apiKey.length > 512 ||
    !/^re_[A-Za-z0-9_-]+$/u.test(apiKey) ||
    !fromEmail ||
    !toEmail
  ) {
    return null;
  }
  return Object.freeze({ apiKey, fromEmail, toEmail });
}

function runtimeString(key: string): string | null {
  if ((typeof env !== "object" && typeof env !== "function") || env === null) {
    return null;
  }
  const value = Reflect.get(env, key);
  return typeof value === "string" && value.length > 0 ? value : null;
}
