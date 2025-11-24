// OCR Service using browser-based PDF.js and Tesseract.js
// For production, consider using a server-side OCR service

interface OCRResult {
  text: string;
  pages: number;
  confidence?: number;
}

// PDF.js library interface
interface PDFDocumentProxy {
  numPages: number;
  getPage(pageNumber: number): Promise<PDFPageProxy>;
}

interface PDFPageProxy {
  getTextContent(): Promise<{ items: Array<{ str?: string }> }>;
}

interface PDFjsLib {
  GlobalWorkerOptions: { workerSrc: string };
  getDocument(params: { data: ArrayBuffer }): { promise: Promise<PDFDocumentProxy> };
}

// Simple PDF text extraction using PDF.js CDN
export async function extractTextFromPDF(file: File): Promise<OCRResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;

        // Load PDF.js from CDN if not already loaded
        if (!(window as unknown as { pdfjsLib: unknown }).pdfjsLib) {
          await loadPdfJs();
        }

        const pdfjsLib = (window as unknown as { pdfjsLib: PDFjsLib }).pdfjsLib;
        pdfjsLib.GlobalWorkerOptions.workerSrc =
          'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';

        const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;
        let fullText = '';

        for (let i = 1; i <= pdf.numPages; i++) {
          const page = await pdf.getPage(i);
          const textContent = await page.getTextContent();
          const pageText = textContent.items
            .map((item) => item.str || '')
            .join(' ');
          fullText += pageText + '\n\n';
        }

        resolve({
          text: fullText.trim(),
          pages: pdf.numPages,
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// Load PDF.js dynamically
async function loadPdfJs(): Promise<void> {
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js';
    script.onload = () => resolve();
    script.onerror = () => reject(new Error('Failed to load PDF.js'));
    document.head.appendChild(script);
  });
}

// Extract text from images using Tesseract.js
export async function extractTextFromImage(file: File): Promise<OCRResult> {
  // Load Tesseract.js dynamically
  const Tesseract = await import('tesseract.js');

  const result = await Tesseract.recognize(file, 'eng', {
    logger: (m) => console.log('OCR Progress:', m),
  });

  return {
    text: result.data.text,
    pages: 1,
    confidence: result.data.confidence,
  };
}

// Extract text from DOCX files
export async function extractTextFromDocx(file: File): Promise<OCRResult> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = async (e) => {
      try {
        const arrayBuffer = e.target?.result as ArrayBuffer;

        // Simple DOCX extraction - in production use mammoth.js or similar
        // DOCX is a zip file containing XML
        const JSZip = (await import('jszip')).default;
        const zip = await JSZip.loadAsync(arrayBuffer);

        const documentXml = await zip.file('word/document.xml')?.async('string');
        if (!documentXml) {
          throw new Error('Invalid DOCX file');
        }

        // Extract text from XML (basic extraction)
        const parser = new DOMParser();
        const doc = parser.parseFromString(documentXml, 'text/xml');
        const textElements = doc.getElementsByTagName('w:t');
        let text = '';

        for (let i = 0; i < textElements.length; i++) {
          text += textElements[i].textContent + ' ';
        }

        resolve({
          text: text.trim(),
          pages: 1,
        });
      } catch (error) {
        reject(error);
      }
    };

    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsArrayBuffer(file);
  });
}

// Main OCR function that handles different file types
export async function extractText(
  file: File,
  onProgress?: (progress: number, status: string) => void
): Promise<OCRResult> {
  const fileType = file.type.toLowerCase();
  const fileName = file.name.toLowerCase();

  onProgress?.(10, 'Detecting file type...');

  if (fileType === 'application/pdf' || fileName.endsWith('.pdf')) {
    onProgress?.(20, 'Extracting text from PDF...');
    const result = await extractTextFromPDF(file);
    onProgress?.(100, 'Complete');
    return result;
  }

  if (
    fileType.startsWith('image/') ||
    fileName.endsWith('.png') ||
    fileName.endsWith('.jpg') ||
    fileName.endsWith('.jpeg') ||
    fileName.endsWith('.tiff') ||
    fileName.endsWith('.bmp')
  ) {
    onProgress?.(20, 'Running OCR on image...');
    const result = await extractTextFromImage(file);
    onProgress?.(100, 'Complete');
    return result;
  }

  if (
    fileType ===
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document' ||
    fileName.endsWith('.docx')
  ) {
    onProgress?.(20, 'Extracting text from DOCX...');
    const result = await extractTextFromDocx(file);
    onProgress?.(100, 'Complete');
    return result;
  }

  // Plain text files
  if (fileType === 'text/plain' || fileName.endsWith('.txt')) {
    onProgress?.(20, 'Reading text file...');
    const text = await file.text();
    onProgress?.(100, 'Complete');
    return { text, pages: 1 };
  }

  throw new Error(`Unsupported file type: ${fileType || fileName}`);
}
