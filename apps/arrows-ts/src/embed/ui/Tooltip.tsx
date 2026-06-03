import type { ReactNode } from 'react';
import { Popup } from 'semantic-ui-react';

interface TooltipProps {
  label: string;
  children: ReactNode;
}

export function Tooltip({ label, children }: TooltipProps): JSX.Element {
  return (
    <Popup
      trigger={<span style={{ display: 'inline-flex' }}>{children}</span>}
      content={label}
      position="bottom center"
      size="mini"
      inverted
    />
  );
}
