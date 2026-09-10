import { dialog } from 'electron';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import * as XLSX from 'xlsx';
import type {
  BloggerRow,
  CollectionItem,
  CollectionSettings,
  CollectionSnapshot,
  LinkConversionItem,
} from '../../shared/domain';
import { extractLinks, parseSourceText, type ParsedSource } from '../../shared/parsers';
import { buildBloggerExportRows, buildLinkExportRows, buildSnapshotExportData } from './excelRows';

const readWorkbookFirstColumn = (filePath: string): string => {
  const workbook = XLSX.readFile(filePath);
  const firstSheetName = workbook.SheetNames[0];
  const sheet = firstSheetName ? workbook.Sheets[firstSheetName] : undefined;
  if (!sheet) return '';
  return (XLSX.utils.sheet_to_json(sheet, { header: 1, raw: false }) as unknown[][])
    .map((row) => String(row[0] ?? '').trim())
    .filter(Boolean)
    .join('\n');
};

export const chooseAndParseSources = async (): Promise<{
  sources: ParsedSource[];
  invalid: number;
  duplicates: number;
} | null> => {
  const selection = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [
      { name: '支持的文件', extensions: ['xlsx', 'xls', 'txt', 'csv'] },
      { name: 'Excel', extensions: ['xlsx', 'xls'] },
      { name: '文本', extensions: ['txt', 'csv'] },
    ],
  });
  const filePath = selection.filePaths[0];
  if (!filePath) return null;
  const text = /\.xlsx?$/i.test(filePath) ? readWorkbookFirstColumn(filePath) : await readFile(filePath, 'utf8');
  const parsed = parseSourceText(text);
  return { sources: parsed.valid, invalid: parsed.invalid.length, duplicates: parsed.duplicates };
};

export const chooseAndExtractLinks = async (): Promise<string[] | null> => {
  const selection = await dialog.showOpenDialog({
    properties: ['openFile'],
    filters: [{ name: '支持的文件', extensions: ['xlsx', 'xls', 'txt', 'csv'] }],
  });
  const filePath = selection.filePaths[0];
  if (!filePath) return null;
  const text = /\.xlsx?$/i.test(filePath) ? readWorkbookFirstColumn(filePath) : await readFile(filePath, 'utf8');
  return extractLinks(text);
};

const saveRows = async (options: {
  defaultPath: string;
  sheetName: string;
  rows: Record<string, unknown>[];
  header?: string[];
}): Promise<string | null> => {
  const selection = await dialog.showSaveDialog({
    defaultPath: options.defaultPath,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (!selection.filePath) return null;
  const workbook = XLSX.utils.book_new();
  const header = options.header ?? Object.keys(options.rows[0] ?? {});
  const aoa = [header, ...options.rows.map((row) => header.map((key) => row[key] ?? ''))];
  const worksheet = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(workbook, worksheet, options.sheetName);
  XLSX.writeFile(workbook, selection.filePath);
  return selection.filePath;
};

export const exportSnapshots = (
  settings: CollectionSettings,
  snapshots: CollectionSnapshot[],
  items: CollectionItem[],
  isSvip: boolean,
): Promise<string | null> => {
  const exportData = buildSnapshotExportData(snapshots, items, isSvip);
  const defaultPath = settings.directory ? join(settings.directory, settings.filename) : settings.filename;
  return saveRows({
    defaultPath,
    sheetName: '采集数据',
    rows: exportData.rows,
    header: exportData.header,
  });
};

export const exportBloggers = (rows: BloggerRow[]): Promise<string | null> =>
  saveRows({
    defaultPath: '达人列表.xlsx',
    sheetName: '达人列表',
    rows: buildBloggerExportRows(rows),
  });

export const exportLinks = (items: LinkConversionItem[]): Promise<string | null> =>
  saveRows({
    defaultPath: '链接转换结果.xlsx',
    sheetName: '链接转换结果',
    rows: buildLinkExportRows(items),
  });