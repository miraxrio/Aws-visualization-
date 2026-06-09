/**
 * Canonical ontology entity class taxonomy.
 * All entity classes used in schema files must be registered here.
 */
export const ENTITY_TAXONOMY = {
  COMPUTE: [
    'ComputeInstance',
    'ContainerRuntime',
    'ServerlessFunction',
    'ComputeCluster'
  ],
  STORAGE: [
    'ObjectStore',
    'BlockVolume',
    'FileSystem',
    'DatabaseInstance'
  ],
  NETWORK: [
    'VirtualNetwork',
    'Subnet',
    'NetworkGateway',
    'LoadBalancer',
    'Firewall',
    'PrivateEndpoint'
  ],
  IDENTITY: [
    'IdentityPrincipal',
    'IdentityRole',
    'IdentityPolicy'
  ],
  SECURITY: [
    'SecurityControl',
    'VulnerabilityFinding',
    'ComplianceControl',
    'ThreatIndicator'
  ],
  ASSESSMENT: [
    'AssessmentBoundary',
    'AssessmentControl',
    'AssessmentFinding'
  ],
  ORGANIZATION: [
    'Guild',
    'Project',
    'SubProject'
  ]
};

/**
 * Given an entityClass string, return its parent category.
 * Returns null if the class is not registered.
 * @param {string} entityClass
 * @returns {string|null}
 */
export function getCategoryForClass(entityClass) {
  for (const [category, classes] of Object.entries(ENTITY_TAXONOMY)) {
    if (classes.includes(entityClass)) return category;
  }
  return null;
}

/**
 * Validate that an entity's entityClass and entityCategory are consistent.
 * @param {string} entityClass
 * @param {string} entityCategory
 * @returns {boolean}
 */
export function validateEntityClassCategory(entityClass, entityCategory) {
  return getCategoryForClass(entityClass) === entityCategory;
}

/**
 * Return all registered entity class strings as a flat array.
 * @returns {string[]}
 */
export function getAllEntityClasses() {
  return Object.values(ENTITY_TAXONOMY).flat();
}

// Bridge to non-module (classic IIFE) scripts — visualizer.js, catalog.js
// and app.js are loaded as classic scripts and read the ontology from
// window rather than importing it.
if (typeof window !== 'undefined') {
  window.Ontology = {
    ENTITY_TAXONOMY,
    getCategoryForClass,
    validateEntityClassCategory,
    getAllEntityClasses
  };
}
