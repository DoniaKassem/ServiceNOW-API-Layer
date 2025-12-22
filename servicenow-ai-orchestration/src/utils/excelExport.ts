import JSZip from 'jszip';

export type ExcelColumnType =
  | 'text'
  | 'reference'
  | 'date'
  | 'datetime'
  | 'number'
  | 'currency'
  | 'boolean';

interface ExcelColumn {
  field: string;
  label: string;
  /**
   * Optional hint for how the column should be encoded in Excel
   * (controls number/date/currency formats so Excel can sort/filter properly)
   */
  type?: ExcelColumnType;
  /**
   * Optional fixed width (in Excel "character" units).
   * If omitted, width will be calculated based on header + cell contents.
   */
  width?: number;
}

interface ExcelExportOptions {
  filename: string;
  sheetName?: string;
  columns: ExcelColumn[];
  data: Record<string, unknown>[];
}

/**
 * Creates and downloads an Excel file (.xlsx) from the given data.
 * Uses the minimal Office Open XML format that Excel can read, with:
 * - frozen header row
 * - header styling (fill/bold/borders)
 * - auto-filter
 * - column widths (auto-fit-ish)
 * - typed numeric/date/currency cells so Excel behaves correctly
 */
export async function exportToExcel({
  filename,
  sheetName = 'Sheet1',
  columns,
  data,
}: ExcelExportOptions): Promise<void> {
  const zip = new JSZip();

  const safeColumns = columns ?? [];
  const safeData = data ?? [];

  const lastCellRef =
    safeColumns.length > 0
      ? getCellRef(safeColumns.length - 1, Math.max(0, safeData.length))
      : 'A1';

  // Content Types
  const contentTypes = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
  <Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>
  <Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>
</Types>`;

  // Relationships
  const rels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  // Workbook relationships
  const workbookRels = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
  <Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>
  <Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/sharedStrings" Target="sharedStrings.xml"/>
</Relationships>`;

  // Workbook
  const workbook = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="${escapeXml(sheetName)}" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  // Styles
  // numFmtId notes:
  // - 0 is "General"
  // - 2 is "0.00"
  // - 14 is "m/d/yy"
  // Custom IDs must be >= 164.
  const NUMFMT_DATE = 164;
  const NUMFMT_DATETIME = 165;
  const NUMFMT_CURRENCY = 166;

  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <numFmts count="3">
    <numFmt numFmtId="${NUMFMT_DATE}" formatCode="mm-dd-yyyy"/>
    <numFmt numFmtId="${NUMFMT_DATETIME}" formatCode="mm-dd-yyyy\\ hh:mm"/>
    <numFmt numFmtId="${NUMFMT_CURRENCY}" formatCode="[$$-409]#,##0.00;[Red]-[$$-409]#,##0.00"/>
  </numFmts>

  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/><color rgb="FF1F2937"/></font>
  </fonts>

  <fills count="3">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
    <fill>
      <patternFill patternType="solid">
        <fgColor rgb="FFEFF6FF"/>
        <bgColor indexed="64"/>
      </patternFill>
    </fill>
  </fills>

  <borders count="2">
    <border><left/><right/><top/><bottom/><diagonal/></border>
    <border>
      <left style="thin"/>
      <right style="thin"/>
      <top style="thin"/>
      <bottom style="thin"/>
      <diagonal/>
    </border>
  </borders>

  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>

  <cellXfs count="5">
    <!-- 0: default -->
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>

    <!-- 1: header (bold + fill + border + centered) -->
    <xf numFmtId="0" fontId="1" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1">
      <alignment horizontal="center" vertical="center" wrapText="1"/>
    </xf>

    <!-- 2: date -->
    <xf numFmtId="${NUMFMT_DATE}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>

    <!-- 3: datetime -->
    <xf numFmtId="${NUMFMT_DATETIME}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>

    <!-- 4: currency -->
    <xf numFmtId="${NUMFMT_CURRENCY}" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
  </cellXfs>
</styleSheet>`;

  // Build shared strings and sheet data
  const sharedStrings: string[] = [];
  const sharedStringMap = new Map<string, number>();
  let sharedStringCount = 0;

  const addSharedString = (value: string): number => {
    sharedStringCount += 1;

    const existing = sharedStringMap.get(value);
    if (existing !== undefined) return existing;

    const index = sharedStrings.length;
    sharedStrings.push(value);
    sharedStringMap.set(value, index);
    return index;
  };

  // Column widths (auto-fit-ish)
  const colWidths = safeColumns.map((col) => {
    if (typeof col.width === 'number' && Number.isFinite(col.width) && col.width > 0) {
      return clamp(col.width, 5, 80);
    }

    const headerLen = (col.label || '').length;
    let maxLen = headerLen;

    for (const record of safeData) {
      const display = getValueAsString(record?.[col.field]);
      maxLen = Math.max(maxLen, display.length);
    }

    // Simple heuristic: characters + padding, clamped.
    return clamp(maxLen + 2, 10, 50);
  });

  // Build rows
  const rows: string[] = [];

  // Header row (row 1)
  const headerCells = safeColumns.map((col, colIndex) => {
    const cellRef = getCellRef(colIndex, 0);
    const stringIndex = addSharedString(col.label ?? '');
    return `<c r="${cellRef}" t="s" s="1"><v>${stringIndex}</v></c>`;
  });
  rows.push(`<row r="1" ht="18" customHeight="1">${headerCells.join('')}</row>`);

  // Data rows
  safeData.forEach((record, rowIndex) => {
    const excelRow = rowIndex + 2; // 1-based row number in Excel, + header row
    const dataCells = safeColumns.map((col, colIndex) => {
      const cellRef = getCellRef(colIndex, rowIndex + 1);
      return buildCellXml({
        cellRef,
        value: record?.[col.field],
        typeHint: col.type,
        addSharedString,
      });
    });
    rows.push(`<row r="${excelRow}">${dataCells.join('')}</row>`);
  });

  // Worksheet
  const dimension = `A1:${lastCellRef}`;
  const autoFilterRef = safeColumns.length > 0 ? `A1:${getCellRef(safeColumns.length - 1, 0)}` : 'A1';

  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>

  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>

  <sheetFormatPr defaultRowHeight="15"/>

  <cols>
    ${colWidths
      .map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w.toFixed(2)}" customWidth="1"/>`)
      .join('')}
  </cols>

  <sheetData>
    ${rows.join('\n    ')}
  </sheetData>

  <autoFilter ref="${autoFilterRef}"/>
