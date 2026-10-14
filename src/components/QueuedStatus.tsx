import "./QueuedStatus.scss";

import * as React from "react";
import { IStatusProps } from "azure-devops-ui/Status";
import { css } from "azure-devops-ui/Util";

// Animated "queued" icon (ring with three pulsing dots) for checks such as a
// CI build that are waiting for an agent. azure-devops-ui has no animated
// queued status, so this plugs a custom renderer into the Status component.
export const QueuedAnimated: IStatusProps = {
  color: "active",
  onRenderIcon: (className, size, animated, ariaLabel) => (
    <svg
      className={css(className, "queued-status", animated !== false && "queued-status-animate")}
      height={size}
      width={size}
      viewBox="0 0 16 16"
      role="img"
      aria-label={ariaLabel}
    >
      <circle cx="8" cy="8" r="7" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <circle className="queued-dot" cx="4.75" cy="8" r="1.25" />
      <circle className="queued-dot" cx="8" cy="8" r="1.25" />
      <circle className="queued-dot" cx="11.25" cy="8" r="1.25" />
    </svg>
  ),
};
