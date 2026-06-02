import * as vscode from 'vscode';
import type { Neo4jConfig, SchemaResult } from '@arrows-code/neo4j-client';
import { readGraph, writeGraph } from '@arrows-code/format-json';
import { findLayout } from '@arrows-code/graph-logic';
import { schemaToGraph } from './schemaToGraph';
import { msg, workspaceTargetUri } from './helpers';

const secretKey = (uri: string): string => `arrows.neo4j.password:${uri}`;

async function resolveConfig(context: vscode.ExtensionContext): Promise<Neo4jConfig | undefined> {
  const settings = vscode.workspace.getConfiguration('arrows.neo4j');
  let uri = settings.get<string>('uri')?.trim();
  if (!uri) {
    uri = (
      await vscode.window.showInputBox({
        title: 'Neo4j connection',
        prompt: 'Connection URI',
        placeHolder: 'neo4j+s://xxxx.databases.neo4j.io',
        ignoreFocusOut: true,
      })
    )?.trim();
    if (!uri) return undefined;
  }
  const user = settings.get<string>('user')?.trim() || 'neo4j';
  const database = settings.get<string>('database')?.trim() || undefined;

  let password = await context.secrets.get(secretKey(uri));
  if (!password) {
    password = await vscode.window.showInputBox({
      title: 'Neo4j password',
      prompt: `Password for ${user}@${uri}`,
      password: true,
      ignoreFocusOut: true,
    });
    if (!password) return undefined;
    await context.secrets.store(secretKey(uri), password);
  }
  return { uri, user, password, database };
}

function isAuthError(error: unknown): boolean {
  const code = (error as { code?: string })?.code ?? '';
  return code === 'Neo.ClientError.Security.Unauthorized';
}

async function laidOutText(schema: SchemaResult): Promise<string | undefined> {
  const force = findLayout('force');
  if (!force) return undefined;
  const laid = await force.run(schemaToGraph(schema));
  const { graph, diagnostics } = readGraph(JSON.stringify(laid));
  if (diagnostics.some((d) => d.severity === 'error')) return undefined;
  return writeGraph(graph);
}

export function makePullSchema(context: vscode.ExtensionContext) {
  return async (): Promise<void> => {
    const config = await resolveConfig(context);
    if (!config) return;

    const { fetchSchema, verifyConnectivity } = await import('@arrows-code/neo4j-client');
    try {
      const schema = await vscode.window.withProgress(
        { location: vscode.ProgressLocation.Notification, title: 'Arrows: pulling Neo4j schema…' },
        async () => {
          await verifyConnectivity(config);
          return fetchSchema(config);
        }
      );

      if (schema.nodeTypes.length === 0) {
        void vscode.window.showWarningMessage('Arrows: the database has no node labels to pull.');
        return;
      }

      const text = await laidOutText(schema);
      if (!text) {
        void vscode.window.showErrorMessage('Arrows: failed to build a graph from the schema.');
        return;
      }

      const target = await vscode.window.showSaveDialog({
        defaultUri: workspaceTargetUri('schema', 'arrows'),
        filters: { Arrows: ['arrows'] },
        saveLabel: 'Save schema graph',
        title: 'Save pulled Neo4j schema',
      });
      if (!target) return;
      await vscode.workspace.fs.writeFile(target, Buffer.from(text, 'utf8'));
      await vscode.commands.executeCommand('vscode.openWith', target, 'arrows.preview');
    } catch (error) {
      if (isAuthError(error)) {
        await context.secrets.delete(secretKey(config.uri));
        void vscode.window.showErrorMessage('Arrows: Neo4j authentication failed. Run the command again to re-enter the password.');
        return;
      }
      void vscode.window.showErrorMessage(`Arrows: could not pull schema: ${msg(error)}`);
    }
  };
}
