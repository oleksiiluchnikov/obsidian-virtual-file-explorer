import { MetadataCache, TFile } from "obsidian";

import {
  CategoryFolderNode,
  CategoryPath,
  CategoryTree,
  ROOT_FOLDER_ID,
  UNCATEGORIZED_FOLDER_ID,
  UNCATEGORIZED_FOLDER_NAME,
  VirtualTreeSettings,
} from "./types";

/**
 * Builds the virtual folder tree from markdown note frontmatter.
 */
export function buildCategoryTree(
  files: readonly TFile[],
  metadataCache: MetadataCache,
  settings: VirtualTreeSettings,
): CategoryTree {
  const sourceFiles = sortFiles(files.filter((file) => !isIgnoredVaultPath(file.path)));
  const root = createNode(ROOT_FOLDER_ID, "All notes", 0);
  const folderLookup = new Map<string, CategoryFolderNode>([[ROOT_FOLDER_ID, root]]);
  const uncategorizedFiles: TFile[] = [];
  const categoryPathCache = new Map<string, CategoryPath | null>();

  for (const file of sourceFiles) {
    const categoryPaths = extractCategoryPaths(file, metadataCache, settings, categoryPathCache);

    if (categoryPaths.length === 0) {
      if (settings.showUncategorized) {
        uncategorizedFiles.push(file);
      }

      continue;
    }

    for (const categoryPath of categoryPaths) {
      let currentNode = root;

      categoryPath.segments.forEach((segment, index) => {
        const nodeId = categoryPath.segments.slice(0, index + 1).join("/");
        const existingChild = currentNode.children.get(segment);

        if (existingChild) {
          if (index === categoryPath.segments.length - 1) {
            existingChild.assignmentValue ??= categoryPath.assignmentValue;
            existingChild.icon ??= categoryPath.icon;
          }

          currentNode = existingChild;
          return;
        }

        const nextNode = createNode(nodeId, segment, index + 1);

        if (index === categoryPath.segments.length - 1) {
          nextNode.assignmentValue = categoryPath.assignmentValue;
          nextNode.icon = categoryPath.icon;
        }

        currentNode.children.set(segment, nextNode);
        folderLookup.set(nextNode.id, nextNode);
        currentNode = nextNode;
      });

      currentNode.directFiles.push(file);
    }
  }

  injectUnassignedCategoryNotes(root, folderLookup, sourceFiles, metadataCache, settings);

  if (settings.showUncategorized && settings.showUncategorizedFolder && uncategorizedFiles.length > 0) {
    const uncategorizedNode = createNode(UNCATEGORIZED_FOLDER_ID, UNCATEGORIZED_FOLDER_NAME, 1);
    uncategorizedNode.directFiles.push(...uncategorizedFiles);
    root.children.set(UNCATEGORIZED_FOLDER_NAME, uncategorizedNode);
    folderLookup.set(UNCATEGORIZED_FOLDER_ID, uncategorizedNode);
  }

  finalizeSortedChildren(root);

  const descendantFilesByFolderId = new Map<string, readonly TFile[]>();
  collectDescendantFiles(root, descendantFilesByFolderId);
  descendantFilesByFolderId.set(ROOT_FOLDER_ID, sourceFiles);

  return {
    root,
    folderLookup,
    descendantFilesByFolderId,
    allFiles: sourceFiles,
    uncategorizedFiles,
  };
}

function injectUnassignedCategoryNotes(
  root: CategoryFolderNode,
  folderLookup: Map<string, CategoryFolderNode>,
  files: readonly TFile[],
  metadataCache: MetadataCache,
  settings: VirtualTreeSettings,
): void {
  const prefix = settings.categoryNoteFilenamePrefix.trim();
  if (!settings.showUnassignedCategoryNotes || prefix.length === 0) {
    return;
  }

  for (const file of files) {
    if (!file.basename.startsWith(prefix)) {
      continue;
    }

    const parsedPath = parseCategoryPath(`[[${file.basename}]]`, settings.treatSlashesAsHierarchy, metadataCache);
    if (!parsedPath) {
      continue;
    }

    ensureCategoryPathFromSegments(
      root,
      folderLookup,
      parsedPath.segments,
      parsedPath.assignmentValue,
      parsedPath.icon,
    );
  }
}

