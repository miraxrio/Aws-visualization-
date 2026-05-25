/**
 * Assembly level constants and utilities.
 * Assembly levels describe where an entity sits in a system-of-systems hierarchy.
 */
export const ASSEMBLY_LEVELS = {
  0: { name: 'Atom',            label: 'Atomic Unit',        description: 'Smallest indivisible assessment unit' },
  1: { name: 'Component',       label: 'Component',          description: 'Coherent assembly of atoms' },
  2: { name: 'Subsystem',       label: 'Subsystem',          description: 'Assembly of components serving a logical function' },
  3: { name: 'System',          label: 'System',             description: 'Complete functional system' },
  4: { name: 'SystemOfSystems', label: 'System of Systems',  description: 'Coordinated assembly of multiple systems' },
};

/**
 * Get the human-readable label for an assembly level.
 * @param {number} level - 0 through 4
 * @returns {string}
 */
export function getAssemblyLabel(level) {
  return ASSEMBLY_LEVELS[level]?.label ?? `Level ${level}`;
}

/**
 * Get the description for an assembly level.
 * @param {number} level
 * @returns {string}
 */
export function getAssemblyDescription(level) {
  return ASSEMBLY_LEVELS[level]?.description ?? '';
}

/**
 * Given a flat array of entities, build a tree structure grouped by assemblyLevel.
 * Returns an object keyed by level (0-4), each containing an array of entities at that level.
 * @param {object[]} entities
 * @returns {Object.<number, object[]>}
 */
export function groupByAssemblyLevel(entities) {
  const groups = { 0: [], 1: [], 2: [], 3: [], 4: [] };
  for (const entity of entities) {
    const level = entity.assemblyLevel ?? 0;
    if (groups[level]) groups[level].push(entity);
  }
  return groups;
}

/**
 * Validate the parent-child consistency of assemblyLevel chains.
 * Returns an array of error strings. Empty array = valid.
 * @param {object[]} entities
 * @returns {string[]}
 */
export function validateAssemblyChains(entities) {
  const errors = [];
  const entityMap = Object.fromEntries(entities.map(e => [e.id, e]));
  for (const entity of entities) {
    // Atoms must not have children
    if (entity.assemblyLevel === 0 && entity.atomicChildren?.length > 0) {
      errors.push(`Atom "${entity.id}" must not have atomicChildren`);
    }
    // Non-atoms should have children
    if (entity.assemblyLevel > 0 && (!entity.atomicChildren || entity.atomicChildren.length === 0)) {
      errors.push(`Non-atom "${entity.id}" (level ${entity.assemblyLevel}) has no atomicChildren — add children or set level to 0`);
    }
    // Children must exist and be at level N-1
    for (const childId of (entity.atomicChildren ?? [])) {
      const child = entityMap[childId];
      if (!child) {
        errors.push(`"${entity.id}" references child "${childId}" which does not exist`);
        continue;
      }
      if (child.assemblyLevel !== entity.assemblyLevel - 1) {
        errors.push(`"${entity.id}" (level ${entity.assemblyLevel}) has child "${childId}" at level ${child.assemblyLevel} — expected ${entity.assemblyLevel - 1}`);
      }
      if (child.assembledInto && child.assembledInto !== entity.id) {
        errors.push(`Child "${childId}" points assembledInto "${child.assembledInto}" but is listed as child of "${entity.id}"`);
      }
    }
  }
  return errors;
}

/**
 * Walk up the assembly chain from a given entity to the top.
 * Returns the chain of entity IDs from atom up to the system of systems.
 * @param {string} startId
 * @param {Object.<string, object>} entityMap - id → entity lookup
 * @returns {string[]}
 */
export function walkAssemblyChainUp(startId, entityMap) {
  const chain = [];
  let current = entityMap[startId];
  while (current) {
    chain.push(current.id);
    current = current.assembledInto ? entityMap[current.assembledInto] : null;
  }
  return chain;
}

// Bridge to non-module (classic IIFE) scripts.
if (typeof window !== 'undefined') {
  window.OntologyAssembly = {
    ASSEMBLY_LEVELS,
    getAssemblyLabel,
    getAssemblyDescription,
    groupByAssemblyLevel,
    validateAssemblyChains,
    walkAssemblyChainUp
  };
}
