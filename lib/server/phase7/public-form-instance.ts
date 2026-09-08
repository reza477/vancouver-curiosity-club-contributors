import { cacheForRequest } from "vinext/cache";
import { getRuntimeAuthConfiguration } from "../auth/runtime";
import { readServerUtcMs } from "../clock";
import { ensureDatabaseInvariants } from "../database/invariants";
import { getRequestPublicOrganization } from "../public/request-cache";
import { writeSafeLog } from "../../validation/server-observability";
import type { PublicFormKey } from "./public-form-contract";
import {
  createPublicFormInstanceToken,
  ensurePublicFormProtectionKey,
  readPublicFormProtectionKey,
} from "./public-form-protection";

const requestInstances = cacheForRequest(
  () => new Map<PublicFormKey, Promise<string | null>>(),
);

export function preparePublicFormInstance(formKey: PublicFormKey): Promise<string | null> {
  const instances = requestInstances();
  const existing = instances.get(formKey);
  if (existing) return existing;
  const prepared = prepareInstance(formKey);
  instances.set(formKey, prepared);
  return prepared;
}

async function prepareInstance(formKey: PublicFormKey): Promise<string | null> {
  try {
    const { database } = getRuntimeAuthConfiguration();
    const organization = await getRequestPublicOrganization(database);
    if (!organization) return null;
    const nowUtcMs = readServerUtcMs();
    let keyHex = await readPublicFormProtectionKey(database, organization.id);
    if (keyHex === null) {
      const invariantStatus = await ensureDatabaseInvariants(database);
      if (invariantStatus !== "ready") return null;
      keyHex = await ensurePublicFormProtectionKey(database, organization.id, nowUtcMs);
    }
    const { token } = await createPublicFormInstanceToken(keyHex, formKey, nowUtcMs);
    return token;
  } catch {
    writeSafeLog("error", "public_form_instance_unavailable", {
      code: "service_unavailable",
      operation: "prepare_public_form",
      route: `/api/forms/${formKey}`,
      status: 503,
    });
    return null;
  }
}