function ensureCategoryPathFromSegments(
  root: CategoryFolderNode,
  folderLookup: Map<string, CategoryFolderNode>,
  segments: readonly string[],
  assignmentValue: string | null,
  icon: string | null,
): void {
  let currentNode = root;

  segments.forEach((segment, index) => {
    const nodeId = segments.slice(0, index + 1).join("/");
    const existingChild = currentNode.children.get(segment);

    if (existingChild) {
      if (index === segments.length - 1) {
        existingChild.assignmentValue ??= assignmentValue;
        existingChild.icon ??= icon;
      }
      currentNode = existingChild;
      return;
    }

    const nextNode = createNode(nodeId, segment, index + 1);

    if (index === segments.length - 1) {
      nextNode.assignmentValue = assignmentValue;
      nextNode.icon = icon;
    }

    currentNode.children.set(segment, nextNode);
    folderLookup.set(nextNode.id, nextNode);
    currentNode = nextNode;
  });
}

function collectDescendantFiles(
  node: CategoryFolderNode,
  descendantFilesByFolderId: Map<string, readonly TFile[]>,
): readonly TFile[] {
  let collectedFiles: readonly TFile[] = node.directFiles;

  for (const child of node.sortedChildren) {
    collectedFiles = mergeSortedFiles(collectedFiles, collectDescendantFiles(child, descendantFilesByFolderId));
  }

  descendantFilesByFolderId.set(node.id, collectedFiles);

  return collectedFiles;
}

function extractCategoryPaths(
  file: TFile,
  metadataCache: MetadataCache,
  settings: VirtualTreeSettings,
  categoryPathCache: Map<string, CategoryPath | null>,
): readonly CategoryPath[] {
  const frontmatterValue = metadataCache.getFileCache(file)?.frontmatter?.[settings.frontmatterKey] as unknown;
  const rawValues = normalizeRawCategoryValues(frontmatterValue);
  const parsedPaths: CategoryPath[] = [];

  for (const rawValue of rawValues) {
    if (categoryPathCache.has(rawValue)) {
      const cachedPath = categoryPathCache.get(rawValue) ?? null;
      if (cachedPath) {
        parsedPaths.push(cachedPath);
      }
      continue;
    }

    const parsedPath = parseCategoryPath(rawValue, settings.treatSlashesAsHierarchy, metadataCache);
    categoryPathCache.set(rawValue, parsedPath);
    if (parsedPath) {
      parsedPaths.push(parsedPath);
    }
  }

  return parsedPaths.length > 0 ? deduplicatePaths(parsedPaths) : [];
}

function normalizeRawCategoryValues(value: unknown): readonly string[] {
  if (typeof value === "string") {
    return [value];
  }

  if (!Array.isArray(value)) {
    return [];
  }

  return value.filter((entry): entry is string => typeof entry === "string");
}

function parseCategoryPath(
  rawValue: string,
  treatSlashesAsHierarchy: boolean,
  metadataCache: MetadataCache,
): CategoryPath | null {
  const categoryDetails = resolveCategoryDetails(rawValue, metadataCache);
  const segments = (treatSlashesAsHierarchy ? rawValue.split("/") : [rawValue])
    .map((segment) => normalizeCategorySegment(segment, metadataCache))
    .filter((segment) => segment.length > 0);

  if (segments.length === 0) {
    return null;
  }

  return {
    id: segments.join("/"),
    segments,
    assignmentValue: categoryDetails.assignmentValue,
    icon: categoryDetails.icon,
  };
}

function resolveCategoryDetails(
  rawValue: string,
  metadataCache: MetadataCache,
): Pick<CategoryPath, "assignmentValue" | "icon"> {
  const trimmedValue = rawValue.trim();
  const wikilinkMatch = trimmedValue.match(/^\[\[(.+?)\]\]$/u);

  if (!wikilinkMatch) {
    return {
      assignmentValue: trimmedValue.length > 0 ? trimmedValue : null,
      icon: null,
    };
  }

  const targetPart = wikilinkMatch[1].split("|")[0]?.split("#")[0]?.trim() ?? "";
  const destination = targetPart.length > 0 ? metadataCache.getFirstLinkpathDest(targetPart, "") : null;
  const destinationPath = destination?.path;
  const frontmatterIcon = destinationPath
    ? metadataCache.getFileCache(destination)?.frontmatter?.icon
    : null;

  return {
    assignmentValue: destination ? `[[${destination.basename}]]` : trimmedValue,
    icon: typeof frontmatterIcon === "string" && frontmatterIcon.trim().length > 0 ? frontmatterIcon.trim() : null,
  };
}

