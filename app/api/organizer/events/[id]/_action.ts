import {
  assertOnlyKeys,
  parseFiniteInteger,
  parseObject,
} from "@/lib/validation";

export function expectedVersionFromBody(value: unknown): number {
  const body = parseObject(value, "body");
  assertOnlyKeys(body, ["expectedContentVersion"], "body");
  return parseFiniteInteger(body.expectedContentVersion, {
    path: "expectedContentVersion",
    minimum: 1,
  });
}
