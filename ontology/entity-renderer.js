/**
 * Maps entity classes to their visual rendering properties.
 * This is the single source of truth for what each entity looks like.
 * Update here to change appearance globally across 2D and 3D views.
 */
export const ENTITY_RENDER_MAP = {
  // COMPUTE
  ComputeInstance:      { icon: '⬡', shape: 'hexagon',  baseColor: '#3b82f6', category: 'COMPUTE' },
  ContainerRuntime:     { icon: '⬡', shape: 'hexagon',  baseColor: '#06b6d4', category: 'COMPUTE' },
  ServerlessFunction:   { icon: '◈', shape: 'diamond',  baseColor: '#8b5cf6', category: 'COMPUTE' },
  ComputeCluster:       { icon: '⬡', shape: 'hexagon',  baseColor: '#1d4ed8', category: 'COMPUTE' },
  // STORAGE
  ObjectStore:          { icon: '⬜', shape: 'square',   baseColor: '#f59e0b', category: 'STORAGE' },
  BlockVolume:          { icon: '▬',  shape: 'rect',     baseColor: '#d97706', category: 'STORAGE' },
  FileSystem:           { icon: '⬜', shape: 'square',   baseColor: '#b45309', category: 'STORAGE' },
  DatabaseInstance:     { icon: '⬟', shape: 'cylinder', baseColor: '#92400e', category: 'STORAGE' },
  // NETWORK
  VirtualNetwork:       { icon: '◯', shape: 'circle',   baseColor: '#10b981', category: 'NETWORK' },
  Subnet:               { icon: '◯', shape: 'circle',   baseColor: '#059669', category: 'NETWORK' },
  NetworkGateway:       { icon: '⬡', shape: 'hexagon',  baseColor: '#047857', category: 'NETWORK' },
  LoadBalancer:         { icon: '⬡', shape: 'hexagon',  baseColor: '#065f46', category: 'NETWORK' },
  Firewall:             { icon: '⬡', shape: 'hexagon',  baseColor: '#ef4444', category: 'NETWORK' },
  PrivateEndpoint:      { icon: '◈', shape: 'diamond',  baseColor: '#16a34a', category: 'NETWORK' },
  // IDENTITY
  IdentityPrincipal:    { icon: '◎', shape: 'circle',   baseColor: '#f97316', category: 'IDENTITY' },
  IdentityRole:         { icon: '◎', shape: 'circle',   baseColor: '#ea580c', category: 'IDENTITY' },
  IdentityPolicy:       { icon: '◎', shape: 'circle',   baseColor: '#c2410c', category: 'IDENTITY' },
  // SECURITY
  SecurityControl:      { icon: '◈', shape: 'diamond',  baseColor: '#a855f7', category: 'SECURITY' },
  VulnerabilityFinding: { icon: '▲', shape: 'triangle', baseColor: '#dc2626', category: 'SECURITY' },
  ComplianceControl:    { icon: '◈', shape: 'diamond',  baseColor: '#9333ea', category: 'SECURITY' },
  ThreatIndicator:      { icon: '▲', shape: 'triangle', baseColor: '#b91c1c', category: 'SECURITY' },
  // ASSESSMENT
  AssessmentBoundary:   { icon: '◻', shape: 'rect',     baseColor: '#6b7280', category: 'ASSESSMENT' },
  AssessmentControl:    { icon: '◈', shape: 'diamond',  baseColor: '#4b5563', category: 'ASSESSMENT' },
  AssessmentFinding:    { icon: '▲', shape: 'triangle', baseColor: '#374151', category: 'ASSESSMENT' },
  // ORGANIZATION
  Guild:                { icon: '◉', shape: 'circle',   baseColor: '#0ea5e9', category: 'ORGANIZATION' },
  Project:              { icon: '◉', shape: 'circle',   baseColor: '#0284c7', category: 'ORGANIZATION' },
  SubProject:           { icon: '◉', shape: 'circle',   baseColor: '#0369a1', category: 'ORGANIZATION' },
};

/**
 * Get render properties for a given entity class.
 * Falls back to a default if the class is not registered.
 * @param {string} entityClass
 * @returns {{ icon: string, shape: string, baseColor: string, category: string }}
 */
export function getRenderProps(entityClass) {
  return ENTITY_RENDER_MAP[entityClass] ?? {
    icon: '◯', shape: 'circle', baseColor: '#6b7280', category: 'UNKNOWN'
  };
}

/**
 * Get the provider badge text for display in tooltips and detail panels.
 * @param {string} provider
 * @param {string|null} providerType
 * @returns {string}
 */
export function getProviderBadge(provider, providerType) {
  const providerLabel = {
    aws: 'AWS', azure: 'Azure', gcp: 'GCP', 'on-prem': 'On-Prem', agnostic: '—'
  }[provider] ?? provider.toUpperCase();
  return providerType ? `${providerLabel} · ${providerType}` : providerLabel;
}

// Bridge to non-module (classic IIFE) scripts.
if (typeof window !== 'undefined') {
  window.OntologyRenderer = {
    ENTITY_RENDER_MAP,
    getRenderProps,
    getProviderBadge
  };
}
