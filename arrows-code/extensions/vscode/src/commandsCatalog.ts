// Command surface lives in @arrows-code/messages (commands.json) so every
// host - VS Code and IntelliJ - renders the same menu from one source.
import { COMMANDS, type ArrowsCommand } from '@arrows-code/messages';

export { COMMANDS };
export type { ArrowsCommand };

export const webviewAllowedCommandIds: ReadonlySet<string> = new Set(
  COMMANDS.filter((c) => c.webview).map((c) => c.id)
);

export function sidebarQuickActions(): readonly ArrowsCommand[] {
  return COMMANDS.filter((c) => c.surface.sidebar);
}

export interface EmbedMenuEntry {
  id: string;
  title: string;
  description: string;
  icon: string;
  shortcut?: ArrowsCommand['shortcut'];
}

export function embedMenuPayload(): EmbedMenuEntry[] {
  return COMMANDS.filter((c) => c.surface.embedMenu && c.webview).map(
    ({ id, title, description, icon, shortcut }) => ({ id, title, description, icon, shortcut })
  );
}
