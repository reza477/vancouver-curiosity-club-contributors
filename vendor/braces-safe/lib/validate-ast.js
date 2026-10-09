'use strict';

const { MAX_DEPTH, MAX_LENGTH } = require('./constants');

// Direct AST callers bypass parse(). Bound their object graph before any of
// the upstream recursive walkers run, without following normal parent/prev
// back-references. Direct AST calls apply additional node and text size bounds.
module.exports = ast => {
  const stack = [{ node: ast, depth: ast && ast.type === 'root' ? 0 : 1 }];
  const seen = new Set();
  let textLength = 0;

  while (stack.length > 0) {
    const { node, depth } = stack.pop();
    if (!node || typeof node !== 'object' || Array.isArray(node)) {
      throw new TypeError('Expected an AST node');
    }
    if (node.type !== undefined && typeof node.type !== 'string') {
      throw new TypeError('Expected an AST node type string');
    }
    if (node.value !== undefined && typeof node.value !== 'string') {
      throw new TypeError('Expected an AST node value string');
    }
    for (const field of ['ranges', 'commas']) {
      if (node[field] !== undefined &&
          (!Number.isInteger(node[field]) || node[field] < 0 || node[field] > MAX_LENGTH)) {
        throw new TypeError('Expected bounded integer AST range/comma metadata');
      }
    }
    if (seen.has(node)) throw new RangeError('AST contains repeated or cyclic nodes');
    seen.add(node);
    if (seen.size > MAX_LENGTH) throw new RangeError('AST exceeds maximum node count');
    if (typeof node.value === 'string') textLength += node.value.length;
    if (textLength > MAX_LENGTH) throw new RangeError('AST exceeds maximum text length');
    if (node.nodes === undefined) continue;
    if (!Array.isArray(node.nodes)) throw new TypeError('Expected an AST node array');
    if (depth > MAX_DEPTH) throw new RangeError('AST exceeds maximum nesting depth');
    if (node.nodes.length + seen.size + stack.length > MAX_LENGTH) {
      throw new RangeError('AST exceeds maximum node count');
    }
    for (let index = node.nodes.length - 1; index >= 0; index--) {
      const child = node.nodes[index];
      stack.push({ node: child, depth: child && child.nodes ? depth + 1 : depth });
    }
  }
};
