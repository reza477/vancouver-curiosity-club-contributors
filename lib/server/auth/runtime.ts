import { env } from "cloudflare:workers";
import { tryNormalizeEmail } from "../../validation";
import { AuthConfigurationError, isD1DatabaseLike } from "./index";
import type { D1DatabaseLike } from "./index";

export type RuntimeAuthConfiguration = Readonly<{
  database: D1DatabaseLike;
  initialOwnerEmail: string | null;
}>;

/**
 * Reads Sites runtime bindings on the server. Runtime values remain outside
 * `.openai/hosting.json`; that file contains only logical DB/MEDIA names.
 */
export function getRuntimeAuthConfiguration(): RuntimeAuthConfiguration {
  const database = readRuntimeValue("DB");
  if (!isD1DatabaseLike(database)) throw new AuthConfigurationError();

  const configuredOwner = readRuntimeValue("INITIAL_OWNER_EMAIL");
  const initialOwnerEmail =
    configuredOwner === undefined ||
    configuredOwner === null ||
    configuredOwner === ""
      ? null
      : tryNormalizeEmail(configuredOwner);
  if (
    configuredOwner !== undefined &&
    configuredOwner !== null &&
    configuredOwner !== "" &&
    initialOwnerEmail === null
  ) {
    throw new AuthConfigurationError();
  }

  return Object.freeze({ database, initialOwnerEmail });
}

function readRuntimeValue(key: string): unknown {
  if ((typeof env !== "object" && typeof env !== "function") || env === null) {
    return undefined;
  }
  return Reflect.get(env, key);
}
