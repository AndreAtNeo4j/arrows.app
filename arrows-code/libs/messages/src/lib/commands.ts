import commandsData from './commands.json';

export interface ArrowsCommand {
  id: string;
  title: string;
  icon: string;
  description: string;
  // Embed canvas may invoke this command via the postMessage `command` channel.
  webview: boolean;
  surface: { sidebar: boolean; embedMenu: boolean };
  shortcut?: { mod?: 'cmd' | 'cmd+shift' | 'shift+alt'; key: string };
}

export const COMMANDS: ArrowsCommand[] = commandsData as ArrowsCommand[];
