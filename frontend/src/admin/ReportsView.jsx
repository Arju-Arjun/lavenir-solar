import React, { useState, useEffect, useRef, useMemo } from 'react';
import { reportsApi } from '../utils/dashboardApi';

// jsPDF and jsPDF-autotable for multi-page PDF generation with watermark support
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';

const PERIOD_OPTIONS = [
  { value: 'last_week', label: 'Last Week' },
  { value: 'last_month', label: '1 Month' },
  { value: 'custom', label: 'Custom Range' },
];

const LANGUAGE_OPTIONS = [
  { value: 'english', label: 'English' },
  { value: 'malayalam', label: 'Malayalam' },
  { value: 'hindi', label: 'Hindi' },
  { value: 'manglish', label: 'Manglish' },
];

function downloadTxt(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

// Helper to load watermark logo if available
async function loadWatermarkLogo() {
  // Placeholder or standard logo fetch mechanism if needed
  return { dataUrl: '', aspect: 1 };
}

async function downloadPdf(filename, title, text, customerInfo = {}) {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const pageHeight = doc.internal.pageSize.getHeight();
  const marginLeft = 14;
  let currentY = 20;

  // Header Title Two-Tone
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  const partOne = "Lavenir ";
  const partTwo = "Solar";
  const partOneWidth = doc.getStringUnitWidth(partOne) * doc.getFontSize() / doc.internal.scaleFactor;
  const partTwoWidth = doc.getStringUnitWidth(partTwo) * doc.getFontSize() / doc.internal.scaleFactor;
  const titleStartX = (pageWidth - (partOneWidth + partTwoWidth)) / 2;

  doc.setTextColor(4, 44, 83);
  doc.text(partOne, titleStartX, currentY, { align: "left" });

  doc.setTextColor(186, 117, 23);
  doc.text(partTwo, titleStartX + partOneWidth, currentY, { align: "left" });

  currentY += 7;
  doc.setFontSize(12);
  doc.setFont("helvetica", "normal");
  doc.setTextColor(60, 60, 60);
  doc.text(title, pageWidth / 2, currentY, { align: "center" });

  currentY += 10;
  doc.setFontSize(10);

  // If customer info is provided, display personal details line by line
  if (customerInfo.name || customerInfo.id || customerInfo.district || customerInfo.place || customerInfo.capacity) {
    if (customerInfo.name) {
      doc.text(`Customer Name: ${customerInfo.name}`, marginLeft, currentY);
      currentY += 6;
    }
    if (customerInfo.id) {
      doc.text(`Customer ID: ${customerInfo.id}`, marginLeft, currentY);
      currentY += 6;
    }
    if (customerInfo.district) {
      doc.text(`District: ${customerInfo.district}`, marginLeft, currentY);
      currentY += 6;
    }
    if (customerInfo.place) {
      doc.text(`Place: ${customerInfo.place}`, marginLeft, currentY);
      currentY += 6;
    }
    if (customerInfo.capacity) {
      doc.text(`Capacity: ${customerInfo.capacity} kW`, marginLeft, currentY);
      currentY += 6;
    }
    currentY += 4;
  }

  // Split report content into printable chunks/paragraphs for multi-page support
  doc.setFontSize(10);
  doc.setTextColor(20, 20, 20);
  const splitText = doc.splitTextToSize(text, pageWidth - (marginLeft * 2));

  // Use autoTable or direct multi-page text insertion
  let cursorY = currentY;
  for (let i = 0; i < splitText.length; i++) {
    if (cursorY > pageHeight - 20) {
      doc.addPage();
      cursorY = 20;
    }
    doc.text(splitText[i], marginLeft, cursorY);
    cursorY += 6;
  }

  // Watermark implementation across all pages
  try {
    const { dataUrl, aspect } = await loadWatermarkLogo();
    if (dataUrl) {
      const watermarkWidth = pageWidth * 0.6;
      const watermarkHeight = watermarkWidth / aspect;
      const x = (pageWidth - watermarkWidth) / 2;
      const y = (pageHeight - watermarkHeight) / 2;

      const totalPages = doc.internal.getNumberOfPages();
      for (let p = 1; p <= totalPages; p++) {
        doc.setPage(p);
        doc.addImage(dataUrl, "PNG", x, y, watermarkWidth, watermarkHeight);
      }
    }
  } catch (err) {
    console.error("Failed to add watermark logo to PDF:", err);
  }

  doc.save(filename);
}

// Generic search-as-you-type dropdown
function SearchableSelect({
  value,
  onSelect,
  fetchOptions,
  getLabel,
  getKey,
  getSubLabel,
  placeholder,
  disabled,
}) {
  const [query, setQuery] = useState('');
  const [options, setOptions] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef(null);
  const containerRef = useRef(null);

  const runSearch = async (q) => {
    setLoading(true);
    try {
      const results = await fetchOptions(q);
      setOptions(results || []);
    } catch (e) {
      setOptions([]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (!open) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => runSearch(query), 300);
    return () => clearTimeout(debounceRef.current);
  }, [query, open]);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (containerRef.current && !containerRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const handleFocus = () => {
    setOpen(true);
    if (options.length === 0) runSearch(query);
  };

  return (
    <div ref={containerRef} style={{ position: 'relative', flex: '1 1 220px', minWidth: '220px' }}>
      <input
        type="text"
        className="search-bar-input"
        placeholder={placeholder}
        value={value ? getLabel(value) : query}
        onChange={(e) => {
          if (value) onSelect(null);
          setQuery(e.target.value);
          setOpen(true);
        }}
        onFocus={handleFocus}
        disabled={disabled}
        style={{ width: '100%' }}
      />
      {open && (
        <div
          style={{
            position: 'absolute',
            top: 'calc(100% + 4px)',
            left: 0,
            right: 0,
            zIndex: 20,
            background: 'var(--bg-main, #fff)',
            border: '1px solid var(--border-color, #ddd)',
            borderRadius: '6px',
            maxHeight: '260px',
            overflowY: 'auto',
            boxShadow: '0 4px 12px rgba(0,0,0,0.12)',
          }}
        >
          {loading && (
            <div style={{ padding: '0.6rem 0.8rem', fontSize: '0.85rem', opacity: 0.7 }}>
              Searching...
            </div>
          )}
          {!loading && options.length === 0 && (
            <div style={{ padding: '0.6rem 0.8rem', fontSize: '0.85rem', opacity: 0.7 }}>
              No matches
            </div>
          )}
          {!loading &&
            options.map((opt) => (
              <div
                key={getKey(opt)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => {
                  onSelect(opt);
                  setQuery('');
                  setOpen(false);
                }}
                style={{
                  padding: '0.6rem 0.8rem',
                  cursor: 'pointer',
                  fontSize: '0.9rem',
                  borderBottom: '1px solid var(--border-color, #eee)',
                }}
              >
                <div>{getLabel(opt)}</div>
                {getSubLabel && (
                  <div style={{ fontSize: '0.75rem', opacity: 0.6 }}>{getSubLabel(opt)}</div>
                )}
              </div>
            ))}
        </div>
      )}
    </div>
  );
}

export default function ReportsView() {
  const [reportType, setReportType] = useState('customer');

  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [period, setPeriod] = useState('last_week');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const [language, setLanguage] = useState('english');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null);

  const resetOutput = () => {
    setError('');
    setReport(null);
  };

  const handleGenerate = async () => {
    resetOutput();

    if (reportType === 'customer' && !selectedCustomer) {
      setError('Customer തിരഞ്ഞെടുക്കുക.');
      return;
    }
    if (reportType === 'staff' && !selectedStaff) {
      setError('Staff തിരഞ്ഞെടുക്കുക.');
      return;
    }
    if (reportType === 'staff' && period === 'custom' && (!startDate || !endDate)) {
      setError('Custom Range-ന് Start Date, End Date രണ്ടും വേണം.');
      return;
    }

    setLoading(true);
    try {
      if (reportType === 'customer') {
        const data = await reportsApi.generateCustomerReport(selectedCustomer.customer_id, language);
        setReport(data);
      } else {
        const payload =
          period === 'custom'
            ? { period, start_date: startDate, end_date: endDate, language }
            : { period, language };
        const data = await reportsApi.generateStaffReport(selectedStaff.id, payload);
        setReport(data);
      }
    } catch (err) {
      setError(err.message || 'Report generate ചെയ്യാൻ കഴിഞ്ഞില്ല.');
    } finally {
      setLoading(false);
    }
  };

  const reportTitle =
    reportType === 'customer'
      ? `Customer Report - ${report?.customer_name || report?.customer_id || ''}`
      : `Staff Performance Report - ${report?.staff_name || ''}`;

  const baseFilename =
    reportType === 'customer'
      ? `customer_report_${report?.customer_id || 'na'}`
      : `staff_report_${report?.staff_id || 'na'}`;

  return (
    <div className="customers-view-container">
      <div className="profile-header-summary-card"><h2>📋 Reports</h2></div>
      

      <div className="control-filter-panel">
        <div className="dropdown-controls-group">
          <button
            className="btn-primary"
            style={{ opacity: reportType === 'customer' ? 1 : 0.55 }}
            onClick={() => {
              setReportType('customer');
              setSelectedStaff(null);
              resetOutput();
            }}
          >
            Customer Report
          </button>
          <button
            className="btn-primary"
            style={{ opacity: reportType === 'staff' ? 1 : 0.55 }}
            onClick={() => {
              setReportType('staff');
              setSelectedCustomer(null);
              resetOutput();
            }}
          >
            Staff Report
          </button>
        </div>
      </div>

      <div className="control-filter-panel">
        {reportType === 'customer' ? (
          <SearchableSelect
            value={selectedCustomer}
            onSelect={setSelectedCustomer}
            fetchOptions={async (q) => {
              const data = await reportsApi.searchCustomers(q);
              return data.customers || [];
            }}
            getLabel={(c) => `${c.customer_name} (${c.customer_id})`}
            getKey={(c) => c.customer_id}
            getSubLabel={(c) =>
              [c.place, c.district].filter(Boolean).join(', ') +
              (c.phone_number ? ` · ${c.phone_number}` : '')
            }
            placeholder="Search customer (name / ID / phone)"
          />
        ) : (
          <>
            <SearchableSelect
              value={selectedStaff}
              onSelect={setSelectedStaff}
              fetchOptions={async (q) => {
                const data = await reportsApi.searchStaff(q);
                return data.staff || [];
              }}
              getLabel={(s) => (s.employee_id ? `${s.full_name} (${s.employee_id})` : s.full_name)}
              getKey={(s) => s.id}
              getSubLabel={(s) => [s.department, s.role].filter(Boolean).join(' · ')}
              placeholder="Search staff (name / employee ID)"
            />

            <select
              className="control-select-dropdown"
              value={period}
              onChange={(e) => setPeriod(e.target.value)}
            >
              {PERIOD_OPTIONS.map((opt) => (
                <option key={opt.value} value={opt.value}>
                  {opt.label}
                </option>
              ))}
            </select>

            {period === 'custom' && (
              <>
                <input
                  type="date"
                  className="control-select-dropdown"
                  value={startDate}
                  onChange={(e) => setStartDate(e.target.value)}
                />
                <input
                  type="date"
                  className="control-select-dropdown"
                  value={endDate}
                  onChange={(e) => setEndDate(e.target.value)}
                />
              </>
            )}
          </>
        )}

        <select
          className="control-select-dropdown"
          value={language}
          onChange={(e) => setLanguage(e.target.value)}
        >
          {LANGUAGE_OPTIONS.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>

        <button className="btn-primary" onClick={handleGenerate} disabled={loading}>
          {loading ? 'Generating...' : 'Generate Report'}
        </button>
      </div>

      {loading && <div className="table-loader-fallback">Gemini Report Generating...</div>}
      {error && <div className="table-error-fallback">{error}</div>}

      {report && (
        <div className="table-responsive-wrapper" style={{ padding: '1.5rem' }}>
          <h3 style={{ marginBottom: '1rem' }}>{reportTitle}</h3>

          <pre
            style={{
              whiteSpace: 'pre-wrap',
              fontFamily: 'inherit',
              fontSize: '0.95rem',
              lineHeight: 1.6,
              color: 'var(--text-main)',
              marginBottom: '1.5rem',
            }}
          >
            {report.report}
          </pre>

          <div className="dropdown-controls-group">
            <button
              className="btn-primary"
              onClick={() => downloadTxt(`${baseFilename}.txt`, report.report)}
            >
              Download TXT
            </button>
            <button
              className="btn-primary"
              onClick={() =>
                downloadPdf(`${baseFilename}.pdf`, reportTitle, report.report, {
                  name: selectedCustomer?.customer_name,
                  id: selectedCustomer?.customer_id,
                  district: selectedCustomer?.district,
                  place: selectedCustomer?.place,
                  capacity: selectedCustomer?.capacity_kw,
                })
              }
            >
              Download PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}