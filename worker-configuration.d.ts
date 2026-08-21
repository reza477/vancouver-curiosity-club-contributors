declare namespace Cloudflare {
  interface Env {
    ASSETS: Fetcher;
    DB: D1Database;
    MEDIA: R2Bucket;
    RESEND_API_KEY?: string;
    FORM_SUBMISSION_FROM_EMAIL?: string;
    FORM_SUBMISSION_TO_EMAIL?: string;
  }
}
