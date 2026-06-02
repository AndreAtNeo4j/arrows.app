import commandsData from './commands.json';

/** The command surface, shared by every host so their menus can't diverge. */
export interface ArrowsCommand {
  id: string;
  title: string;
  icon: string;
  description: string;
  /** Embed canvas may invoke this via the postMessage `command` channel. */
  webview: boolean;
  surface: { sidebar: boolean; embedMenu: boolean };
  shortcut?: { mod?: 'cmd' | 'cmd+shift' | 'shift+alt'; key: string };
}

export const COMMANDS: ArrowsCommand[] = commandsData as ArrowsCommand[];
