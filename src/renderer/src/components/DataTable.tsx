import { useMemo, useRef, useState, type ReactNode } from 'react';
import {
  flexRender,
  getCoreRowModel,
  getFilteredRowModel,
  getPaginationRowModel,
  getSortedRowModel,
  useReactTable,
  type ColumnDef,
} from '@tanstack/react-table';
import { useVirtualizer } from '@tanstack/react-virtual';
import { ChevronDown, ChevronLeft, ChevronRight, ChevronsUpDown, ChevronUp, Search } from 'lucide-react';
import { Button, EmptyState } from './ui';

export const DataTable = <T,>({
  data,
  columns,
  searchPlaceholder = '搜索当前列表',
  emptyTitle = '暂无数据',
  emptyDescription = '完成上方操作后，数据会显示在这里。',
  toolbar,
  pageSize = 50,
  virtualized = false,
}: {
  data: T[];
  columns: Array<ColumnDef<T>>;
  searchPlaceholder?: string;
  emptyTitle?: string;
  emptyDescription?: string;
  toolbar?: ReactNode;
  pageSize?: number;
  virtualized?: boolean;
}) => {
  const [globalFilter, setGlobalFilter] = useState('');
  const stableColumns = useMemo(() => columns, [columns]);
  const table = useReactTable({
    data,
    columns: stableColumns,
    state: { globalFilter },
    initialState: { pagination: { pageSize } },
    onGlobalFilterChange: setGlobalFilter,
    getCoreRowModel: getCoreRowModel(),
    getFilteredRowModel: getFilteredRowModel(),
    getSortedRowModel: getSortedRowModel(),
    ...(virtualized ? {} : { getPaginationRowModel: getPaginationRowModel() }),
  });
  const scrollRef = useRef<HTMLDivElement>(null);
  const rows = table.getRowModel().rows;
  const rowVirtualizer = useVirtualizer({
    count: virtualized ? rows.length : 0,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 50,
    overscan: 8,
  });
  const virtualRows = rowVirtualizer.getVirtualItems();
  const paddingTop = virtualized && virtualRows.length > 0 ? virtualRows[0]!.start : 0;
  const paddingBottom = virtualized && virtualRows.length > 0
    ? rowVirtualizer.getTotalSize() - virtualRows[virtualRows.length - 1]!.end
    : 0;
  const renderRow = (row: (typeof rows)[number]) => (
    <tr key={row.id}>
      {row.getVisibleCells().map((cell) => <td key={cell.id}>{flexRender(cell.column.columnDef.cell, cell.getContext())}</td>)}
    </tr>
  );

  return (
    <section className="data-panel">
      <div className="data-toolbar">
        <label className="search-box"><Search size={16} /><input value={globalFilter} onChange={(event) => setGlobalFilter(event.target.value)} placeholder={searchPlaceholder} /></label>
        {toolbar ? <div className="data-toolbar__actions">{toolbar}</div> : null}
      </div>
      <div ref={scrollRef} className="table-scroll">
        <table className="data-table">
          <thead>
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => (
                  <th key={header.id} style={{ width: header.getSize() }}>
                    {header.isPlaceholder ? null : (
                      <button className="table-sort" onClick={header.column.getToggleSortingHandler()} disabled={!header.column.getCanSort()}>
                        {flexRender(header.column.columnDef.header, header.getContext())}
                        {header.column.getIsSorted() === 'asc' ? <ChevronUp size={14} /> : header.column.getIsSorted() === 'desc' ? <ChevronDown size={14} /> : header.column.getCanSort() ? <ChevronsUpDown size={14} /> : null}
                      </button>
                    )}
                  </th>
                ))}
              </tr>
            ))}
          </thead>
          <tbody>
            {paddingTop > 0 ? <tr className="virtual-spacer" aria-hidden="true"><td colSpan={table.getVisibleLeafColumns().length} style={{ height: paddingTop }} /></tr> : null}
            {virtualized
              ? virtualRows.map((virtualRow) => {
                  const row = rows[virtualRow.index];
                  return row ? renderRow(row) : null;
                })
              : rows.map(renderRow)}
            {paddingBottom > 0 ? <tr className="virtual-spacer" aria-hidden="true"><td colSpan={table.getVisibleLeafColumns().length} style={{ height: paddingBottom }} /></tr> : null}
          </tbody>
        </table>
        {data.length === 0 ? <EmptyState title={emptyTitle} description={emptyDescription} /> : null}
      </div>
      {!virtualized && data.length > pageSize ? (
        <footer className="pagination">
          <span>第 {table.getState().pagination.pageIndex + 1} / {table.getPageCount()} 页，共 {data.length} 条</span>
          <div><Button variant="ghost" onClick={() => table.previousPage()} disabled={!table.getCanPreviousPage()}><ChevronLeft size={16} />上一页</Button><Button variant="ghost" onClick={() => table.nextPage()} disabled={!table.getCanNextPage()}>下一页<ChevronRight size={16} /></Button></div>
        </footer>
      ) : null}
    </section>
  );
};