# Bounded braces security backport

This private CommonJS package is a locally maintained derivative of MIT-licensed
`braces@3.0.3`, identified as `3.0.3-vcc.1`. It is **not an upstream patched
release**. It preserves the upstream API for the site's build and lint tooling.

## Provenance

- Published source: https://registry.npmjs.org/braces/-/braces-3.0.3.tgz
- Upstream release SHA-1: `490332f40919452272d55a8480adc0c441358789`.
- Upstream SHA-512 integrity: `sha512-yQbXgO/OSZVD2IsiLlro+7Hf6Q18EJrKSEsdoMzKePKXct3gvD8oLcOQdIzGupr5Fj+EDe8gO/lxc1BzfMpxvA==`.
- `UPSTREAM_SHA256.json` records the original individual source-file hashes.
- Advisory: https://github.com/advisories/GHSA-vfj7-8cjw-p6xm
- Security patch: https://github.com/micromatch/braces/pull/72 at commit
  `28d440b5dd449dbf1fe6f3506cf94ecca4d02660`.

As checked on October 3, 2026, upstream npm's latest version was still 3.0.3,
the advisory had no patched release, and the upstream security PR remained open.
The five `lib/` patches from that exact PR were applied to the published 3.0.3
source. Other unreleased upstream changes were not imported. The original
upstream MIT license is retained in `LICENSE`.

## Security changes and limits

The upstream security patch caps brace/parenthesis nesting at 100 while parsing
and guards `compile`, `expand`, and `stringify` AST walkers. A stricter numeric
`maxDepth` remains supported; a larger value cannot relax the hard cap. It also
rejects parent cycles in expansion and preserves stringify's prior handling of
`escapeInvalid`.

The local `lib/validate-ast.js` preflight additionally rejects cyclic/repeated
child nodes, more than 10,000 AST nodes or text characters, and excess depth
before direct caller-supplied ASTs enter recursive walkers. Ordinary parsed
strings retain the upstream 10,000-character cap and 1,000-item range limit.
AST text values must be strings, and range/comma metadata must be bounded
integers, preventing recursive array/object coercion in upstream walkers.
External AST parent-chain traversal also has a hard 100-level bound.
The length-option check additionally treats non-finite values as the default
so `maxLength: NaN` cannot disable the character bound.
This is a targeted depth/AST-input mitigation, not a claim of general sandboxing
or a bound on every possible Cartesian expansion output.

Run `node --import tsx --test tests/security/braces-safe.test.mjs`. The normal
lint and build checks also exercise the transitive glob consumers. Keep npm's
audit gate unchanged; recheck the upstream advisory when updating dependencies
and replace this derivative with an official fixed release once available and
verified compatible.

The registry tarball integrity and all eight original file hashes were verified
on October 3, 2026. The unchanged 3.0.3 release test suite (Git tag `3.0.3`,
commit `74b2db2938fad48a2ea54a9c8bf27a37a62c350d`) passed all 764 tests against
this derivative under Node on Windows using Mocha 11.7.5. The focused local
suite separately covers depth/length bypass attempts, direct ASTs, parent
cycles, normal patterns, and actual transitive package resolution.
