import { useMemo, useState } from "react";
import plantumlEncoder from "plantuml-encoder";
import type { PlantUmlRenderFormat } from "../../../shared/protocol.ts";
import { defaultRichFeatureSettings } from "../../rich-features.ts";
import { MaterialIcon } from "../MaterialIcon.tsx";

export function PlantUmlDiagram({
  format,
  serverUrl,
  source,
}: {
  format: PlantUmlRenderFormat;
  serverUrl: string;
  source: string;
}) {
  const [failed, setFailed] = useState(false);
  const diagramUrl = useMemo(
    () => plantUmlDiagramUrl(source, serverUrl, format),
    [format, serverUrl, source],
  );

  if (failed) {
    return (
      <div className="truss-plantuml-fallback">
        <div className="truss-plantuml-header">
          <span>
            <MaterialIcon name="account_tree" size={18} />
            PlantUML
          </span>
          <a href={diagramUrl} rel="noreferrer noopener" target="_blank">
            Open source render
            <MaterialIcon name="open_in_new" size={15} />
          </a>
        </div>
        <pre>{source}</pre>
      </div>
    );
  }

  return (
    <figure className="truss-plantuml-diagram">
      <div className="truss-plantuml-header">
        <span>
          <MaterialIcon name="account_tree" size={18} />
          PlantUML
        </span>
        <a href={diagramUrl} rel="noreferrer noopener" target="_blank">
          Open diagram
          <MaterialIcon name="open_in_new" size={15} />
        </a>
      </div>
      <div className="truss-plantuml-canvas">
        <img
          alt="PlantUML diagram"
          loading="lazy"
          onError={() => setFailed(true)}
          src={diagramUrl}
        />
      </div>
    </figure>
  );
}

function plantUmlDiagramUrl(
  source: string,
  serverUrl: string,
  format: PlantUmlRenderFormat,
): string {
  const safeServerUrl = safePlantUmlServerUrl(serverUrl);
  const normalizedFormat = format === "png" ? "png" : "svg";
  const encoded = plantumlEncoder.encode(source);

  return `${safeServerUrl}/${normalizedFormat}/${encoded}`;
}

function safePlantUmlServerUrl(serverUrl: string): string {
  try {
    const url = new URL(serverUrl.trim() || defaultRichFeatureSettings.plantUmlServerUrl);

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return defaultRichFeatureSettings.plantUmlServerUrl;
    }

    return url.toString().replace(/\/+$/g, "");
  } catch {
    return defaultRichFeatureSettings.plantUmlServerUrl;
  }
}
