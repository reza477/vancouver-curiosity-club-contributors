import { getTrustedCspNonce } from "@/lib/server/public/origin";

export async function StructuredData({
  value,
}: Readonly<{ value: Readonly<Record<string, unknown>> }>) {
  const nonce = await getTrustedCspNonce();
  const json = JSON.stringify(value).replaceAll("<", "\\u003c");

  return (
    <script
      nonce={nonce ?? undefined}
      type="application/ld+json"
      dangerouslySetInnerHTML={{ __html: json }}
    />
  );
}
