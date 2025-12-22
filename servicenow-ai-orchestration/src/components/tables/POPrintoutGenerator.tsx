import { useState, useCallback, useRef, useEffect } from 'react';
import {
  X,
  Printer,
  Plus,
  Trash2,
  Download,
  FileText,
  Building2,
  MapPin,
  DollarSign,
  Calculator,
  Calendar,
  Save,
  Loader2,
} from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import jsPDF from 'jspdf';
import html2canvas from 'html2canvas';
import { useToast } from '../ui';
import { useSettingsStore } from '../../stores/settingsStore';
import { getServiceNowAPI } from '../../services/servicenow';
import { getSysId, getDisplayValue } from '../../utils/serviceNowHelpers';

// Fixed Bill To Address
const BILL_TO_ADDRESS = {
  company: 'illumin',
  street: '70 University Ave Suite 1200',
  city: 'Toronto',
  state: 'Ontario',
  postalCode: 'M5J 2M4',
  country: 'Canada',
};

// Predefined Ship To Addresses
const SHIP_TO_ADDRESSES = [
  {
    id: 'herndon',
    label: 'AcuityAds C/O Aptum - Herndon, VA',
    company: 'AcuityAds C/O Aptum',
    street: '2350 Corporate Park Drive Suite 225',
    city: 'Herndon',
    state: 'Virginia',
    postalCode: '20171-5805',
    country: 'United States',
  },
  {
    id: 'losangeles',
    label: 'Aptum Technologies - Los Angeles, CA',
    company: 'Aptum Technologies',
    street: '900 N Alameda St',
    city: 'Los Angeles',
    state: 'California',
    postalCode: '90012-2904',
    country: 'United States',
  },
  {
    id: 'toronto',
    label: 'illumin - Toronto, ON',
    company: 'illumin',
    street: '70 University Ave Suite 1200',
    city: 'Toronto',
    state: 'Ontario',
    postalCode: 'M5J 2M4',
    country: 'Canada',
  },
];

interface LineItem {
  id: string;
  description: string;
  quantity: number;
  unitOfMeasure: string;
  unitPrice: number;
  total: number;
}

