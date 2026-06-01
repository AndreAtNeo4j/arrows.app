import neo4j, { type Driver } from 'neo4j-driver';
import { buildSchema, type NodeTypePropertyRow, type RelTypePropertyRow, type RelEndpoint } from './mapping';
import type { Neo4jConfig, SchemaResult } from './types';

function driverFor(config: Neo4jConfig): Driver {
  return neo4j.driver(config.uri, neo4j.auth.basic(config.user, config.password));
}

export async function verifyConnectivity(config: Neo4jConfig): Promise<void> {
  const driver = driverFor(config);
  try {
    await driver.verifyConnectivity({ database: config.database });
  } finally {
    await driver.close();
  }
}

export async function fetchSchema(config: Neo4jConfig): Promise<SchemaResult> {
  const driver = driverFor(config);
  const session = driver.session({
    database: config.database,
    defaultAccessMode: neo4j.session.READ,
  });
  try {
    const nodeRes = await session.run('CALL db.schema.nodeTypeProperties()');
    const nodeRows: NodeTypePropertyRow[] = nodeRes.records.map((r) => ({
      nodeLabels: r.get('nodeLabels') as string[],
      propertyName: (r.get('propertyName') as string | null) ?? null,
      propertyTypes: (r.get('propertyTypes') as string[] | null) ?? null,
    }));

    const relRes = await session.run('CALL db.schema.relTypeProperties()');
    const relRows: RelTypePropertyRow[] = relRes.records.map((r) => ({
      relType: r.get('relType') as string,
      propertyName: (r.get('propertyName') as string | null) ?? null,
      propertyTypes: (r.get('propertyTypes') as string[] | null) ?? null,
    }));

    const endpoints = await fetchEndpoints(session);
    return buildSchema(nodeRows, relRows, endpoints);
  } finally {
    await session.close();
    await driver.close();
  }
}

async function fetchEndpoints(
  session: ReturnType<Driver['session']>
): Promise<RelEndpoint[]> {
  const res = await session.run('CALL db.schema.visualization()');
  const record = res.records[0];
  if (!record) return [];
  const nodes = record.get('nodes') as { identity: unknown; labels: string[] }[];
  const rels = record.get('relationships') as { type: string; start: unknown; end: unknown }[];
  const labelsById = new Map(nodes.map((n) => [String(n.identity), n.labels]));
  return rels.map((rel) => ({
    type: rel.type,
    from: labelsById.get(String(rel.start)) ?? [],
    to: labelsById.get(String(rel.end)) ?? [],
  }));
}
