import type { DiagramNodeSchema } from "../../schema";
import { SECTION_GAP_X } from "./constants";
import { getSectionIdFromComponent } from "./section-helpers";
import type { ComponentByIdMap } from "./types";

/**
 * Section layouts start each section at a fixed `SECTION_BLOCK_WIDTH` offset,
 * which leaves wide empty bands after sparse sections. Shift every section left
 * so it starts `SECTION_GAP_X` after the previous one actually ends; the shape
 * inside each section is unchanged.
 */
export function packSectionsHorizontally(
  nodes: DiagramNodeSchema[],
  componentsById: ComponentByIdMap,
  sectionIds: string[],
): void {
  const nodesBySection = new Map<string, DiagramNodeSchema[]>();
  for (const node of nodes) {
    const component = componentsById.get(node.id);
    if (!component) continue;
    const sectionId = getSectionIdFromComponent(component);
    const list = nodesBySection.get(sectionId) ?? [];
    list.push(node);
    nodesBySection.set(sectionId, list);
  }

  let nextX: number | null = null;
  for (const sectionId of sectionIds) {
    const sectionNodes = nodesBySection.get(sectionId);
    if (!sectionNodes?.length) continue;

    const xs = sectionNodes.map((node) => node.position.x);
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    // Only ever pull sections left, so packing can't push them into each other.
    const shift: number = nextX === null ? 0 : Math.min(0, nextX - minX);
    if (shift < 0) {
      for (const node of sectionNodes) {
        node.position = { x: node.position.x + shift, y: node.position.y };
      }
    }
    nextX = maxX + shift + SECTION_GAP_X;
  }
}