</worksheet>`;

  // Shared Strings
  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStringCount}" uniqueCount="${sharedStrings.length}">
  ${sharedStrings.map((s) => `<si><t>${escapeXml(s)}</t></si>`).join('\n  ')}
</sst>`;

  // Add files to zip
  zip.file('[Content_Types].xml', contentTypes);
  zip.file('_rels/.rels', rels);
  zip.file('xl/_rels/workbook.xml.rels', workbookRels);
  zip.file('xl/workbook.xml', workbook);
  zip.file('xl/styles.xml', styles);
  zip.file('xl/worksheets/sheet1.xml', worksheet);
  zip.file('xl/sharedStrings.xml', sharedStringsXml);

  // Generate and download
  const content = await zip.generateAsync({ type: 'blob' });
  const url = URL.createObjectURL(content);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename.endsWith('.xlsx') ? filename : `${filename}.xlsx`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function buildCellXml(args: {
  cellRef: string;
  value: unknown;
  typeHint?: ExcelColumnType;
  addSharedString: (s: string) => number;
}): string {
  const { cellRef, value, typeHint, addSharedString } = args;

  // Always prefer the display_value for ServiceNow reference objects.
  const display = getValueAsString(value);

  // If no hint, fall back to a conservative heuristic.
  const effectiveType: ExcelColumnType =
    typeHint ??
    (typeof value === 'boolean'
      ? 'boolean'
      : looksLikeIsoDate(display)
        ? 'date'
        : looksLikeNumber(display)
          ? 'number'
          : 'text');

  if (effectiveType === 'boolean') {
    const b = coerceBoolean(value, display);
    return `<c r="${cellRef}" t="b"><v>${b ? 1 : 0}</v></c>`;
  }

  if (effectiveType === 'date' || effectiveType === 'datetime') {
    const dateSerial = parseExcelDateSerial(display);
    if (dateSerial !== null) {
      // Styles: 2 = date, 3 = datetime
      const styleId = effectiveType === 'datetime' ? 3 : 2;
      return `<c r="${cellRef}" s="${styleId}"><v>${dateSerial}</v></c>`;
    }
    // Fallback to text if parsing fails
    const stringIndex = addSharedString(display);
    return `<c r="${cellRef}" t="s"><v>${stringIndex}</v></c>`;
  }

  if (effectiveType === 'currency') {
    const n = coerceNumber(display);
    if (n !== null) {
      // Style 4 = currency
      return `<c r="${cellRef}" s="4"><v>${n}</v></c>`;
    }
    const stringIndex = addSharedString(display);
    return `<c r="${cellRef}" t="s"><v>${stringIndex}</v></c>`;
  }

  if (effectiveType === 'number') {
    const n = coerceNumber(display);
    if (n !== null) {
      // General numeric without forcing decimal places; Excel will handle it.
      return `<c r="${cellRef}"><v>${n}</v></c>`;
    }
    const stringIndex = addSharedString(display);
    return `<c r="${cellRef}" t="s"><v>${stringIndex}</v></c>`;
  }

  // Text/reference default
  const stringIndex = addSharedString(display);
  return `<c r="${cellRef}" t="s"><v>${stringIndex}</v></c>`;
}

