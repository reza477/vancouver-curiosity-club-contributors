import { env } from "cloudflare:workers";
import { SafeApplicationError } from "../../validation/server-observability";
import type { R2BucketLike } from "./storage";
import type {
  MediaImageDecodeProbe,
  MediaImageMimeType,
} from "./image-validation";

export type RuntimeImagesBinding = Readonly<{
  input(stream: ReadableStream): {
    transform(options: Readonly<{
      fit?: "cover";
      height?: number;
      width: number;
    }>): {
      output(options: Readonly<{
        format: string;
        quality: number;
      }>): Promise<{ response(): Response }>;
    };
  };
}>;

export function getRuntimeMediaBucket(): R2BucketLike {
  const value =
    (typeof env === "object" || typeof env === "function") && env !== null
      ? Reflect.get(env, "MEDIA")
      : undefined;
  if (!isR2BucketLike(value)) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "Media storage is not configured.",
    );
  }
  return value;
}

export function getRuntimeMediaDecodeProbe(): MediaImageDecodeProbe {
  const images = getRuntimeImagesBinding();
  return async ({ bytes, mimeType }) => {
    const body = new Uint8Array(bytes.byteLength);
    body.set(bytes);
    const response = await decodeWithImagesBinding(
      images,
      body.buffer,
      mimeType,
    );
    if (!response.ok || (await response.arrayBuffer()).byteLength < 12) {
      throw new SafeApplicationError(
        "validation_failed",
        422,
        "The image could not be decoded safely.",
      );
    }
  };
}

export function getRuntimeImagesBinding(): RuntimeImagesBinding {
  const images =
    (typeof env === "object" || typeof env === "function") && env !== null
      ? Reflect.get(env, "IMAGES")
      : undefined;
  if (
    typeof images !== "object" ||
    images === null ||
    typeof Reflect.get(images, "input") !== "function"
  ) {
    throw new SafeApplicationError(
      "service_unavailable",
      503,
      "Image validation is not configured.",
    );
  }
  return images as RuntimeImagesBinding;
}

function isR2BucketLike(value: unknown): value is R2BucketLike {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof Reflect.get(value, "put") === "function" &&
    typeof Reflect.get(value, "get") === "function" &&
    typeof Reflect.get(value, "delete") === "function"
  );
}

async function decodeWithImagesBinding(
  images: RuntimeImagesBinding,
  bytes: ArrayBuffer,
  mimeType: MediaImageMimeType,
): Promise<Response> {
  const stream = new Blob([bytes], { type: mimeType }).stream();
  const result = await images.input(stream)
    .transform({ width: 1 })
    .output({ format: "image/webp", quality: 75 });
  return result.response();
}
