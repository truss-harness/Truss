export const defaultPlantUmlServerUrl = "https://www.plantuml.com/plantuml";

export const defaultPlantUmlPrompt = [
  "When writing PlantUML for Truss, return a fenced plantuml code block containing valid multiline PlantUML source. Include @startuml and @enduml, and do not flatten the source into a single line.",
  "",
  "Use this palette consistently: #242421 for main text and line work, #8C8370 for neutral borders and secondary elements, #D96C4A for accents and errors, and #F9F7F2 for background and light fills.",
  "",
  "Place these directives near the top of each diagram after @startuml, replacing the title and header placeholders with useful text:",
  "autonumber",
  "skinparam style strictuml",
  "skinparam DefaultFontName Calibri",
  "skinparam RoundCorner 3",
  "title **<Diagram Title>**",
  'header "<Header Text>"',
  "",
  "For sequence diagrams, use ++ and -- inline on arrows to open and close activation bars:",
  "client -> alb ++: Send request",
  "alb -> envoy ++: Re-route",
  "envoy --> alb --: Response",
  "",
  "Use dividers in the form ... <description> ... for time or state separators, for example: ... A client application is already registered ...",
  "",
  "Use these arrow styles: normal forward calls use ->, returns or async responses use -->, and error responses use -[#red]->.",
].join("\n");
