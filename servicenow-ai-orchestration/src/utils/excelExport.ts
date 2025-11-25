import JSZip from 'jszip';

interface ExcelColumn {
  field: string;
  label: string;
}

interface ExcelExportOptions {
  filename: string;
  sheetName?: string;
  columns: ExcelColumn[];
  data: Record<string, unknown>[];
}

/**
 * Creates and downloads an Excel file (.xlsx) from the given data
 * Uses the minimal Office Open XML format that Excel can read
 */
export async function exportToExcel({
  filename,
  sheetName = 'Sheet1',
  columns,
  data,
}: ExcelExportOptions): Promise<void> {
  const zip = new JSZip();

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

  // Styles (minimal)
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <fonts count="2">
    <font><sz val="11"/><name val="Calibri"/></font>
    <font><b/><sz val="11"/><name val="Calibri"/></font>
  </fonts>
  <fills count="2">
    <fill><patternFill patternType="none"/></fill>
    <fill><patternFill patternType="gray125"/></fill>
  </fills>
  <borders count="1">
    <border><left/><right/><top/><bottom/><diagonal/></border>
  </borders>
  <cellStyleXfs count="1">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0"/>
  </cellStyleXfs>
  <cellXfs count="2">
    <xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
    <xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
  </cellXfs>
</styleSheet>`;

  // Build shared strings and sheet data
  const sharedStrings: string[] = [];
  const sharedStringMap = new Map<string, number>();

  const getSharedStringIndex = (value: string): number => {
    if (sharedStringMap.has(value)) {
      return sharedStringMap.get(value)!;
    }
    const index = sharedStrings.length;
    sharedStrings.push(value);
    sharedStringMap.set(value, index);
    return index;
  };

  // Build rows
  const rows: string[] = [];

  // Header row
  const headerCells = columns.map((col, index) => {
    const cellRef = getCellRef(index, 0);
    const stringIndex = getSharedStringIndex(col.label);
    return `<c r="${cellRef}" t="s" s="1"><v>${stringIndex}</v></c>`;
  });
  rows.push(`<row r="1">${headerCells.join('')}</row>`);

  // Data rows
  data.forEach((record, rowIndex) => {
    const dataCells = columns.map((col, colIndex) => {
      const cellRef = getCellRef(colIndex, rowIndex + 1);
      const value = getValueAsString(record[col.field]);

      // Check if it's a number
      const numValue = Number(value);
      if (!isNaN(numValue) && value !== '' && value.trim() === String(numValue)) {
        return `<c r="${cellRef}"><v>${numValue}</v></c>`;
      }

      // String value
      const stringIndex = getSharedStringIndex(value);
      return `<c r="${cellRef}" t="s"><v>${stringIndex}</v></c>`;
    });
    rows.push(`<row r="${rowIndex + 2}">${dataCells.join('')}</row>`);
  });

  // Worksheet
  const dimension = `A1:${getCellRef(columns.length - 1, data.length)}`;
  const worksheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  <dimension ref="${dimension}"/>
  <sheetViews>
    <sheetView tabSelected="1" workbookViewId="0">
      <pane ySplit="1" topLeftCell="A2" activePane="bottomLeft" state="frozen"/>
    </sheetView>
  </sheetViews>
  <cols>
    ${columns.map((_, i) => `<col min="${i + 1}" max="${i + 1}" width="15" customWidth="1"/>`).join('')}
  </cols>
  <sheetData>
    ${rows.join('\n    ')}
  </sheetData>
</worksheet>`;

  // Shared Strings
  const sharedStringsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="${sharedStrings.length}" uniqueCount="${sharedStrings.length}">
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
    // Handle reference fields
    const ref = value as { display_value?: string; value?: string };
    return ref.display_value || ref.value || '';
  }
  return String(value);
}
