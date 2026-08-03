import React, { useState, useEffect, useRef } from 'react';
import { reportsApi } from '../utils/dashboardApi';

// jsPDF is optional - only needed for the "Download PDF" button.
// npm install jspdf
import { jsPDF } from 'jspdf';

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

function downloadPdf(filename, title, text) {
  const doc = new jsPDF();
  const marginLeft = 14;
  const marginTop = 20;
  const pageWidth = doc.internal.pageSize.getWidth() - marginLeft * 2;

  doc.setFontSize(14);
  doc.text(title, marginLeft, marginTop);

  doc.setFontSize(11);
  const lines = doc.splitTextToSize(text, pageWidth);
  doc.text(lines, marginLeft, marginTop + 10);

  doc.save(filename);
}

// Generic search-as-you-type dropdown. Opens on focus (showing an initial
// unfiltered list from fetchOptions('')), then re-queries on a 300ms
// debounce as the person types. Selecting an option locks the input to its
// label; typing again clears the selection and re-opens the list.
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
  const [reportType, setReportType] = useState('customer'); // 'customer' | 'staff'

  // ---- Customer Report state ----
  // selectedCustomer: { customer_id, customer_name, phone_number, place, district } | null
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  // ---- Staff Report state ----
  // selectedStaff: { id, full_name, employee_id, department, role } | null
  const [selectedStaff, setSelectedStaff] = useState(null);
  const [period, setPeriod] = useState('last_week');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  // ---- Shared state ----
  const [language, setLanguage] = useState('english');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [report, setReport] = useState(null); // { report, customer_name/staff_name, ... }

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
      <h2 style={{ marginBottom: '1rem' }}>Reports</h2>

      {/* Report type toggle */}
      <div className="control-filter-panel">
        <div className="dropdown-controls-group">
          <button
            className="btn-primary"
            style={{
              opacity: reportType === 'customer' ? 1 : 0.55,
            }}
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
            style={{
              opacity: reportType === 'staff' ? 1 : 0.55,
            }}
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

      {/* Input section */}
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
              onClick={() => downloadPdf(`${baseFilename}.pdf`, reportTitle, report.report)}
            >
              Download PDF
            </button>
          </div>
        </div>
      )}
    </div>
  );
}