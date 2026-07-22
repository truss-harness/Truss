import process from "node:process";
import { isAbsolute, relative, resolve } from "node:path";
import type { FileAccessRoot } from "./file-access.ts";

export interface FileAccessIgnoreMatch {
  ignored: boolean;
  negated?: boolean;
  pattern?: string;
  rootPath?: string;
}

const maxIgnorePatternGlobstars = 3;
const maxIgnorePatternWildcards = 64;
const maxCompiledIgnorePatternLength = 4_096;

export function comparableFileAccessPath(path: string): string {
  const normalized = resolve(path);

  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

export function isFileAccessPathWithin(rootPath: string, targetPath: string): boolean {
  const root = comparableFileAccessPath(rootPath);
  const target = comparableFileAccessPath(targetPath);
  const relativePath = relative(root, target);

  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  );
}

export function fileAccessRootForPath(
  accessRoots: FileAccessRoot[],
  targetPath: string,
): FileAccessRoot | null {
  const matchingRoots = accessRoots.filter((root) => isFileAccessPathWithin(root.path, targetPath));

  matchingRoots.sort(
    (left, right) =>
      comparableFileAccessPath(right.path).length - comparableFileAccessPath(left.path).length,
  );

  return matchingRoots[0] ?? null;
}

export function isFileAccessPathIgnored(options: {
  absolutePath: string;
  accessRoots: FileAccessRoot[];
  ignorePatterns: string[];
  isDirectoryPath: boolean;
}): boolean {
  return fileAccessIgnoreMatch(options).ignored;
}

export function fileAccessIgnoreMatch({
  absolutePath,
  accessRoots,
  ignorePatterns,
  isDirectoryPath,
}: {
  absolutePath: string;
  accessRoots: FileAccessRoot[];
  ignorePatterns: string[];
  isDirectoryPath: boolean;
}): FileAccessIgnoreMatch {
  const root = fileAccessRootForPath(accessRoots, absolutePath);

  if (!root) {
    return { ignored: true };
  }

  const relativePath = relative(root.path, absolutePath).replace(/\\/g, "/") || ".";
  let match: FileAccessIgnoreMatch = {
    ignored: false,
    rootPath: root.path,
  };

  for (const rawPattern of ignorePatterns) {
    const pattern = rawPattern.trim();

    if (!pattern || pattern.startsWith("#")) {
      continue;
    }

    const negated = pattern.startsWith("!");
    const effectivePattern = negated ? pattern.slice(1).trim() : pattern;

    if (!effectivePattern) {
      continue;
    }

    if (matchesIgnorePattern(effectivePattern, relativePath, isDirectoryPath)) {
      match = {
        ignored: !negated,
        negated,
        pattern,
        rootPath: root.path,
      };
    }
  }

  return match;
}

function matchesIgnorePattern(
  rawPattern: string,
  relativePath: string,
  isDirectoryPath: boolean,
): boolean {
  const directoryOnly = rawPattern.endsWith("/");
  const pattern = rawPattern
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\/+$/, "");
  const normalizedPath = relativePath.replace(/\\/g, "/").replace(/^\.?\//, "");

  if (!pattern) {
    return false;
  }

  if (directoryOnly) {
    return matchesDirectoryIgnorePattern(pattern, normalizedPath, isDirectoryPath);
  }

  if (!pattern.includes("/")) {
    const segmentMatcher = wildcardRegExp(pattern, false);
    return normalizedPath.split("/").some((segment) => segmentMatcher.test(segment));
  }

  return wildcardRegExp(pattern, rawPattern.startsWith("/")).test(normalizedPath);
}

function matchesDirectoryIgnorePattern(
  pattern: string,
  relativePath: string,
  isDirectoryPath: boolean,
): boolean {
  if (!pattern.includes("/")) {
    const segmentMatcher = wildcardRegExp(pattern, false);
    const segments = relativePath.split("/");

    return segments.some((segment, index) => {
      const isLast = index === segments.length - 1;
      return segmentMatcher.test(segment) && (!isLast || isDirectoryPath);
    });
  }

  const matcher = wildcardRegExp(pattern, pattern.startsWith("/"));

  return (
    matcher.test(relativePath) ||
    relativePath
      .split("/")
      .some((_, index, parts) => matcher.test(parts.slice(index).join("/")))
  );
}

function wildcardRegExp(pattern: string, anchored: boolean): RegExp {
  let globstars = 0;
  let wildcards = 0;
  const source = pattern
    .replace(/^\/+/, "")
    .split("")
    .reduce((regex, char, index, chars) => {
      if (char === "*") {
        if (chars[index + 1] === "*") {
          globstars += 1;
          wildcards += 1;
          return `${regex}.*`;
        }

        if (chars[index - 1] === "*") {
          return regex;
        }

        wildcards += 1;
        return `${regex}[^/]*`;
      }

      if (char === "?") {
        wildcards += 1;
        return `${regex}[^/]`;
      }

      return `${regex}${escapeRegExp(char)}`;
    }, "");

  if (
    globstars > maxIgnorePatternGlobstars ||
    wildcards > maxIgnorePatternWildcards ||
    source.length > maxCompiledIgnorePatternLength
  ) {
    throw new Error(`Ignore pattern is too complex: ${pattern}`);
  }

  return new RegExp(anchored ? `^${source}(?:/.*)?$` : `(?:^|.*/)${source}(?:/.*)?$`);
}

function escapeRegExp(value: string): string {
  return value.replace(/[\\^$.*+?()[\]{}|]/g, "\\$&");
}