function normalizeCategorySegment(segment: string, metadataCache: MetadataCache): string {
  const trimmedSegment = segment.trim();
  const wikilinkMatch = trimmedSegment.match(/^\[\[(.+?)\]\]$/u);

  if (!wikilinkMatch) {
    return cleanupCategoryLabel(trimmedSegment);
  }

  const [targetPart, displayPart] = wikilinkMatch[1].split("|");
  if (displayPart) {
    return cleanupCategoryLabel(displayPart.trim());
  }

  const cleanTarget = targetPart.split("#")[0].trim();
  const destination = metadataCache.getFirstLinkpathDest(cleanTarget, "");
  const frontmatterTitle = destination
    ? metadataCache.getFileCache(destination)?.frontmatter?.title
    : null;

  if (typeof frontmatterTitle === "string" && frontmatterTitle.trim().length > 0) {
    return cleanupCategoryLabel(frontmatterTitle);
  }

  if (destination) {
    return cleanupCategoryLabel(destination.basename);
  }

  return cleanupCategoryLabel(cleanTarget);
}

function isIgnoredVaultPath(path: string): boolean {
  return path.startsWith(".obsidian/");
}

function cleanupCategoryLabel(label: string): string {
  return label.replace(/^category\s*-\s*/iu, "").trim();
}

function deduplicatePaths(paths: readonly CategoryPath[]): readonly CategoryPath[] {
  const byId = new Map<string, CategoryPath>();

  for (const path of paths) {
    byId.set(path.id, path);
  }

  return [...byId.values()].sort((left, right) => left.id.localeCompare(right.id));
}

function finalizeSortedChildren(node: CategoryFolderNode): void {
  const sortedChildren = sortNodes([...node.children.values()]);
  node.sortedChildren = sortedChildren;

  for (const child of sortedChildren) {
    finalizeSortedChildren(child);
  }
}

function createNode(id: string, name: string, depth: number): CategoryFolderNode {
  return {
    id,
    name,
    depth,
    children: new Map<string, CategoryFolderNode>(),
    sortedChildren: [],
    directFiles: [],
    assignmentValue: null,
    icon: null,
  };
}

function sortNodes(nodes: readonly CategoryFolderNode[]): CategoryFolderNode[] {
  return [...nodes].sort((left, right) => left.name.localeCompare(right.name));
}

function sortFiles(files: readonly TFile[]): TFile[] {
  return [...files].sort(compareFiles);
}

function mergeSortedFiles(leftFiles: readonly TFile[], rightFiles: readonly TFile[]): readonly TFile[] {
  if (leftFiles.length === 0) {
    return rightFiles;
  }

  if (rightFiles.length === 0) {
    return leftFiles;
  }

  const mergedFiles: TFile[] = [];
  let leftIndex = 0;
  let rightIndex = 0;

  while (leftIndex < leftFiles.length && rightIndex < rightFiles.length) {
    if (compareFiles(leftFiles[leftIndex], rightFiles[rightIndex]) <= 0) {
      mergedFiles.push(leftFiles[leftIndex]);
      leftIndex += 1;
    } else {
      mergedFiles.push(rightFiles[rightIndex]);
      rightIndex += 1;
    }
  }

  while (leftIndex < leftFiles.length) {
    mergedFiles.push(leftFiles[leftIndex]);
    leftIndex += 1;
  }

  while (rightIndex < rightFiles.length) {
    mergedFiles.push(rightFiles[rightIndex]);
    rightIndex += 1;
  }

  return mergedFiles;
}

function compareFiles(left: TFile, right: TFile): number {
  const nameComparison = left.basename.localeCompare(right.basename);
  return nameComparison !== 0 ? nameComparison : left.path.localeCompare(right.path);
}
