import assert from "node:assert/strict";
import { existsSync, readFileSync, realpathSync } from "node:fs";
import test from "node:test";
import { imageSize } from "../../vendor/image-size-safe/index.js";

const packageJson = JSON.parse(readFileSync("package.json", "utf8"));

test("Vinext resolves image metadata to the fail-closed local shim", () => {
  assert.equal(packageJson.devDependencies.vinext, "0.0.50");
  assert.equal(
    packageJson.devDependencies["image-size"],
    "file:vendor/image-size-safe",
  );
  assert.equal(packageJson.overrides["image-size"], "$image-size");
  assert.equal(
    realpathSync("node_modules/image-size"),
    realpathSync("vendor/image-size-safe"),
  );
  assert.equal(
    existsSync(
      "node_modules/vinext/dist/deps/.pnpm/image-size@2.0.2",
    ),
    false,
  );
});

test("the replacement parser rejects every input promptly", () => {
  const png = Buffer.from(
    "89504e470d0a1a0a0000000d4948445200000040000000200806000000",
    "hex",
  );
  for (const input of [
    png,
    Buffer.from("69636e7300000000", "hex"),
    Buffer.from("ff0a000000000000", "hex"),
    Buffer.from("0000000c4a584c200d0a870a", "hex"),
    Buffer.from("00000018667479706865696300000000", "hex"),
  ]) {
    assert.throws(() => imageSize(input), /disabled for this site/u);
  }
});
