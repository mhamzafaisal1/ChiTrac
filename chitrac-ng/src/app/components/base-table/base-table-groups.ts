export interface BaseTableGroup {
  key: string;
  summary: Record<string, any>;
  details: Record<string, any>[];
}

export interface BaseTableGroupRow {
  key: string;
  id: string;
  rank: number;
  kind: 'summary' | 'detail' | 'empty-detail';
  summary: Record<string, any>;
  expanded: boolean;
  detailCount: number;
  singleItem: string;
}

export function groupedTableRows(groups: BaseTableGroup[], expanded: Set<string>, identity: string): any[] {
  return groups.flatMap(group => {
    const wrap = (data: Record<string, any>, kind: BaseTableGroupRow['kind'], rank: number) => ({
      ...data,
      __baseTableGroup: {
        key: group.key, id: JSON.stringify([group.key, kind, rank]), kind, rank,
        summary: group.summary, expanded: expanded.has(group.key), detailCount: group.details.length,
        singleItem: group.details.length === 1 ? String(group.details[0]['Item'] || 'Unknown Item') : ''
      } satisfies BaseTableGroupRow
    });
    const summary = wrap(group.summary, 'summary', 0);
    if (!expanded.has(group.key)) return [summary];
    if (!group.details.length) return [summary, wrap({ [identity]: 'No item details' }, 'empty-detail', 1)];
    return [summary, ...group.details.map((detail, index) =>
      wrap({ ...detail, [identity]: detail['Item'] }, 'detail', index + 1))];
  });
}