interface VendorInfo {
  name: string;
  contactName: string;
  email: string;
  phone: string;
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

interface POPrintoutGeneratorProps {
  onClose: () => void;
  purchaseOrderSysId?: string;
}

export function POPrintoutGenerator({ onClose, purchaseOrderSysId }: POPrintoutGeneratorProps) {
  const toast = useToast();
  const printRef = useRef<HTMLDivElement>(null);
  const { settings } = useSettingsStore();

  const [poNumber, setPoNumber] = useState(`PO-${Date.now()}`);
  const [poDate, setPoDate] = useState(new Date().toISOString().split('T')[0]);
  const [selectedShipTo, setSelectedShipTo] = useState(SHIP_TO_ADDRESSES[0].id);

  const [vendorInfo, setVendorInfo] = useState<VendorInfo>({
    name: '',
    contactName: '',
    email: '',
    phone: '',
    street: '',
    city: '',
    state: '',
    postalCode: '',
    country: '',
  });

  const [lineItems, setLineItems] = useState<LineItem[]>([
    {
      id: '1',
      description: '',
      quantity: 1,
      unitOfMeasure: 'EA',
      unitPrice: 0,
      total: 0,
    },
  ]);

  const [taxRate, setTaxRate] = useState(13);
  const [shippingFee, setShippingFee] = useState(0);
  const [paymentTerms, setPaymentTerms] = useState('Net 45 days from delivery date');
  const [isDataLoaded, setIsDataLoaded] = useState(false);

  const selectedShipToAddress = SHIP_TO_ADDRESSES.find((addr) => addr.id === selectedShipTo);

  // Fetch PO data from ServiceNow
  const { data: poData, isLoading: isLoadingPO } = useQuery({
    queryKey: ['purchase_order', purchaseOrderSysId],
    queryFn: async () => {
      if (!purchaseOrderSysId) return null;
      const api = getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
      const response = await api.get<Record<string, unknown>>('sn_shop_purchase_order', {
        sysparm_query: `sys_id=${purchaseOrderSysId}`,
        sysparm_display_value: 'all',
      });
      return response.result?.[0] || null;
    },
    enabled: !!purchaseOrderSysId && !!settings.servicenow.apiKey,
  });

  // Fetch PO Lines
  const { data: poLines, isLoading: isLoadingLines } = useQuery({
    queryKey: ['purchase_order_lines', purchaseOrderSysId],
    queryFn: async () => {
      if (!purchaseOrderSysId) return [];
      const api = getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
      const response = await api.get<Record<string, unknown>>('sn_shop_purchase_order_line', {
        sysparm_query: `purchase_order=${purchaseOrderSysId}`,
        sysparm_display_value: 'all',
      });
      return response.result || [];
    },
    enabled: !!purchaseOrderSysId && !!settings.servicenow.apiKey,
  });

  // Fetch Vendor/Supplier data
  const { data: vendorData } = useQuery({
    queryKey: ['vendor', poData?.vendor || poData?.supplier],
    queryFn: async () => {
      const vendorRef = poData?.vendor || poData?.supplier;
      if (!vendorRef) return null;
      
      const vendorSysId = typeof vendorRef === 'object' ? getSysId((vendorRef as any).value) : getSysId(vendorRef);
      if (!vendorSysId) return null;

      const api = getServiceNowAPI(settings.servicenow.instanceUrl, settings.servicenow.apiKey);
      
      // Try supplier table first
      try {
        const response = await api.get<Record<string, unknown>>('sn_fin_supplier', {
          sysparm_query: `sys_id=${vendorSysId}`,
          sysparm_display_value: 'all',
        });
        if (response.result?.[0]) return response.result[0];
      } catch {
        // If not in supplier table, try vendor table
      }

      // Try vendor/company table
      try {
        const response = await api.get<Record<string, unknown>>('core_company', {
          sysparm_query: `sys_id=${vendorSysId}`,
          sysparm_display_value: 'all',
        });
        return response.result?.[0] || null;
      } catch {
        return null;
      }
    },
    enabled: !!(poData?.vendor || poData?.supplier) && !!settings.servicenow.apiKey,
  });

  // Populate form with ServiceNow data
  useEffect(() => {
    if (!poData || isDataLoaded) return;

    // Set PO details
    setPoNumber(getDisplayValue(poData.number) || getDisplayValue(poData.display_name) || `PO-${Date.now()}`);
    
    const createdDate = getDisplayValue(poData.sys_created_on) || getDisplayValue(poData.created);
    if (createdDate) {
      try {
        const date = new Date(createdDate);
        if (!isNaN(date.getTime())) {
          setPoDate(date.toISOString().split('T')[0]);
        }
      } catch {
        // Keep default date
      }
    }

    setIsDataLoaded(true);
  }, [poData, isDataLoaded]);

  // Populate vendor info
  useEffect(() => {
    if (!vendorData) return;

    setVendorInfo({
      name: getDisplayValue(vendorData.name) || getDisplayValue(vendorData.legal_name) || '',
      contactName: getDisplayValue(vendorData.contact) || getDisplayValue(vendorData.primary_contact) || '',
      email: getDisplayValue(vendorData.email) || getDisplayValue(vendorData.u_email) || '',
      phone: getDisplayValue(vendorData.phone) || getDisplayValue(vendorData.phone_number) || '',
      street: getDisplayValue(vendorData.street) || getDisplayValue(vendorData.address) || '',
      city: getDisplayValue(vendorData.city) || '',
      state: getDisplayValue(vendorData.state) || '',
      postalCode: getDisplayValue(vendorData.zip) || getDisplayValue(vendorData.postal_code) || '',
      country: getDisplayValue(vendorData.country) || '',
    });
  }, [vendorData]);

  // Helper function to parse currency values from ServiceNow format (e.g., "USD;1575.00")
  const parseCurrencyValue = useCallback((value: unknown): number => {
    // Try to get display value first
    const strValue = getDisplayValue(value);
    if (!strValue) {
      // If display value is empty, try to access the raw object
      if (typeof value === 'object' && value !== null) {
        const valueObj = value as any;
        // Try to get the display_value property
        if (valueObj.display_value) {
          return parseCurrencyValue(valueObj.display_value);
        }
        // Try to get the value property
        if (valueObj.value) {
          return parseCurrencyValue(valueObj.value);
        }
      }
      return 0;
    }
    
    // Check if it's in the format "CURRENCY;AMOUNT"
    if (strValue.includes(';')) {
      const parts = strValue.split(';');
      if (parts.length === 2) {
        const amount = parseFloat(parts[1].trim());
        return isNaN(amount) ? 0 : amount;
      }
    }
    
    // Otherwise try to parse it directly
    const amount = parseFloat(strValue.replace(/[^0-9.-]/g, ''));
    return isNaN(amount) ? 0 : amount;
  }, []);

  // Populate line items
  useEffect(() => {
    if (!poLines || poLines.length === 0) return;

    const items: LineItem[] = poLines.map((line, index) => {
      // Log the raw line data for debugging
      console.log('PO Line Item:', line);
      
      const quantity = parseFloat(getDisplayValue(line.purchased_quantity) || getDisplayValue(line.quantity) || '1');
      const unitPrice = parseCurrencyValue(line.unit_price) || parseCurrencyValue(line.price);
      const totalAmount = parseCurrencyValue(line.total_line_amount) || parseCurrencyValue(line.total_amount) || parseCurrencyValue(line.total);
      
      console.log('Parsed values:', { quantity, unitPrice, totalAmount });
      
      return {
        id: String(index + 1),
        description: getDisplayValue(line.product_name) || getDisplayValue(line.short_description) || getDisplayValue(line.item) || '',
        quantity: quantity,
        unitOfMeasure: getDisplayValue(line.unit_of_measure) || 'EA',
        unitPrice: unitPrice,
        total: totalAmount || (quantity * unitPrice),
      };
    });

    if (items.length > 0) {
      setLineItems(items);
    }
  }, [poLines, parseCurrencyValue]);

  // Calculate totals
  const subtotal = lineItems.reduce((sum, item) => sum + item.total, 0);
  const taxAmount = (subtotal * taxRate) / 100;
  const grandTotal = subtotal + taxAmount + shippingFee;

  const handleVendorChange = (field: keyof VendorInfo, value: string) => {
    setVendorInfo((prev) => ({ ...prev, [field]: value }));
  };

  const handleLineItemChange = useCallback((id: string, field: keyof LineItem, value: string | number) => {
    setLineItems((prev) =>
      prev.map((item) => {
        if (item.id !== id) return item;

        const updated = { ...item, [field]: value };

        // Recalculate total when quantity or unitPrice changes
        if (field === 'quantity' || field === 'unitPrice') {
          updated.total = updated.quantity * updated.unitPrice;
        }

        return updated;
      })
    );
  }, []);

  const addLineItem = useCallback(() => {
    const newId = (Math.max(...lineItems.map((item) => parseInt(item.id))) + 1).toString();
    setLineItems((prev) => [
      ...prev,
      {
        id: newId,
        description: '',
        quantity: 1,
        unitOfMeasure: 'EA',
        unitPrice: 0,
        total: 0,
      },
    ]);
  }, [lineItems]);

  const removeLineItem = useCallback((id: string) => {
    setLineItems((prev) => prev.filter((item) => item.id !== id));
  }, []);

  const formatCurrency = (amount: number) => {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency: 'USD',
    }).format(amount);
  };

  const handlePrint = useCallback(() => {
    if (!vendorInfo.name) {
      toast.error('Missing Information', 'Please provide vendor information.');
      return;
    }

    if (lineItems.some((item) => !item.description)) {
      toast.error('Missing Information', 'Please fill in all line item descriptions.');
      return;
    }

    window.print();
  }, [vendorInfo, lineItems, toast]);

  const handleDownloadPDF = useCallback(async () => {
    if (!vendorInfo.name) {
      toast.error('Missing Information', 'Please provide vendor information.');
      return;
    }

    if (lineItems.some((item) => !item.description)) {
      toast.error('Missing Information', 'Please fill in all line item descriptions.');
      return;
    }

    try {
      const element = printRef.current;
      if (!element) {
        toast.error('Error', 'Unable to generate PDF.');
        return;
      }

      toast.info('Generating PDF', 'Please wait...');

      // Create an iframe to isolate from main document's CSS
      const iframe = document.createElement('iframe');
      iframe.style.position = 'absolute';
      iframe.style.left = '-9999px';
      iframe.style.width = '816px'; // 8.5 inches at 96 DPI
      iframe.style.height = '1056px'; // 11 inches at 96 DPI
      document.body.appendChild(iframe);

      const iframeDoc = iframe.contentDocument || iframe.contentWindow?.document;
      if (!iframeDoc) {
        throw new Error('Could not access iframe document');
      }

      // Write a clean HTML document with inline styles only
      iframeDoc.open();
      iframeDoc.write(`
        <!DOCTYPE html>
        <html>
        <head>
          <style>
            * { margin: 0; padding: 0; box-sizing: border-box; }
            body { font-family: Arial, sans-serif; background: white; }
          </style>
        </head>
        <body></body>
        </html>
      `);
      iframeDoc.close();

      // Clone and prepare the content
      const clone = element.cloneNode(true) as HTMLElement;
      
      // Apply all computed styles as inline styles to avoid CSS dependencies
      const applyInlineStyles = (source: HTMLElement, target: HTMLElement) => {
        const computed = window.getComputedStyle(source);
        const inlineStyle: string[] = [];
        
        // Copy essential style properties
        const props = [
          'background-color', 'color', 'border', 'border-color', 'border-width',
          'border-style', 'padding', 'margin', 'font-size', 'font-weight',
          'font-family', 'text-align', 'display', 'width', 'height', 'line-height'
        ];
        
        props.forEach(prop => {
          const value = computed.getPropertyValue(prop);
          if (value && value !== 'auto' && !value.includes('oklch')) {
            inlineStyle.push(`${prop}: ${value}`);
          }
        });
        
        target.setAttribute('style', inlineStyle.join('; '));
        
        // Recursively apply to children
        for (let i = 0; i < source.children.length; i++) {
          if (target.children[i]) {
            applyInlineStyles(source.children[i] as HTMLElement, target.children[i] as HTMLElement);
          }
        }
      };
      
      applyInlineStyles(element, clone);
      
      // Append to iframe body
      iframeDoc.body.appendChild(clone);

      // Wait for iframe to render
      await new Promise(resolve => setTimeout(resolve, 100));

      // Capture using html2canvas
      const canvas = await html2canvas(iframeDoc.body, {
        scale: 2,
        useCORS: true,
        logging: false,
        backgroundColor: '#ffffff',
        windowWidth: 816,
        windowHeight: 1056
      });

      // Create PDF using jsPDF
      const imgData = canvas.toDataURL('image/jpeg', 0.98);
      const pdf = new jsPDF({
        orientation: 'portrait',
        unit: 'in',
        format: 'letter'
      });

      const imgWidth = 8.5;
      const imgHeight = (canvas.height * imgWidth) / canvas.width;
      
      pdf.addImage(imgData, 'JPEG', 0, 0, imgWidth, imgHeight);
      pdf.save(`${poNumber}.pdf`);

      // Clean up
      document.body.removeChild(iframe);
      
      toast.success('PDF Downloaded', `${poNumber}.pdf has been downloaded.`);
    } catch (error) {
      console.error('PDF generation error:', error);
      toast.error('Error', 'Failed to generate PDF. Please try again.');
    }
  }, [vendorInfo, lineItems, toast, poNumber]);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-7xl max-h-[95vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 print:hidden">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-blue-100 rounded-lg">
              <FileText className="w-6 h-6 text-blue-600" />
            </div>
            <div>
              <h2 className="text-xl font-semibold text-gray-900">Purchase Order Generator</h2>
              <p className="text-sm text-gray-500">
                {purchaseOrderSysId ? 'Generate printout from ServiceNow PO' : 'Create professional PO printouts for vendors'}
              </p>
            </div>
          </div>
          {(isLoadingPO || isLoadingLines) && (
            <div className="flex items-center gap-2 text-blue-600 mr-4">
              <Loader2 className="w-5 h-5 animate-spin" />
              <span className="text-sm">Loading PO data...</span>
            </div>
          )}
          <div className="flex items-center gap-2">
            <button
              onClick={handleDownloadPDF}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg"
            >
              <Download className="w-4 h-4" />
              Download PDF
            </button>
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-lg"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
            <button
              onClick={onClose}
              className="p-2 text-gray-500 hover:text-gray-700 hover:bg-gray-100 rounded-lg"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content - Split View */}
        <div className="flex-1 overflow-hidden flex">
          {/* Form Panel */}
          <div className="w-1/2 overflow-y-auto p-6 border-r border-gray-200 print:hidden">
            <div className="space-y-6">
              {/* PO Information */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4">PO Information</h3>
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      PO Number
                    </label>
                    <input
                      type="text"
                      value={poNumber}
                      onChange={(e) => setPoNumber(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      PO Date
                    </label>
                    <input
                      type="date"
                      value={poDate}
                      onChange={(e) => setPoDate(e.target.value)}
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                </div>
              </div>

              {/* Ship To Address */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <MapPin className="w-5 h-5" />
                  Ship To Address
                </h3>
                <select
                  value={selectedShipTo}
                  onChange={(e) => setSelectedShipTo(e.target.value)}
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                >
                  {SHIP_TO_ADDRESSES.map((addr) => (
                    <option key={addr.id} value={addr.id}>
                      {addr.label}
                    </option>
                  ))}
                </select>
              </div>

              {/* Vendor Information */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Building2 className="w-5 h-5" />
                  Vendor Information
                </h3>
                <div className="space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Vendor Name <span className="text-red-500">*</span>
                    </label>
                    <input
                      type="text"
                      value={vendorInfo.name}
                      onChange={(e) => handleVendorChange('name', e.target.value)}
                      placeholder="Company name"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Contact Name
                      </label>
                      <input
                        type="text"
                        value={vendorInfo.contactName}
                        onChange={(e) => handleVendorChange('contactName', e.target.value)}
                        placeholder="Contact person"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Email
                      </label>
                      <input
                        type="email"
                        value={vendorInfo.email}
                        onChange={(e) => handleVendorChange('email', e.target.value)}
                        placeholder="vendor@example.com"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Phone
                    </label>
                    <input
                      type="tel"
                      value={vendorInfo.phone}
                      onChange={(e) => handleVendorChange('phone', e.target.value)}
                      placeholder="+1 (555) 123-4567"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      Street Address
                    </label>
                    <input
                      type="text"
                      value={vendorInfo.street}
                      onChange={(e) => handleVendorChange('street', e.target.value)}
                      placeholder="123 Main Street"
                      className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        City
                      </label>
                      <input
                        type="text"
                        value={vendorInfo.city}
                        onChange={(e) => handleVendorChange('city', e.target.value)}
                        placeholder="City"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        State/Province
                      </label>
                      <input
                        type="text"
                        value={vendorInfo.state}
                        onChange={(e) => handleVendorChange('state', e.target.value)}
                        placeholder="State/Province"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Postal Code
                      </label>
                      <input
                        type="text"
                        value={vendorInfo.postalCode}
                        onChange={(e) => handleVendorChange('postalCode', e.target.value)}
                        placeholder="12345"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Country
                      </label>
                      <input
                        type="text"
                        value={vendorInfo.country}
                        onChange={(e) => handleVendorChange('country', e.target.value)}
                        placeholder="Country"
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Line Items */}
              <div>
                <div className="flex items-center justify-between mb-4">
                  <h3 className="text-lg font-semibold text-gray-900 flex items-center gap-2">
                    <Calculator className="w-5 h-5" />
                    Line Items
                  </h3>
                  <button
                    onClick={addLineItem}
                    className="flex items-center gap-2 px-3 py-1.5 text-sm font-medium text-blue-700 bg-blue-100 hover:bg-blue-200 rounded-lg"
                  >
                    <Plus className="w-4 h-4" />
                    Add Line
                  </button>
                </div>
                <div className="space-y-3">
                  {lineItems.map((item, index) => (
                    <div key={item.id} className="p-4 bg-gray-50 rounded-lg space-y-3">
                      <div className="flex items-center justify-between">
                        <span className="text-sm font-medium text-gray-700">
                          Item {index + 1}
                        </span>
                        {lineItems.length > 1 && (
                          <button
                            onClick={() => removeLineItem(item.id)}
                            className="p-1 text-red-600 hover:bg-red-100 rounded"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        )}
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 mb-1">
                          Description <span className="text-red-500">*</span>
                        </label>
                        <textarea
                          value={item.description}
                          onChange={(e) => handleLineItemChange(item.id, 'description', e.target.value)}
                          placeholder="Item description"
                          rows={2}
                          className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                        />
                      </div>
                      <div className="grid grid-cols-4 gap-2">
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Quantity
                          </label>
                          <input
                            type="number"
                            min="1"
                            value={item.quantity}
                            onChange={(e) => handleLineItemChange(item.id, 'quantity', parseFloat(e.target.value) || 1)}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            UOM
                          </label>
                          <select
                            value={item.unitOfMeasure}
                            onChange={(e) => handleLineItemChange(item.id, 'unitOfMeasure', e.target.value)}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                          >
                            <option value="EA">EA</option>
                            <option value="BOX">BOX</option>
                            <option value="HR">HR</option>
                            <option value="DAY">DAY</option>
                            <option value="MONTH">MONTH</option>
                            <option value="UNIT">UNIT</option>
                          </select>
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Unit Price
                          </label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => handleLineItemChange(item.id, 'unitPrice', parseFloat(e.target.value) || 0)}
                            className="w-full px-2 py-1.5 border border-gray-300 rounded-lg text-sm"
                          />
                        </div>
                        <div>
                          <label className="block text-xs font-medium text-gray-700 mb-1">
                            Total
                          </label>
                          <div className="px-2 py-1.5 bg-gray-200 border border-gray-300 rounded-lg text-sm font-medium">
                            {formatCurrency(item.total)}
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* Additional Charges */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <DollarSign className="w-5 h-5" />
                  Additional Charges
                </h3>
                <div className="space-y-3">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Tax Rate (%)
                      </label>
                      <input
                        type="number"
                        min="0"
                        max="100"
                        step="0.01"
                        value={taxRate}
                        onChange={(e) => setTaxRate(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">
                        Shipping Fee
                      </label>
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={shippingFee}
                        onChange={(e) => setShippingFee(parseFloat(e.target.value) || 0)}
                        className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Terms */}
              <div>
                <h3 className="text-lg font-semibold text-gray-900 mb-4 flex items-center gap-2">
                  <Calendar className="w-5 h-5" />
                  Payment Terms
                </h3>
                <input
                  type="text"
                  value={paymentTerms}
                  onChange={(e) => setPaymentTerms(e.target.value)}
                  placeholder="Net 45 days from delivery date"
                  className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm"
                />
              </div>
            </div>
          </div>

          {/* Preview Panel */}
          <div className="w-1/2 overflow-y-auto bg-gray-100 p-8">
            <div
              ref={printRef}
              data-print-content
              className="bg-white shadow-lg mx-auto"
              style={{ width: '8.5in', minHeight: '11in', padding: '0.75in' }}
            >
              {/* Header with Logo and Company Info */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '24px', paddingBottom: '16px', borderBottom: '4px solid #0066CC' }}>
                <div>
                  <img
                    src="/illumin-2023_B.png"
                    alt="illumin"
                    style={{ height: '40px', marginBottom: '10px' }}
                  />
                  <div style={{ fontSize: '10px', color: '#4B5563', lineHeight: '1.4' }}>
                    <p style={{ fontWeight: '600' }}>illumin</p>
                    <p>70 University Ave Suite 1200</p>
                    <p>Toronto, Ontario M5J 2M4</p>
                    <p>Canada</p>
                  </div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <h1 style={{ fontSize: '24px', fontWeight: 'bold', marginBottom: '10px', color: '#0066CC' }}>PURCHASE ORDER</h1>
                  <div style={{ fontSize: '12px' }}>
                    <div style={{ marginBottom: '6px' }}>
                      <p style={{ fontWeight: '600', color: '#4B5563', margin: 0 }}>PO Number:</p>
                      <p style={{ fontSize: '16px', fontWeight: 'bold', color: '#1F2937', margin: 0 }}>{poNumber}</p>
                    </div>
                    <div>
                      <p style={{ fontWeight: '600', color: '#4B5563', margin: 0 }}>Date:</p>
                      <p style={{ color: '#1F2937', margin: 0 }}>{new Date(poDate).toLocaleDateString('en-US', {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}</p>
                    </div>
                  </div>
                </div>
              </div>

              {/* Addresses Section */}
              <div style={{ display: 'flex', gap: '16px', marginBottom: '24px' }}>
                {/* Bill To */}
                <div style={{ flex: '1 1 0', padding: '12px', borderRadius: '8px', backgroundColor: '#F3F4F6', minWidth: 0 }}>
                  <h3 style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '12px', textTransform: 'uppercase', color: '#0066CC' }}>Bill To:</h3>
                  <div style={{ fontSize: '11px', color: '#374151', lineHeight: '1.4' }}>
                    <p style={{ fontWeight: '600', marginBottom: '4px' }}>{BILL_TO_ADDRESS.company}</p>
                    <p style={{ wordBreak: 'break-word' }}>{BILL_TO_ADDRESS.street}</p>
                    <p>
                      {BILL_TO_ADDRESS.city}, {BILL_TO_ADDRESS.state} {BILL_TO_ADDRESS.postalCode}
                    </p>
                    <p>{BILL_TO_ADDRESS.country}</p>
                  </div>
                </div>

                {/* Ship To */}
                <div style={{ flex: '1 1 0', padding: '12px', borderRadius: '8px', backgroundColor: '#F3F4F6', minWidth: 0 }}>
                  <h3 style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '12px', textTransform: 'uppercase', color: '#0066CC' }}>Ship To:</h3>
                  {selectedShipToAddress && (
                    <div style={{ fontSize: '11px', color: '#374151', lineHeight: '1.4' }}>
                      <p style={{ fontWeight: '600', marginBottom: '4px' }}>{selectedShipToAddress.company}</p>
                      <p style={{ wordBreak: 'break-word' }}>{selectedShipToAddress.street}</p>
                      <p>
                        {selectedShipToAddress.city}, {selectedShipToAddress.state}{' '}
                        {selectedShipToAddress.postalCode}
                      </p>
                      <p>{selectedShipToAddress.country}</p>
                    </div>
                  )}
                </div>

                {/* Vendor */}
                <div style={{ flex: '1 1 0', padding: '12px', borderRadius: '8px', backgroundColor: '#FEF3C7', minWidth: 0 }}>
                  <h3 style={{ fontWeight: 'bold', marginBottom: '8px', fontSize: '12px', textTransform: 'uppercase', color: '#92400E' }}>Vendor:</h3>
                  <div style={{ fontSize: '11px', color: '#374151', lineHeight: '1.4' }}>
                    <p style={{ fontWeight: '600', marginBottom: '4px' }}>{vendorInfo.name || '[Vendor Name]'}</p>
                    {vendorInfo.contactName && <p style={{ fontSize: '10px', marginBottom: '2px' }}>Attn: {vendorInfo.contactName}</p>}
                    {vendorInfo.street && <p style={{ wordBreak: 'break-word' }}>{vendorInfo.street}</p>}
                    {(vendorInfo.city || vendorInfo.state || vendorInfo.postalCode) && (
                      <p>
                        {vendorInfo.city}
                        {vendorInfo.city && vendorInfo.state && ', '}
                        {vendorInfo.state} {vendorInfo.postalCode}
                      </p>
                    )}
                    {vendorInfo.country && <p>{vendorInfo.country}</p>}
                    {vendorInfo.email && <p style={{ fontSize: '10px', marginTop: '4px' }}>✉ {vendorInfo.email}</p>}
                    {vendorInfo.phone && <p style={{ fontSize: '10px' }}>☎ {vendorInfo.phone}</p>}
                  </div>
                </div>
              </div>

              {/* Line Items Table */}
              <div style={{ marginBottom: '24px', overflow: 'hidden' }}>
                <h3 style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '8px', textTransform: 'uppercase', color: '#0066CC' }}>Order Details</h3>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '11px', tableLayout: 'fixed' }}>
                  <colgroup>
                    <col style={{ width: '6%' }} />
                    <col style={{ width: '44%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '8%' }} />
                    <col style={{ width: '17%' }} />
                    <col style={{ width: '17%' }} />
                  </colgroup>
                  <thead>
                    <tr style={{ backgroundColor: '#0066CC', color: 'white' }}>
                      <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: '600' }}>#</th>
                      <th style={{ padding: '8px 6px', textAlign: 'left', fontWeight: '600' }}>Description</th>
                      <th style={{ padding: '8px 6px', textAlign: 'center', fontWeight: '600' }}>Qty</th>
                      <th style={{ padding: '8px 6px', textAlign: 'center', fontWeight: '600' }}>UOM</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: '600' }}>Unit Price</th>
                      <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: '600' }}>Total</th>
                    </tr>
                  </thead>
                  <tbody>
                    {lineItems.map((item, index) => (
                      <tr
                        key={item.id}
                        style={{ backgroundColor: index % 2 === 0 ? '#F9FAFB' : 'white' }}
                      >
                        <td style={{ padding: '10px 6px', borderBottom: '1px solid #E5E7EB', color: '#6B7280', verticalAlign: 'top' }}>
                          {index + 1}
                        </td>
                        <td style={{ padding: '10px 6px', borderBottom: '1px solid #E5E7EB', color: '#1F2937', wordBreak: 'break-word', verticalAlign: 'top' }}>
                          {item.description || '[Description]'}
                        </td>
                        <td style={{ padding: '10px 6px', borderBottom: '1px solid #E5E7EB', color: '#1F2937', textAlign: 'center', verticalAlign: 'top' }}>
                          {item.quantity}
                        </td>
                        <td style={{ padding: '10px 6px', borderBottom: '1px solid #E5E7EB', color: '#6B7280', textAlign: 'center', verticalAlign: 'top' }}>
                          {item.unitOfMeasure}
                        </td>
                        <td style={{ padding: '10px 6px', borderBottom: '1px solid #E5E7EB', color: '#1F2937', textAlign: 'right', verticalAlign: 'top' }}>
                          {formatCurrency(item.unitPrice)}
                        </td>
                        <td style={{ padding: '10px 6px', borderBottom: '1px solid #E5E7EB', color: '#0066CC', textAlign: 'right', fontWeight: '600', verticalAlign: 'top' }}>
                          {formatCurrency(item.total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Totals Section */}
              <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '24px' }}>
                <div style={{ width: '280px' }}>
                  <div style={{ fontSize: '12px' }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#F9FAFB', marginBottom: '2px' }}>
                      <span style={{ color: '#6B7280' }}>Subtotal:</span>
                      <span style={{ fontWeight: '600', color: '#1F2937' }}>{formatCurrency(subtotal)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#F9FAFB', marginBottom: '2px' }}>
                      <span style={{ color: '#6B7280' }}>Tax ({taxRate}%):</span>
                      <span style={{ fontWeight: '600', color: '#1F2937' }}>{formatCurrency(taxAmount)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '8px 12px', backgroundColor: '#F9FAFB', marginBottom: '2px' }}>
                      <span style={{ color: '#6B7280' }}>Shipping:</span>
                      <span style={{ fontWeight: '600', color: '#1F2937' }}>{formatCurrency(shippingFee)}</span>
                    </div>
                    <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px', backgroundColor: '#0066CC', color: 'white', fontSize: '14px', fontWeight: 'bold', marginTop: '4px' }}>
                      <span>TOTAL:</span>
                      <span>{formatCurrency(grandTotal)}</span>
                    </div>
                  </div>
                </div>
              </div>

              {/* Payment Terms */}
              <div style={{ marginBottom: '20px', padding: '12px', borderRadius: '8px', backgroundColor: '#EFF6FF', borderLeft: '4px solid #0066CC' }}>
                <h4 style={{ fontWeight: 'bold', fontSize: '12px', marginBottom: '6px', color: '#0066CC' }}>PAYMENT TERMS</h4>
                <p style={{ fontSize: '11px', color: '#374151', margin: 0 }}>{paymentTerms}</p>
              </div>

              {/* Footer Notes */}
              <div style={{ fontSize: '10px', paddingTop: '12px', borderTop: '1px solid #E5E7EB', color: '#6B7280' }}>
                <p style={{ marginBottom: '6px' }}>
                  Please reference PO Number <strong style={{ color: '#1F2937' }}>{poNumber}</strong> on all invoices and correspondence.
                </p>
                <p style={{ margin: 0 }}>
                  If you have any questions about this purchase order, please contact our procurement department.
                </p>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Print Styles */}
      <style>{`
        @media print {
          body * {
            visibility: hidden;
          }
          .print\\:hidden {
            display: none !important;
          }
          [data-print-content],
          [data-print-content] * {
            visibility: visible;
          }
          [data-print-content] {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
            background: white;
          }
        }
        @page {
          size: letter;
          margin: 0;
        }
      `}</style>
    </div>
  );
}