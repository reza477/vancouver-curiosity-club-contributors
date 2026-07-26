import {
  assertOnlyKeys,
  parseFiniteInteger,
  parseObject,
} from "@/lib/validation";

export function expectedVersionFromBody(value: unknown): number {
  const body = parseObject(value, "body");
  assertOnlyKeys(
    body,
    ["expectedContentVersion", "expectedScheduleVersion"],
    "body",
  );
  return parseFiniteInteger(body.expectedContentVersion, {
    path: "expectedContentVersion",
    minimum: 1,
  });
}

export function expectedScheduleVersionFromBody(value: unknown): number {
  const body = parseObject(value, "body");
  assertOnlyKeys(
    body,
    ["expectedContentVersion", "expectedScheduleVersion"],
    "body",
  );
  return parseFiniteInteger(body.expectedScheduleVersion, {
    path: "expectedScheduleVersion",
    minimum: 1,
  });
}