function looksLikeNumber(value: string): boolean {
  const s = value.trim();
  if (!s) return false;
  // Reject if it contains letters (likely IDs / names)
  if (/[a-zA-Z]/.test(s)) return false;

  const n = coerceNumber(s);
  return n !== null;
}

function coerceNumber(value: string): number | null {
  const s = value.trim();
  if (!s) return null;

  // Remove common currency/number adornments
  const cleaned = s.replace(/[$,]/g, '').replace(/\s/g, '');
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

function coerceBoolean(raw: unknown, display: string): boolean {
  if (typeof raw === 'boolean') return raw;
  const s = (display ?? '').trim().toLowerCase();
  return s === 'true' || s === 'yes' || s === '1' || s === 'y';
}

function looksLikeIsoDate(value: string): boolean {
  const s = value.trim();
  // yyyy-mm-dd
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return true;
  // full ISO datetime
  if (/^\d{4}-\d{2}-\d{2}t\d{2}:\d{2}/i.test(s)) return true;
  return false;
}

/**
 * Excel stores dates as days since 1899-12-30 (with a known leap-year bug baked in).
 * This conversion follows the standard Excel 1900 date system conventions.
 */
function parseExcelDateSerial(value: string): number | null {
  const s = value.trim();
  if (!s) return null;

  // yyyy-mm-dd - treat as UTC midnight for stable results across timezones
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (m) {
    const year = Number(m[1]);
    const month = Number(m[2]); // 1-12
    const day = Number(m[3]); // 1-31
    if (!Number.isFinite(year) || !Number.isFinite(month) || !Number.isFinite(day)) return null;

    const utcMs = Date.UTC(year, month - 1, day);
    return excelSerialFromUtcMs(utcMs);
  }

  // Otherwise, let JS parse; prefer UTC millis
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;

  return excelSerialFromUtcMs(d.getTime());
}

function excelSerialFromUtcMs(utcMs: number): number {
  // 1899-12-30T00:00:00Z is Excel day 0 in the 1900 system
  const excelEpoch = Date.UTC(1899, 11, 30);
  const days = (utcMs - excelEpoch) / 86400000;
  // Keep up to 5 decimals (~seconds precision)
  return Math.round(days * 100000) / 100000;
}

function getCellRef(col: number, row: number): string {
  let colStr = '';
  let c = col;
  do {
    colStr = String.fromCharCode(65 + (c % 26)) + colStr;
    c = Math.floor(c / 26) - 1;
  } while (c >= 0);
  return `${colStr}${row + 1}`;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function getValueAsString(value: unknown): string {
  if (value === null || value === undefined) {
    return '';
  }
  if (typeof value === 'object') {
    // Handle ServiceNow reference fields: { display_value, value, ... }
    const ref = value as { display_value?: string; value?: string };
    return ref.display_value || ref.value || '';
  }
  return String(value);
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}
