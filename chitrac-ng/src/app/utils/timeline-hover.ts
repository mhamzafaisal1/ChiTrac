export interface TimelinePointer {
  clientX: number;
  clientY: number;
}

export function hoveredTimelineChunk<T extends { id: string }>(
  svg: SVGSVGElement | undefined,
  pointer: TimelinePointer | null,
  machines: { serial: number | string; chunks: T[] }[]
): T | undefined {
  if (!svg || !pointer) return undefined;
  const target = svg.ownerDocument.elementFromPoint(pointer.clientX, pointer.clientY);
  const segment = target?.closest('.session-chunk');
  if (!segment || !svg.contains(segment)) return undefined;
  const machine = machines.find(item => String(item.serial) === segment.getAttribute('data-machine'));
  return machine?.chunks.find(chunk => chunk.id === segment.getAttribute('data-chunk'));
}
