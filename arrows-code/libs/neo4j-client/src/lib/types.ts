export interface Neo4jConfig {
  uri: string;
  user: string;
  password: string;
  database?: string;
}

export interface PropertySchema {
  name: string;
  type: string;
}

export interface NodeTypeSchema {
  labels: string[];
  properties: PropertySchema[];
}

export interface RelTypeSchema {
  type: string;
  from: string[];
  to: string[];
  properties: PropertySchema[];
}

export interface SchemaResult {
  nodeTypes: NodeTypeSchema[];
  relTypes: RelTypeSchema[];
}
